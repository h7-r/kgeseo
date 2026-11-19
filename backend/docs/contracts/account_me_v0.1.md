# 내 계정 API 계약 v0.1 — `GET /me` · 저장 경합 · 사이트 상태 소셜 (11/18 해랑)

- 근거: 로그인 · 회원가입 연동 점검(11/18) M5 · L22 · H2(선택). 세진 부재로 해랑이 백엔드도 맡았다.
- 코드: `app/api/v1/me.py`(`read_me` · `write_game_save`), `app/api/v1/site.py`, `app/schemas/account_data.py` `MeResponse`,
  `app/schemas/admin_setting.py` `SiteSocial`. 새 마이그레이션 없음.
- 범위: 이번에 **바뀐 것만** 적는다. `/me/game-save` GET/DELETE · `/me/character` · `/me/items` · `/me/logout` 전체 정리는 L24(BE-5) 때
  이 문서를 늘린다. 탈퇴는 `account_withdrawal_v0.2.md`, 1:1 문의는 `admin_api_v0.3_phase3.md`.

## 1. `GET /api/v1/me` — 가입 시각 · 로그인 수단 추가

로그인 쿠키 세션 필수(없으면 401 `{"detail": "Login required."}`). 기존 다섯 필드는 그대로, 두 필드를 덧붙인다.

```json
{
  "user_id": "…", "email": "…", "nickname": "…", "region": "광주", "role": "user",
  "created_at": "2026-11-18T05:16:35.520051Z",
  "providers": ["local", "google"]
}
```

| 필드 | 형 | 값 |
|---|---|---|
| `created_at` | string | 가입 시각(`app_users.created_at`). **ISO 8601 UTC, 끝에 `Z`** — 다른 API 의 「Z 없는 UTC naive」와 다르다. 웹의 `parseBackendTimestamp` 는 두 꼴을 다 UTC 로 읽는다 |
| `providers` | string[] | 그 회원의 `auth_identities.provider` 값 그대로(`local` · `google` · `naver`). **연결한 순서**(가입 수단이 먼저), 중복 없음. 소셜 전용 회원이면 `local` 이 없다. 탈퇴 회원은 세션이 없어 여기 오지 않는다 |

- 관리자 상세(`admin_last_login.md` §4)의 `providers` 는 알파벳순 — 정의는 같고 순서만 다르다.
- 비밀번호 해시 · `provider_subject` · 세션 · 토큰은 내지 않는다(기존 그대로).
- 쓰는 곳: 웹사이트 `restoreServerSession`(새 탭 복원 때 가입일 · 가입 방식 칩), 탈퇴 · 비밀번호 UI 의 소셜 전용 판별(`"local" in providers`).
  게임 쪽(`src/save/gameSave.ts` · `src/beta/betaBoot.ts`)은 `user_id` 만 읽어 영향 없다.

## 2. `PUT /api/v1/me/game-save` 409 — 첫 저장 경합의 `revision`

저장본이 없는 회원의 두 창이 거의 동시에 `revision: 0` 으로 첫 저장을 하면 한쪽은 UNIQUE(`app_user_id`, `slot`) 에 막힌다.
그때 409 본문의 `detail.revision` 은 **지금 DB 에 들어간 저장본의 번호**(보통 `1`)다. 예전엔 상수 `0` 이어서 재시도가 다시 409 로 끝났다.

```json
{ "detail": { "code": "save_conflict", "revision": 1 } }
```

- 재조회해도 행이 없으면(상대가 바로 지웠음) `0` — 첫 저장으로 다시 하면 된다.
- 다른 창이 먼저 저장한 보통 경합(stale revision)은 전과 같이 그 저장본의 `revision` 을 싣는다. 클라이언트는 어느 경우든
  `detail.revision` 으로 한 번 더 PUT 하면 된다.

## 3. `GET /api/v1/site/status` — 소셜 로그인 준비 여부

인증 없음 · 기록 없음 · `Cache-Control: no-store`(기존). `maintenance` 는 그대로, `social` 을 덧붙인다.

```json
{ "maintenance": { "on": false, "message": "" }, "social": { "google": true, "naver": false } }
```

- `social.google` = `GOOGLE_CLIENT_ID` 가 실제 값. `social.naver` = `NAVER_CLIENT_ID` · `NAVER_CLIENT_SECRET` · `NAVER_REDIRECT_URI` 셋 다 실제 값.
  빈 값 · 견본 자리표시자(`YOUR_…`)는 `false`. 판정 함수는 로그인 API 가 503 `… is not configured.` 을 내는 것과 같은 것
  (`google_auth.google_auth_configured` · `naver_auth.naver_auth_configured`).
- **값은 절대 싣지 않는다**(키 · 비밀 · 콜백 주소 없음). 설정됐는지 참/거짓만.
- 쓰는 곳(선택): 웹사이트 `boot.ts` 가 `false` 인 수단의 단추를 「준비 중」으로 보여 네이버 화면까지 갔다 오는 헛걸음을 없앤다.
  `true` 라도 콘솔 쪽(콜백 URL · 이메일 제공 동의) 문제는 알 수 없다 — 그건 여전히 로그인 시도 때 드러난다.
