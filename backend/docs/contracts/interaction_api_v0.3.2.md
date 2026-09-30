# Interaction API Contract v0.3.2

**Status: Confirmed Phase 1 Contract**

## 1. Endpoint

```http
POST /api/v1/play-sessions/{play_session_id}/interactions
```

`play_session_id`는 UUID path parameter가 Source of Truth다. Request Body에는
중복해서 포함하지 않는다.

## 2. Request

공통 필드는 다음과 같다.

```json
{
  "client_event_id": "<uuid>",
  "client_timestamp": "<timezone-aware ISO-8601 datetime>",
  "zone_id": "ZONE_001",
  "action": "input",
  "target_type": "object",
  "target_id": "OBJ_LOCK_01",
  "payload": {}
}
```

- `client_timestamp`는 UTC로 정규화해 보존하지만 서버 시간 판정에 사용하지 않는다.
- `client_timestamp`는 멱등 equality에 포함하지 않는다.
- `zone_id`는 현재 Phase 1 멱등 equality에 포함하지 않는다.
- `input`은 `target_type=object`, non-null Object ID와 `payload.answer`를 사용한다.
- `combine_clues`는 `target_type=clue`, `target_id=null`과 정확히 두 개의 서로 다른
  `payload.clue_ids`를 사용한다.
- `navigate`는 `target_type=zone`과 non-null destination Zone ID를 사용한다.
- `inspect`와 `select`는 계약 Schema로 검증하지만 target 의미와 Runtime 동작은
  Phase 2에서 확정한다.

Phase 1에서 `input`과 `combine_clues`만 Runtime 처리한다. `inspect`, `navigate`,
`select`는 유효한 action이지만 현재 구현되지 않았으므로 HTTP 501을 반환한다.

## 3. Response

Interaction endpoint만 envelope 없는 flat response를 사용한다.

```json
{
  "interaction_id": "<uuid>",
  "result_type": "correct",
  "message": null,
  "attempt_count": 1,
  "state_changes": [],
  "ui_actions": []
}
```

- `result_type`: `ok | correct | incorrect | already_completed`
- `message`: Phase 1에서는 항상 `null`
- `attempt_count`: input 채점 결과는 누적값, 비채점 Interaction은 `null`
- `ui_actions`: Phase 1에서는 항상 빈 배열
- 오답은 HTTP 오류가 아니라 HTTP 200의 `incorrect` 결과다.
- `already_completed`는 HTTP 200이며 `state_changes=[]`다.

AnonymousSession과 PlaySession의 기존 `success/data` envelope는 변경하지 않는다.

## 4. State Changes

닫힌 목록은 다음 다섯 종류다.

- `clue_acquired`: `clue_id`
- `puzzle_completed`: `puzzle_id`
- `zone_unlocked`: `zone_id`
- `hint_level_changed`: `puzzle_id`, `hint_level`
- `flag_updated`: `flag`, `value`

Service가 실제 적용한 변경만 생성한다. attempt count 변경은 state change로 만들지 않는다.
Phase 1의 input/combine_clues는 clue, puzzle, flag change만 생성할 수 있다.

## 5. Attempt Count

`PlaySession.state_json.attempt_counts`에 puzzle ID별 누적 횟수를 저장한다.
과거 row에서 key가 없으면 빈 mapping으로 읽는다.

- 미완료 puzzle에 대한 실제 input 채점은 correct/incorrect 모두 1 증가한다.
- 이미 완료된 puzzle에 대한 새 Event는 `already_completed`이며 증가하지 않는다.
- 같은 Event replay는 최초 저장 응답을 반환하며 증가하지 않는다.
- invalid request, 존재하지 않는 puzzle, 처리 오류는 증가하지 않는다.
- combine_clues는 증가하지 않으며 응답은 `attempt_count=null`이다.
- attempt 변경, PlaySession 상태 변경, InteractionEvent 저장은 한 transaction이다.

## 6. Idempotency

`(play_session_id, client_event_id)` unique 제약과 기존 `FOR UPDATE` 흐름을 유지한다.
같은 normalized 내부 요청은 최초 응답을 replay한다. 동일 Event ID를 다른
interaction type, target 또는 payload로 재사용하면 HTTP 409다.

`client_timestamp`와 `zone_id`는 equality에서 제외한다. replay는 state, attempt count,
Event를 다시 변경하지 않으며 commit하지 않는다. IntegrityError 경합에서는 winner
Event를 다시 읽어 같은 replay/conflict 규칙을 적용한다.

## 7. Event Persistence

기존 `interaction_events`를 유지한다. 새 테이블을 만들지 않는다.

- `client_timestamp DATETIME(6) NULL`을 새 Migration으로 추가한다.
- timezone-aware Client timestamp를 UTC naive로 저장한다.
- `created_at`은 서버 권위의 최초 처리 시각이다.
- 신규 `response_json`은 message, attempt count, state changes, UI actions를 포함한다.
- 과거 내부 response JSON은 compatibility adapter로 읽는다.
- 과거 응답에 없는 attempt count를 Event history에서 추론하지 않는다.

## 8. HTTP Errors

| 상황 | HTTP |
|---|---:|
| Request/path validation | 422 |
| PlaySession, Puzzle, Zone, Object 없음 | 404 |
| 미획득 Clue, Object interaction 불일치, idempotency conflict | 409 |
| `inspect`, `navigate`, `select` Runtime 미구현 | 501 |
| Client Content 또는 Runtime 서버 구성 오류 | 500 |
| `incorrect`, `already_completed` | 200 |

서버 파일 경로, 원본 JSON 또는 내부 validation 상세는 HTTP response에 노출하지 않는다.

## 9. Phase 1 제외 범위

- inspect Runtime
- navigate Runtime과 current zone mutation
- select Runtime
- Hint API
- remaining time/server timer
- `interaction_request` 신규 테이블
- `play_puzzle_state` 신규 테이블
