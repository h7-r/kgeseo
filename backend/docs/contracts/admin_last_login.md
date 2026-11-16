# 회원 최근 로그인 `last_login_at` (11/16 세진 — 미르 승인 정책)

관리자 API v0.2 계약 초안(PR #119) D4 「두 필드 공존 · 실제 `last_login_at` 은 베타 이후 개발」의 구현. D4-a · D4-b · D4-c 는 아래 §1 · §3 으로 정했다(미르 11/16).
마이그레이션 `744dc740f81f` (← `734021834040`).

## 1. 정의

**`last_login_at` = 마지막으로 새 로그인 세션을 발급한 시각**(UTC naive). 마지막 활동 시각이 아니다.

| 갱신한다 (새 세션 발급 성공) | 갱신하지 않는다 |
|---|---|
| 이메일 회원가입 `POST /auth/register` | 쿠키로 다시 접속(세션 재사용) · `GET /me` 등 로그인 상태의 모든 요청 |
| 이메일 로그인 `POST /auth/login` | 로그아웃 `POST /me/logout` |
| Google 로그인 `POST /auth/google`(가입 완료 계정) | 로그인 실패 401 · 잠김 429 |
| Naver 로그인 `POST /auth/naver`(가입 완료 계정) | 소셜 가입 미완료(`onboarding_required` — 세션을 주지 않는다) |
| 소셜 회원가입 완료 `POST /auth/social-onboarding/complete` | 게스트 진행 승계(별도 처리) |

- 쿠키 세션은 14일 고정이고 토큰 갱신 · 자동 복구 기능이 없다 — 쿠키로 계속 쓰는 동안 이 값은 바뀌지 않는다(정상).
- 프로필 `updated_at` 은 바꾸지 않는다.

## 2. 저장 · 갱신

- `app_users.last_login_at DATETIME(6) NULL`. 색인 없음(목록은 쪽 단위 PK 조회, 이 값으로 정렬 · 필터하지 않는다).
- 갱신 위치: `app/services/user_session.py` `start_session()` 한 곳(로그인 성공 공통 처리 `auth._establish_login` 만 부른다).
- 트랜잭션: **회원 행 UPDATE → 세션 INSERT → 한 번 커밋.** 둘 중 하나만 남지 않는다. 실패하면 rollback 하고 예외를 다시 던진다
  (세션 · 쿠키 모두 없음, 응답 500).
- 더 최근 값만: `UPDATE … SET last_login_at=:now WHERE id=:id AND (last_login_at IS NULL OR last_login_at < :now)`.
  늦게 커밋되는 이른 시각이 값을 되돌리지 않는다(행 잠금 뒤 WHERE 재평가).
- UPDATE 를 INSERT 보다 먼저 하는 이유: 세션 INSERT 의 FK 확인이 회원 행에 공유 잠금을 걸어, 같은 회원의 동시 로그인에서 INSERT 를
  먼저 하면 데드락(1213)이 났다(격리 MySQL `test_concurrent_logins_transfer_once` 로 확인 · 수정). 지금은 둘째 로그인이 첫째 커밋을
  기다렸다가 차례로 처리된다.
- 게스트 진행 승계는 세션 커밋 **뒤** 별도 트랜잭션 그대로 — 승계가 실패해도 로그인 · `last_login_at` 은 되돌리지 않는다.

## 3. 기존 회원 (migration 백필)

- 회원별 `MAX(user_sessions.created_at)` 로 한 번 채운다 — 만료 · 철회된 세션 포함, 마지막으로 세션을 만든 시각.
- 세션이 없는 회원은 `NULL`. 회원 행 생성 · 삭제 없음, `updated_at` 변경 없음.
- downgrade 는 열만 지운다(회원 행 그대로). 다시 upgrade 하면 같은 규칙으로 다시 채운다.

## 4. API 변경 (모두 덧붙이거나 `null` → 값 — 기존 필드 · 형식 그대로)

| API | 변경 |
|---|---|
| `GET /api/v1/admin/users` | `users[].last_login_at` 이 실제 값(기록 없으면 `null`). `last_session_started_at`(추정값) 그대로 |
| `GET /api/v1/admin/admins` | `items[].last_login_at` 이 실제 값. `last_session_started_at` 그대로 |
| `GET /api/v1/admin/users/{id}` | `user` 에 **`region` · `providers` · `last_login_at` · `last_session_started_at` 네 필드 추가**(해랑 요청 — 목록과 같은 의미 · 자료형). `save` · `character` · `items` 그대로 |
| `GET /api/v1/me` | **변경 없음** |

- 회원 상세 `user` 의 네 필드 정의(목록 `users[]` 와 같다):

  | 필드 | 형 | 값 |
  |---|---|---|
  | `region` | string \| null | `app_users.region`(가입 때 고른 지역) |
  | `providers` | string[] | 그 회원의 `auth_identities.provider` 중복 제거 · 알파벳순(`local` · `google` · `naver`). 없으면 `[]` |
  | `last_login_at` | string \| null | §1 정의 |
  | `last_session_started_at` | string \| null | `MAX(user_sessions.created_at)`(추정값, 기존 그대로) |

  권한(`current_admin`) · 감사 기록(`read_user`) · 노출 범위는 목록과 같다 — 비밀번호 해시 · `provider_subject` · 토큰은 내지 않는다.
- 시각은 UTC naive ISO(`2026-11-16T03:00:00.123456`, 끝에 `Z` 없음) — 기존 규칙.
- 관리자 화면의 표시 규칙은 그대로 동작한다: `last_login_at` → 없으면 `last_session_started_at` 을 '추정' 으로 → 둘 다 없으면 '기록 없음'.
  백필 뒤에는 세션이 있던 회원 모두 `last_login_at` 이 있어 '추정' 표시는 세션이 없던 회원에게만 남는다.
- `last_session_started_at` 은 이제 `last_login_at` 과 대개 같다(둘 다 마지막 세션 시각). 두 필드 공존은 D4 대로 유지한다.

## 5. 남은 것(이 변경 밖)

- 마이페이지 「로그인 기록 10건」 은 브라우저 로컬 시연 데이터다 — 서버 로그인 이력 표는 없다(별도 설계).
- 회원 탈퇴(삭제 · 비식별화)와 이 열의 처리는 탈퇴 설계에서 정한다.
