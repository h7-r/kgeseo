# NPC 턴 멱등 응답 저장소 (1차 · 독립 기반)

기준: `feat/SJ-ai-npc-integration` / `6264576`. 브랜치: `feat/SJ-npc-turn-idempotency-store`.

## 범위와 연결 상태

- 구현한 것: 저장 모델 2개, Async Repository, 멱등 처리 서비스(`NpcTurnIdempotencyStore`), Alembic `e4c1f7a2b9d6`, 격리 MySQL 테스트.
- **연결하지 않은 것:** NPC 턴 HTTP 라우터, 기존 `client_event_id` 경로, FE 응답 필드, 세션 종료 처리, 게시 상태·긴급 차단 운영 기능, 관리자 기능. 운영 LLM은 OFF 그대로다.
- 기존 NPC 턴은 지금처럼 `interaction_events`로 재전송을 판정한다. 이 저장소는 아직 어떤 요청 경로에서도 호출되지 않는다.
- 승인 영속화(`feat/SJ-npc-approval-persistence`)와 코드를 공유하지 않는다.

## PM 결정과 구현 대응

| PM 결정 (v0.4.4 · v0.4.6) | 구현 |
|---|---|
| 키 `(play_session_id, turn_request_id)` | 두 테이블의 복합 PK. 다른 세션의 같은 요청 ID는 별개다 |
| 같은 요청 → 저장된 최종 응답 재현 | `claim()` → `TurnReplay` |
| 다른 본문 → 422 `idempotency_mismatch` | `IdempotencyMismatchError` (`code = "idempotency_mismatch"`) |
| 만료 → 410 `turn_expired` | `TurnExpiredError` (`code = "turn_expired"`) |
| 만료 키 · 같은 본문 410 / 다른 본문 422 | 본문 비교를 만료 판정보다 **먼저** 한다 |
| 최종 응답 본문만 저장. 원문·차단 생성문·model_context 금지 | `complete()`는 `NpcTurnResponse`만 받는다. 요청은 키 있는 HMAC 값만 남는다 |
| 본문: 최초 발급 후 24h 또는 세션 종료 후 24h 중 이른 시점 | READY 시 `issued_at + 24h`. 종료 시각이 주어지면 `종료 + 24h`로만 줄인다 |
| 재전송으로 기한 연장 금지 | 재현 경로는 행을 바꾸지 않는다 |
| tombstone: 진행 중 유지, 종료 후 24h 또는 게스트 정리 시 삭제 | 본문만 지우고 요청 행은 남긴다. `delete_ended_session_records()`, `play_sessions` FK `ON DELETE CASCADE` |
| 일반 중단 후 재전송: 저장 응답 그대로 | 저장소는 게시 상태를 보지 않으므로 그대로 재현된다 |
| 긴급 차단: 해당 버전 저장 본문 삭제, tombstone 보존, 재전송은 generic + `NPC_CONTENT_WITHDRAWN` | `withdraw_content_version()`이 본문을 지우고 `withdrawn_at`을 남긴다. 재전송은 `TurnWithdrawn`(generic 응답 생성은 호출자 몫) |
| 긴급 차단 × 만료 겹침: 명세 없음 | 판정하지 않고 `TurnStatusUndecidedError` |
| `completed_at`을 종료로 쓰지 않음 | 종료 시각은 호출자가 넘기는 인자로만 받는다 |

## 저장 구조

`npc_turn_requests` (tombstone)

| 컬럼 | 의미 |
|---|---|
| `play_session_id`, `turn_request_id` | PK. `play_session_id`는 `play_sessions.id` FK(`ON DELETE CASCADE`) |
| `request_body_hash` | `hmac-sha256:<key id>:<64 hex>` |
| `status` | `PROCESSING` / `READY` / `EXPIRED` |
| `case_id`, `content_version`, `content_fingerprint` | 세션이 고정한 콘텐츠 버전. 긴급 차단 대상 식별(INDEX `case_id, content_version`) |
| `owner_token`, `lease_expires_at` | PROCESSING 동안의 처리 권한(fencing 토큰) |
| `created_at`, `issued_at`, `expires_at` | 최초 claim, 최초 응답 발급, 본문 삭제 기한(INDEX `status, expires_at`) |
| `purged_at` | 기한 만료로 본문을 지운 시각 |
| `withdrawn_at` | 긴급 차단으로 본문을 지웠거나 처리 중 확정을 막은 시각 |

`npc_turn_response_bodies`: PK = 요청 키(요청 행 FK `ON DELETE CASCADE`), `response_json`(실제 전달한 `NpcTurnResponse`), `created_at`.

## 처리 흐름과 판정 순서

1. **`claim(key, content, request)`** — 짧은 트랜잭션. 새 키면 PROCESSING 행을 넣는다.
   - 중복 키(1062)면 새 트랜잭션에서 행을 잠그고 아래 순서로 판정한다.
     1. 본문 해시 불일치 → 422
     2. 철회 + 기한 지남 → `TurnStatusUndecidedError`(PM 미정)
     3. 철회 → `TurnWithdrawn`
     4. 기한 지남 또는 EXPIRED → 410(정리 작업 전에도)
     5. READY → 저장 응답 재현
     6. PROCESSING · lease 유효 → `TurnInProgressError`
     7. PROCESSING · lease 만료 → 새 owner_token으로 권한 회수
2. **NPC 계산** — 호출자가 한다. DB 잠금을 잡지 않는다.
3. **`complete(claim, response, write_event=, session_ended_at=)`** — 짧은 트랜잭션.
   - 요청 행을 잠그고 PROCESSING · 같은 owner_token · lease 유효 · 미철회를 다시 확인한다. 아니면 `TurnLeaseLostError` / `TurnWithdrawnError`.
   - 호출자의 이벤트 기록(`write_event(db)`)과 본문 · READY 전환을 **같은 트랜잭션**으로 commit한다. 이벤트 기록이 실패하면 본문도 남지 않고 권한은 그대로다.
   - commit이 성공한 뒤에만 저장 응답을 돌려준다.
4. **`release(claim)`** — 계산 실패 시 lease를 바로 만료시킨다. 같은 요청은 즉시 다시 처리할 수 있고, 이전 owner의 늦은 저장은 거부된다.

- Repository는 commit·rollback하지 않는다. 모든 트랜잭션은 서비스가 세션 팩토리로 연다.
- 교착(1213)은 같은 짧은 트랜잭션을 최대 3회 다시 시도한다. 잠금 대기 초과(1205) 등 다른 DB 오류는 그대로 전파한다. `write_event`는 재시도 때 새 세션으로 다시 불릴 수 있다.
- 시각은 timezone 없는 UTC다. 서버 간 시계 차이는 lease 회수 시점에만 영향이 있다. owner_token fencing 때문에 한 키에 확정되는 응답은 하나뿐이다.

### 긴급 차단 저장 경계

`withdraw_content_version(case_id, content_version)`은 그 버전의 READY · PROCESSING 행을 잠근다.
- READY는 본문을 지운다. PROCESSING은 표식만 남겨 이후 확정을 막는다. 두 경우 모두 `withdrawn_at`을 남긴다.
- EXPIRED는 이미 본문이 없어 그대로 둔다.
- 확정 트랜잭션과는 요청 행 잠금으로 직렬화된다. 확정이 먼저 commit되면 차단이 그 본문을 지우고, 차단이 먼저면 확정이 거부된다.
- 게시 상태 변경 · 차단 판단 · generic 응답 생성 · 운영 실행 경로는 **작업 D**다.

## `request_body_hash` 표현

- 값: `hmac-sha256:<key id>:<64 hex>`.
  - 입력은 도메인 문자열 ‖ `play_session_id` ‖ `turn_request_id` ‖ RFC 8785 정규화 요청이다.
  - 키 없는 SHA-256이 아닌 이유: 플레이어 문장은 짧아서 사전 대입으로 되돌릴 수 있다.
- key id를 함께 저장하므로 키를 바꿔도(`RequestHashKeys(current_id, keys)`) 24시간 안의 재전송을 이전 키로 검증한다.
- 서버가 모르는 key id는 422가 아니라 설정 오류(`RequestHashKeyUnavailableError`)다. 키를 지우면 정상 재전송이 422가 되므로, 키는 최소 24시간 겹쳐 둔다.
- PM 계약의 `request_body_hash`가 「키 없는 sha256 16진수」로 정의돼 있다면 표현이 다르다(확인 필요). 어떤 경우에도 FE가 같은 값을 계산하거나 비교할 필요는 없다.

## 정리 작업

- `purge_expired(limit=500)`: 기한이 지난 READY 본문을 지우고 EXPIRED로 바꾼다. `SKIP LOCKED`로 처리 중인 행을 건너뛴다.
- BE에 스케줄러가 없으므로 운영 주기 실행(cron · EventBridge 등)이 필요하다. 정리 전이라도 기한이 지나면 410이라 판정은 정리 주기와 무관하다. 다만 「24시간 뒤 본문 삭제」 자체는 정리 작업이 돌아야 지켜진다.
- `delete_ended_session_records(play_session_id, ended_at)`: 종료 후 24시간이 지난 세션의 tombstone · 본문을 지운다. 아직이면 0이다.

## Alembic

- 새 revision `e4c1f7a2b9d6`의 부모는 `c9e1a4b7d2f0`(기준 브랜치 head)다. 기존 revision은 바꾸지 않았다.
- 같은 부모 계열에서 승인 영속화 `d2a6f8b1c903`(부모 `c9e1a4b7d2f0`)과 소셜 온보딩 `c9d8e7f6a5b4`(부모 `b8a7c6d5e4f3`)가 갈라진다. 세 브랜치가 모두 dev에 들어가면 head가 3개가 된다.
  - 나중에 병합되는 쪽이 merge revision으로 head를 하나로 합친다.
  - 순서에 따라 merge revision이 1~2개 필요하다.
- 이 revision은 새 테이블만 만든다. 트리거가 없어서 TRIGGER 권한은 필요 없다.
- downgrade는 멱등 기록 전체를 지운다. 그 뒤 재전송은 새 요청으로 처리된다.
- 확인한 기존 결함(이번 범위 밖, 수정 안 함): 전체 체인을 MySQL에서 downgrade하면 `f1b2c3d4e5f6`(create auth identities) downgrade가 `1553 Cannot drop index 'ix_auth_identities_app_user_id': needed in a foreign key constraint`로 실패한다. 테스트 하네스는 새 revision만 downgrade로 검증하고, 나머지는 격리된 전용 schema에서 직접 지운다.

## 검증 방법

일반 pytest는 실제 DB에 연결하지 않는다. `tests/test_npc_turn_idempotency_mysql.py`는 기본 skip이며 다음을 **모두** 충족해야 한다.

- `NPC_IDEMPOTENCY_MYSQL_ISOLATED=1`
- `NPC_IDEMPOTENCY_MYSQL_URL`: mysql+aiomysql, localhost 또는 127.0.0.1, 3306이 아닌 명시 포트, `test_npc_idem_` 접두사의 전용 DB
- `NPC_IDEMPOTENCY_MYSQL_DATADIR`: 새 테스트 인스턴스의 실제 데이터 디렉터리
- 접속 후 `SELECT DATABASE(), @@datadir`가 일치하고 schema가 비어 있음

각 시나리오는 전체 revision 체인을 적용한 뒤 시작하고, 끝나면 schema를 비운다. 앱 `.env`의 DB 주소는 쓰지 않는다.

### 2026-10-30 검증 기록

- 격리 MySQL 8.0.46(새 datadir, 포트 13317, REPEATABLE-READ, `--no-defaults`). 시스템 MySQL 서비스(3306)에는 연결하지 않았다.
- MySQL 시나리오 14개 통과:
  - 재현 · 이벤트 1회 · 기한 불변
  - 다른 세션 독립
  - 모든 상태에서 422
  - 기한 경계(−1µs 재현 / 정각 410) · 정리 · tombstone
  - 종료 시각 단축만 허용
  - 종료 24h 뒤 tombstone 삭제 · 세션 삭제 cascade
  - 동시 claim 10개 중 1개만 권한, 동시 확정 1개
  - lease 회수 · 구 소유자 저장 거부
  - release
  - 이벤트 실패 · 제약 위반 · 취소 시 미저장
  - FK
  - 버전별 철회 · tombstone · 처리 중 확정 차단 · 겹침 미판정
  - 철회와 확정 직렬화
  - 원문 · model_context 미저장
- 변이 확인: fencing 비교 제거, 만료 판정을 본문 비교 앞으로 이동, PROCESSING 철회 표식 제거 → 각각 해당 테스트가 실패한다.

## 남은 결정 사항

1. `TurnInProgressError`의 HTTP 상태와 재시도 안내(PM 명세에 없음)
2. 긴급 차단과 기한 만료가 겹칠 때의 응답(PM 명세에 없음, 현재 미판정 오류)
3. lease 기본 30초의 적정값(생성 OFF 기준. 생성을 켜면 다시 정한다)
4. 응답 없이 버려진 PROCESSING 행의 정리 기한(현재는 회수만 가능하고 지우지 않는다)
5. `request_body_hash` 표현(위 절)과 HMAC 키 보관 위치(설정 · 비밀 관리)
6. 요청 해시 입력 범위: 라우터 연결 시 `client_timestamp` 등 전송 메타데이터를 뺄지
7. 일반 대사 팩(dialogue_pack) 긴급 차단 시 저장 응답 식별 방식(현재는 케이스 콘텐츠 버전만 식별)
