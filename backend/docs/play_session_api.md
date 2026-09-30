# Play Session API

## 1. 목적

유효한 익명 세션으로 게임 플레이를 시작하고 초기 진행 상태를 저장합니다.

`AnonymousSession`은 비로그인 사용자를 식별하고,
`PlaySession`은 해당 사용자의 실제 게임 진행 상태를 담당합니다.

## 2. API 계약

### Endpoint

```http
POST /api/v1/play-sessions
```

### Request Body

```json
{
  "anonymous_session_id": "5bb78728-d94c-4113-82e9-30e5ffd2a46e",
  "case_id": "case-001"
}
```

- `anonymous_session_id`: 존재하며 만료되지 않은 익명 세션 ID
- `case_id`: 1자 이상 64자 이하이며 유효한 Client Content가 존재하는 사건 ID

### Success Response

HTTP Status:

```text
201 Created
```

```json
{
  "success": true,
  "data": {
    "play_session_id": "0a2a5044-a83d-433b-bfe0-17c550b45c63",
    "case_id": "case-001",
    "created_at": "2026-09-18T00:34:47.546846Z",
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

## 3. 오류 응답

### AnonymousSession이 존재하지 않음

HTTP Status:

```text
404 Not Found
```

```json
{
  "detail": "Anonymous session not found."
}
```

### AnonymousSession이 만료됨

HTTP Status:

```text
410 Gone
```

```json
{
  "detail": "Anonymous session has expired."
}
```

필수 필드 누락이나 `case_id` 길이 위반은 FastAPI 요청 검증에 따라
`422 Unprocessable Entity`로 처리합니다. Loader가 거부하는 Case ID 형식은
아래의 `Invalid case ID` 응답으로 처리합니다.

### Case ID 형식이 유효하지 않음

```text
422 Unprocessable Entity
```

```json
{
  "detail": "Invalid case ID."
}
```

### Case Client Content가 존재하지 않음

```text
404 Not Found
```

```json
{
  "detail": "Case not found."
}
```

### Case Client Content를 사용할 수 없음

JSON parse 또는 Client Schema 검증이 실패하면 내부 상세를 노출하지 않고 다음을 반환합니다.

```text
500 Internal Server Error
```

```json
{
  "detail": "Case content is unavailable."
}
```

## 4. 초기 상태

새 PlaySession은 다음 상태로 시작합니다.

```json
{
  "current_zone_id": "ZONE_001",
  "completed_puzzle_ids": [],
  "acquired_clue_ids": [],
  "hint_levels": {},
  "flags": {}
}
```

Client Content의 `entry_zone_id`를 `current_zone_id`로 초기화합니다. DB에서는
`state_json`에 저장하고 API에서는 `state`로 반환합니다. AnonymousSession 검증이
성공한 뒤 Client Content를 검증하므로 익명 세션 오류가 Case 오류보다 우선합니다.

## 5. DB 저장 관계

```text
AnonymousSession 1
        ↓
PlaySession N
```

`play_sessions.anonymous_session_id`는 `anonymous_sessions.id`를 참조합니다.

저장 필드:

| Column | 설명 |
|---|---|
| `id` | PlaySession UUID |
| `anonymous_session_id` | 연결된 AnonymousSession UUID |
| `case_id` | 플레이할 사건 ID |
| `state_json` | 현재 게임 진행 상태 |
| `created_at` | 생성 시각 |
| `updated_at` | 마지막 갱신 시각 |
| `completed_at` | 완료 시각, 최초 생성 시 `NULL` |

## 6. UTC 처리

MySQL `DATETIME(6)`에는 UTC 기준 naive datetime을 저장합니다.
API의 `created_at` 응답에는 UTC timezone을 명시합니다.

최초 생성 시 `created_at`과 `updated_at`은 같고 `completed_at`은 `NULL`입니다.

## 7. 검증 상태

2026-09-18 로컬 개발 환경에서 다음 항목을 검증했습니다.

- pytest 자동 테스트: 성공, 필수 입력 오류, 404, 410, 초기 상태, 저장 동작
- 로컬 Uvicorn HTTP 호출: 201, 404, 410 응답 확인
- `waegok_app` 계정으로 `waegok` MySQL 연결 확인
- API가 반환한 `play_session_id`로 실제 저장 레코드 조회
- `id`, `anonymous_session_id`, `case_id`, `state_json` 일치 확인
- `created_at`, `updated_at`, `completed_at` 정책 확인
- API UTC timezone과 DB UTC naive datetime 일치 확인

검증 데이터는 기존 데이터와 구분되는 `validation-*` case ID를 사용했으며,
전체 삭제나 기존 데이터 변경은 수행하지 않았습니다.

## 8. 완료 기준

- [x] API 계약 확인
- [x] DB 구조 및 ORM Model 확인
- [x] Alembic Migration 적용 확인
- [x] Pydantic Schema 구현
- [x] Service 구현
- [x] Router 구현 및 `main.py` 등록
- [x] 자동 테스트
- [x] 실제 HTTP 호출 검증
- [x] 실제 MySQL 저장 검증
- [x] 문서 갱신

따라서 `POST /api/v1/play-sessions`는 현재 로컬 개발 환경에서 구현 및 검증 완료 상태입니다.

## 9. 상태 조회 / 이어하기 API

저장된 PlaySession의 현재 진행 상태를 조회해 새로고침이나 재접속 후 플레이를 이어갑니다.

### Endpoint

```http
GET /api/v1/play-sessions/{play_session_id}
```

### Success Response

HTTP Status:

```text
200 OK
```

```json
{
  "success": true,
  "data": {
    "play_session_id": "0a2a5044-a83d-433b-bfe0-17c550b45c63",
    "case_id": "case-001",
    "created_at": "2026-09-18T00:34:47.546846Z",
    "updated_at": "2026-09-18T00:39:47.546846Z",
    "completed_at": null,
    "state": {
      "current_zone_id": null,
      "completed_puzzle_ids": [],
      "acquired_clue_ids": [],
      "hint_levels": {},
      "flags": {}
    }
  }
}
```

`created_at`, `updated_at`, 완료 세션의 `completed_at`에는 UTC timezone을 명시합니다.
진행 중인 세션의 `completed_at`은 `null`입니다.
과거 `state_json`에 `current_zone_id`가 없으면 API에서 `null`로 반환하며 DB row를
수정하거나 현재 Content에서 위치를 추론하지 않습니다. 신규 세션은 non-null
`current_zone_id`로 생성됩니다.

### Not Found Response

존재하지 않는 `play_session_id`는 다음 응답을 반환합니다.

```text
404 Not Found
```

```json
{
  "detail": "Play session not found."
}
```

### 조회 정책

- AnonymousSession 만료 여부를 다시 검사하지 않습니다.
- 완료된 PlaySession도 정상 리소스로 조회합니다.
- 조회 과정에서는 PlaySession을 추가하거나 갱신하지 않습니다.
- 장애 자동 복구가 아니라 DB에 저장된 게임 진행 상태를 반환하는 API입니다.

## 10. 조회 API 검증 상태

2026-09-18 로컬 개발 환경에서 다음 항목을 검증했습니다.

- pytest 자동 테스트: 진행 중 세션 200, 완료 세션 UTC, 미존재 세션 404
- `PlaySession` 모델과 요청 ID를 사용한 ORM 조회 확인
- 조회 시 `add`, `commit`, `refresh`, `rollback` 미호출 확인
- 기존 검증용 PlaySession으로 실제 GET 200 확인
- API `state`와 MySQL `state_json` 일치 확인
- `case_id`, `created_at`, `updated_at`, `completed_at` 일치 확인
- API 응답의 UTC timezone 확인
- 완료 검증용 PlaySession의 non-null `completed_at` UTC 응답 확인
- 실제 GET 호출 전후 DB 스냅샷이 변경되지 않았음을 확인
- 실제 404 응답과 OpenAPI Response Schema 노출 확인

따라서 `GET /api/v1/play-sessions/{play_session_id}`는 현재 로컬 개발 환경에서 구현 및 검증 완료 상태입니다.

## 11. Entry Zone 초기화 검증

2026-09-23 로컬 개발 환경에서 production Content를 만들지 않고 임시 Client
Content와 전용 UUID row를 사용해 다음을 검증했습니다.

- `entry_zone_id`가 첫 번째 Zone이 아니어도 POST state에 정확히 반환됨
- MySQL `state_json.current_zone_id` 저장 확인
- GET 응답에서 저장된 위치 반환 확인
- 검증용 PlaySession과 AnonymousSession row의 제한적 cleanup 확인
- 전체 pytest 및 Ruff 검증 통과
