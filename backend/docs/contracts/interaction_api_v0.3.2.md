# Interaction API Contract v0.3.2

**Status: Confirmed Phase 1 Contract + Object 상태·inspect 확장 구현 (팀 검토 대기)**

Phase 1 확정 범위는 `input`과 `combine_clues`다. 이후 `inspect` Runtime, PlaySession
Object 상태(`object_states`), Object 상태 `state_changes` 3종이 구현됐다(2026-10-23).
이어서 (Q6) `navigate` Runtime과 현재 Zone 접근 제한이 구현됐다. Q6로 바뀐 부분은
**(Q6 변경)**으로 표시했다.
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
- **(Q6 변경)** `input`·`inspect`·`navigate`의 `zone_id`는 서버의 현재 위치
  (`state.current_zone_id`)와 같아야 한다(§2.3). `combine_clues`의 `zone_id`는 받기만 하고
  검사하지 않는다.
- `input`은 `target_type=object`, non-null Object ID와 `payload.answer`를 사용한다.
- `combine_clues`는 `target_type=clue`, `target_id=null`과 정확히 두 개의 서로 다른
  `payload.clue_ids`를 사용한다.
- `navigate`는 `target_type=zone`, non-null(빈 문자열 불가) 목적지 Zone ID, 빈 `payload`를
  사용한다. `zone_id`는 출발 Zone이다. 문 Object ID는 보내지 않는다(§2.4).
- `inspect`는 `target_type=object`, non-null(빈 문자열 불가) Object ID와 빈 `payload`를
  사용한다. 다른 `target_type`, `target_id=null`, payload 필드는 422다.
- `select`는 계약 Schema로 검증하지만 target 의미와 Runtime 동작은 아직 확정하지 않았다.

Runtime 처리하는 action은 `input`, `combine_clues`, `inspect`, `navigate`다. `select`는
유효한 action이지만 구현되지 않았으므로 HTTP 501을 반환한다.
**(Q6 변경)** 이전에는 `navigate`도 501이었다.

### 2.1 inspect 처리

`zone_id`와 `target_id`로 Client Content Object를 찾고, 그 Object의
`interaction.type`이 `inspect`일 때 `interaction.target_id`를 Server Runtime의
`inspect_id`로 사용한다. PlaySession 행 잠금 안에서 다음 순서로 판정한다.

1. 같은 `client_event_id`의 동일 요청이면 최초 응답을 replay한다.
   **(Q6 변경)** 그다음 요청 `zone_id`가 서버의 현재 위치가 아니면 409다(§2.3).
   이미 조사한 대상도 다른 Zone에서 요청하면 409다.
2. Server Runtime에 `inspect_id`가 없으면 404다.
3. 이미 `completed_inspect_ids`에 있으면 `ok`, `state_changes=[]`다. Object가 지금
   숨김·비활성이어도 오류로 만들지 않고 효과를 다시 적용하지 않는다.
4. 서버 유효 상태(콘텐츠 초기값 + 세션 `object_states`)에서 Object가 숨김이면 409,
   비활성이면 409다. Frontend 표시 상태는 판정에 쓰지 않는다.
5. (Q5) 조사의 `requires_clue_ids` 중 획득하지 않은 단서가 있으면 409다(§2.2).
6. `on_inspect` 효과를 적용하고 `inspect_id`를 `completed_inspect_ids`에 추가한다.

효과가 없는 조사 대상도 빈 `on_inspect`로 Server Runtime에 정의해야 한다
(정의 없으면 콘텐츠 교차 검증 오류).

### 2.2 선행 단서 조건 (Q5, 팀 검토 대기)

Server Runtime의 `puzzles[].requires_clue_ids`·`inspections[].requires_clue_ids`에 나열한
단서를 모두 획득하지 않았으면 409로 거절한다. `input`은 이미 완료한 퍼즐 확인 뒤,
시도 횟수 증가와 정답 비교 **전에** 판정하므로 정답·오답이 같은 409다.
`inspect`는 숨김·비활성 판정 뒤에 판정한다. 거절 시 상태, 시도 횟수, Event, commit이 없다.

```http
HTTP/1.1 409 Conflict
```

```json
{
  "detail": "Required clues are not acquired.",
  "missing_clue_count": 2
}
```

`detail`은 다른 오류와 같은 문자열이고 `missing_clue_count`만 추가된다. 부족한 단서 ID는
응답에 넣지 않는다.

### 2.3 현재 Zone 접근 제한 (Q6, 팀 검토 대기)

`input`·`inspect`·`navigate`는 PlaySession 행 잠금 안에서, 같은 Event replay 판정 **뒤**,
다른 모든 판정(이미 완료한 퍼즐·조사 포함) **앞**에 현재 위치를 확인한다.
`input`·`inspect`의 Object 해석(Zone·Object 404, interaction 불일치 409)은 이전처럼
잠금 전에 먼저 수행한다.

현재 위치는 다음과 같이 정한다.

| 저장된 `current_zone_id` | Client Content | 처리 |
|---|---|---|
| Zone ID, 콘텐츠에 있음 | — | 그 값 |
| 없음/`null` | Zone 1개 | `entry_zone_id`로 복원하고, 이번 상호작용이 Event를 저장할 때 함께 저장 |
| 없음/`null` | Zone 여러 개 | 409 `Current zone is unknown.` |
| Zone ID, 콘텐츠에 없음 | — | 409 `Current zone is unknown.` |

요청 `zone_id`가 현재 위치와 다르면 409 `Zone is not current.`다. 거절 시 상태, Event,
commit이 없다. `combine_clues`, `GET /play-sessions/{id}/clues`, PlaySession GET에는
Zone 제한이 없다. 내부 서비스 모델(`submit_answer`·`inspect`·`navigate`)은 `zone_id`를
필수 필드로 가지므로 위치 검사를 생략하는 경로가 없다.

### 2.4 navigate 처리 (Q6, 팀 검토 대기)

```json
{
  "client_event_id": "<uuid>",
  "client_timestamp": "2026-10-23T09:10:00+09:00",
  "zone_id": "ZONE_A",
  "action": "navigate",
  "target_type": "zone",
  "target_id": "ZONE_B",
  "payload": {}
}
```

PlaySession 행 잠금 안에서 다음 순서로 판정한다. Object 해석을 미리 하지 않는다.

1. 같은 `client_event_id`의 동일 요청이면 최초 응답을 replay한다. 이미 이동해
   현재 위치가 바뀌었어도 replay한다.
2. 출발 Zone(`zone_id`)이 콘텐츠에 없으면 404 `Zone not found.`
3. 현재 위치를 확정할 수 없으면 409 `Current zone is unknown.`, 출발 Zone이 현재
   위치가 아니면 409 `Zone is not current.`(§2.3)
4. 목적지 Zone(`target_id`)이 콘텐츠에 없으면 404 `Zone not found.`
5. 출발 Zone의 `navigation[]`에 목적지로 가는 항목이 없으면 409
   `Navigation is unavailable.` (자기 Zone으로의 이동 포함)
6. 그 문 Object의 서버 유효 상태가 숨김이면 409 `Object is not visible.`, 비활성이면
   409 `Object is not enabled.`
7. `current_zone_id`를 목적지로 바꾸고 `current_zone_changed`를 응답한다.

성공 응답:

```json
{
  "interaction_id": "<uuid>",
  "result_type": "ok",
  "message": null,
  "attempt_count": null,
  "state_changes": [
    { "type": "current_zone_changed", "zone_id": "ZONE_B" }
  ],
  "ui_actions": []
}
```

문 연결 정의 규칙은 `case_content_zone_mapping_v0.1.md` §5.1을 따른다.

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
- **(Q6 변경)** `navigate` 성공은 HTTP 200의 `ok`, `attempt_count=null`이다.
- `inspect`는 첫 조사와 재조사 모두 HTTP 200의 `ok`다. 재조사는 `state_changes=[]`다.
  효과가 없는 대상을 처음 조사해도 `state_changes=[]`이므로, Frontend는
  `state_changes`가 비었는지만으로 재조사 여부를 구분할 수 없다.

AnonymousSession과 PlaySession의 기존 `success/data` envelope는 변경하지 않는다.

## 4. State Changes

닫힌 목록은 다음 아홉 종류다. 아래 세 Object 상태 change는 확장 구현으로,
`current_zone_changed`는 Q6로 추가됐다.

- `clue_acquired`: `clue_id`
- `puzzle_completed`: `puzzle_id`
- `zone_unlocked`: `zone_id`
- `hint_level_changed`: `puzzle_id`, `hint_level`
- `flag_updated`: `flag`, `value`
- `object_revealed`: `zone_id`, `object_id` — 유효 `visible` false → true
- `object_hidden`: `zone_id`, `object_id` — 유효 `visible` true → false
- `object_unlocked`: `zone_id`, `object_id` — 유효 `enabled` false → true
- **(Q6 변경)** `current_zone_changed`: `zone_id` — navigate 성공 시 이동한 목적지 Zone.
  navigate만 생성하며 항상 한 개다. 과거 세션의 위치 복원(§2.3)은 change를 만들지 않는다.

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
- **(Q6 변경)** `current_zone_id`: navigate 성공 시 목적지로 바뀐다. Zone 1개 콘텐츠의
  과거 세션은 `input`·`inspect`·`navigate` 처리 시 `entry_zone_id`로 복원되어 저장될 수
  있다(§2.3). PlaySession GET은 저장값을 그대로 반환하며 복원을 계산하지 않는다.

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

**(Q6 변경)** `navigate`의 내부 equality 대상은 `interaction_type=navigate`,
`target_id=<목적지 Zone ID>`, `payload={}`다. 같은 Event ID로 목적지를 바꾸면 409이고,
출발 `zone_id`만 바꾸면 replay다. replay와 동일 요청 판정은 Zone 검사보다 먼저 하므로,
이동한 뒤 이전 Zone의 input·inspect·navigate Event를 재전송해도 최초 응답을 받는다.
거절된 요청은 Event를 남기지 않으므로 같은 Event ID로 다시 시도할 수 있다.

콘텐츠 변경 시 주의: `input`·`inspect`는 replay 판정 전에 Object를 해석한다. 배포 후
Zone·Object ID를 바꾸거나 Object의 interaction `target_id`를 다른 퍼즐·조사로 바꾸면,
이전 Event 재전송이 404 또는 멱등 충돌 409가 될 수 있다. 저장된 현재 Zone이 콘텐츠에서
사라지면 그 세션은 409 `Current zone is unknown.`이 된다. 배포된 케이스의 ID는 바꾸지 않는다.

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
| 퍼즐·조사의 선행 단서 미획득 (Q5) | 409 | `Required clues are not acquired.` + `missing_clue_count` |
| **(Q6)** 현재 위치 확정 불가 (다중 Zone 과거 세션, 콘텐츠에서 사라진 Zone) | 409 | `Current zone is unknown.` |
| **(Q6)** 요청 `zone_id`가 서버 현재 위치와 다름 (input·inspect·navigate) | 409 | `Zone is not current.` |
| **(Q6)** 출발 Zone에 목적지로 가는 문 연결 없음 | 409 | `Navigation is unavailable.` |
| **(Q6)** navigate 문이 서버 유효 상태에서 숨김 / 비활성 | 409 | `Object is not visible.` / `Object is not enabled.` |
| `select` Runtime 미구현 (**Q6 변경**: navigate 제외) | 501 | `Interaction action '<action>' is not implemented.` |
| Client Content·Runtime 구성 오류, Client/Server 교차 참조 오류 | 500 | `Case content is unavailable.` 등 |
| `incorrect`, `already_completed`, inspect·navigate `ok` | 200 | — |

서버 파일 경로, 원본 JSON 또는 내부 validation 상세는 HTTP response에 노출하지 않는다.
`visible`·`enabled` 판정은 `inspect` 대상과 `navigate`의 문에 적용한다. `input`은 Object 상태를 검사하지
않는다(아래 합의 필요 사항 참고).

## 9. 제외 범위

- ~~navigate Runtime과 current zone mutation, 비활성 문 이동의 서버 검증~~ (Q6로 구현됨)
- 접근할 수 없는 Zone의 Case Bundle 조회 제한 — Bundle은 계속 모든 Zone을 공개한다
- select Runtime
- Session 상태를 반영한 Zone 조회 API
- 단서 표시 데이터(제목·본문 등)를 Interaction 응답에 싣는 것 — `clue_acquired`에는 계속
  `clue_id`만 담긴다. 표시 정보는 별도 `GET /play-sessions/{id}/clues`(`clue_api_v0.1.md`)
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
- (Q5) 선행 조건 409 응답에 `missing_clue_count`를 추가하는 형식, 개수 공개 범위
- ~~(Q5) 현재 Zone 밖 대상의 상호작용 허용~~ → Q6에서 409로 제한
- (Q6) `current_zone_changed`를 Frontend 계약 v0.3.2 §5 닫힌 목록에 추가할지
- (Q6) 신규 오류 문구 3종(`Current zone is unknown.`, `Zone is not current.`,
  `Navigation is unavailable.`)과 409
- (Q6) 다른 Zone에서 보낸 완료 퍼즐·조사 요청을 `already_completed`·`ok` 대신 409로 처리
- (Q6) 다중 Zone 과거 세션(`current_zone_id=null`)의 Frontend 안내와 복구 방법
- (Q6) 배포된 케이스의 Zone·Object·interaction target ID 불변 운영 규칙
- 실제 MySQL 영속성 검증(미완료)
