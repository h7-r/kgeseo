# Anonymous Session API

## 1. 목적

로그인하지 않은 사용자를 임시로 구분하기 위한 익명 세션을 발급합니다.

익명 세션은 **사용자 식별만 담당**하며, 실제 게임 진행 상태는 추후 `PlaySession`에서 관리합니다.

## 2. API 계약

### Endpoint

```http
POST /api/v1/anonymous-sessions
```

### Request Body

없음.

### Success Response

HTTP Status:

```text
201 Created
```

예시:

```json
{
  "success": true,
  "data": {
    "anonymous_session_id": "74d93a68-dc7a-4b84-a628-46c05c7aff14",
    "expires_at": "2026-09-15T01:49:34.193594Z"
  }
}
```

정책:

- ID 형식: UUID
- 유효시간: 생성 후 24시간
- 시간 기준: UTC

## 3. 처리 흐름

```text
POST /api/v1/anonymous-sessions
        ↓
Router
        ↓
Service
        ↓
UUID 생성
        ↓
현재 UTC 시간 계산
        ↓
expires_at = now + 24시간
        ↓
SQLAlchemy ORM 객체 생성
        ↓
MySQL INSERT
        ↓
201 Response
```

## 4. 역할 분리

- `app/models/anonymous_session.py`: DB 테이블 구조
- `app/schemas/anonymous_session.py`: API 응답 JSON 구조
- `app/services/anonymous_session.py`: UUID 생성, 시간 계산, DB 저장
- `app/api/v1/anonymous_sessions.py`: HTTP 요청/응답 처리

## 5. DB 구조

| Column | Type | Constraint | 설명 |
|---|---|---|---|
| `id` | `CHAR(36)` | PK, NOT NULL | 익명 세션 UUID |
| `created_at` | `DATETIME(6)` | NOT NULL | 생성 시각 |
| `expires_at` | `DATETIME(6)` | NOT NULL, INDEX | 만료 시각 |

의도적으로 포함하지 않는 값:

```text
status
last_seen_at
case_id
current_zone_id
puzzle 상태
clue 상태
```

게임 진행 상태는 `PlaySession`의 책임으로 분리합니다.

## 6. Migration

Alembic Revision:

```text
41648d0b186d
```

Migration 이름:

```text
create anonymous sessions
```

적용 명령:

```powershell
alembic upgrade head
```

검증된 테이블:

```text
alembic_version
anonymous_sessions
```

`alembic_version` 값:

```text
41648d0b186d
```

## 7. 실제 API 테스트

Swagger에서 `POST /api/v1/anonymous-sessions` 실행 성공.

응답:

```json
{
  "success": true,
  "data": {
    "anonymous_session_id": "74d93a68-dc7a-4b84-a628-46c05c7aff14",
    "expires_at": "2026-09-15T01:49:34.193594Z"
  }
}
```

MySQL 조회 결과:

```text
id
74d93a68-dc7a-4b84-a628-46c05c7aff14

created_at
2026-09-14 01:49:34.193594

expires_at
2026-09-15 01:49:34.193594
```

생성 시각과 만료 시각이 정확히 24시간 차이이며, API 생성 결과가 실제 DB에 저장되는 것을 확인했습니다.

## 8. 완료 기준

- [x] API 계약 정의
- [x] DB 구조 설계
- [x] SQLAlchemy ORM Model 작성
- [x] Alembic 초기 설정
- [x] Migration 생성
- [x] Migration 실제 적용
- [x] Pydantic Schema 작성
- [x] Service 구현
- [x] Router 구현
- [x] `main.py` 등록
- [x] Swagger 호출 성공
- [x] MySQL 저장 검증

따라서 `POST /api/v1/anonymous-sessions`는 현재 로컬 개발 환경에서 구현 및 검증 완료 상태입니다.
