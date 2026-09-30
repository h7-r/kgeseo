# Google Authentication API Contract v0.1

**Status: Implemented PoC v0.1**

## 1. 목적과 범위

이 API는 Google Identity Services(GIS)에서 발급받은 Google ID token을 Backend가
검증하고, 검증된 Google 사용자 프로필을 Frontend에 반환한다.

현재 PoC는 다음 작업만 수행한다.

- Frontend가 GIS callback의 `credential`을 수신한다.
- Backend가 Google ID token의 신뢰성과 대상 Client ID를 검증한다.
- Backend가 필요한 claim을 정제한 프로필로 반환한다.
- Frontend가 반환된 프로필을 현재 React state에 표시한다.

현재 구현은 사용자를 DB에 저장하지 않으며 자체 JWT 또는 로그인 session을 발급하지
않는다. Google credential 자체를 왜곡 서비스의 인증 토큰으로 저장하거나 재사용하지
않는다.

## 2. 전체 흐름

```text
Frontend
  -> Google Identity Services
  <- Google credential (ID token)
  -> POST /api/v1/auth/google
  -> Backend Google token verification
  <- sanitized Google profile
Frontend
```

이 흐름의 성공은 "Google 사용자가 Backend에서 검증되었다"는 의미다. 왜곡 서비스의
지속 로그인 session이나 보호 API 접근 권한이 생성되었다는 의미는 아니다.

## 3. Endpoint

```http
POST /api/v1/auth/google
Content-Type: application/json
```

Router의 `/auth` prefix와 애플리케이션의 `/api/v1` prefix를 조합한 경로다. DB를
조회하거나 변경하지 않는다.

## 4. Request

```json
{
  "credential": "<GOOGLE_ID_TOKEN>"
}
```

| 필드 | 타입 | 필수 | Validation | 의미 |
|---|---|---:|---|---|
| `credential` | string | 예 | 최소 길이 1 | GIS callback이 반환한 Google ID token |

필드가 없거나 빈 문자열이면 FastAPI/Pydantic request validation에 의해 HTTP 422를
반환한다. 실제 token 값은 문서, 로그 또는 Git에 기록하지 않는다.

## 5. Success Response

HTTP 200:

```json
{
  "provider": "google",
  "subject": "<GOOGLE_SUBJECT>",
  "email": "user@example.com",
  "email_verified": true,
  "name": "Example User",
  "picture": "https://example.com/profile.png"
}
```

| 필드 | 타입 | 필수 | 의미 |
|---|---|---:|---|
| `provider` | string | 예 | 현재 구현에서는 `google` |
| `subject` | string | 예 | Google `sub` claim. 외부 계정의 안정적인 식별자 |
| `email` | string | 예 | 검증된 token에서 추출한 이메일 |
| `email_verified` | boolean | 예 | 현재 성공 응답에서는 항상 `true` |
| `name` | string 또는 null | 아니요 | Google profile에 존재할 때 반환 |
| `picture` | string 또는 null | 아니요 | Google profile에 존재할 때 반환하는 이미지 URL |

Google 계정의 안정적인 외부 identity는 변경될 수 있는 이메일이 아니라 `subject`
(`sub`)로 식별한다. `name`과 `picture` claim은 없을 수 있으며, 현재 response model은
이 경우 해당 값을 `null`로 직렬화할 수 있다.

## 6. Error Contract

### 6.1 잘못되었거나 신뢰할 수 없는 credential

HTTP 401:

```json
{
  "detail": "Invalid Google credential."
}
```

Google 검증 실패, 만료, audience 불일치, 필수 claim 누락 또는 미검증 이메일에 사용한다.
Frontend는 로그인 상태를 만들지 않고 현재 구현처럼 HTTP status가 포함된 실패 상태를
표시한다. 원본 credential이나 내부 검증 예외는 사용자에게 반환하지 않는다.

### 6.2 Request validation 실패

HTTP 422:

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "credential"],
      "msg": "Field required",
      "input": {}
    }
  ]
}
```

`credential` 필드가 없거나 빈 문자열일 때 FastAPI/Pydantic이 생성한다. 세부 `type`과
메시지는 validation 실패 종류에 따라 달라질 수 있다. Frontend는 요청 생성 오류로
취급하고 로그인 상태를 만들지 않는다.

### 6.3 Backend Google 설정 누락

HTTP 503:

```json
{
  "detail": "Google authentication is not configured."
}
```

Backend의 `GOOGLE_CLIENT_ID`가 비어 있거나 placeholder일 때 반환한다. 사용자 token
오류와 구분되는 서버 설정 오류이며, Frontend는 로그인 실패 상태를 유지한다.

## 7. Backend 검증 규칙

`app.services.google_auth.verify_google_credential()`은
`google.oauth2.id_token.verify_oauth2_token()`을 사용한다.

`google-auth` 라이브러리가 검증하는 항목:

- Google 공개 키를 이용한 token signature
- `aud`가 전달한 `GOOGLE_CLIENT_ID`와 일치하는지
- token expiration
- Google issuer

왜곡 Backend가 검증 결과에 추가로 적용하는 규칙:

- `sub`가 반드시 존재해야 한다.
- `email`이 반드시 존재해야 한다.
- `email_verified`가 정확히 `true`여야 한다.
- `name`과 `picture`는 optional claim으로 처리한다.
- 검증 또는 필수 claim 확인에 실패하면 동일한 401 계약으로 변환한다.

token payload를 단순 decode한 결과만 신뢰해서는 안 된다. 모든 로그인 요청은 Backend의
검증 단계를 거쳐야 한다.

## 8. Frontend 사용 방법

현재 구현의 최소 호출 흐름은 다음과 같다.

```text
Google GIS callback
  -> response.credential
  -> Google로그인(response.credential)
  -> POST /api/v1/auth/google
  -> Backend가 반환한 profile을 React state에 저장
```

`src/서버/api.js`의 `Google로그인()`은 `/api/v1/auth/google` 상대경로를 사용하므로
기존 Vite `/api` proxy를 그대로 통과한다. `src/서버/Google로그인.jsx`는 검증된
profile만 state에 보관하고 로그아웃 시 이를 초기화한다.

Frontend 보안 경계:

- credential을 `console.log` 등으로 출력하지 않는다.
- credential을 `localStorage` 또는 `sessionStorage`에 저장하지 않는다.
- Client Secret을 사용하거나 Frontend에 노출하지 않는다.
- Backend가 반환한 profile은 로그인 표시용이며 보호 API authorization 근거가 아니다.

## 9. 환경변수

Backend:

```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
```

Frontend:

```env
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
```

두 값에는 동일한 Google Web OAuth Client ID를 설정한다. Client ID는 브라우저에서
사용되는 공개 식별자이며 Client Secret과 다르다. 이 PoC는 Client Secret을 사용하지
않으며 관련 환경변수도 정의하지 않는다.

실제 `.env`와 `.env.local`은 Git에 commit하지 않는다. 예제와 문서에는 placeholder만
기록한다.

## 10. 현재 PoC 범위와 제한

구현된 범위:

- GIS 기반 Google 계정 선택과 credential 수신
- Backend Google ID token 검증
- 정제된 Google profile 반환
- Frontend 로그인 상태 표시
- Frontend 로그아웃 시 메모리 상태 초기화

구현되지 않은 범위:

- `app_users` 또는 `auth_identities` 저장
- 자체 JWT 또는 로그인 session 발급
- 새로고침 후 로그인 상태 유지
- AnonymousSession과 인증 사용자 연결
- 보호 API authorization
- 서버 session revoke를 포함한 정식 로그아웃

현재 로그아웃은 Frontend React state를 지우고 GIS auto-select를 비활성화한다. Backend
session이나 token을 폐기하는 동작은 아니다.

## 11. 개발 및 시연 환경

검증 완료:

- 같은 LAN의 다른 PC에서 Frontend -> Vite proxy -> Backend -> DB Health/Readiness 통신
- `http://localhost:5173`에서 실제 Google 계정 선택
- `/api/v1/auth/google` 호출과 Backend token 검증
- 검증된 이름과 이메일의 Frontend 표시

Google 로그인 자체는 `http://localhost:5173`에서 검증했다. LAN raw IP origin에서의
Google 로그인은 현재 검증 범위가 아니며, LAN Health/Readiness 성공과 혼동하지 않는다.

## 12. 자동 테스트 근거

`backend/tests/test_google_auth.py`는 외부 Google 서버를 직접 호출하지 않고 verifier를
mock 또는 monkeypatch하여 다음 계약을 검증한다.

- 정상 credential은 HTTP 200과 정제된 profile을 반환한다.
- 응답에 원본 credential이 포함되지 않는다.
- invalid credential과 검증 실패는 HTTP 401이다.
- Backend Client ID 설정 누락은 HTTP 503이다.
- credential 누락과 빈 문자열은 HTTP 422다.
- verifier가 설정된 audience를 Google 검증 함수에 전달한다.
- `sub` 누락 또는 `email_verified=false`를 거부한다.

현재 전체 Backend 검증 기록은 `174 passed, 2 warnings`다. 테스트 개수는 코드 변경에
따라 달라질 수 있으므로 계약의 기준은 위 검증 항목과 테스트 코드다.

## 13. 보안 주의사항

- Google ID token 원문을 로그에 출력하지 않는다.
- credential을 브라우저 저장소나 Backend DB에 저장하지 않는다.
- Client Secret을 Frontend에 노출하거나 Git에 commit하지 않는다.
- 이메일을 외부 identity primary key로 사용하지 않고 Google `sub`를 사용한다.
- token을 단순 decode만 해서 신뢰하지 않는다.
- Google credential을 사용하는 모든 로그인은 Backend 검증을 거친다.

## 14. Future Work

- `app_users` / `auth_identities` migration 계보 복구
- Google identity와 내부 user 연결
- 자체 로그인 session 또는 JWT 설계
- AnonymousSession에서 인증 사용자로의 연결 정책
- logout 및 session revocation 정책
- 보호 API authorization

위 항목은 현재 구현 범위가 아니며 이 계약에서 완료된 기능으로 간주하지 않는다.
