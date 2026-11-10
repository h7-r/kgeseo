# 배포 로그인 준비 (2026-11-05)

기준 ca4f7fe에서 feat/SJ-deployment-login-ready로 분리했다. 원본 보안 브랜치의
ed6ad28 → 1a1558c → ad69c66을 순서대로 적용했다(중복 없음, 충돌 없음).
테스트 계정 DEV 전용 분기·운영 번들 검사·로컬 DB seed 보호·Naver returnTo/state
회귀 테스트를 재사용한다. 운영에서는 이전 isTest 브라우저 기록도 폐기한다.

## 코드에서 준비한 설정

- APP_ENV=production: DB 비밀번호 및 Google/Naver 설정 누락·placeholder,
  root DB 사용자, wildcard/HTTP CORS 및 잘못된 Naver callback이면 설정 로딩 실패.
  오류에 설정값을 출력하지 않는다. 개발/테스트는 기존 opt-in 동작을 유지한다.
- CORS_ORIGINS: JSON 문자열 배열로 정확한 HTTPS FE origin을 지정한다.
  origin 끝 슬래시·경로·쿼리·userinfo를 허용하지 않는다. 허용 origin만 CORS 응답.
  현재 쿠키 인증이 없으므로 allow_credentials=False다. CORS는 인증 수단이 아니다.
- Google: GOOGLE_CLIENT_ID(서버 audience), VITE_GOOGLE_CLIENT_ID(공개 FE ID).
  현재 GIS ID-token popup 방식이며 Google code callback API는 없다. 운영자는
  실제 웹사이트 origin을 Authorized JavaScript origins에 등록해야 한다.
- Naver: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET(서버만), NAVER_REDIRECT_URI,
  VITE_NAVER_CLIENT_ID(공개 FE ID). callback은 실제 웹사이트 /로그인/콜백이다.
  제공자 콘솔·FE 계산 주소·서버 설정이 일치해야 한다. 인코딩된 경로 표현도 허용.
- VITE_API_ORIGIN: 비우면 /api 같은 출처 reverse proxy(권장); 별도 API host라면
  origin만 지정한다. 운영은 HTTPS만 허용하며 userinfo·경로·쿼리·fragment는 거부.
  website 빌드에서도 검증한다. 브라우저에 provider secret을 넣지 않는다.
- VITE_GAME_URL: 실제 게임 origin. VITE_GAME_ENTRY_PATH 기본 /character-creation;
  별도 나주 앱으로 연결할 때는 운영자가 명시적으로 / 또는 필요한 query를 지정한다.
  게임 주소와 로그인 주소에 자격증명·토큰을 싣지 않는다. 다른 origin의 게임에
  sessionStorage 로그인 표시가 자동 전달된다고 가정하지 않는다.
- OAuth payload 유효성 오류는 credential/code/state 입력을 반사하지 않고 no-store.
  Naver state는 브라우저에서 한 번만 소비되고 returnTo는 사이트 내부 경로만 사용.
  기존 회원은 원래 페이지로, 신규 회원은 온보딩 완료 후 원래 페이지로 돌아간다.

## 운영자가 준비해야 하는 값과 미완료 보안 경계

실제 도메인·공개 client ID·provider secret·최소권한 DB 계정·TLS termination·
정확한 callback 등록·SPA fallback과 /api reverse proxy는 미제공이다. 임의 생성하지
않고 콘솔이나 운영 서버를 변경하지 않았다. DB 관련 값과 secret은 VITE_*에 두지 않는다.

중요: 현재 로그인 API는 user 정보만 반환한다. website/src/services/session.ts는
2시간 sessionStorage UI 기록이며 서버 인증 토큰/세션이 아니다. Backend는 로그인
HttpOnly 쿠키나 access token을 발급하지 않는다. 따라서 SameSite/Secure/HttpOnly를
설정했다고 주장할 수 없고 서버에 바인딩된 OAuth state 검증도 아직 없다. Naver state
검증은 FE 일회성 확인이며 직접 API 요청의 서버 CSRF/session 검증을 대체하지 못한다.
배포 설정 검증 통과는 운영 인증 서비스의 출시 승인이 아니다.

운영 인증 완료에는 서버 세션(또는 승인된 토큰 체계), 만료/폐기/logout/me,
계정별 권한 검증, 로그인된 사용자와 플레이 세션 소유권 연결 및 서버 state/CSRF
설계·검증이 추가로 필요하다. 쿠키 채택 시 HTTPS Secure+HttpOnly, same-site 배포는
SameSite=Lax 등을 검토하고 cross-site는 SameSite=None+Secure와 CSRF 방어 및 정확한
credentialed CORS가 필요하다. 현재 구조에 이름뿐인 cookie/secret 설정을 추가하지 않았다.
동행 NPC는 기존 익명·버전 고정 플레이 세션을 재사용하며 계정 소유 세션이 아니다.

## DB 및 검증 범위

기존 Alembic 단일 head까지의 app_users/auth_identities/social_onboarding_pendings 및
merge 마이그레이션이 필요하다. 운영자가 실제 DB를 백업·검토한 뒤 적용해야 한다.
이번 작업은 운영 DB migration·seed를 실행하지 않는다. 테스트 seed 스크립트는
로컬 dev/test 이름·명시적 확인·접속 서버 검사 없이는 쓰기를 거부한다.

로컬/격리 API 테스트, 설정 실패·CORS·OAuth 오류 및 기존 returnTo/state/온보딩
테스트는 코드 수준 증거다. 실제 계정 OAuth 성공은 도메인/제공자 설정 미준비로
검증하지 못했다. 전체 테스트·브라우저 흐름·운영 번들 검사 결과는 통합 보고서와
외부 감사 폴더 C:/dev/kgeseo-login-companion-integration-20261105에 기록한다.

## 베타 전 보안 PR A (2026-11-10): API 문서 · 로그인 Retry-After

- API 문서(`/docs` · `/redoc` · `/openapi.json`)는 `APP_ENV=production`일 때만 끈다
  (`app/core/deployment.py` `api_docs_settings`, `app/main.py`의 `FastAPI(...)`). 개발 · 테스트는 그대로 연다.
- **운영 판별은 `APP_ENV` 하나뿐이다.** 운영 서버 환경(`EnvironmentFile` 또는 `/srv/waegok/.env`)에
  `APP_ENV=production`이 없으면 기본값 `development`로 떠서 문서가 그대로 열린다. 이때 운영 설정 검증
  (`validate_deployment`: root DB 계정 금지 · HTTPS CORS · 소셜 설정 필수)도 함께 건너뛴다.
- 선행 조건(배포 전, 운영 서버 접근 권한이 있는 담당자, 값은 보고에 적지 않는다):
  1. 운영 API 프로세스 환경에 `APP_ENV=production`이 있는지(파일 내용 전체를 출력하지 말고 그 한 줄만 확인).
  2. 운영 설정이 배포 설정 검증을 통과하는지 `scripts/check_deployment.py`로 확인한다. 특히 `APP_ENV=production`을
     새로 넣는 경우에는 넣기 전에 확인한다 — 검증에 실패하면 API 가 뜨지 않는다.
- 배포 후 확인은 둘로 나눈다. 운영 Caddy가 문서 경로를 임시로 막고 있어(11/10 기준), **외부 404만으로는
  FastAPI 에서 문서가 꺼졌는지 알 수 없다.**
  1. FastAPI 자체 확인(운영 서버 내부, 운영 접근 권한이 있는 담당자만): 서버 안에서 Caddy를 거치지 않고
     `http://127.0.0.1:8000/docs`, `/redoc`, `/openapi.json`에 요청해 상태 코드가 셋 다 404인지 본다.
     응답 본문 · 헤더 · 환경 값은 보고에 옮기지 않고 상태 코드만 적는다. 200이면 선행 조건 1을 다시 확인한다.
  2. 외부 확인(Caddy 경유, 누구나): `https://api.k-escape.com/docs`, `/redoc`, `/openapi.json`이 계속 404인지,
     `/api/v1/health`가 `{"status":"ok"}`, `/api/v1/health/ready`가 `{"status":"ready"}`인지 본다.
  - Caddy 임시 차단은 1에서 FastAPI 자체가 404임을 확인한 뒤에 정리할지 정한다(남겨 둬도 무방하다).
- 로그인 잠금 429 는 `Retry-After`(정수 초)를 싣는다. 값은 `login_throttles.locked_until - 지금`을 올림한 값이고,
  이메일 · IP 잠금이 둘 다면 더 늦게 풀리는 쪽이다. 잠금 정책(15분 안 이메일당 5회 · IP당 30회 실패)과
  401 · 429 응답 본문은 바꾸지 않았다. CORS `expose_headers`에 `Retry-After`가 이미 있어 웹사이트가 읽을 수 있다.
- 되돌리기: 이 PR 커밋을 되돌려 재배포한다(DB 변경 없음).

## 베타 전 보안 PR B (2026-11-11): IP 기준 요청 빈도 제한

- 대상과 기본 한도(IP 당 최근 60초, 미르 확정): `POST /api/v1/auth/email-exists` 30회,
  `/auth/nickname-exists` 30회, `/auth/register` 30회(베타. 종료 뒤 10회로 낮출 예정), `/anonymous-sessions` 60회
  (**새 게스트를 만들 때만** 센다 — 유효한 게스트 쿠키로 기존 세션을 돌려받는 요청은 세지도 막지도 않는다).
  API 마다 · IP 마다 따로 센다.
- 넘으면 429 `{"detail": {"code": "rate_limited", "message": …}}`, 헤더 `Retry-After`(정수 초) ·
  `Cache-Control: no-store`. 허용된 요청만 센다(막힌 요청은 창을 밀지 않는다). 다른 사이트 Origin(403)은 세기 전에 막힌다.
- `APP_ENV`와 무관하게 항상 적용된다(지금 운영의 development 에서도 켜져 있다).

### 설정 값(`app/core/config.py` `Settings`, 이름은 코드와 같다)

| 환경 변수 | 기본값 | 대상 |
|---|---|---|
| `RATE_LIMIT_EMAIL_EXISTS` | 30 | `POST /api/v1/auth/email-exists` |
| `RATE_LIMIT_NICKNAME_EXISTS` | 30 | `POST /api/v1/auth/nickname-exists` |
| `RATE_LIMIT_REGISTER` | 30 | `POST /api/v1/auth/register`(베타 종료 뒤 10 으로 낮출 예정) |
| `RATE_LIMIT_ANONYMOUS_SESSION_CREATE` | 60 | `POST /api/v1/anonymous-sessions`(새 게스트 발급만) |
| `RATE_LIMIT_WINDOW_SEC` | 60 | 네 API 가 함께 쓰는 창(초). 보통 바꾸지 않는다 |

- 줄이 없으면 기본값으로 켜진다. 값은 1 이상의 정수(`RATE_LIMIT_WINDOW_SEC`는 1~3600)만 받는다. 제한을 끄는 값은 없다.
- 0 · 음수 · 빈 값 · 숫자가 아닌 값이면 **설정 로딩이 실패해 `waegok-api`가 시작되지 않는다**(기본값으로 바꿔 뜨지
  않는다). 오류에는 항목 이름만 나오고 넣은 값은 나오지 않는다.
- 값은 **프로세스가 시작할 때 한 번** 읽는다. 실행 중 `.env` 재읽기 · 파일 감시 · 설정 변경 API 는 없다(11/11 미르 결정).
  따라서 값을 바꾸면 **코드 재배포는 필요 없고, `waegok-api` 재시작은 필요하다.**
- 같은 이름이 systemd `Environment=` · `EnvironmentFile=`에도 있으면 그쪽이 `.env`보다 먼저다. 한 곳에만 둔다.

### 운영에서 수치 바꾸기(운영 접근 권한이 있는 담당자)

1. 위치 확인: `systemctl show waegok-api -p WorkingDirectory -p EnvironmentFiles` — 이 두 속성만 본다
   (`systemctl cat`은 유닛에 적힌 비밀값까지 보여 줄 수 있어 쓰지 않는다). 인수인계 기준 파일은 `/srv/waegok/.env`.
2. 바꾸기 전 값 기록: `sudo grep -E '^RATE_LIMIT_' /srv/waegok/.env` — 제한 줄만 출력한다. 파일 전체를 `cat`하지 않는다.
3. 편집: `sudoedit /srv/waegok/.env`로 해당 `RATE_LIMIT_*` 한 줄만 고치거나 추가한다(예: `RATE_LIMIT_REGISTER=50`).
   다른 줄은 건드리지 않는다. 다시 2의 명령으로 제한 줄만 확인한다.
4. 재시작: `sudo systemctl restart waegok-api` — API 서비스만 재시작한다(Caddy · 로비는 재시작하지 않는다).
   재시작하는 몇 초 동안 API 요청이 실패할 수 있다.
5. 확인:
   - `systemctl is-active waegok-api` → `active`
   - 서버 안: `curl -fsS http://127.0.0.1:8000/api/v1/health/ready` → `{"status":"ready"}`
   - 외부: `https://api.k-escape.com/api/v1/health` → `{"status":"ok"}`, `/api/v1/health/ready` → `{"status":"ready"}`
   - (선택) 적용된 한도 확인 — 계정을 만들지 않는 방법이다. 서버 안에서 Caddy 를 거치지 않고 보내므로 127.0.0.1 몫만 쓴다
     (실제 사용자는 Caddy 가 넣는 주소로 따로 센다). Origin 은 운영 `CORS_ORIGINS`에 있는 웹사이트 주소를 쓴다.
     `for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code} ' -X POST http://127.0.0.1:8000/api/v1/auth/register -H 'Origin: https://www.k-escape.com' -H 'Content-Type: application/json' -d '{}'; done`
     → 한도가 30이면 `422`가 30번, 31번째가 `429`(빈 본문이라 가입은 되지 않는다). 다른 API 는 경로만 바꾼다.

### 재시작과 카운터

- 카운터는 **API 프로세스 메모리**에 있다. 재시작하면 이 PR 의 네 카운터가 모두 비워진다(새 값으로 0 부터 다시 센다).
  로비 입장권 발급 카운터도 같은 메모리 방식이라 함께 비워진다. 로그인 실패 잠금은 DB(`login_throttles`)라 유지된다.
- 재시작 없이는 값이 바뀌지 않으므로, 「실행 중 값 변경 시 카운터 유지」는 일어나지 않는다.

### 잘못된 값 · 되돌리기

- 재시작 뒤 `systemctl is-active waegok-api`가 `failed` · `activating`이면 `journalctl -u waegok-api -n 30 --no-pager`에서
  `validation error for Settings`와 항목 이름(예: `rate_limit_register`)을 확인한다. 값은 로그에 나오지 않는다.
- 되돌리기: 2에서 기록한 이전 값으로 그 줄을 되돌리거나(줄이 없었으면 지운다 — 기본값으로 돌아간다)
  `sudo systemctl restart waegok-api` 후 5의 확인을 다시 한다. 코드 · DB 는 바뀌지 않는다.
### 저장 · IP 판별 · 운영 확인

- 저장: API 프로세스 메모리(슬라이딩 창). 한 워커 안에서는 동시 요청도 한도를 넘지 않는다. **Uvicorn 워커가 여러
  개면 워커마다 따로 센다**(한도 × 워커 수), 재시작하면 카운터가 비워진다. 베타는 워커 1개 전제(로비 입장권 제한과 같다).
  워커 · 서버를 늘릴 때는 DB 공유 카운터로 바꾼다.
- IP 판별: `request.client.host`만 쓴다(로그인 잠금 · 로비 입장권 제한과 같다). Uvicorn 기본값
  (`proxy_headers` 켜짐, `--forwarded-allow-ips` 127.0.0.1)이 Caddy(같은 EC2, → `127.0.0.1:8000`)에서 온 연결의
  `X-Forwarded-For`만 오른쪽부터 읽어 실제 주소를 정하고, 다른 연결이 보낸 헤더는 무시한다.
- 운영 확인(값은 보고에 적지 않는다):
  1. Uvicorn 실행 줄이 `--host 127.0.0.1`이고, `--forwarded-allow-ips` · `FORWARDED_ALLOW_IPS`를 `*` 등으로 넓히지 않았는지.
  2. 워커 수가 1인지(`--workers` · `WEB_CONCURRENCY` 없음).
  3. Caddy `reverse_proxy`가 `127.0.0.1:8000`으로 넘기고 `X-Forwarded-For`를 지우지 않는지(Caddy 기본은 클라이언트가
     보낸 값을 버리고 실제 주소를 넣는다). 헤더가 빠지면 모든 사용자가 127.0.0.1 하나로 묶여 전체가 함께 막힌다.
  4. 배포 뒤 서버 로그에 실제 클라이언트 주소가 찍히는지(Uvicorn 접근 로그의 주소가 127.0.0.1 만이 아닌지).
- 되돌리기: 이 PR 커밋을 되돌려 재배포한다(DB 변경 없음).
