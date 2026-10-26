# Interaction / Puzzle Runtime Contract v0.1

**Status: Draft Contract v0.1**

이 문서는 Interaction API와 Puzzle Runtime Definition의 v0.1 설계 방향과
현재 구현된 범위를 정리한다. production Runtime Content를 이용한 실제 게임 통합 검증은
아직 완료되지 않았다.

외부 HTTP Adapter의 Source of Truth는 `interaction_api_v0.3.2.md`와
`fe_backend_interaction_mapping_v0.1.md`다. 이 문서의 Interaction Request/Result 명칭은
Backend 내부 v0.1 모델을 설명하며 외부 HTTP Contract로 직접 노출하지 않는다.

문서에서 사용하는 상태 표시는 다음과 같다.

- **Confirmed Decision**: v0.1 설계 방향으로 합의된 내용
- **Proposed Schema**: 구현 전에 추가 검토가 필요한 제안 구조
- **TBD**: 아직 결정하지 않은 내용
- **Example**: 구조 설명을 위한 예시이며 실제 콘텐츠 확정값이 아님

## 1. 목적

Interaction API는 모든 플레이어 행동을 서버로 보내는 API가 아니다.
게임 상태를 변경할 수 있는 의미 있는 행동만 Backend에 전달하고,
Backend가 판정한 결과를 PlaySession 상태에 반영하기 위한 계약이다.

Puzzle Runtime Definition은 Backend가 퍼즐 정답과 상태 변경 효과를 판정할 때 사용하는
서버 전용 최소 콘텐츠 구조를 정의한다.

## 2. 범위

### 2.1 Frontend 책임

다음 항목은 Frontend가 담당한다.

- 위치
- 회전
- 카메라
- 모델 표시
- 조명
- 단순 UI 연출

### 2.2 Backend 책임

다음 항목은 Backend가 Source of Truth로 관리한다.

- 퍼즐 정답 판정
- 퍼즐 완료 상태
- 단서 획득 상태
- 해금 상태
- 중요한 게임 진행 상태

### 2.3 v0.1 Interaction Type

**Confirmed Decision** (`submit_answer`, `combine_clues`)

v0.1은 다음 두 Interaction type을 지원한다. `inspect`는 이후 확장 구현으로
추가됐다(팀 검토 대기, §7.6).

| `interaction_type` | 목적 |
|---|---|
| `submit_answer` | 퍼즐 정답 제출 |
| `combine_clues` | 조사수첩에서 단서 두 개 조합 |
| `inspect` | Object 조사. `target_id`는 Server `inspect_id`, 판정용 `zone_id`·`object_id` 포함 |

클라이언트는 다음 상태 변경을 직접 명령하지 않는다.

- 단서 획득
- 퍼즐 완료
- 해금
- `flags` 변경

이 상태들은 Interaction을 Backend가 판정한 결과로만 변경한다.

## 3. 확정된 설계

**Confirmed Decision**

- 게임 상태 판정과 상태 변경의 Source of Truth는 Backend다.
- 정답과 오답은 정상적인 게임 결과이며 API 장애가 아니다.
- `client_event_id`를 사용해 동일 요청의 중복 처리를 방지한다.
- 퍼즐 정답 Source of Truth는 Frontend에 두지 않는다.
- MVP에서는 Puzzle/Answer DB 테이블 대신 Backend 전용 정적 Case Content JSON을 사용한다.
- v0.1 단서 조합은 정확히 두 개의 단서만 지원하며 순서는 의미가 없다.
- 퍼즐 성공과 단서 조합 성공은 가능한 한 동일한 Effect 구조를 사용한다.
- 사용자 답안은 정규화 후 비교하지만 이벤트에는 원본 입력을 저장한다.
- 완료된 Puzzle에 다시 답을 제출하면 Effect를 재적용하지 않고 `already_completed`를 반환한다.
- 동일한 멱등 요청은 최초 응답을 재사용하고, 같은 이벤트 ID의 다른 요청은 HTTP 409로 거부한다.
- 정상 처리된 Interaction 게임 결과에는 현재 PlaySession 전체 state를 항상 포함한다.
- 판정, PlaySession 상태 변경, 이벤트 기록은 하나의 DB Transaction으로 처리한다.
- v0.1 Runtime Definition은 요청 시 파일을 읽고 검증하며 별도 cache를 사용하지 않는다.
- Runtime Definition에 없는 `puzzle_id`는 `PuzzleNotFoundError`로 구분하고, Router에서 HTTP 404로 변환한다.
- 획득하지 않은 단서가 포함된 조합은 `ClueNotAcquiredError`로 구분하고, Router에서 HTTP 409로 변환한다.

## 4. Interaction API v0.1

### 4.1 Endpoint

```http
POST /api/v1/play-sessions/{play_session_id}/interactions
```

`play_session_id`는 Interaction이 발생한 플레이를 식별한다.

### 4.2 공통 필드

| Field | 의미 |
|---|---|
| `client_event_id` | 클라이언트가 생성한 요청 UUID. 중복 처리 방지에 사용 |
| `interaction_type` | `submit_answer` 또는 `combine_clues` |
| `target_id` | Interaction 대상 ID. `submit_answer`에서는 `puzzle_id` 사용 |
| `payload` | Interaction type별 입력 데이터 |

Request는 `interaction_type`에 따라 분리된 Pydantic Schema로 검증한다.

### 4.3 `submit_answer`

다음은 **Example**이며 `puzzle_01`과 `아랑사`는 실제 콘텐츠 확정값이 아니다.

```json
{
  "client_event_id": "<uuid>",
  "interaction_type": "submit_answer",
  "target_id": "puzzle_01",
  "payload": {
    "answer": "아랑사"
  }
}
```

`target_id`는 답안을 제출할 `puzzle_id`다.

### 4.4 `combine_clues`

다음은 **Example**이며 `clue_03`과 `clue_07`은 실제 콘텐츠 확정값이 아니다.

```json
{
  "client_event_id": "<uuid>",
  "interaction_type": "combine_clues",
  "payload": {
    "clue_ids": [
      "clue_03",
      "clue_07"
    ]
  }
}
```

두 `clue_id` 자체가 대상이므로 `target_id`가 필요하지 않을 수 있다.
`combine_clues`에서 `target_id`를 최종적으로 허용하거나 금지할지는 실제 Request Schema 확정 시 검토한다.

### 4.5 게임 결과와 API 오류

정답과 오답은 Service가 반환하는 정상 처리 결과다.
외부 HTTP result type과 Response 구조는 Mapping 문서에서 정의한다.

오답 응답 **Example**:

```json
{
  "success": true,
  "result_type": "incorrect",
  "state": {
    "completed_puzzle_ids": [],
    "acquired_clue_ids": [],
    "hint_levels": {},
    "flags": {}
  }
}
```

단서 조합 실패 응답 **Example**:

```json
{
  "success": true,
  "result_type": "incorrect_combination",
  "state": {
    "completed_puzzle_ids": [],
    "acquired_clue_ids": [],
    "hint_levels": {},
    "flags": {}
  }
}
```

v0.1 결과 후보는 다음과 같다.

- `correct`
- `incorrect`
- `combined`
- `incorrect_combination`
- `already_completed`
- `inspected` (확장, 외부 `ok`)
- `already_inspected` (확장, 외부 `ok`, `state_changes=[]`)

이미 완료된 Puzzle에 새로운 `client_event_id`로 답을 다시 제출하면
Backend 내부 Service는 `already_completed`를 반환한다.
퍼즐 판정과 Effect는 다시 적용하지 않으며 현재 PlaySession 전체 state를 유지한다.
외부 HTTP에서는 `already_completed`로 매핑한다.

정상적으로 처리된 다음 게임 결과 Response에는 현재 PlaySession 전체 state를 항상 포함한다.

- `correct`
- `incorrect`
- `combined`
- `incorrect_combination`
- `already_completed`
- 동일 요청의 idempotent replay

Request validation, 404, 409, 서버 오류와 같은 HTTP 오류 Response에는
state 포함을 강제하지 않는다.

다음은 게임 결과가 아니라 API 오류다.

- PlaySession이 존재하지 않음
- `submit_answer`의 `target_id`가 Runtime Definition에 존재하지 않음
- `combine_clues`에 현재 획득하지 않은 단서가 포함됨
- Request 구조가 잘못됨
- 같은 이벤트 ID가 최초 요청과 다른 내용으로 재사용됨
- 서버 내부 장애

같은 이벤트 ID가 다른 요청에 재사용된 경우는 HTTP 409 Conflict로 처리한다.
존재하지 않는 퍼즐은 Service의 `PuzzleNotFoundError`로 구분하며 Router에서 HTTP 404로 변환한다.
미획득 단서 사용은 Service의 `ClueNotAcquiredError`로 구분하며 Router에서 HTTP 409 Conflict로 변환한다.
아래 표에 없는 예외에는 이 Draft에서 새로운 HTTP 매핑을 추가하지 않는다.

두 단서를 모두 획득했지만 Runtime Definition에 해당 조합이 없는 경우는 API 오류가 아니다.
정상 게임 결과인 `incorrect_combination`을 반환한다.

현재 Router의 Service Exception 매핑은 다음과 같다.

| Service Exception | HTTP Status | `detail` |
|---|---:|---|
| `PlaySessionNotFoundError` | 404 | `Play session not found.` |
| `PuzzleNotFoundError` | 404 | `Puzzle not found.` |
| `InspectionNotFoundError` (확장) | 404 | `Inspection not found.` |
| `ZoneNotFoundError` | 404 | `Zone not found.` |
| `ObjectNotFoundError` | 404 | `Object not found.` |
| `ClueNotAcquiredError` | 409 | `Clue is not acquired.` |
| `ObjectInteractionNotFoundError` | 409 | `Object interaction is unavailable.` |
| `InteractionTypeMismatchError` | 409 | `Interaction action does not match the object.` |
| `ObjectNotVisibleError` (확장) | 409 | `Object is not visible.` |
| `ObjectNotEnabledError` (확장) | 409 | `Object is not enabled.` |
| `RequiredCluesMissingError` (Q5) | 409 | `Required clues are not acquired.` + 최상위 `missing_clue_count` |
| `IdempotencyConflictError` | 409 | `Client event ID conflicts with a previous interaction.` |
| `CurrentZoneUnknownError` (Q6) | 409 | `Current zone is unknown.` |
| `ZoneNotCurrentError` (Q6) | 409 | `Zone is not current.` |
| `NavigationUnavailableError` (Q6) | 409 | `Navigation is unavailable.` |
| `UnsupportedInteractionActionError` | 501 | `Interaction action '<action>' is not implemented.` (`select`. **Q6 변경**: navigate 제외) |
| `CaseClientContentError` | 500 | `Case content is unavailable.` |
| `CaseContentLinkValidationError` (확장) | 500 | `Case content is unavailable.` |
| `PuzzleRuntimeError` | 500 | `Puzzle runtime is unavailable.` |

Runtime 파일 없음, JSON decode 실패, Runtime Schema validation 실패는
정상 게임 결과로 변환하지 않는다. 현재 Router는 `PuzzleRuntimeError` 계열을
내부 파일 경로나 validation 상세를 노출하지 않는 안전한 HTTP 500 응답으로 변환한다.

## 5. Idempotency

**Confirmed Decision**

`client_event_id`는 동일 Interaction 요청의 재전송으로 상태 변화가 중복 적용되는 것을 방지한다.

```text
첫 요청
client_event_id = abc123
→ Interaction 처리
→ 상태 변경
→ 결과 저장

같은 요청 재전송
client_event_id = abc123
→ Interaction 재처리 안 함
→ 최초 저장 response를 그대로 반환
→ 상태 변경 없음
```

멱등성 범위는 PlaySession 단위이며, 제안 DB 제약은
`UNIQUE(play_session_id, client_event_id)`다.

동일 요청 여부는 같은 `play_session_id`와 `client_event_id` 범위에서
`interaction_type`, `target_id`, `payload`가 최초 요청과 모두 같은지로 판단한다.

- 모두 같으면 최초 저장된 response를 그대로 반환하고 상태를 다시 변경하지 않는다.
- 하나라도 다르면 HTTP 409 Conflict를 반환하고 Interaction 처리와 상태 변경을 수행하지 않는다.

동일 요청의 idempotent replay는 정상 게임 결과이므로 최초 response에 저장된
현재 PlaySession 전체 state도 그대로 반환한다.

## 6. `interaction_events` Schema

**Confirmed Decision**

| Column | Type | Constraint / 의미 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `play_session_id` | `CHAR(36)` | PlaySession FK |
| `client_event_id` | `CHAR(36)` | 클라이언트 생성 이벤트 UUID |
| `client_timestamp` | `DATETIME(6)` | NULL 허용, 클라이언트 시각을 UTC naive로 정규화 |
| `interaction_type` | `VARCHAR(32)` | Interaction type |
| `target_id` | `VARCHAR(64)` | NULL 허용 |
| `payload_json` | `JSON` | 클라이언트가 보낸 원본 payload |
| `result_type` | `VARCHAR(32)` | 판정 결과 |
| `response_json` | `JSON` | 최초 처리 응답 |
| `created_at` | `DATETIME(6)` | UTC 기준 naive datetime |

제안 제약과 인덱스:

```text
UNIQUE(play_session_id, client_event_id)
INDEX(play_session_id)
```

이 테이블은 멱등성 처리 기록과 최소 Interaction 이벤트 기록을 함께 담당한다.

v0.1에서는 다음 필드를 포함하지 않는 방향이다.

- `updated_at`
- `deleted_at`
- `retry_count`
- `ip_address`
- `user_agent`
- `processing_status`
- `error_stack`

`client_timestamp`는 서버 권위 시각과 멱등 equality에 사용하지 않는다.
이 Schema는 Alembic Migration으로 적용되어 있다.

## 7. Puzzle Runtime Definition v0.1

### 7.1 저장 방향

**Confirmed Decision**

MVP에서는 Backend 전용 정적 Case Content JSON을 사용한다.

권장 위치 **Example**:

```text
app/content/cases/case_001.server.json
```

`.server.json`은 정답 정보가 포함된 Backend 전용 콘텐츠임을 나타낸다.
이 파일은 Frontend에 그대로 노출하면 안 된다.

v0.1의 실제 디렉터리와 파일 이름은 다음 규칙을 사용한다.

```text
app/content/cases/<case_id>.server.json
```

`case_id`는 영문, 숫자, underscore, hyphen으로 구성된 단일 파일 식별자여야 한다.

### 7.2 Runtime Definition

다음 JSON의 모든 ID와 정답은 **Example**이며 실제 콘텐츠 확정값이 아니다.

```json
{
  "schema_version": "0.1",
  "case_id": "case_001",
  "puzzles": [
    {
      "puzzle_id": "puzzle_01",
      "accepted_answers": [
        "아랑사"
      ],
      "on_correct": {
        "grant_clue_ids": [
          "clue_03"
        ],
        "set_flags": {
          "dock_archive_unlocked": true
        }
      }
    }
  ],
  "clue_combinations": [
    {
      "combination_id": "combination_01",
      "clue_ids": [
        "clue_03",
        "clue_07"
      ],
      "on_success": {
        "complete_puzzle_ids": [
          "puzzle_02"
        ],
        "grant_clue_ids": [
          "clue_10"
        ],
        "set_flags": {
          "truth_fragment_01": true
        }
      }
    }
  ]
}
```

### 7.3 필드 규칙

| Field | 규칙 |
|---|---|
| `schema_version` | Runtime Definition 구조 버전. API 버전이나 게임 버전과 별개 |
| `case_id` | `PlaySession.case_id`로 Runtime Content를 찾을 때 사용 |
| `puzzle_id` | 퍼즐 고유 ID |
| `accepted_answers` | 서버가 정답으로 인정할 문자열 목록. 숫자 답도 문자열로 저장 |
| `on_correct` | 퍼즐 정답 성공 후 적용할 추가 상태 변화 |
| `clue_combinations` | 두 단서의 조합과 성공 효과 목록 |
| `on_success` | 단서 조합 성공 후 적용할 상태 변화 |

숫자 자물쇠 답안 **Example**:

```json
{
  "accepted_answers": ["1234"]
}
```

v0.1 Effect가 지원하는 필드는 다음 세 개다.

- `grant_clue_ids`
- `complete_puzzle_ids`
- `set_flags`

확장 구현으로 네 번째 필드가 추가됐다(팀 검토 대기).

- `set_object_states` (선택, 기본값 `[]`): §7.6

퍼즐 성공 시 `completed_puzzle_ids`에 `puzzle_id`를 추가하는 것은 Backend 공통 규칙이다.
Runtime JSON에는 `complete_puzzle: true` 같은 중복 필드를 두지 않는다.
`on_correct`, `on_success`, `on_inspect`는 모두 같은 Effect 구조를 사용한다.

### 7.4 Clue Combination

v0.1은 정확히 두 개의 `clue_id` 조합만 지원한다.

```text
clue_03 + clue_07
clue_07 + clue_03
```

위 두 입력은 같은 조합이다. `clue_ids` 순서는 의미가 없다.
조합 성공 시 `on_success` Effect를 적용한다.

### 7.5 Loading / Cache

**Confirmed Decision**

- Runtime Definition은 필요한 요청 시점에 해당 Case의 `.server.json` 파일을 읽는다.
- Python 표준 JSON parser로 읽은 후 Pydantic Runtime Schema로 검증한다.
  정의되지 않은 필드는 검증 오류다(§7.7).
- v0.1에서는 별도 cache를 사용하지 않는다.
- cache는 실제 필요가 확인된 후 별도 작업으로 검토한다.
- Loader는 DB에 접근하거나 원본 JSON을 변경하지 않는다.
- 원본 server-only JSON을 Frontend에 반환하는 API를 제공하지 않는다.
- (확장) Object 상태가 필요한 처리(`set_object_states`가 있는 Effect 적용, `inspect`)에서만
  Client Content도 읽고 `validate_case_content_links`로 교차 검증한 뒤 진행한다.
  검증 실패는 아무것도 적용하지 않고 HTTP 500으로 변환한다.

### 7.6 Object 상태 Effect와 Inspection (확장 구현, 팀 검토 대기)

`set_object_states` 항목 형식:

```json
{ "zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "enabled": true }
```

- `zone_id`, `object_id`는 필수이며 빈 문자열을 허용하지 않는다.
- `visible`, `enabled`는 선택이지만 최소 하나는 있어야 하며 JSON boolean만 허용한다
  (`"true"`, `1`, `null` 거부). 정의되지 않은 필드는 거부한다.
- `enabled: false`는 지원하지 않는다. 대응하는 state change 계약이 없어 Schema에서 거부한다.
- 한 Effect 안에서 같은 `(zone_id, object_id)`를 두 번 쓰면 값이 같든 다르든 거부한다.
  다른 Zone의 같은 `object_id`는 별개 대상이다.

Server Runtime에 선택 필드 `inspections`(기본값 `[]`)가 추가됐다.

```json
{
  "inspections": [
    {
      "inspect_id": "INSPECT_BEDDING",
      "on_inspect": {
        "grant_clue_ids": [],
        "set_flags": {},
        "set_object_states": [
          { "zone_id": "ZONE_SARANG", "object_id": "OBJ_LETTER", "visible": true }
        ]
      }
    }
  ]
}
```

- `inspect_id`는 빈 문자열 불가, Runtime 안에서 유일하다(중복은 Schema validation error).
- Client Object의 `interaction: {"type": "inspect", "target_id": "<inspect_id>"}`로 연결한다.
  조사 효과는 Client Content에 두지 않는다.
- 위 JSON의 ID는 **Example**이다.

**조사 문구 `message` (Q7, 2026-10-26, 팀 검토 대기)**

```json
{
  "inspect_id": "INSPECT_SCREEN",
  "on_inspect": { "grant_clue_ids": [], "set_flags": {} },
  "message": "병풍 뒤에는 먼지뿐입니다."
}
```

- 선택 필드다. 생략하거나 `null`이면 문구가 없다(기존 콘텐츠와 호환).
- 문자열만 허용한다. 빈 문자열·공백만 있는 값은 Schema 오류다(`clues[].summary`·`body`와
  같은 규칙). 다른 정의되지 않은 필드는 계속 거부한다.
- 응답 동작: 첫 조사 성공 응답의 `message`에만 싣는다. 이미 조사한 대상의 재조사는
  `message=null`, 모든 오류(Zone·숨김·비활성·선행 단서)는 문구를 싣지 않는다.
  같은 Event 재전송은 저장된 최초 응답을 그대로 돌려준다
  (`interaction_api_v0.3.2.md` §2.1).
- 표시용 문구다. 정답 판정·단서 조건·단서 참조 검증 대상이 아니다.
  Client Content가 아니라 Server Runtime에 두므로 조사 전에는 Frontend에 내려가지 않는다.
- 위 JSON의 ID와 문구는 **Example**이다.

### 7.7 Schema 엄격 검증 (2026-10-23)

Server Runtime 모델 6개는 모두 정의되지 않은 필드를 거부한다(`extra="forbid"`).
이전에는 `ObjectStateEffect`를 뺀 5개가 정의되지 않은 필드를 **오류 없이 버렸다**.

| 모델 | JSON 위치 |
|---|---|
| `PuzzleRuntimeDefinition` | 최상위 |
| `PuzzleDefinition` | `puzzles[]` |
| `ClueCombinationDefinition` | `clue_combinations[]` |
| `InspectionDefinition` | `inspections[]` |
| `RuntimeEffect` | `on_correct`, `on_success`, `on_inspect` |
| `ObjectStateEffect` | `set_object_states[]` (원래부터 거부) |

- 필드 목록, 필수 여부, 기본값은 바뀌지 않았다. 기존 `case_001`과 테스트 콘텐츠는 그대로 로드된다.
- 다음은 여전히 **미지원**이며 로드 오류(`extra_forbidden`)가 난다:
  정의되지 않은 효과(예: `set_clue_states`), 임의 메타데이터 필드,
  선행 조건 별칭(`requires`, `required_clues` 등).
  최상위 `clues[]`는 이후 Q4(§7.8), `puzzles[]`·`inspections[]`의 `requires_clue_ids`는
  Q5(§7.9)에서 지원됐다.
  `on_correct` 대신 `success_effects`를 쓰면 `on_correct` 누락(`missing`)과
  `success_effects`(`extra_forbidden`)가 함께 보고된다.
- 런타임에서 로드에 실패하면 응답 문구는 그대로다. Interaction은 HTTP 500
  `Puzzle runtime is unavailable.`, Case Bundle은 HTTP 500 `Case content is unavailable.`이며
  필드 이름이나 파일 경로를 응답에 넣지 않는다.
- `python -m scripts.validate_case <case_id>`는 스키마 실패 시 기존
  `[FAIL] <단계>: <예외 이름>` 줄 아래에 오류마다 한 줄씩
  `<파일> → <경로> → <오류 종류> → <메시지>`를 출력하고 종료 코드 1로 끝난다.
  JSON 문법 오류는 `<파일> → line L, column C → json_invalid → <메시지>`다.
  입력값(정답 등)은 출력하지 않는다. 예:

  ```text
  [FAIL] Server Runtime Schema: CaseRuntimeValidationError
  case_x.server.json → puzzles.0.required_clues → extra_forbidden → Extra inputs are not permitted
  Case 'case_x': INVALID
  ```

- **이번 변경에 포함하지 않은 것:** 값 타입의 느슨한 변환. 예를 들어 `set_flags`의 `"yes"`·`1`은
  `true`로, Client Content의 `"visible": "false"`는 `false`로 바뀌어 로드된다.
  `puzzle_id`, `combination_id`의 빈 문자열도 아직 막지 않는다.

### 7.8 단서 정의 `clues[]` (Q4, 2026-10-23, 팀 검토 대기)

Server Runtime 최상위 선택 필드 `clues`(기본값 `[]`)에 단서 표시 정보를 둔다.
필드는 `clue_id`(필수), `title`(필수), `summary`(선택), `body`(선택)이며
정의되지 않은 필드(`carrier_kind`, `asset_key` 등)는 거부한다.

- `clue_id` 빈 값·공백만 있는 값, `title` 공백만 있는 값, 값을 쓴 `summary`·`body`의
  공백만 있는 값은 거부한다. `clue_id` 중복도 거부한다.
- `clues` 키가 있으면(빈 목록 포함) 모든 `grant_clue_ids`와 단서 조합 `clue_ids`가
  정의돼 있어야 한다. 키가 없으면 기존처럼 ID만 쓰며 이 검증을 하지 않는다.
- 단서 정의는 Server 전용이다. 획득한 단서만 `GET /api/v1/play-sessions/{id}/clues`로
  공개한다. 상세 계약은 `clue_api_v0.1.md`.

### 7.9 선행 단서 조건 `requires_clue_ids` (Q5, 2026-10-23, 팀 검토 대기)

`puzzles[]`와 `inspections[]`에 선택 필드 `requires_clue_ids`(기본값 `[]`)를 둔다.
나열한 단서를 PlaySession이 **모두** 획득해야 정답 판정·조사 효과가 실행된다.
필드가 없거나 빈 배열이면 조건이 없다(기존 콘텐츠와 호환).

- 원소는 문자열이며 빈 값·공백만 있는 값, 같은 항목 안의 중복은 Schema 오류다.
- `clues`를 명시한 콘텐츠는 `requires_clue_ids`의 모든 ID가 `clues`에 정의돼 있어야 한다.
  `clues`가 없으면 존재 검증을 하지 않는다(ID만 쓰는 기존 방식).
- 별칭(`requires`, `required_clues`, `requires: {clue_ids}` 등)은 허용하지 않는다.

PM 생성 JSON 형식 예 (구조만 PM 생성 케이스와 같고 ID·정답은 실제 콘텐츠가 아닌 **Example**):

```json
{
  "puzzles": [
    {
      "puzzle_id": "PZ-LOCK",
      "accepted_answers": ["ANSWER_EXAMPLE"],
      "requires_clue_ids": ["CL-A-1", "CL-A-2", "CL-A-3"],
      "on_correct": {
        "grant_clue_ids": [],
        "set_flags": {},
        "set_object_states": [
          { "zone_id": "ZONE_A", "object_id": "OBJ_A_DOOR", "enabled": true }
        ]
      }
    }
  ],
  "inspections": [
    {
      "inspect_id": "INSP_SEAL",
      "requires_clue_ids": ["CL-B-1", "CL-B-2"],
      "on_inspect": { "grant_clue_ids": [], "complete_puzzle_ids": ["PZ-SEAL"], "set_flags": {} }
    }
  ]
}
```

런타임 판정 위치(행 잠금 안, 같은 `client_event_id` replay가 가장 먼저):

- `input`: 퍼즐 없음 404 → 완료 퍼즐 `already_completed` → **선행 조건** → 시도 횟수 +1
  → 정답 비교 → 효과. 정답 비교 전에 판정하므로 정답·오답 모두 같은 409이고,
  응답으로 정답 여부가 드러나지 않는다.
- `inspect`: 조사 정의 없음 404 → 완료 조사 `ok`·`[]` → 숨김·비활성 409 → **선행 조건**
  → 효과(Q7: 이때만 `message`를 싣는다). 완료 확인을 숨김 판정보다 먼저 하는 기존 순서
  (`interaction_api_v0.3.2.md` §2.1)는 유지한다.

조건이 부족하면 `RequiredCluesMissingError` → HTTP 409. 상태·시도 횟수·Interaction Event·
commit 모두 없다. 이벤트가 남지 않으므로 같은 `client_event_id`로 단서를 얻은 뒤 다시
보내면 새로 처리된다. 응답에는 부족한 **개수**만 넣고 단서 ID는 넣지 않는다.

## 8. State Mutation Rules

현재 신규 PlaySession의 `state_json` 구조는 다음과 같다.

```json
{
  "current_zone_id": "ZONE_001",
  "completed_puzzle_ids": [],
  "completed_inspect_ids": [],
  "acquired_clue_ids": [],
  "hint_levels": {},
  "attempt_counts": {},
  "flags": {},
  "object_states": {}
}
```

`current_zone_id`, `attempt_counts`, `completed_inspect_ids`, `object_states`는 과거 row에
없을 수 있으며 읽을 때 각각 `null`, `{}`, `[]`, `{}`로 해석한다.

Interaction 성공 시 Backend는 다음 규칙으로 상태를 변경한다.

### `completed_puzzle_ids`

- 정답 처리된 `puzzle_id`를 추가한다.
- Effect의 `complete_puzzle_ids`에 정의된 ID를 추가한다.
- 이미 존재하는 `puzzle_id`는 중복 추가하지 않는다.

### `acquired_clue_ids`

- Effect의 `grant_clue_ids` 값을 추가한다.
- 이미 보유한 `clue_id`는 중복 추가하지 않는다.

### `flags`

- Effect의 `set_flags` 값을 기존 `flags`에 merge한다.

### `hint_levels`

- `submit_answer`와 `combine_clues`에서는 변경하지 않는다.

### `object_states` (확장)

- 구조: `{zone_id: {object_id: {"visible"?: bool, "enabled"?: bool}}}`. Zone과 Object를
  중첩 key로 나눈다. ID에 문자 제약이 없어 `"ZONE/OBJ"` 같은 합친 key는 충돌할 수 있다.
- 유효 상태 = Client Content Object 초기값 위에 기록된 속성만 덮어쓴 값
  (`app/services/object_state.py`의 `resolve_effective_object_state`).
- `set_object_states`의 각 속성은 유효 상태와 다를 때만 기록하고 change를 만든다.
- 기록할 때만 키를 만든다. 변화가 없으면 과거 row에 키를 추가하지 않는다.
- 저장값 형식이 잘못되면(알 수 없는 속성, boolean 아님) 읽기 검증 오류다.

### `completed_inspect_ids` (확장)

- `inspect` 효과를 처음 적용할 때 `inspect_id`를 추가한다.
- 목록에 있는 `inspect_id`는 다시 적용하지 않는다(`already_inspected`). 효과 중복 방지만으로는
  부족하다. 예: 서신을 조사해 숨긴 뒤 이부자리를 재조사하면 "다시 표시"가 실제 변화로
  계산돼 서신이 되살아난다.

클라이언트는 위 상태 변화의 최종 값을 직접 지정하지 않는다.

### Interaction State Changes

Service는 실제 상태가 변경된 항목만 `puzzle_completed`, `clue_acquired`,
`flag_updated`, (확장) `object_revealed`, `object_hidden`, `object_unlocked`로 기록한다.
순서는 puzzle, clue, flag, Object 순이며 같은 종류 안에서는 Runtime Effect의 순서를
유지한다. 한 Object 안에서는 visible change가 enabled change보다 먼저다.
이미 반영된 값에는 중복 change를 만들지 않는다.

신규 Event의 `response_json`에는 이 목록을 저장한다. 기존 Event에 목록이 없으면
빈 배열로 읽고 과거 변경 내역을 추론하지 않는다.

### Transaction Invariant

**Confirmed Decision**

새로운 Interaction을 처리할 때 다음 세 작업은 하나의 DB Transaction으로 처리한다.

1. Interaction 판정
2. `PlaySession.state_json` 상태 변경
3. `interaction_events` 기록

세 작업 중 일부만 반영된 상태는 허용하지 않는다.
Transaction이 성공하면 모두 반영하고, 실패하면 모두 rollback해야 한다.

## 9. Answer Normalization

**Confirmed Decision**

정답 비교 전에 다음 정규화를 순서대로 적용한다.

1. 문자열 앞뒤 공백을 제거한다.
2. 문자열 내부의 모든 whitespace를 제거한다.
3. 대소문자가 존재하는 문자는 대소문자 차이를 무시한다.
4. 정규화된 문자열끼리 정확히 비교한다.

개념적 Python **Example**:

```python
def normalize_answer(value: str) -> str:
    return "".join(value.split()).casefold()
```

정규화 **Example**:

| 입력 | 비교 값 |
|---|---|
| `"아랑사"` | `"아랑사"` |
| `" 아랑사 "` | `"아랑사"` |
| `"아랑 사"` | `"아랑사"` |
| `"아 랑 사"` | `"아랑사"` |
| `"ANSWER"` | `"answer"` |
| `" Answer "` | `"answer"` |
| `"1 2 3 4"` | `"1234"` |

다음 처리는 수행하지 않는다.

- 오타 자동 교정
- 부분 일치
- 유사어 추론
- AI를 이용한 의미상 정답 추측

의미상 허용할 표현은 콘텐츠 작성자가 `accepted_answers`에 명시적으로 추가한다.

```json
{
  "accepted_answers": [
    "아랑사",
    "어부 아랑사"
  ]
}
```

위 값도 구조 설명을 위한 **Example**이다.

원칙은 다음과 같다.

> 표현상의 공백·대소문자는 관대하게, 의미상의 차이는 콘텐츠 작성자가 명시적으로 허용한다.

## 10. Security / Server-only Content

- Puzzle 정답과 판정 규칙은 Backend에만 둔다.
- `.server.json` Runtime Definition을 Frontend에 그대로 제공하지 않는다.
- Interaction 요청의 정답 여부와 상태 변화는 Backend가 판정한다.
- 클라이언트가 `grant_clue_ids`, `completed_puzzle_ids`, `set_flags`를 직접 명령하지 못하게 한다.
- (확장) `set_object_states`, `inspections`, `on_inspect`도 Server-only다. 별도 Object 상태
  변경 API는 없고, Object 상태는 Interaction 판정 결과로만 바뀐다.

정답 비교에는 정규화된 값을 사용하지만,
`interaction_events.payload_json`에는 사용자가 보낸 원본 값을 저장하는 방향이다.

```text
원본 입력: " 아랑 사 "
비교 값:   "아랑사"
이벤트:    " 아랑 사 "
```

원본 입력은 향후 사용자 입력 패턴 분석과 디버깅에 활용할 수 있다.
보존 기간과 Analytics 활용 수준은 아직 결정하지 않았다.

## 11. Puzzle Agent 연계

현재와 향후 흐름은 다음 방향을 가정한다.

```text
현재
사람이 Server Runtime JSON 작성

향후
Puzzle Agent
→ Puzzle Definition 생성
→ 사람 검수
→ Backend Runtime JSON

더 이후
관리자 승인
→ 필요 시 DB 저장
```

Runtime JSON Contract는 향후 Puzzle Agent 출력 포맷의 일부로 활용될 수 있다.
Puzzle Agent 전체 출력에는 퍼즐 설명, 근거, 힌트, 연출 등 더 많은 정보가 포함될 수 있으나,
Runtime Definition에는 서버 판정에 필요한 최소 데이터만 둔다.

## 12. 제외 범위

v0.1 Runtime Definition은 다음 정보를 다루지 않는다.

- 퍼즐 제목
- 퍼즐 설명
- 힌트 내용
- 난이도
- Asset 정보
- NPC 대사
- 위치/좌표
- 연출
- Sound
- AI 생성 메타데이터

이 정보가 불필요하다는 의미가 아니라 Interaction Runtime 판정의 책임에서 분리한다는 의미다.

## 13. TBD

다음 항목은 아직 결정하지 않았으며, 이 Draft에서 임의로 확정하지 않는다.

1. Interaction Event 보존 기간
2. `interaction_events`를 Analytics 용도로 어느 수준까지 활용할지
3. 향후 Puzzle Runtime Definition을 DB로 이전할 시점
4. (확장) `set_object_states`·`inspections` 구조와 `enabled: false` 미지원 정책의 확정
5. (확장) 세션에 저장된 `object_states`가 콘텐츠 수정으로 사라진 Object를 가리킬 때의
   처리. 현재는 Object 상태 계산 시 404(`Zone/Object not found.`)로 실패한다.
6. (확장) Object 상태 처리 시 Client Content를 행 잠금 전·후 두 번 읽는 비용의 허용 여부
7. 값 타입 엄격 검증(`set_flags` boolean, Client `visible`·`enabled`, ID 빈 문자열)의 적용 여부
8. 생성 에이전트 결과물의 메타데이터(설명, 근거, 힌트 등)를 Server JSON에 둘 허용 영역을 만들지.
   지금은 정의되지 않은 필드로 거부된다.
9. 선행 조건: `requires_clue_ids`(단서만)로 구현됨(§7.9). 퍼즐 완료·flag 조건과
   `excludes`를 추가할지, NPC 대사 조건과 모델을 함께 쓸지는 미정

## 14. 다음 구현 단계

이 문서 자체는 구현 승인이 아니다. 구현 전 다음 순서로 진행한다.

1. Draft Contract와 TBD 검토
2. Request/Response Schema와 API 오류 계약 확정
3. `interaction_events` DB Schema 검토
4. ORM Model 및 신규 Alembic Migration 설계
5. 실제 Case Runtime Content 작성 및 검수
6. Service와 Router 구현
7. 멱등성, 상태 변경, 정답 정규화 자동 테스트
8. 실제 API 및 DB 저장 검증
9. 구현 결과에 맞게 Contract와 상태 문서 갱신

현재 Interaction Service v0.1에는 정답·단서 조합 판정, state 변경,
멱등성 확인, Interaction Event 기록, Transaction 처리가 구현되어 있다.
외부 HTTP 계약은 `interaction_api_v0.3.2.md`, 변환 규칙은
`fe_backend_interaction_mapping_v0.1.md`를 따른다. `input`, `combine_clues`, (확장)
`inspect`, (Q6) `navigate`를 지원하며 `select`의 Runtime 동작은 WIP다.

확장 구현(Object 상태·inspect) 검증 상태(2026-10-23): pytest 358개 통과, Ruff check 통과,
실제 `TestClient` HTTP 테스트 통과. DB는 테스트용 가짜 세션만 사용했고 실제 MySQL
영속성 검증은 하지 않았다.
