# API 오류 응답 계약 · FE 연동 확인 (2026-11-03, 팀 검토 대기)

응답 본문 · 상태 코드는 바꾸지 않았다. 지금 라우터가 내는 그대로를 OpenAPI `responses`에 적었다.

- 명세: `app/api/v1/error_responses.py`(라우터마다 `responses=`), 본문 모델 `app/schemas/api_error.py`
- 확인: `tests/test_api_error_contract.py`(명세 ↔ 소스 문장 · code 대조), `tests/test_fe_integration_contract_mysql.py`(격리 MySQL, 실제 라우터), `tests/test_hint_case_content_missing.py`(Hint 케이스 파일 누락 HTTP 응답, DB 없음)
- 앞선 점검: `fe_be_contract_check_1103.md`(B1을 이 문서로 처리)

## 1. 본문 형식

| 모델 | 본문 | 구분 방법 |
|---|---|---|
| `ErrorMessage` | `{"detail": "<영문 문장>"}` | 문장(같은 상태 안에서 여럿이면 문장 비교 필요) |
| `CodedError` | `{"detail": {"code", "message"}}` | `code`(`message`는 화면에 쓰지 않는다) |
| `HintBalanceEmptyError` | `{"detail": {"code": "HINT_BALANCE_EMPTY", "message", "minigames_left", "special_minigame_available"}}` | `code` |
| `MissingRequirementsError` | `{"detail": "<문장>", "missing_clue_count" \| "missing_puzzle_count" \| "missing_item_count": n}` | 개수 키 |
| `ValidationErrorResponse` | `{"detail": [{loc, msg, type, …}]}` | 요청 형식 오류(FastAPI 기본) |

`400`을 내는 경로는 없다. 인증 경로(`/auth/register` · `/login` · `/social-onboarding/complete`)의 요청 형식 오류는 입력을 되돌려 보내지 않으려고
목록 형식 대신 `CodedError`(`invalid_email` · `invalid_password` · `invalid_nickname` · `invalid_input`)로 답한다.

## 2. 경로별 오류 (우선 영역)

| 경로 | 상태 · 본문 |
|---|---|
| `POST /anonymous-sessions` | 오류 응답 없음(201만) |
| `POST /play-sessions` | 404 `Anonymous session not found.` · `Case not found.` / 409 `CASE_VERSION_UNAVAILABLE` / 410 `Anonymous session has expired.` / 422 검증 · `Invalid case ID.` / 500 `Case content is unavailable.` |
| `GET /play-sessions/{id}` | 404 `Play session not found.` |
| `GET /play-sessions/{id}/bundle` | 404(세션 · 케이스) / 409 `CASE_VERSION_UNAVAILABLE` / 422 / 500 |
| `GET /play-sessions/{id}/clues` | 404 / 409 / 500 |
| `GET /cases/{case_id}/bundle` | 404 `Case not found.` / 422 `Invalid case ID.` / 500 |
| `POST …/interactions` | 404 5종 · 409 13종(아래 §3) · 422 · 500 2종 · 501 |
| `POST …/hints` | 404 4종(세션 · 퍼즐 · 힌트 단계 · 레거시 세션의 `Case not found.`) / 409 `HINT_BALANCE_EMPTY` · `HINT_REF_MISMATCH` · 문장 5종 / 422 검증 · `HINT_REF_INVALID` / 500 `Hint state is invalid.` · `Case content is unavailable.` / 503 `HINT_REF_UNAVAILABLE` |
| `POST …/puzzles/{puzzle_id}/hints`(별칭) | 위에서 `hint_ref` 관련(409 `HINT_REF_MISMATCH` · 422 `HINT_REF_INVALID` · 503)만 빠진다 |
| `POST …/npc/turns` | 404 / 409 `CASE_VERSION_UNAVAILABLE`(레거시 세션 포함) · 이벤트 ID 충돌 / 422 / 500 `NPC content is unavailable.` |
| `POST /auth/social-onboarding/complete` | 401 `invalid_onboarding_token` / 409 `onboarding_token_used` · `terms_version_mismatch` · `nickname_unavailable` · `account_link_required` · 문장 1종 / 422 `consent_required` · `invalid_nickname` · `invalid_input` |
| `POST /auth/google` · `/naver` | 401 · 409(`account_link_required` 또는 문장) · 422 · 502(네이버) · 503 |

전체 문장 · code 목록은 OpenAPI 각 응답의 `description`에 있다(소스와 다르면 테스트가 실패한다).

긴급 중단은 NPC 오류가 아니다: 200 · `fallback_reason: NPC_CONTENT_WITHDRAWN` · `content_mode: "generic"` · 승인 일반 대사 또는 `reply: null`.

## 3. 문장 비교로만 구분되는 상태 (보고 · 바꾸지 않음)

| 경로 · 상태 | 같은 상태 안의 경우 | 영향 |
|---|---|---|
| `POST /play-sessions` 409 | 버전 미등록 · 미게시 · 일시 중단 · 긴급 중단이 **모두 같은 본문** `CASE_VERSION_UNAVAILABLE` | FE가 「점검 중」과 「없는 버전」을 구분할 수 없다(문장으로도 불가) |
| `POST /play-sessions` 404 | 익명 세션 없음 · 케이스 없음 | FE는 404면 익명 세션을 새로 만든다 — 케이스 없음에도 한 번 더 시도한다 |
| `POST …/interactions` 404 | 세션 · 퍼즐 · 조사 · 구역 · Object | 문장 비교 |
| `POST …/interactions` 409 | `CASE_VERSION_UNAVAILABLE`, 단서 미획득, 상호작용 없음, action 불일치, 현재 구역 모름, 현재 구역 아님, 이동 불가, 안 보임, 비활성, 이벤트 ID 충돌, 선행 단서 · 퍼즐 · 아이템 부족(개수 키로 구분 가능) | 문장 비교 |
| `POST …/hints` 404 · 409 · 500 | 404 세션 · 퍼즐 · 힌트 단계 · 케이스 파일 없음 / 500 힌트 상태 오류 · 케이스 파일 형식 오류 / 409 `CASE_VERSION_UNAVAILABLE` · 이전 단계 미해금 · 아직 못 씀 · 이벤트 ID 충돌 | 잔액 · `hint_ref`만 `code`가 있다 |
| `POST …/npc/turns` 409 | 버전 사용 불가 · 이벤트 ID 충돌 | 문장 비교 |
| `POST /auth/register` 409 · 422 | 이메일 · 닉네임 중복(문장), 동의 누락 · 입력 오류(문장)와 `code` 혼재 | 사이트 FE가 이미 문장 비교로 분기한다 |
| 소셜 로그인 · 가입 409 | 계정 생성 경합만 문장(나머지는 `code`) | FE는 일반 문구로 처리 |
| `GET …/bundle` · `POST /play-sessions` 404 | 세션 없음 · 케이스 없음 | 문장 비교 |

`code`로 통일할지는 PM 결정이다(P7). 바꾸면 기존 클라이언트가 읽는 형식이 바뀌므로 이번에는 손대지 않았다.

### 3.1 Hint API 케이스 파일 누락(1103 수정)

수정 전: Hint API는 `CaseRuntimeNotFoundError` 등 케이스 파일 오류를 잡지 않아, 레거시 세션(`content_version` 없음)의
케이스 파일이 없거나 깨지면 처리되지 않은 예외 → 본문 없는 500(`text/plain` `Internal Server Error`)이었다.
라우터가 `unlock_hint` 전에 런타임을 읽으므로(`resolve_hint_target`) 세션 잠금 · 차감 · 이벤트 기록 전에 실패한다.

수정 후(새 의미를 만들지 않고 세션 번들 `GET /play-sessions/{id}/bundle`의 기존 매핑을 그대로 쓴다):

| 경우 | 응답 |
|---|---|
| 런타임(`server.json`) 또는 Client 콘텐츠 파일 없음 | 404 `Case not found.` |
| 파일은 있지만 JSON · 검증 오류 | 500 `Case content is unavailable.` |

- 일반 내부 오류(`InvalidHintStateError` 500 `Hint state is invalid.`, 그 밖의 처리되지 않은 예외)와 구분된다.
- 응답에 파일 경로 · 케이스 ID · 예외 이름을 싣지 않는다.
- 차감 · 이벤트 기록 없음. 같은 `client_event_id` 재전송도 같은 응답이고, 파일이 복구되면 처음 응답을 그대로 돌려준다.
- 고정 세션은 게시 묶음(메모리)을 쓰므로 해당 없다.
- 같은 세션 단위 API 사이에 남은 차이: Interaction은 런타임 오류를 모두 500 `Puzzle runtime is unavailable.`로 답한다
  (파일 없음도 500). 맞출지는 P7(오류 형식 통일) 결정에 포함한다.

## 4. FE 호출과 BE 계약 (읽기 전용 비교, 최신 FE `dcba86d`)

FE가 아직 쓰지 않는 API는 「미사용」으로 적었다.

### 4.1 나주 버전 고정 세션 생성

- 요청: `POST /play-sessions {anonymous_session_id, case_id, content_version}`.
  `content_version`은 정수 ≥ 1(엄격 — 문자열 `"1"`은 422). `case_id`는 `^[A-Za-z0-9_-]+$` · 64자 이하(초안 ID `naju-angam-01`도 형식상 가능).
- 조건: 그 버전이 게시 루트에서 서버 메모리 저장소에 등록됐고, 같은 트랜잭션에서 읽은 DB 게시 상태가 새 세션을 받아야 한다.
  아니면 409 `CASE_VERSION_UNAVAILABLE`(구분 없음, §3).
- `content_version` 없이 보내면 레거시 세션이다. 레거시는 저장소 파일 케이스(`case_001`)만 가능하고, 게시 상태 확인이 없다.
- FE 현황: `createPlaySession(anonymousSessionId, caseId)`는 `content_version`을 보내지 않는다. 나주 FE는 세션 API를 부르지 않는다.
  BE에는 나주 게시 콘텐츠가 없다(테스트는 가상 게시 콘텐츠 `case_test` v1로 계약만 확인).

### 4.2 번들 · 세션 복원

| API | 내용 | FE |
|---|---|---|
| `GET /play-sessions/{id}` | 세션 · `state` · `completed_at` | 사용(복원 시) |
| `GET /play-sessions/{id}/bundle` | 그 세션이 고정한 버전의 번들(레거시는 기본 파일 번들) | 미사용 |
| `GET /cases/{case_id}/bundle` | 저장소 파일 번들만. 게시 콘텐츠(고정 세션)의 케이스는 404 | 사용(복원 · 신규) |

계약 테스트에서 확인: 레거시 `case_001`은 두 번들이 같다. 고정 세션은 `/cases/…/bundle`이 404이고 세션 번들만 200이다
→ 나주(고정 세션)로 가면 FE 복원은 세션 번들을 써야 한다.

### 4.3 `client_event_id` 재전송

| API | 같은 ID · 같은 요청 | 같은 ID · 다른 요청 |
|---|---|---|
| Interaction | 처음 응답 그대로(시도 횟수 · 상태 추가 변경 없음) | 409 `Client event ID conflicts with a previous interaction.` |
| Hint | 처음 응답 그대로(추가 차감 없음) | 409 같은 문장 |
| NPC | 이벤트는 1건. 응답은 **지금** 승인 · 게시 상태로 다시 판정(철회되면 대사 숨김) | 409 같은 문장 |

FE 현황: `submitFireCabinetLock`은 호출마다 새 UUID를 만든다(재전송 규칙 미사용). Hint · NPC는 미사용.

### 4.4 NPC `content_mode` · `reply: null`

미사용(FE 호출 없음). 레거시 세션은 NPC 409라 지금 FE 세션으로는 NPC를 쓸 수 없다.
긴급 중단 응답은 §2. 정상 응답의 `content_mode`는 `null`(PM 결정 P2).

### 4.5 Hint 잔액

잔액(`hint_balance`) · 도움 수(`help_used`)는 **해금 응답 `result`에만** 있다. 세션 생성 · 조회 응답에는 없다(계약 테스트로 확인).
잔액 0이면 409 `HINT_BALANCE_EMPTY`(`minigames_left` · `special_minigame_available` 포함, 차감 없음).
잔액 조회 API는 계약이 없어 추가하지 않았다(PM 결정 P3). FE는 미사용.

### 4.6 `/api/v1/packs`

- 호출 위치: `naju01/src/loaders/packSource.ts` `fetchTicket(id)` — 배포본(`import.meta.env.DEV`가 아닐 때)에서만
  `GET /api/v1/packs/{id}`(`credentials: "include"`). 기대 응답 `{ url: string, key: string }`, 실패하면 그 팩을 열지 않는다(단품 파일로 되돌아가지 않음).
- 언제 불리나: manifest `public/_sf_local/manifest.json`의 `팩` 목록 또는 주소의 `?pack=<id>`. 지금 저장소 manifest에는 `팩`이 없다
  → 평소 배포본은 부르지 않고, `?pack=`을 붙이면 부른다(BE에 경로가 없어 404 → 팩 열기 실패).
- 주석상 「백엔드가 플레이 세션을 확인하고 { url, key }를 준다 — P2, 상의 중」. BE에는 쿠키 세션이 없어 `credentials: "include"`만으로는
  세션을 확인할 수 없다(요청에 `play_session_id`가 없다). 계약이 없어 구현하지 않았다(PM 결정 P8).

## 5. 계약 테스트

`tests/test_fe_integration_contract_mysql.py`(격리 MySQL · 실제 라우터 · 운영 게시 guard, 모든 오류 응답을 명세와 대조):

| 테스트 | 확인 |
|---|---|
| 레거시 `case_001` 흐름 | FE 순서 그대로(익명 → 세션 → 조회 → 번들 → 오답 · 정답 입력), 같은 ID 재전송 동일 응답 · 시도 횟수 2, 다른 요청 409, 힌트 원문 없음 404(차감 없음), NPC 409 |
| 레거시 오류 | 익명 세션 404 · 만료 410 · 케이스 404 · 세션 404 |
| 고정 세션 필수 조건 | 버전 없음 → 레거시 경로 404, 문자열 버전 422, 미등록 · 미게시 409(같은 본문), 게시 후 201 · 세션 번들 200 · 케이스 번들 404 |
| 긴급 중단 | 신규 고정 세션 409, 레거시 세션 생성은 그대로 201(현재 동작), 기존 세션 힌트 2단계 200 · 잔액 1 · 재전송 추가 차감 없음 · 다른 요청 409, 조회 응답에 잔액 없음 |
| NPC 긴급 중단 | 정상 `content_mode: null`, 중단 + 승인 팩 없음 → `reply: null` · `generic`, 재전송 동일, 다른 요청 409, 테스트용 가상 승인 뒤 승인 원문 |
| Hint 오류 | `HINT_BALANCE_EMPTY`(차감 · 기록 없음), 키 없음 503, 형식 422, 불일치 · 레거시 세션 409 `HINT_REF_MISMATCH`, 단계 건너뜀 409, 세션 없음 404 |
| Hint 케이스 파일 누락(§3.1) | 파일 없는 레거시 세션 404 `Case not found.`(재전송 동일, 차감 · 기록 없음), 연 단계가 있는 세션에서 파일 삭제 → 재전송 · 새 단계 · Client 파일 없음 404, 깨진 파일 500, 고정 세션 힌트 200 그대로, 복구 뒤 재전송은 처음 응답 · 다음 단계 정상 차감 |
