# PlaySession Initialization Policy v0.1

**Status: Implemented Policy v0.1**

## 1. 목적

PlaySession 생성 시 요청의 `case_id`를 Client Content와 연결하고, 검증된
`entry_zone_id`를 신규 세션의 `current_zone_id`로 초기화하는 정책을 정한다.
이 문서는 구현된 초기화 정책과 호환 경계를 기록한다. ORM column과 DB Schema는
변경하지 않고 `state_json`을 확장했다.

핵심 질문은 Client Content가 없거나 잘못된 Case에 대해서도 PlaySession 생성을
허용할 것인지다. 초기 위치의 Source of Truth, 기존 POST 호환성, 과거 row의
키 누락, HTTP 오류 분류를 함께 고려한다.

## 2. 구현된 생성 흐름

현재 `create_play_session()`의 순서는 다음과 같다.

1. `anonymous_session_id`로 AnonymousSession을 조회한다.
2. AnonymousSession의 존재와 만료 여부를 확인한다.
3. Client Content를 로드하고 `entry_zone_id`를 확인한다.
4. `current_zone_id`를 포함한 초기 `state_json`을 만든다.
5. PlaySession ORM 객체를 Session에 추가한다.
6. 한 번의 commit 후 refresh하고 결과를 반환한다.

현재 초기 상태는 다음과 같다.

```json
{
  "current_zone_id": "ZONE_001",
  "completed_puzzle_ids": [],
  "acquired_clue_ids": [],
  "hint_levels": {},
  "flags": {}
}
```

Request Schema는 기존 길이 검증을 유지하고 실제 ID 형식과 Content 유효성은
Client Loader를 Source of Truth로 사용한다. 유효한 Content가 없으면 PlaySession을
추가하거나 commit하지 않는다.

## 3. entry_zone_id 현황

`CaseClientContent`에는 필수 `entry_zone_id`가 구현되어 있다.

- 빈 문자열을 허용하지 않는다.
- 같은 Case의 `zones[].zone_id` 중 하나를 참조해야 한다.
- Zone 배열 순서와 무관하다.
- `zones[0]`을 시작 위치로 추론하지 않는다.
- 빈 Zone 목록은 유효한 Entry Zone을 가질 수 없으므로 검증에 실패한다.

따라서 정상적으로 로드된 Client Content의 `entry_zone_id`는 신규 PlaySession의
초기 위치로 바로 사용할 수 있는 검증된 값이다.

## 4. Case Content 존재 정책

### A. Client Content 필수

```text
AnonymousSession 검증
-> load_case_client_content(case_id)
-> entry_zone_id 획득
-> current_zone_id 초기화
-> PlaySession 저장
```

장점:

- 실제로 로드 가능한 Case에 대해서만 PlaySession을 생성한다.
- `case_id -> client.json -> entry_zone_id -> current_zone_id`가 명확해진다.
- 잘못된 Case ID로 플레이 불가능한 세션이 쌓이지 않는다.
- Zone API와 이어하기 기능이 유효한 시작 위치를 전제로 개발될 수 있다.

비용:

- 기존 POST는 임의 Case ID를 허용했으므로 행동 계약이 강화된다.
- PlaySession 테스트에 유효한 Client Content fixture가 필요하다.
- Content 오류를 HTTP 오류로 변환하는 정책과 운영 진단이 필요하다.

### B. Client Content 선택

Content가 없을 때 `current_zone_id`를 누락하거나 `null`로 저장하면 기존 POST와
가깝게 동작한다. 그러나 신규 세션도 유효한 시작 위치를 보장하지 못하고,
PlaySession 생성 성공이 실제 플레이 가능성을 뜻하지 않게 된다. Zone 조회와
이어하기에서 같은 누락을 반복 처리해야 한다.

### C. Request의 initial_zone_id 사용

Frontend가 초기 위치를 고르면 여러 시작점을 표현할 수 있지만, Client Content가
Source of Truth라는 원칙을 약화한다. 서버는 결국 해당 Zone의 존재와 접근 가능성을
Content로 다시 검증해야 하므로 Content 필수 정책을 대체하지 못한다. v0.1의 기본
후보로 사용하지 않는다.

**확정: A. Client Content 필수.** MVP의 PlaySession 생성 성공은 최소한 정적
Client Content가 유효하고 시작 Zone이 결정되었다는 뜻이어야 한다. 개발 편의를
위해 누락을 허용하는 대신 테스트에서 작은 명시적 Content fixture를 제공한다.

## 5. current_zone_id 저장 전략

### state_json 필드

MVP에서는 `state_json.current_zone_id`를 사용한다.

```json
{
  "current_zone_id": "ZONE_001",
  "completed_puzzle_ids": [],
  "acquired_clue_ids": [],
  "hint_levels": {},
  "flags": {}
}
```

장점:

- ORM 컬럼과 Alembic Migration이 필요 없다.
- 퍼즐·단서·flag와 같은 진행 상태로 저장하고 같은 트랜잭션에서 변경할 수 있다.
- 기존 PlaySession 조회 및 Interaction의 전체 state 반환 구조를 유지할 수 있다.
- 독립 검색이나 인덱싱 요구가 없는 현재 MVP에 충분하다.

주의점:

- JSON key 누락과 `null`을 Schema에서 구분하거나 호환 처리해야 한다.
- Router가 state를 수동 조립하므로 POST와 GET 양쪽을 함께 갱신해야 한다.
- Interaction 응답과 저장된 `response_json`의 state 직렬화도 영향을 받는다.
- 향후 Zone 위치로 대량 검색해야 한다면 별도 컬럼을 다시 평가해야 한다.

별도 DB 컬럼은 조회·인덱스 요구가 확인되지 않았고 기존 row backfill 및 Migration을
요구하므로 v0.1에서는 권장하지 않는다.

## 6. 기존 row 호환 전략

기존 PlaySession row에는 `current_zone_id` key가 없다. 다음의 과도기 정책을
적용한다.

```text
기존 row: current_zone_id 누락을 None으로 읽음
신규 row: entry_zone_id를 non-null current_zone_id로 저장
```

`PlaySessionState`에서는 `current_zone_id: str | None = None` 호환 파싱을
사용한다. 이 optional 정의는 과거 row를 읽기 위한 것이며,
신규 세션에 `null` 저장을 허용하는 생성 정책은 아니다.

기존 row는 조회 시 DB에서 갱신하지 않는다. 현재 Client Content의
`entry_zone_id`를 과거 세션에 즉석으로 주입하면 Content 변경이 과거 세션의
위치를 바꿀 수 있고, 실제 방문 위치를 복원했다는 보장도 없다. 기존 row의
`None`을 허용하고 별도 보정 정책이 확정되기 전까지 위치 미상으로 취급한다.

## 7. Client Content 오류 분류

| 예외 | 의미 | 권장 분류 |
|---|---|---|
| `InvalidClientCaseIdError` | 허용되지 않는 문자나 경로 형태의 Case ID | Client request 오류 |
| `CaseClientContentNotFoundError` | 요청 ID에 해당하는 `.client.json`을 찾지 못함 | 외부에서는 Case unavailable/not found |
| `CaseClientContentJSONDecodeError` | 파일은 있으나 JSON 또는 문자 인코딩이 잘못됨 | 서버 콘텐츠 구성 오류 |
| `CaseClientContentValidationError` | 파일이 Client Schema를 만족하지 않거나 내부 `case_id`가 다름 | 서버 콘텐츠 구성 오류 |

현재 Case Registry나 `cases` 테이블이 없으므로 존재하지 않는 Case ID와 배포에서
빠진 known Case 파일을 `NotFoundError`만으로 구분할 수 없다. HTTP 응답과 별도로
배포 전 Content Validation CLI, readiness 검사 또는 운영 로그가 누락을 발견해야
한다. 향후 Registry가 생기면 known Case의 파일 누락은 명확한 서버 오류로
재분류할 수 있다.

## 8. HTTP Error 후보

권장 외부 정책은 다음과 같다.

| 상황 | 권장 HTTP | 이유 |
|---|---:|---|
| Case ID 형식이 유효하지 않음 | 422 | Request 값 자체가 허용된 식별자 형식이 아님 |
| Client Content 파일 없음 | 404 | 현재 Registry 없이 확인 가능한 것은 요청 Case Content가 없다는 사실뿐임 |
| JSON decode 실패 | 500 | 서버가 관리하는 Content artifact가 손상됨 |
| Client Schema validation 실패 | 500 | 서버가 제공해야 할 Content가 Contract를 위반함 |

500 응답에는 Pydantic 오류나 파일 경로 같은 내부 정보를 그대로 노출하지 않는다.
정확한 `detail` 문자열은 API Contract로 구현 전에 확정한다. 내부 로그에는
`case_id`, 예외 종류, 원인을 남겨 운영 문제를 구분할 수 있어야 한다.

오류 우선순위는 기존 동작을 보존하도록 다음 순서를 추천한다.

```text
AnonymousSession 없음/만료 확인
-> Client Content load 및 검증
-> PlaySession 생성
```

따라서 AnonymousSession과 Case ID가 모두 잘못된 요청에서는 기존 404/410 정책이
먼저 적용된다. Content load 실패 전에는 PlaySession INSERT나 commit을 하지 않는다.

## 9. POST Response 영향

기존 envelope는 유지할 수 있다.

```json
{
  "success": true,
  "data": {
    "play_session_id": "<uuid>",
    "case_id": "case_001",
    "created_at": "<UTC datetime>",
    "state": {
      "current_zone_id": "ZONE_001",
      "completed_puzzle_ids": [],
      "acquired_clue_ids": [],
      "hint_levels": {},
      "flags": {}
    }
  }
}
```

즉 endpoint나 중첩 구조를 바꾸지 않고 `state`에 필드를 추가한다. 신규 세션의
POST 응답은 non-null 위치를 반환한다. 기존 row의 GET 응답은 호환 Schema 정책에
따라 `current_zone_id: null`을 반환하는 방향이 단순하다.

필드 추가는 일반적으로 확장 변경이지만, 응답의 알 수 없는 필드를 거부하는 Client가
있다면 영향을 받을 수 있다. 구현 시 기존 POST/GET Contract 문서를 갱신하고 회귀
테스트를 추가한다. FE 전용 flat Session Adapter는 이 작업과 분리한다.

## 10. Interaction/Zone 영향

`current_zone_id` 추가는 위치 저장의 시작일 뿐 Zone 접근 정책을 만들지는 않는다.

- External Interaction의 `request.zone_id == current_zone_id`를 강제하지 않는다.
- Object Resolver의 현재 target 해석 규칙을 변경하지 않는다.
- Navigation 요청이나 위치 갱신 API를 추가하지 않는다.
- Session-derived `visible`/`enabled`를 계산하지 않는다.
- Zone 조회가 현재 위치 외 Zone을 허용할지는 별도 Contract로 결정한다.

Interaction Service는 전체 `state_json`을 복사해 변경하므로 신규 위치 key를
보존해야 한다. `PlaySessionState` 확장 시 신규 InteractionEvent의
`response_json`에도 위치가 포함된다. 과거 Event 응답에 key가 없을 때는 기존
PlaySession row와 같은 optional 호환 규칙이 필요하며 과거 위치를 추론하지 않는다.

## 11. 구현 정책

1. 신규 PlaySession 생성에는 유효한 Client Content를 필수로 한다.
2. AnonymousSession 검증 후 `load_case_client_content(case_id)`를 호출한다.
3. 검증된 `entry_zone_id`를 `state_json.current_zone_id`에 non-null로 저장한다.
4. Request에 `initial_zone_id`를 추가하지 않는다.
5. 기존 row의 누락 key는 `None`으로 읽고 DB를 자동 갱신하지 않는다.
6. 기존 POST/GET envelope를 유지하고 중첩 `state`만 확장한다.
7. missing Content는 현 구조에서 404, malformed Content는 500으로 구분한다.
8. 위치 저장과 Zone 접근·Navigation 검증은 별도 단계로 유지한다.

이 정책은 구현 및 로컬 MySQL 검증되었다. Migration 없이 초기 위치의 Source of
Truth를 명확히 하며 과거 row를 파괴적으로 보정하지 않는다.

## 12. 구현 영향 파일

구현된 최소 영향 범위는 다음과 같다.

- `app/schemas/play_session.py`: 호환 가능한 `current_zone_id` state 필드.
- `app/services/play_session.py`: Content load, 신규 state 초기화, Content 오류 변환.
- `app/api/v1/play_sessions.py`: Content 오류의 HTTP 변환과 POST/GET state 직렬화.
- `tests/test_play_sessions.py`: Content fixture, 초기 위치, 오류 및 과거 row 테스트.
- `tests/test_interaction_service.py`: 위치 key 보존과 Interaction state 직렬화 회귀.
- `tests/test_interactions.py`: 기존 External Interaction WIP 회귀 테스트로 영향 없음 확인(파일 수정 없음).
- `scripts/verify_play_session_entry_zone.py`: 실제 API와 MySQL 저장·조회 검증.
- `docs/play_session_api.md`: POST/GET state 및 오류 Contract 갱신.
- `docs/contracts/play_session_fe_mapping_v0.1.md`: 확정된 초기화 정책 반영.

`app/models/play_session.py`, 기존 Alembic Migration, DB 컬럼은 변경하지 않는다.
`app/services/case_content.py`의 Loader 동작도 재사용하며 중복 구현하지 않는다.

## 13. 테스트 전략

### Service/Router

- 유효한 Content의 `entry_zone_id`가 신규 `state_json.current_zone_id`에 저장된다.
- POST 응답의 `state.current_zone_id`가 저장값과 일치한다.
- AnonymousSession 없음과 만료 오류가 기존 404/410을 유지한다.
- Content load는 AnonymousSession 검증 이후에만 호출된다.
- 유효하지 않은 Case ID는 422로 변환된다.
- Content 파일 없음은 404로 변환되고 DB write/commit이 없다.
- JSON decode 및 Schema validation 오류는 500으로 변환되고 DB write/commit이 없다.
- Content 오류 이후 AsyncSession transaction 정리 여부를 확인한다.
- DB commit 오류의 기존 rollback 동작을 유지한다.

### 기존 row/응답

- `current_zone_id` key가 없는 기존 row를 GET할 수 있고 위치는 `None`으로 표현된다.
- 신규 row의 POST/GET에는 non-null 위치가 포함된다.
- 기존 row 조회만으로 `state_json`이 변경되거나 commit되지 않는다.
- 과거 InteractionEvent 응답에 위치 key가 없어도 replay가 가능하다.
- 신규 Interaction은 위치 key를 보존하고 state 전체에 포함한다.

### 회귀 및 실제 검증

- 전체 pytest, Ruff lint, Ruff format check를 실행한다.
- Swagger/OpenAPI에 확장된 state와 오류 응답이 반영되는지 확인한다.
- 실제 MySQL에서 신규 row의 JSON에 위치가 저장되는지 확인한다.
- 기존 row를 수정하거나 전체 삭제하지 않고 읽기 호환성을 검증한다.

## 14. Decision Required

다음 운영·향후 구조 결정은 남아 있다.

1. 배포 전에 모든 공개 Case의 client/server Content를 검증하는 절차를
   readiness 또는 별도 배포 단계 중 어디에 둘지.
2. 향후 Case Registry가 도입되면 known Case의 Content 파일 누락을 500으로
   재분류할지.
3. Navigation이 구현될 때 `current_zone_id` 변경과 Zone 접근 검증을 어떤
   Transaction 경계로 처리할지.
