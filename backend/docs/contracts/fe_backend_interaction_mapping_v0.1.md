# Frontend / Backend Interaction Mapping v0.1

**Status: Confirmed for Interaction v0.3.2 Phase 1**

## 1. 기준 문서

- External HTTP API: `interaction_api_v0.3.2.md`
- Backend 내부 판정: `interaction_puzzle_runtime_v0.1.md`
- Client/Server 콘텐츠 연결: `case_content_zone_mapping_v0.1.md`

외부 HTTP 필드와 내부 Runtime 필드는 Adapter에서 명시적으로 변환한다.
Router는 DB를 직접 조회하거나 게임 결과와 상태 변화를 다시 판정하지 않는다.

## 2. 공통 Request 정책

- Endpoint Path의 `play_session_id`가 SSOT이며 Request Body에는 중복하지 않는다.
- `client_event_id`는 UUID여야 한다.
- `client_timestamp`는 timezone offset이 있는 datetime이어야 한다.
- `client_timestamp`는 UTC naive datetime으로 `interaction_events.client_timestamp`에 저장한다.
- `client_timestamp`는 서버 권위 시각이나 v0.1 멱등 equality 비교에 사용하지 않는다.
- `zone_id`는 input Object 검색에 사용하지만 DB에 저장하지 않고 멱등 equality 비교에도 사용하지 않는다.

## 3. Request Mapping

### `input`

| External v0.3.2 | Backend Internal v0.1 |
|---|---|
| `action: "input"` | `interaction_type: "submit_answer"` |
| `target_type: "object"` | Object Resolver 입력 검증 |
| `zone_id` + `target_id` | Client Content Object를 찾아 `interaction.target_id`를 puzzle target으로 사용 |
| `payload.answer` | `payload.answer` |
| `client_event_id` | `client_event_id` |
| `client_timestamp` | Event의 UTC naive `client_timestamp` |

Object의 `object_id`와 Backend target ID는 서로 다른 역할이며,
`Object.interaction.target_id`를 통해 연결한다.

### `combine_clues`

| External v0.3.2 | Backend Internal v0.1 |
|---|---|
| `action: "combine_clues"` | `interaction_type: "combine_clues"` |
| `target_type: "clue"` | Request validation |
| `target_id: null` | 내부 Request에는 전달하지 않음 |
| `payload.clue_ids` | `payload.clue_ids` |
| `client_event_id` | `client_event_id` |
| `client_timestamp` | Event의 UTC naive `client_timestamp` |

`clue_ids`는 서로 다른 값 두 개여야 하며 조합 판정에서 순서는 의미가 없다.

## 4. Action 지원 상태

| External Action | Internal Type | Phase 1 상태 |
|---|---|---|
| `input` | `submit_answer` | 구현됨 |
| `combine_clues` | `combine_clues` | 구현됨 |
| `inspect` | 없음 | 계약상 허용, HTTP 501 |
| `navigate` | 없음 | 계약상 허용, HTTP 501 |
| `select` | 없음 | 계약상 허용, HTTP 501 |

미구현 action은 Interaction Event를 생성하거나 PlaySession state를 변경하지 않는다.
실제 Runtime 구현이 승인되기 전에는 공용 카탈로그나 Agent의 사용 가능 action으로 노출하지 않는다.

## 5. Result Mapping

| Internal Result | External Result |
|---|---|
| `correct` | `correct` |
| `incorrect` | `incorrect` |
| `combined` | `correct` |
| `incorrect_combination` | `incorrect` |
| `already_completed` | `already_completed` |

성공 Response는 Interaction 전용 flat 구조를 사용한다. Phase 1의 `message`는 항상 `null`,
`ui_actions`는 항상 빈 배열이다. 다른 Session API의 `success/data` envelope는 유지한다.

## 6. Attempt Count

`PlaySession.state_json.attempt_counts`는 puzzle ID별 누적 채점 횟수를 저장한다.

- 실제 `input`의 `correct`와 `incorrect` 판정에서만 1 증가한다.
- `already_completed`, replay, invalid request, `combine_clues`에서는 증가하지 않는다.
- 해당 puzzle의 기록이 없는 legacy state는 최초 채점 시 0에서 시작한다.
- attempt 변경, 상태 변경, Event 기록은 같은 Transaction에 포함된다.
- `attempt_count` 자체는 `state_changes`에 포함하지 않는다.

## 7. State Changes

External 목록은 다음 다섯 종류로 닫혀 있다.

- `clue_acquired`
- `puzzle_completed`
- `zone_unlocked`
- `hint_level_changed`
- `flag_updated`

현재 input/combine Runtime은 실제로 적용한 `puzzle_completed`, `clue_acquired`,
`flag_updated`만 생성한다. 생성 순서는 puzzle, clue, flag 순이고 같은 종류 안에서는
Runtime Effect 순서를 유지한다. 이미 적용된 값은 상태와 change 양쪽에 중복하지 않는다.

Router는 DB 재조회나 전체 state diff로 change를 만들지 않는다.

## 8. Idempotency와 Legacy Replay

멱등 equality는 변환된 `interaction_type`, `target_id`, `payload_json`을 비교한다.
`zone_id`와 `client_timestamp`는 비교에 포함하지 않는다.

- 동일 요청은 기존 `InteractionEvent.id`를 `interaction_id`로 사용한다.
- 저장된 `response_json`을 재사용하며 Runtime 재판정, 상태 변경, Event 생성, commit을 하지 않는다.
- 같은 ID의 다른 내부 요청은 HTTP 409를 반환한다.
- `response_json`에 새 필드가 없는 legacy Event는 `state_changes=[]`, `message=null`,
  `attempt_count=null`, `ui_actions=[]` 기본값으로 읽는다.
- legacy state change의 `target_id/value` 형식은 현재 명시적 필드 형식으로 변환해 반환한다.
- legacy 데이터에서 과거 attempt나 state change를 추론하지 않는다.

## 9. Error Mapping

| 조건 | HTTP Status |
|---|---:|
| Request/Path validation 실패 | 422 |
| PlaySession, Puzzle, Zone, Object 없음 | 404 |
| 획득하지 않은 Clue, Object interaction 불일치, idempotency conflict | 409 |
| `inspect`, `navigate`, `select` | 501 |
| Client Content 또는 Puzzle Runtime 로드 실패 | 500 |

오답과 잘못된 clue 조합은 HTTP 오류가 아니라 200의 `incorrect` 게임 결과다.

## 10. 남은 WIP

- `inspect`, `navigate`, `select` 실제 Runtime 동작
- `zone_unlocked`, `hint_level_changed`를 생성하는 Runtime Effect
- 콘텐츠 기반 `message` Source of Truth
- Hint API
- `remaining_sec` 및 server timer
- Session 외부 Contract 정합성
