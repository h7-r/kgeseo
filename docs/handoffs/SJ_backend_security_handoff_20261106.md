# 백엔드 보안 · 게스트 세션 인계 (2026-11-06, 세진 → Codex)

## Codex 인계 결과

- 원본은 `C:\dev\kgeseo-play-ownership-1106`의 `feat/SJ-play-session-ownership-guest-1106`이다. HEAD는 `6dbd3670fc64492f27eda25b767730146e93ae71`였고, 보안 변경 24개 파일이 staged 상태였다. 별도 보안 커밋은 없었다.
- PR #39는 `6dbd367`을 두 번째 부모로 하는 merge commit `3fa49e6`으로 병합됐다. Codex 브랜치는 `main`의 `29b2a850c309da93701421d47eba24ed717867c2`에서 시작해 보안 패치만 적용했다.
- `POST /anonymous-sessions`는 로그인 여부와 별개로 유효한 게스트 쿠키를 재사용하거나 새로 발급한다. 로그인 쿠키가 유효하면 플레이는 계정 소유로 생성된다. 쿠키 없는 첫 요청을 동시에 보내면 요청마다 독립된 게스트가 생길 수 있으므로 FE는 익명 세션 발급 요청을 직렬화한다.
- 게스트 회차 생성은 INSERT 커밋까지 게스트 행의 공유 잠금을 유지한다. 승계는 같은 행을 배타 잠금한다. 생성이 먼저 끝나면 새 회차도 승계하고, 승계가 먼저 끝나면 이전 게스트 쿠키의 생성 요청은 401이다. 승계가 실패하면 소유권·승계 기록·게스트 폐기가 함께 롤백되고 쿠키를 보존한다. 로그인은 성공하며 다음 로그인에서 승계를 다시 시도할 수 있다.
- `APP_ENV=production`에서 게스트 쿠키는 `__Host-waegok_guest`와 Secure를 사용한다. 플레이 쓰기 요청은 로그인 · 저장 API와 같이 `CORS_ORIGINS`에 정확히 적힌 Origin만 받는다(11/8 변경: 이전의 www · play 고정 목록은 없앴다. preview 등은 `CORS_ORIGINS`에 넣을 때만 허용). 기존 로그인과 OAuth의 Origin 검사는 그대로 적용된다. 운영 로그인 쿠키에는 `SESSION_COOKIE_SECURE=true`도 필요하다.
- `d8f2a6c4e1b9`는 테이블 두 개와 NULL 허용 소유자 열을 추가한다. 이전 앱이 쓴 행은 보존되며 신규 앱의 소유권 검사에서는 404다. 과거 익명 UUID를 근거로 소유자를 할당하지 않는다. 앱 롤백 때는 스키마를 유지한다. 다운그레이드는 신규 소유권과 승계 기록을 제거하므로 운영 롤백 절차로 사용하지 않는다.
- 새 격리 MySQL 8.0.46에서 단일 head, 업그레이드·다운그레이드·재업그레이드, 배포 CLI의 스키마 검사, 이전 main 앱의 신규 스키마 회차 생성·조회를 확인했다. 소셜 온보딩 전용 MySQL 테스트의 7개 실패(`role` 기본값을 복사하지 않는 fixture)는 기준 main과 신규 브랜치에서 동일하게 재현됐다. 운영 MySQL 8.4 실행은 확인 범위 밖이다.
- 최신 main의 FE `companionApi.ts` 공통 fetch에는 `credentials: "include"`가 빠져 있다. 진행 동기화를 포함해 이 경로에서 쿠키를 보낸다. `shared/env.ts`에 `setAssetVersionPath()`가 있으므로 생성·조회 응답의 `asset_base_path`를 케이스 에셋 로딩 전에 이 함수로 전달한다. 버전 없는 세션은 `null`을 전달해 빌드 기본 경로로 돌아간다. FE 연동과 백엔드 배포 시점을 조율한다.

아래는 Claude Code 작업 중 작성한 기록이다. 현재 계약과 달라진 항목은 위 내용을 따른다.

> **로컬 선행 개발 브랜치다. main 병합 가능한 최종 PR 이 아니다.** Push · PR · 배포는 하지 않았다.
> 이 문서는 코드와 격리 DB 실행으로 **확인한 것**만 1–4절에 적고, 확인하지 못한 것 · 추정은 5절에 따로 적는다.

## 1. Git

| 항목 | 값 |
|---|---|
| 작업 폴더 | `C:\dev\kgeseo-play-ownership-1106` (독립 clone) |
| 브랜치 | `feat/SJ-play-session-ownership-guest-1106` (원격 없음 · upstream 없음) |
| 기준 커밋 | `6dbd3670fc64492f27eda25b767730146e93ae71` — PR #39 통합 merge 커밋(부모: main `0307623` · NPC `8a8e8bc`) |
| 이 작업 커밋 | 이 문서를 담은 커밋 하나(`git log 6dbd367..HEAD`) |
| 작업 당시 origin/main | `030762374ca171ef9fff01d629a38853d2d5766f` — PR #39 · #40 · #38 모두 OPEN(미병합) |

- 이 clone 안에는 clone 할 때 생긴 `feat/SJ-npc-main-integration-1106` 로컬 사본도 있다. **push 하지 말 것**(PR #39 원격 브랜치는 이 작업으로 바뀌지 않았다).
- `backend/.venv/` 는 git 무시 대상이다(이 clone 전용 venv).

## 2. 구현한 것 (PM 11/6 확정 정책)

### 2-1. 파일

| 구분 | 파일 |
|---|---|
| 신규 | `backend/app/models/guest_session.py` (GuestSession · GuestSessionTransfer) |
| 신규 | `backend/app/services/guest_session.py` (게스트 쿠키 · 발급 · 로그인 승계) |
| 신규 | `backend/app/services/play_principal.py` (주체 · 소유권 · Origin 의존성) |
| 신규 | `backend/alembic/versions/d8f2a6c4e1b9_add_guest_sessions_and_play_owner.py` |
| 신규 | `backend/tests/test_play_session_ownership_mysql.py` (실제 쿠키 · MySQL 9건) |
| 수정 | `app/api/v1/anonymous_sessions.py` · `play_sessions.py` · `interactions.py` · `hints.py` · `npc.py` · `auth.py` · `error_responses.py` |
| 수정 | `app/models/play_session.py` · `app/schemas/play_session.py` · `app/services/play_session.py` · `app/services/user_session.py`(공개 함수 2개 추가만) · `alembic/env.py` |
| 수정(테스트) | `tests/conftest.py` · `test_anonymous_sessions.py` · `test_api_error_contract.py` · `test_pinned_session_http.py` · `test_play_session_content_pin.py` · `pytest.ini`(marker) |

FE 파일 · NPC v0.4.16 · P01/P03/P09 퍼즐은 건드리지 않았다.

### 2-2. 마이그레이션 `d8f2a6c4e1b9` (down: `c1d2e3f4a5b6`) — 단일 head

- `guest_sessions`: id · `anonymous_session_id`(FK, **UNIQUE** — 게스트 1 = 익명 세션 1) · `token_hash`(UNIQUE, sha256) · created/expires/revoked_at.
- `guest_session_transfers`: 승계 기록. `guest_session_id` **UNIQUE**(게스트당 한 번) · `app_user_id`(FK CASCADE) · `anonymous_session_id` · `play_session_count` · `transferred_at`.
- `play_sessions.owner_user_id`(FK app_users, ON DELETE SET NULL) · `owner_anonymous_session_id`(FK anonymous_sessions) + 인덱스 2. 인덱스를 FK 보다 먼저 만들어 중복 인덱스가 생기지 않는다(격리 DB `SHOW INDEX` 확인).
- **기존 행은 두 열 모두 NULL → 누구도 접근 못 함(404)**. 행을 지우지는 않는다(PM: 소유자 없는 기존 데이터 초기화 허용).
- 격리 MySQL 8.0.46 에서 upgrade → downgrade -1 → upgrade 확인.

### 2-3. 인증 주체 · 게스트 쿠키

- 주체(`PlayPrincipal`): **유효한 로그인 쿠키 먼저**, 없으면 유효한 게스트 쿠키, 둘 다 없으면 **401 `Play session cookie required.`**. 로그인 사용자와 게스트는 다른 주체.
- 로그인 전용 `current_user`(/me 등)는 그대로 — 게스트는 계정 API 를 못 쓴다.
- 게스트 쿠키: 운영(`SESSION_COOKIE_SECURE=true`) `__Host-waegok_guest`, 로컬 `waegok_guest`. 속성은 로그인 쿠키 옵션(`SESSION_COOKIE_OPTIONS`)을 그대로 씀 — HttpOnly · SameSite=Lax · Path=/ · Secure(운영) · Domain 없음. 수명 14일(`SESSION_LIFETIME`), 갱신 없음(로그인 세션과 같은 규칙).
- 토큰 원문은 쿠키에만. DB 에는 `hash_session_token`(로그인 세션과 같은 sha256)만. 로그에 남기지 않는다.

### 2-4. `POST /api/v1/anonymous-sessions` (응답 형식 · 201 유지)

| 요청 상태 | 동작 |
|---|---|
| 유효한 로그인 쿠키 | 게스트를 만들지 않는다. 호환용 익명 세션만 새로(기존 24시간) |
| 유효한 게스트 쿠키 | 그 게스트의 익명 세션을 그대로 돌려준다(새 게스트 · Set-Cookie 없음) |
| 없음 · 만료 · 폐기 | 새 익명 세션 + 게스트 + 쿠키. **익명 세션 만료 = 게스트 만료(14일)** |

- Origin 검사 적용(없거나 다르면 403, 게스트를 만들지 않음).
- 동시에 쿠키 없이 두 번 오면 게스트 둘이 생기고 브라우저에는 마지막 쿠키가 남는다(앞 게스트는 쓰이지 않을 뿐 해는 없다).

### 2-5. Play Session 소유권

- 생성(`POST /play-sessions`): 로그인 → `owner_user_id`. 게스트 → `owner_anonymous_session_id`, **본문 `anonymous_session_id` 가 자기 것이 아니면 404 `Anonymous session not found.`**(FE 동행 세션은 이 404 를 받으면 익명 세션부터 다시 받는다 — 기존 동작). 본문 UUID 는 권한이 아니다.
- 경로별 의존성(`require_play_session_owner`): `GET /play-sessions/{id}` · `/clues` · `/bundle` · `POST …/interactions` · `…/hints` · `…/puzzles/{puzzle_id}/hints` · `…/npc/turns`. 남의 세션 · 없는 세션 · 레거시 행은 **같은 404 `Play session not found.`(같은 본문)**.
- 라우트 입구에서 검사하므로 같은 `client_event_id` 저장 결과 재생도 소유자만(테스트로 확인).

### 2-6. 로그인 순간 자동 승계

- 공통 지점 `auth._establish_login`: `start_session` 직후 `transfer_guest_to_user`. 호출하는 곳 — 회원가입 · 일반 로그인 · `_start_social_session`(구글 · 네이버 · 소셜 가입 완료).
- 유효한 게스트 쿠키가 있을 때만. 게스트 행 `FOR UPDATE` → 그 게스트 소유 Play Session 을 계정으로(`UPDATE … WHERE owner_anonymous_session_id = :anon AND owner_user_id IS NULL`) → 게스트 폐기 → 기록 1행 → 게스트 쿠키 삭제. 한 트랜잭션.
- **로그인 요청 세션과 따로 연 세션**에서 한다(같은 세션에서 rollback 하면 로그인 응답용 사용자 객체가 만료돼 500 이 났다 — 테스트로 찾아 고침).
- 반복 콜백 · 동시 로그인: 둘째부터 폐기된 게스트를 보고 아무것도 안 한다(+ 기록 UNIQUE). 3개 동시 로그인 → 기록 1.
- 실패: 되돌리고 게스트 · 쿠키 유지, 로그인은 성공 — 다음 로그인 때 다시 옮긴다(테스트로 확인).
- 게스트에게 Play Session 밖의 자산은 없다: 게임 저장(`/me/game-save`) · 캐릭터 · 아이템은 로그인 전용 API, 힌트 잔액 · 진행 · 이벤트는 Play Session 행/그 FK 에 붙어 함께 옮겨진다.

### 2-7. Origin

- `require_play_origin` = 기존 `require_same_origin`(정확한 `CORS_ORIGINS` 일치) 재사용.
- 적용: `POST /anonymous-sessions` · `POST /play-sessions` · `…/interactions` · `…/hints` · `…/puzzles/{p}/hints` · `…/npc/turns`.
- 로그인 · 저장 API 의 기존 정책은 그대로(auth 라우터 전체 `require_same_origin`).

### 2-8. `asset_base_path`

- 생성 · 조회 응답 `data.asset_base_path` = `"/c/{case_id}/v{content_version}"`(예 `/c/naju-angam-01/v1`). 세션에 **저장된** case_id · 버전만 쓴다 → 새 버전이 게시돼도 기존 세션 값 그대로(테스트: v2 등록 뒤 기존 v1 · 새 세션 v2).
- 버전 없는(레거시) 세션 · `^[A-Za-z0-9_-]{1,64}$` 밖의 case_id → `null`. 기존 응답 필드는 그대로.

### 2-9. API 계약 변경 요약

- 플레이 API: 401(쿠키 없음) · 403(쓰기 Origin) 추가 — `error_responses` · `test_api_error_contract` 반영.
- `POST /anonymous-sessions`: 쿠키 발급 · 재사용, 게스트 익명 세션 만료 14일, 403 추가.
- 생성 · 조회 응답에 `asset_base_path` 추가.

## 3. 테스트 (확인한 것)

| 실행 | 결과 |
|---|---|
| 백엔드 전체(가짜 DB, MySQL 테스트는 건너뜀) | 2,450 통과 · 163 건너뜀 · 실패 0 |
| 백엔드 전체 + 격리 MySQL 8.0.46(`NPC_IDEMPOTENCY_MYSQL_*`) | **2,594 통과 · 28 건너뜀 · 실패 0** |
| 승인 기록 MySQL(`APPROVAL_MYSQL_*`) | 20 통과 |
| 새 소유권 MySQL 9건 | 9 통과 — 게스트 발급/재사용/만료/폐기, Origin 403, 401, 남의 세션 404(읽기 3 · Interaction · Hint 2 · NPC), 이벤트 재생, 레거시 404, 남의 익명 세션 404, asset 경로 · 버전 고정, 일반 로그인 승계 · 반복 로그인, 로그인 쿠키 우선, 동시 로그인 1회, 구글 · 네이버 승계, 승계 실패 보존, 로그인 사용자 익명 세션 |
| Alembic | 단일 head `d8f2a6c4e1b9`, upgrade/downgrade/upgrade 확인 |
| ruff check | 통과(새 · 수정 파일 format 적용) |

- 기존 테스트에서만 새 의존성을 바꾸는 장치: `tests/conftest.py` 의 autouse `legacy_play_auth`(주체 = 본문 익명 세션 게스트, 소유권 · Origin 통과). `@pytest.mark.real_play_auth` 테스트는 바꾸지 않는다.
- **기존부터 실패**: `tests/test_social_onboarding_mysql.py` 7건(`ONBOARDING_MYSQL_TESTS=1`) — 기준 커밋 `6dbd367` 에서도 같은 7건 실패. 원인은 테스트가 만드는 표 복사본에 main 의 `app_users.role`(NOT NULL) 기본값이 없음(`Column 'role' cannot be null`). 이번 작업과 무관 · 수정 안 함.
- `ruff format --check` 는 `tests/conftest.py` · `tests/test_api_error_contract.py` 가 기준 커밋에서부터 미적용 상태라 그대로 둠.

## 4. 운영 배포 호환성 (코드 기준)

- 운영 정보(PM 11/6): API `https://api.k-escape.com`, EC2 Caddy → `127.0.0.1:8000`, RDS MySQL 8.4.11 DB `waegok` 계정 `waegok_app`, `/srv/waegok/.env`. **운영 서버 · DB 에는 접속하지 않았다.**
- 시작 실패 조건(`config.py` · `deployment.validate_deployment`): `DB_HOST/USER/PASSWORD/NAME` 없음 → 시작 실패. `APP_ENV=production` 이면 추가로 — DB 비밀번호 · Google/Naver ID · Naver secret · redirect URI 가 비었거나 `YOUR_` 로 시작, `DB_USER=root`, `CORS_ORIGINS` 가 비었거나 HTTPS 정확 origin 이 아님(끝 `/` 포함), `NAVER_REDIRECT_URI` 의 origin 이 `CORS_ORIGINS` 에 없거나 경로가 `/로그인/콜백` 이 아님 → 시작 실패.
- **강제되지 않는 것**: `SESSION_COOKIE_SECURE=true` 는 production 검증에 없다(false 면 `waegok_session` · `waegok_guest` 가 Secure 없이 나간다). `HINT_REF_*` · `PUBLISHED_CONTENT_ROOT` · `NPC_GENERAL_PACK` 은 비어도 시작한다(각 기능이 fail-closed).
- `/api/v1/health` = 프로세스 응답만. `/api/v1/health/ready` = DB 에 `SELECT 1` 만(테이블 · migration 버전 · 게시 콘텐츠 · 쿠키 설정은 보지 않는다).
- Uvicorn 0.52.4 는 기본 `forwarded_allow_ips=127.0.0.1` 로 프록시 헤더를 믿는다 → Caddy 가 같은 호스트에서 넘기면 `request.client.host`(로그인 실패 제한 IP 키)가 실제 클라이언트가 된다. Uvicorn 을 0.0.0.0 으로 열거나 다른 호스트 프록시를 쓰면 이 전제가 깨진다.
- Origin 검사 · 쿠키는 브라우저가 보낸 `Origin` 과 쿠키를 그대로 쓴다(Caddy 가 바꾸지 않아야 함). `www`/`play` → `api.k-escape.com` 은 같은 사이트라 SameSite=Lax 쿠키가 `credentials: "include"` 요청에 실린다.

## 5. 확인하지 못한 것 · 추정 (분리)

- **MySQL 8.4 실행 검증 못 함**: 로컬엔 8.0.46 만 있다. 8.4.11 ZIP 을 받아 격리 실행하려 했으나 실행 단계가 권한 검사에서 거부됐다. 아래는 **정적 검토(추정)**다:
  - 8.4 기본 인증 `caching_sha2_password` — `PyMySQL 1.2.0` + `cryptography 50.0.1` 이 requirements 에 있어 지원될 것으로 본다.
  - `d2a6f8b1c903`(NPC 승인 이력)이 **트리거**를 만든다 — 바이너리 로그가 켜진 RDS 는 파라미터 그룹 `log_bin_trust_function_creators=1` 이 필요할 가능성이 높다(로컬 격리 DB 도 이 옵션으로 띄웠다).
  - DB 기본 정렬이 `utf8mb4_unicode_ci` 면 NPC migration 의 FK 가 실패했다(8.0 격리 DB 에서 확인한 사실). RDS `waegok` DB 의 기본 정렬이 `utf8mb4_0900_ai_ci` 인지 확인 필요.
- 브라우저 실제 흐름(FE 가 `credentials: "include"` 로 부르는 경우)은 FE 수정 전이라 확인 못 함. 테스트는 ASGI 클라이언트의 쿠키 저장소로만 했다.
- 운영 `__Host-` 쿠키 이름은 코드로만 확인(테스트 설정은 `SESSION_COOKIE_SECURE=false`).

## 6. 다음 작업 (Codex)

### 6-1. PR #39 병합 뒤 main 정렬

1. PR #39 병합 방식 · 새 main SHA 확인.
2. **merge commit 으로 병합됐으면**: main 에 `6dbd367` 이 그대로 있으므로 이 브랜치를 main 위로 merge 하거나, 이 브랜치의 작업 커밋 하나를 cherry-pick 한다.
3. **squash · rebase 병합이면**: 이 브랜치를 rebase 하지 말 것(NPC 통합이 중복된다). 최신 main 에서 새 브랜치를 만들고 `git cherry-pick <이 작업 커밋>` 만 옮긴다 — 작업 커밋은 6dbd367 위 커밋 하나라 NPC 통합 변경을 포함하지 않는다.
4. 정렬 뒤 Alembic head 가 하나인지 확인(main 에 새 revision 이 생겼으면 `d8f2a6c4e1b9.down_revision` 을 새 head 로 바꾸거나 merge revision).
5. 충돌 후보: `auth.py` · `main.py`(해랑 쿠키 세션 쪽), `play_sessions.py` · `interactions.py` · `hints.py` · `npc.py`(라우트 데코레이터), `error_responses.py`, `tests/conftest.py`. 팀원 변경을 덮어쓰지 말고 hunk 단위로 볼 것(`git checkout --ours` 는 파일 전체를 바꾼다).

### 6-2. 지켜야 할 것

- Codex 원본 `C:\dev\kgeseo-codex-next` 의 미커밋 `naju01/src/companion/companionApi.ts` 는 그대로 둔다.
- `C:\dev\kgeseo-npc-main-integration-1106`(PR #39) · `C:\dev\kgeseo-npc-runtime-integration-1105` · WIP 브랜치는 수정하지 않는다.

### 6-3. FE(해랑) 연동 필요

- `naju01/src/companion/companionApi.ts` 공통 `requestOnce` 에 `credentials: "include"` — 진행 동기화(`progressSync`)도 이 함수를 쓴다. 이 변경 없이 다른 출처 API 를 쓰면 쿠키가 안 실려 **모든 플레이 API 가 401** 이 된다.
- 세션 생성 · 조회 응답 `asset_base_path` → 케이스 에셋 로딩 전에 `setAssetVersionPath()`, 실패 · null 이면 `setAssetVersionPath(null)`.
- 이 브랜치 배포 순간부터 **쿠키 없는 기존 FE 는 플레이 API 를 못 쓴다** — FE 연동과 같은 시점에 배포해야 한다.

### 6-4. 운영 적용 전 체크리스트

- [ ] RDS 백업 · 스냅샷 뒤 `alembic upgrade head`(승인된 절차). 기존 Play Session 은 소유자 없음 → 접근 불가가 됨을 PM 재확인.
- [ ] RDS 파라미터 `log_bin_trust_function_creators` · DB 기본 정렬 확인.
- [ ] `APP_ENV=production` · `SESSION_COOKIE_SECURE=true` · `CORS_ORIGINS=["https://www.k-escape.com","https://play.k-escape.com"]`(preview 를 열 때만 `"https://preview.k-escape.com"` 추가) · `NAVER_REDIRECT_URI` origin 이 그 둘 중 하나.
- [ ] Uvicorn 은 `127.0.0.1:8000` 에만 열고 Caddy 가 TLS · 프록시(Origin · 쿠키 헤더 보존).
- [ ] 배포 뒤 `/api/v1/health/ready`(DB 만) + 실제 브라우저로 게스트 발급 · 플레이 · 로그인 승계 1회 확인.
- [ ] MySQL 8.4 에서 마이그레이션 · 본 테스트 재실행(격리 DB).

### 6-5. 권장 우선순위

1. PR #39 병합 뒤 이 변경을 main 에 정렬 → 별도 PR(FE `credentials` · `asset_base_path` 와 같은 배포 묶음).
2. MySQL 8.4 격리 검증.
3. NPC v0.4.16 상황 대사(PM 확정 사항 · PR #40 차이 문서는 별도).
4. P01 · P09 서버 판정(11/9 ID 대응표 뒤), P03 확정 제출(FE).
5. `/api/v1/packs/{id}` 구현 시 같은 소유권 의존성 적용.
6. `test_social_onboarding_mysql.py` 표 복사본의 `role` 기본값 정리(기존 문제).
