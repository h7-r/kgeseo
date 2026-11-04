# NPC 콘텐츠 게시 상태 (작업 D1)

기준: `feat/SJ-npc-turn-idempotency-store` / `7a714c4`. 브랜치: `feat/SJ-npc-publication-state`.

## 범위와 연결 상태

**구현한 것**
- 불변 콘텐츠 버전 · 현재 게시 상태 · 변경 이력 저장(Alembic `f3b8d2c6a1e7`)
- Async Repository, 상태 전이 서비스(`NpcPublicationService`)
- 멱등 저장소 guard(`publication_state_guard`)와, guard를 연결한 저장소 생성 함수(`build_npc_turn_idempotency_store`)
- generic 응답 우회 차단, 격리 MySQL 테스트

**연결하지 않은 것**
- 관리용 CLI, 관리자 HTTP
- NPC HTTP 라우터
- 서버 시작 시 `PinnedContentStore` 등록
- 세션 생성 시 신규 세션 차단
- 신규 게시 · 재개의 PUB-GATE 최종 연결(DB 승인 이력)
- 운영 LLM(OFF)

**변경하지 않은 것**
- 승인 영속화 브랜치(`e3915c5`)는 병합하거나 재구현하지 않았다.
- 기존 revision은 바꾸지 않았다.

## 상태와 의미 (PM v0.4.6)

| 상태 | 신규 세션 | 진행 중 세션의 케이스 NPC 대사 | 게임 진행 · Client Bundle · Hint API |
|---|---|---|---|
| `published` | 허용 | 사용 | 유지 |
| `suspended` (일반 중단) | 차단 | 사용(고정 게시본) | 유지 |
| `blocked` (긴급 중단) | 차단 | 다음 요청부터 generic | 유지 |

`PublicationPolicy(status)`가 위 표를 코드로 제공한다. 세션 생성 · 라우터는 아직 이 정책을 쓰지 않는다.

## 저장 구조

| 테이블 | 성격 | 내용 |
|---|---|---|
| `npc_content_versions` | 불변 | `(case_id, content_version)` PK, `content_fingerprint`, `registered_at`. 같은 버전을 다른 fingerprint로 다시 등록하면 `ContentFingerprintConflictError` |
| `npc_publication_states` | 현재 상태 | `(case_id, content_version)` PK(버전 FK), `status`, `revision`(변경마다 +1), `updated_at` |
| `npc_publication_events` | 추가만 | `publication_event {case_id, content_version, from, to, reason, actor, at}` + `state_revision`. UNIQUE `(case_id, content_version, state_revision)` |

- 게시 중단을 콘텐츠 삭제나 메모리 저장소 제거로 표현하지 않는다. 상태 행만 바뀐다.
- 버전 · 이력 행의 UPDATE · DELETE는 ORM 이벤트로 거부한다.
- DB 트리거는 만들지 않았다. 승인 이력 migration에서 확인한 TRIGGER 권한 · binlog 1419 문제를 피하기 위해서다. 그래서 직접 SQL로 수정하는 것은 운영 DB 계정 권한으로 막아야 한다(앱 계정에 이 테이블들의 UPDATE · DELETE 권한을 주지 않음).
- 서버를 다시 시작해도 마지막으로 commit된 상태가 그대로다. `restorable_versions()`가 새 트랜잭션에서 전체 상태를 읽는다. blocked도 게임 콘텐츠 유지를 위해 포함한다.

## 전이

| 전이 | 메서드 | 조건 |
|---|---|---|
| (없음) → published | `publish_new()` | DB 승인 이력으로 PUB-GATE 통과(아래 「PUB-GATE 연결」) |
| suspended → published (재개) | `resume()` | 현재 승인 이력으로 PUB-GATE 재판정 + fingerprint가 등록 버전과 같음 |
| blocked → published (재개) | `resume()` | 위에 더해 G1 · G2 · G3 최종 approved 기록이 모두 마지막 차단 시각 **이후** |
| published → suspended | `suspend()` | — |
| published · suspended → blocked | `block()` | 선택 `expected_status`로 동시 변경 감지 |
| blocked → blocked | `block()` | 상태 · 이력은 그대로, 저장 응답 철회만 다시 함(운영 재시도용) |
| blocked → suspended | — | `PublicationTransitionError` |

- 모든 전이에 `reason`(1~500자)과 `actor`(1~100자)가 필수다. 이 서비스는 `actor`를 검증하지 않으므로, 호출하는 관리 CLI가 검증된 주체를 넘겨야 한다.
- 동시 변경은 상태 행 `FOR UPDATE`로 직렬화된다. 잠근 뒤 본 상태로 전이를 판정하므로 나중 요청은 `PublicationTransitionError` · `PublicationStateConflictError`가 된다.
- 재개는 `content_version`을 늘리지 않는다. 승인 기록과 차단 이력은 고치거나 지우지 않고, 상태 이력은 추가만 한다.
- 차단 때 지운 저장 응답은 재개 뒤에도 되살아나지 않는다(그 턴의 재전송은 계속 `TurnWithdrawn`).

## PUB-GATE 연결 (작업 D2)

`publish_new()` · `resume()`은 서버가 읽은 게시 파일 묶음(`BundleSnapshot`, `published_content_loader`가 읽은 바이트)만 받는다.
- 외부에서 만든 `PublicationResult`, 클라이언트가 보낸 승인 결과, `npc.json`의 `approvals[]`는 받지도 쓰지도 않는다. 예전 `publish(gate=PublicationResult)`는 지웠다.
- **fingerprint:** 받은 바이트로 서버가 `compute_content_fingerprint()`를 다시 계산한다. 게이트도 같은 바이트로 HEADER(파일 머리 fingerprint = 재계산 값)를 검사한다. 그래서 「게이트가 검사한 콘텐츠」와 「등록하는 fingerprint」가 구조적으로 같다.
- **승인 범위:** DB 승인 이력 중 정확히 `(case_content, case_id, content_version)` 대상의 기록만 읽는다. `gate_decisions()`는 그중 `target_hash == 재계산 fingerprint`인 기록만 본다.
  - 다른 버전 · 다른 내용(fingerprint)의 승인은 재사용할 수 없다.
  - `ReviewRecord` · `gate_decisions()` 판정 규칙은 바꾸지 않았다.
- **재개 시 fingerprint:** 등록된(불변) 버전 fingerprint와 다르면 `ContentFingerprintMismatchError`이고, 게이트를 돌리기 전에 거부한다.
- **VERSION_ORDER:** 게이트에 메모리 store 대신 DB 등록 버전 목록(같은 케이스, 자기 버전 제외)을 넘긴다(`_VersionOrderView`). 게이트가 검증한 묶음은 `PublicationOutcome.pinned`로 돌려준다. 서버 시작 등록은 별도 작업이다.
- **blocked 재개:** 관문별 최종 기록은 `gate_decisions()`와 같은 방식(같은 fingerprint, `(reviewed_at, review_id)` 최신)으로 고른다. 그 기록의 `reviewed_at`이 마지막 `→ blocked` 이력 시각보다 뒤여야 한다. 같은 밀리초는 인정하지 않는다.

**한 트랜잭션 · 잠금 순서**
1. 승인 대상 잠금 행 `npc_approval_targets` `FOR UPDATE`. `locked_approval_history()`를 쓰며, 승인 이력 append와 같은 잠금이다. 잠금 읽기로 최신 커밋 이력을 읽는다.
2. 같은 케이스의 `npc_content_versions` 범위 `FOR SHARE`. 케이스 단위로 VERSION_ORDER를 직렬화한다.
3. 게시 상태 행 `FOR UPDATE`.
4. 게이트 판정 → 버전 등록 · 상태 · 이력 → commit. commit 뒤에만 결과를 돌려준다.

이 순서 때문에 다음이 보장된다.
- 철회가 판정 전에 commit되면 → 게시 거부
- 철회를 판정 ~ 확정 사이에 시도하면 → 승인 대상 잠금을 기다렸다가 게시 확정 뒤에 commit된다. PM에 따라 게시본을 자동 중단하지 않는다.
- 잠금 대기 초과 · 교착 · 중간 실패 → 전부 rollback(부분 게시 없음)
- 판정은 서비스가 연 세션에서만 하고, 호출자 세션은 건드리지 않는다.

## 트랜잭션 · 잠금 계약

| 경로 | 잠금 순서(한 트랜잭션) |
|---|---|
| 게시 · 재개 `publish_new()` · `resume()` | ⓐ 승인 대상 행 `FOR UPDATE` → ⓑ 케이스 버전 범위 `FOR SHARE` → ① 게시 상태 행 `FOR UPDATE` → 버전 · 상태 · 이력 |
| 승인 기록 추가(승인 영속화) | ⓐ 승인 대상 행 `FOR UPDATE`만 |
| 긴급 차단 `block()` | ① 게시 상태 행 `FOR UPDATE` → ② 멱등 요청 행(`withdraw_content_version`) → ③ 응답 본문 삭제 → 이력 추가 |
| 응답 확정 `complete()` + guard | ① 게시 상태 행 `FOR SHARE` → (버전 행 `FOR SHARE`) → ② 멱등 요청 행 `FOR UPDATE` → ③ 응답 본문 · 이벤트 |
| 상태 조회 `current()` | 새 트랜잭션, 게시 상태 행 `FOR SHARE` |

- 순서가 같아서 차단과 확정이 교착하지 않는다. 확정 6개와 차단을 동시에 실행해 확인했다.
- 게시 상태 행 뒤에 승인 대상 행을 잠그는 경로는 없다. 게시는 버전 행을 공유 잠금으로만 잡는다. 그래서 guard(상태 → 버전)와 게시(버전 → 상태) 사이에 교착이 생기지 않는다.
- 조회는 새 트랜잭션의 잠금 읽기라 오래된 REPEATABLE READ snapshot을 재사용하지 않는다.
- 상태 행과 버전 행은 따로 읽는다. 한 JOIN을 `FOR ... OF 상태 테이블`로 읽으면 MySQL이 버전 테이블을 snapshot으로 읽는다. 그러면 막 commit된 버전이 안 보여 상태가 「없음」이 되는 결함이 생긴다. 동시 최초 게시 테스트에서 실제로 재현됐고 고쳤다.
- 차단 트랜잭션 중 어느 단계라도 실패하면 상태 · 이력 · 본문이 모두 그대로다(rollback).
- DB 오류 · 잠금 대기 초과 · 상태 없음 · fingerprint 불일치는 모두 확정하지 않는다(fail closed).

## 멱등 저장소 guard 연결

`build_npc_turn_idempotency_store(sessions, hash_keys=, generic_lines=)`는 `publication_state_guard`를 연결한 `NpcTurnIdempotencyStore`를 만든다. guard의 판정은 다음과 같다.
- 게시 상태 없음, 또는 요청 콘텐츠의 fingerprint가 등록 버전과 다름 → `PublicationStateUnavailableError`(확정 안 함)
- `blocked` → `ContentPublicationBlockedError` → 저장소가 본문 · 이벤트 없이 철회 표식만 남기고 `TurnWithdrawnError`
- `published` · `suspended` → 통과

### generic 응답 (우회 차단)

`complete(content_mode="generic")`는 `validate_generic_response()`를 통과한 응답만 받는다.
- `reply`가 없거나, 승인된 일반 팩(`generic_lines` 목록)의 line_id와 원문이 **정확히 같은** `approved_line`이어야 한다.
- `suggest_hint`는 케이스 퍼즐을 가리키므로 허용하지 않는다.
- 위반하면 `GenericResponseRejectedError`이고 아무것도 확정하지 않는다.
- 일반 팩이 연결되기 전 기본값(`no_generic_lines`)에서는 `reply: null`만 generic이다. PM의 `NPC_GENERIC_PACK_MISSING` 경우에 해당하고, 미승인 기본 대사를 하드코딩하지 않는다.
- 이 변경으로 `7a714c4`의 MySQL 테스트 1개(일반 팩 없이 임의 대사를 generic으로 저장)는 기대값을 바꿨다. 일반 팩 목록이 있는 저장소로 저장하도록 수정했다.

## 보장 범위

| 구분 | 내용 |
|---|---|
| 이번 단계에서 보장 | 상태 영속 · 원자적 전이 · 이력 · 재시작 복원. 차단 후 신규 요청의 케이스 대사 저장 차단. 계산 중 차단 시 최종 저장 차단. 확정 후 차단 시 본문 삭제. 일반 중단 중 진행 세션 응답 유지. 동시 실행에서 교착 · 부분 저장 없음. generic 표시 우회 차단. DB 오류 fail closed. |
| 작업 D2에서 추가로 보장 | 게시 · 재개가 DB 승인 이력 + 서버 재계산 fingerprint로만 확정됨. 다른 콘텐츠 · 버전 승인 재사용 차단. 판정과 확정이 한 트랜잭션 · 같은 승인 잠금. blocked 재개는 차단 이후 G1~G3 재승인 필수. 재개 시 버전 불변 · 이력 보존. |
| 다음 단계 | 관리 CLI(검증된 actor). 서버 시작 시 게시본 등록(`PublicationOutcome.pinned` · `restorable_versions()`). 세션 생성에서 `accepts_new_sessions` 적용. NPC 라우터에서 차단 시 generic + `NPC_CONTENT_WITHDRAWN` 응답. 일반 팩 G3 + 정책 검사 연결. |

## Alembic과 통합

- 새 revision `f3b8d2c6a1e7`의 부모는 `e4c1f7a2b9d6`(멱등 저장소)다. 기존 revision은 바꾸지 않았다.
- **작업 D2 통합 브랜치(`feat/SJ-npc-publication-approval-integration`):**
  - 승인 영속화 `e3915c5`를 merge commit으로 병합했다.
  - 실제 head 2개(`d2a6f8b1c903`, `f3b8d2c6a1e7`)를 빈 merge revision `a5c7e9b2d4f6`으로 합쳤다. 현재 단일 head는 `a5c7e9b2d4f6`이다.
  - 병합 충돌(`alembic/env.py`, `tests/test_play_session_content_pin.py`)은 두 쪽 내용을 모두 유지하는 방식으로 풀었다.
- **소셜 온보딩(`c9d8e7f6a5b4`, 부모 `b8a7c6d5e4f3`)은 아직 병합하지 않았다.** 그 브랜치를 통합할 때:
  1. merge commit으로 병합한다(rebase 아님).
  2. head 2개(`a5c7e9b2d4f6`, `c9d8e7f6a5b4`)를 합치는 빈 merge revision 1개를 추가한다. 기존 revision은 바꾸지 않는다.
  3. `alembic/env.py`의 모델 import와 head 확인 테스트를 맞춘다.
  4. 격리 MySQL에서 `upgrade head` · `downgrade -1`을 확인한다.
  - 테이블 이름이 겹치지 않아 스키마 충돌은 없다.

## 검증 방법

`tests/test_npc_publication_mysql.py`는 `tests/test_npc_turn_idempotency_mysql.py`의 격리 하네스를 그대로 쓴다. 같은 `NPC_IDEMPOTENCY_MYSQL_*` 조건을 충족해야 실행되고, 아니면 skip이다.

### 2026-10-30 검증 기록

- 격리 MySQL 8.0.46(새 datadir, 포트 13317, REPEATABLE-READ, `--no-defaults`). 시스템 MySQL 서비스(3306)에는 연결하지 않았다.
- 게시 상태 MySQL 시나리오 12개 통과(3회 반복 실행 모두 통과):
  - 전이 · 이력 · 재시작 복원(새 엔진)
  - 잘못된 전이 · 불변 버전 · 이력 수정 거부 · blocked 재차단
  - 동시 최초 게시 4개 · 일반 중단과 긴급 차단 동시 실행
  - 차단 중 실패 rollback
  - snapshot 재사용 방지
  - 차단 후 신규 요청
  - 계산 중 차단
  - 확정 후 차단
  - 일반 중단 유지
  - 확정 6개와 차단 동시 실행
  - 상태 없음 · fingerprint 불일치 · 잠금 대기 초과(1205)
  - generic 우회 차단
- 변이 확인:
  - guard가 blocked를 무시 → 1개 실패
  - 상태 없음을 통과시킴 → 1개 실패
  - 차단에서 철회를 생략 → 4개 실패

### 2026-10-30 작업 D2 검증 기록

- 같은 격리 MySQL에서 D2 시나리오 10개와 D1 12개(새 게시 API로 갱신)가 통과했다.
- D2 시나리오:
  - 판정 전 철회 commit → 게시 거부
  - 다른 fingerprint 승인 재사용 거부
  - 다른 버전 대상 승인 · `npc.json` `approvals[]` 주장 거부
  - 판정 ~ 확정 사이 철회 → 대기 후 게시 유지
  - suspended 재개 재판정
  - blocked 재개 재승인(없음 · 일부 · 전부)
  - blocked 재개 중 신규 철회(양방향)
  - 재개와 멱등 확정 동시 실행
  - 잠금 대기 초과 · 중간 실패 시 부분 게시 없음
  - 호출자 트랜잭션 비침범
  - 다른 내용으로 재개 거부
- 변이 확인:
  - 판정과 확정을 다른 트랜잭션으로 나눔(승인 잠금 해제) → 경쟁 테스트 2개 실패
  - blocked 재승인 확인 제거 → 2개 실패
- 경쟁 테스트는 멈춘 작업을 `finally`에서 풀고 끝낸다. 회귀가 생겨도 멈추지 않고 실패한다.

## 남은 결정 사항

1. 재개할 때 같은 케이스에 더 높은 버전이 등록돼 있으면 VERSION_ORDER로 거부된다. 오래된 버전 재개를 허용할지
2. blocked → suspended 전이 허용 여부(현재 불가)
3. 관문별 재승인 시각을 「차단 이후」로 판정하는 정밀도(현재 밀리초, 같은 밀리초 불인정)
4. 이력 · 버전 테이블 직접 SQL 수정 차단 방식(운영 계정 권한 또는 트리거)
5. 차단으로 확정이 거부된 진행 중 턴에 generic 응답을 새로 저장할지
6. 일반 대사 팩(dialogue_pack)의 게시 상태 관리 여부(현재는 케이스 콘텐츠 버전만)
