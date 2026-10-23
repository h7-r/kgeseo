# Interaction API Contract v0.3.2

**Status: Confirmed Phase 1 Contract + Object 상태·inspect 확장 구현 (팀 검토 대기)**

Phase 1 확정 범위는 `input`과 `combine_clues`다. 이후 `inspect` Runtime, PlaySession
Object 상태(`object_states`), Object 상태 `state_changes` 3종이 구현됐다(2026-10-23).
확장 부분은 구현 기준으로 기록했으며 문서 버전 갱신과 팀 확정은 아직 하지 않았다.
확장 부분은 pytest·실제 `TestClient` HTTP 테스트로 검증했고 실제 MySQL 검증은 하지 않았다.

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
- `inspect`는 `target_type=object`, non-null(빈 문자열 불가) Object ID와 빈 `payload`를
  사용한다. 다른 `target_type`, `target_id=null`, payload 필드는 422다.
- `select`는 계약 Schema로 검증하지만 target 의미와 Runtime 동작은 아직 확정하지 않았다.

Runtime 처리하는 action은 `input`, `combine_clues`, `inspect`다. `navigate`와 `select`는
유효한 action이지만 구현되지 않았으므로 HTTP 501을 반환한다.

### 2.1 inspect 처리

`zone_id`와 `target_id`로 Client Content Object를 찾고, 그 Object의
`interaction.type`이 `inspect`일 때 `interaction.target_id`를 Server Runtime의
`inspect_id`로 사용한다. PlaySession 행 잠금 안에서 다음 순서로 판정한다.

1. 같은 `client_event_id`의 동일 요청이면 최초 응답을 replay한다.
2. Server Runtime에 `inspect_id`가 없으면 404다.
3. 이미 `completed_inspect_ids`에 있으면 `ok`, `state_changes=[]`다. Object가 지금
   숨김·비활성이어도 오류로 만들지 않고 효과를 다시 적용하지 않는다.
4. 서버 유효 상태(콘텐츠 초기값 + 세션 `object_states`)에서 Object가 숨김이면 409,
   비활성이면 409다. Frontend 표시 상태는 판정에 쓰지 않는다.
5. `on_inspect` 효과를 적용하고 `inspect_id`를 `completed_inspect_ids`에 추가한다.

효과가 없는 조사 대상도 빈 `on_inspect`로 Server Runtime에 정의해야 한다
(정의 없으면 콘텐츠 교차 검증 오류).

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
- `inspect`는 첫 조사와 재조사 모두 HTTP 200의 `ok`다. 재조사는 `state_changes=[]`다.
  효과가 없는 대상을 처음 조사해도 `state_changes=[]`이므로, Frontend는
  `state_changes`가 비었는지만으로 재조사 여부를 구분할 수 없다.

AnonymousSession과 PlaySession의 기존 `success/data` envelope는 변경하지 않는다.

## 4. State Changes

닫힌 목록은 다음 여덟 종류다. 아래 세 Object 상태 change는 확장 구현으로 추가됐다.

- `clue_acquired`: `clue_id`
- `puzzle_completed`: `puzzle_id`
- `zone_unlocked`: `zone_id`
- `hint_level_changed`: `puzzle_id`, `hint_level`
- `flag_updated`: `flag`, `value`
- `object_revealed`: `zone_id`, `object_id` — 유효 `visible` false → true
- `object_hidden`: `zone_id`, `object_id` — 유효 `visible` true → false
- `object_unlocked`: `zone_id`, `object_id` — 유효 `enabled` false → true

Service가 실제 적용한 변경만 생성한다. attempt count 변경은 state change로 만들지 않는다.
input/combine_clues/inspect는 puzzle, clue, flag, Object 상태 change를 이 순서로 생성할 수
있다. Object 안에서는 visible change가 enabled change보다 먼저 온다. 한 Object의
`visible`과 `enabled`가 함께 바뀌면 두 change를 모두 보낸다. 이미 유효 상태와 같은 값은
저장하지도 change를 만들지도 않는다. `enabled` true → false(잠금)는 지원하지 않으며
대응 change 타입도 없다. `zone_unlocked`, `hint_level_changed`는 아직 생성하지 않는다.

## 4.1 PlaySession 상태 (확장)

Interaction이 변경할 수 있는 `state_json` 키에 다음이 추가됐다. 둘 다 과거 row에 없으면
기본값으로 읽고, 실제로 값을 쓸 때만 키를 만든다. DB Migration은 없다.

- `object_states`: `{zone_id: {object_id: {"visible"?: bool, "enabled"?: bool}}}`.
  기록한 속성만 담고, 없는 속성은 Client Content 초기값을 따른다. 기본값 `{}`.
- `completed_inspect_ids`: 효과를 적용한 `inspect_id` 목록. 기본값 `[]`.

PlaySession GET 응답 `state`에도 두 키가 포함된다. Case Bundle의 `visible`·`enabled`는
정적 초기값이며, Frontend는 그 위에 `object_states`와 Object 상태 change를 덮어써 표시한다.

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

`inspect`의 내부 equality 대상은 `interaction_type=inspect`, `target_id=<inspect_id>`,
`payload={}`다. Object ID 자체는 비교하지 않으므로, 서로 다른 Object가 같은
`inspect_id`를 공유하는 콘텐츠에서는 같은 Event ID 재사용이 동일 요청으로 취급된다.
replay는 그 사이 Object가 숨김·비활성이 됐어도 최초 응답을 그대로 반환한다.

## 7. Event Persistence

기존 `interaction_events`를 유지한다. 새 테이블을 만들지 않는다.

- `client_timestamp DATETIME(6) NULL`을 새 Migration으로 추가한다.
- timezone-aware Client timestamp를 UTC naive로 저장한다.
- `created_at`은 서버 권위의 최초 처리 시각이다.
- 신규 `response_json`은 message, attempt count, state changes, UI actions를 포함한다.
- 과거 내부 response JSON은 compatibility adapter로 읽는다.
- 과거 응답에 없는 attempt count를 Event history에서 추론하지 않는다.

## 8. HTTP Errors

| 상황 | HTTP | `detail` |
|---|---:|---|
| Request/path validation | 422 | FastAPI validation |
| PlaySession, Puzzle, Zone, Object 없음 | 404 | 기존 문구 |
| inspect 대상의 Server `inspect_id` 없음 | 404 | `Inspection not found.` |
| 미획득 Clue, Object interaction 불일치, idempotency conflict | 409 | 기존 문구 |
| inspect 대상 Object가 서버 유효 상태에서 숨김 | 409 | `Object is not visible.` |
| inspect 대상 Object가 서버 유효 상태에서 비활성 | 409 | `Object is not enabled.` |
| `navigate`, `select` Runtime 미구현 | 501 | `Interaction action '<action>' is not implemented.` |
| Client Content·Runtime 구성 오류, Client/Server 교차 참조 오류 | 500 | `Case content is unavailable.` 등 |
| `incorrect`, `already_completed`, inspect `ok` | 200 | — |

서버 파일 경로, 원본 JSON 또는 내부 validation 상세는 HTTP response에 노출하지 않는다.
`visible`·`enabled` 판정은 현재 `inspect`에만 적용한다. `input`은 Object 상태를 검사하지
않는다(아래 합의 필요 사항 참고).

## 9. 제외 범위

- navigate Runtime과 current zone mutation, 비활성 문 이동의 서버 검증
- select Runtime
- Session 상태를 반영한 Zone 조회 API
- 단서 표시 데이터(제목·본문 등) 제공 — `clue_acquired`에는 `clue_id`만 담긴다
- `enabled` true → false(잠금) 효과와 대응 change 타입
- Hint API
- remaining time/server timer
- `interaction_request` 신규 테이블
- `play_puzzle_state` 신규 테이블

## 10. 합의 필요 사항 (확장 구현)

구현은 아래처럼 동작하지만 팀 확정 전이다.

- 문서 버전 갱신(예: v0.3.3) 여부
- inspect의 `target_type=object` 고정과 422 처리
- 재조사 판정을 숨김·비활성 판정보다 먼저 하는 순서
- 신규 오류 문구 3종과 상태 코드(404·409·409)
- `input` 대상 Object에도 `visible`·`enabled` 판정을 적용할지
- 첫 조사(무효과)와 재조사를 Frontend가 구분할 수단이 필요한지
- 효과가 없는 조사 대상도 Server 정의를 필수로 하는 규칙
- 실제 MySQL 영속성 검증(미완료)
