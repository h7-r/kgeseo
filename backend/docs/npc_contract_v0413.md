# PM v0.4.13 반영 — 대상별 필수 관문 · 승인 기록 CLI · content_mode (11/4, 팀 검토 대기)

기준: PM 「세진님 회신 — 승인 등록 · content_mode (11/3)」 계약 v0.4.13, v0.4.6 §4 · §7, v0.3 §6.
브랜치 `feat/SJ-npc-contract-v0413-1104`(기반 `6977cb0`). 운영 · 개발 DB에는 아무것도 적용하지 않았다.

## 1. 대상 종류별 필수 관문

| 대상 | 필수 | 코드 |
|---|---|---|
| `case_content` | G1 · G2 · G3 (변경 없음) | `REQUIRED_GATES["case_content"]`, PUB-GATE · 케이스 대사 · 재개 판정 그대로 |
| `dialogue_pack` | G3 **+ 정책 검사** | `REQUIRED_GATES["dialogue_pack"] = ("G3",)` + `dialogue_pack_policy` |

- 판정 규칙(v0.4.2 §4: 같은 fingerprint · `(reviewed_at, review_id)` 최신 · 재승인 사유 · supersedes)은 관문마다 그대로다.
  `gate_decisions(records, fingerprint, required=...)`의 기본값은 케이스의 G1~G3다.
- 일반 팩의 G1 · G2 기록은 판정에 쓰지 않는다(대상 아님). 기존 G1~G3 기록(테스트 · 대역)은 지우거나 바꾸지 않았다.
- `check_target_approval()`(DB 이력 관문 판정)도 대상 종류별 표를 쓴다. 정책 검사는 포함하지 않는다.

### 정책 검사 (기준 미정 · fail closed)

> 11/4 갱신: PM v0.4.14로 실제 검사(GEN-LEAK · CASE · WORD · SYS · TIME · LEN)로 바뀌었다 — `npc_pack_policy_v0414.md`. 아래는 v0.4.13 당시 기록이다.

- 정책 검사의 구체 기준은 확인되지 않았다(v0.4.5 §4 원문 미확인, v0.4.6 §4 · v0.4.13 §1은 이름만 정함).
- 그래서 운영 기본 검사(`undefined_dialogue_pack_policy`)는 늘 `UNVERIFIED(policy_undefined)`다.
  **G3 승인이 있어도 일반 팩은 쓰이지 않는다**(긴급 중단 응답은 `reply: null`).
- 기존 NPC 출력 검사(`npc_generation_policy` · 승인 대사의 정답 · 힌트 원문 검사)는 케이스 하나의 출력 검사라
  일반 팩의 정책 검사로 간주하지 않았다.
- G3 판정과 정책 검사 상태는 따로 본다: `general_pack_gate_reasons()`(G3) · `run_dialogue_pack_policy()`(정책) ·
  `general_pack_approved()`(둘 다). 확인 명령 `python -m scripts.general_pack_status general_default/v1 --db`는
  `policy=UNVERIFIED reason=policy_undefined` · `g3_approval=…` · `usable=no|yes`를 따로 출력한다.
- 검사 함수는 라우터 의존성 `get_general_pack_policy`로 주입한다. 테스트만 테스트 전용 통과 검사를 명시적으로 넘긴다
  (`tests/pack_policy_stub.py`).

**PM 확인 필요**: 일반 팩 정책 검사의 범위 · 기준(무엇을 검사하면 PASS인가, 결과를 어디에 기록하는가).

## 2. 승인 기록: actor / reviewer 분리

### DB 스키마 (Alembic `b3f7c2e9a4d1`, 부모 `4b8e1d6a9c27`, 단일 head)

```sql
ALTER TABLE npc_approval_reviews ADD COLUMN actor VARCHAR(100) NULL;
```

| 열 | 뜻 |
|---|---|
| `reviewer` (기존, NOT NULL) | 실제로 판정한 사람 |
| `actor` (신규, NULL 허용) | 기록을 실행한 사람. 이 revision 이전 기록은 NULL(미기록)이며 값을 채우지 않는다 |

- 기존 migration 파일은 바꾸지 않았다. 수정 · 삭제 거부 트리거(`npc_approval_reviews_no_update` · `_no_delete`)는 그대로이며
  새 열의 수정(이전 기록에 actor 채우기 포함)도 막는다(격리 MySQL 확인, SQLSTATE 45000).
- `actor`는 판정에 쓰지 않는다.
- **배포 순서**: 이 코드는 `actor` 열을 읽는다. migration 전 DB에서는 승인 기록을 읽지 못하고 모든 승인이 없는 것으로
  처리된다(fail closed). 코드 배포 전에 대상 DB에 `b3f7c2e9a4d1`까지 적용해야 한다.

### 기록 경로

| 경로 | actor | reviewer |
|---|---|---|
| `create_gate_review(admin=VerifiedAdmin)` (향후 인증) | 검증된 신원 | 검증된 신원(같은 사람) |
| `record_delegated_gate_review(operator=InternalCliOperator, reviewer=…)` (CLI) | CLI 실행자 | 판정자(인자) |

CLI 경로는 `reason`이 필수다. 같은 잠금 · 같은 append-only 저장소 · 같은 시각 규칙(`reviewed_at` = 기록 시각)을 쓴다.
판정일(11/3)은 `reason`에 남는다(`reviewed_at`을 과거로 넣지 않는다 — 재개 판정 · 이력 순서가 기록 시각에 의존한다).

### 내부 CLI `scripts/record_gate_review.py`

```powershell
# 1) 확인만(dry run, DB 접속 없음): fingerprint 재계산 · 입력 검사
.\.venv\Scripts\python.exe -m scripts.record_gate_review `
  --target-type dialogue_pack --target-id general_default --target-version 1 `
  --gate G3 --decision approved --actor 세진 --reviewer 황미르 `
  --reason "PM 11/3 메시지로 G3 승인" `
  --target-hash sha256:a625988f0187d724f97184733be0e8a8d1b936c950dfc35d84329c19cea086be

# 2) 대상 DB 읽기 전용 확인(.env의 DB_*): revision · actor 열 · 현재 G3 · 정책 상태
... 위와 같음 ... --db

# 3) 실제 기록(append-only INSERT 1건): DB 이름을 한 번 더 입력해야 한다
... 위와 같음 ... --commit --confirm-db <DB 이름>
```

- 파일에서 fingerprint를 다시 계산하고 `--target-hash`와 다르면 기록하지 않는다.
- `reviewer`는 관문별 기록 가능한 사람(v0.4.13 §2)만: G1 박지하 · 황미르, G2 이해랑 · 황미르, G3 황미르.
- 대상 종류의 필수 관문이 아니면 거부(일반 팩에 G1 · G2 기록 불가). 지금은 `dialogue_pack`만 지원한다
  (`case_content`는 게시 묶음 fingerprint 재계산 경로를 연결한 뒤).
- `--commit`은 `--confirm-db`가 설정 DB 이름과 같고, 대상 DB에 `actor` 열이 있을 때만 쓴다.
- 철회: 같은 관문에 `--decision hold`(또는 `rejected`) `--supersedes <직전 review_id>`.

## 3. 이번 G3 승인 등록

- **실제 등록하지 않았다.** 이 노트북에는 개발 DB 접속 설정(`backend/.env`)이 없어 대상 DB의 revision을 확인하지 않았다.
  `npc_general_pack.md` §3(11/3)에 따르면 개발 DB(`waegok` · `waegok_test`)는 `c9e1a4b7d2f0`로 승인 저장소 테이블이 없다.
  운영 DB는 확인하지 않았다.
- 같은 등록 내용(actor 세진 · reviewer 황미르 · reason 「PM 11/3 메시지로 G3 승인」 · 위 fingerprint)으로 격리 MySQL에서
  CLI 기록 → G3 PASS → 정책 검사 미정이라 긴급 중단 응답 `reply: null` 유지를 확인했다.
- 공식 팩 fingerprint 재계산: `sha256:a625988f0187d724f97184733be0e8a8d1b936c950dfc35d84329c19cea086be` (PM 값과 일치).

## 4. NPC `content_mode` (FE 공유, `POST /api/v1/play-sessions/{id}/npc/turns`)

| 상황 | HTTP | `content_mode` | `fallback_reason` |
|---|---|---|---|
| 정상 | 200 | `"case"` (이전 `null`) | `null` 또는 `NPC_GENERIC_PACK_MISSING` |
| 긴급 중단 | 200 | `"generic"` | `NPC_CONTENT_WITHDRAWN` |
| 고정 묶음에 npc.json 없음 | 200 | `"generic"` | `NPC_CONTENT_MISSING` |
| npc.json 버전 불일치 · 검증 실패 | 409 `CASE_VERSION_UNAVAILABLE` (변경 없음) | — | — |
| 케이스 버전 사용 불가 · 레거시 세션 | 409 `CASE_VERSION_UNAVAILABLE` (변경 없음) | — | — |
| 같은 `client_event_id`에 다른 요청 | 409 (변경 없음) | — | — |
| 승인 대사에 정답 · 힌트 원문 섞임 | 500 `NPC content is unavailable.` (변경 없음) | — | — |

- `content_mode`는 늘 값이 있다(`"case" | "generic"`, null 없음). `reply: null`이어도 generic 사유면 `"generic"`이다.
- `fallback_reason` 값에 `NPC_CONTENT_MISSING` · `NPC_CONTENT_VERSION_MISMATCH` · `NPC_CONTENT_INVALID`를 더했다(OpenAPI enum).
- npc.json 버전 불일치 · 검증 실패는 지금 구조에서 묶음 생성(`PinnedContent`) · 게시 게이트가 **버전 전체**를 거부하므로
  턴 시점에는 케이스 버전 사용 불가(409)다. 200 generic으로 바꾸려면 게시 게이트를 약하게 해야 해서 바꾸지 않았다.
  두 사유는 계약 값으로만 있고 지금 내는 경로는 없다. npc.json 없음도 게시 경로가 npc.json을 필수로 받아 운영 묶음에서는 생기지 않는다.
- `NPC_GENERIC_PACK_MISSING`(정상 세션에서 일반 팩 없음)은 케이스 콘텐츠를 쓰는 응답이라 `"case"`로 두었다.
- 재전송은 지금 상태로 다시 판정한다(긴급 중단 → 저장 대사를 돌려주지 않음, npc.json 없음 → `NPC_CONTENT_MISSING`).

**PM 확인 필요**: (1) 정상 세션의 `NPC_GENERIC_PACK_MISSING` 응답을 `"case"`로 두는 해석, (2) npc.json만 불일치 · 검증 실패일 때
게임은 열고 NPC만 generic으로 둘지(지금은 버전 전체 409), (3) 500 「승인 대사에 정답 섞임」을 `NPC_CONTENT_INVALID` 200으로 바꿀지.

## 5. 운영 적용 전 남은 작업

1. 일반 팩 정책 검사 기준 PM 확정 → `dialogue_pack_policy` 구현 · 결과 기록 방식
2. 대상 DB(개발 → 운영)에 `b3f7c2e9a4d1`까지 migration 적용(별도 승인; 승인 저장소 · 게시 상태 revision 포함). 코드 배포 전에 적용
3. 대상 DB · 등록 내용 재보고 뒤 CLI로 G3 실제 기록(`--db` 확인 → `--commit --confirm-db`)
4. 운영 설정 `NPC_GENERAL_PACK=general_default/v1` 적용 여부 결정
5. 관리자 인증 도입 시 같은 서비스 함수를 HTTP로 연결, `case_content` CLI 지원(묶음 fingerprint 재계산)
6. FE: `content_mode` 정상값 `"case"` 반영, 새 `fallback_reason` 값 처리
