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
- 배포 전 · 후 확인(운영자, 값은 보고에 적지 않는다):
  1. 운영 API 프로세스 환경에 `APP_ENV=production`이 있는지(파일 내용 전체를 출력하지 말고 그 한 줄만 확인).
  2. 배포 뒤 `https://api.k-escape.com/docs`, `/redoc`, `/openapi.json`이 모두 404인지.
  3. `/api/v1/health`가 `{"status":"ok"}`, `/api/v1/health/ready`가 `{"status":"ready"}`인지.
  4. 1이 아니면(문서가 200) `APP_ENV=production`을 넣기 전에 운영 설정 검증을 통과하는 값인지
     `scripts/check_deployment.py`로 먼저 확인한다 — 검증에 실패하면 API 가 뜨지 않는다.
- 로그인 잠금 429 는 `Retry-After`(정수 초)를 싣는다. 값은 `login_throttles.locked_until - 지금`을 올림한 값이고,
  이메일 · IP 잠금이 둘 다면 더 늦게 풀리는 쪽이다. 잠금 정책(15분 안 이메일당 5회 · IP당 30회 실패)과
  401 · 429 응답 본문은 바꾸지 않았다. CORS `expose_headers`에 `Retry-After`가 이미 있어 웹사이트가 읽을 수 있다.
- 되돌리기: 이 PR 커밋을 되돌려 재배포한다(DB 변경 없음).
