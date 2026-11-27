# 비밀번호 찾기 · 변경 API v0.1 (11/25 해랑)

이메일 비밀번호로 가입한 회원이 비밀번호를 잊었을 때 메일로 6자리 코드를 받아 새 비밀번호를 정하고, 로그인한 채로 비밀번호를 바꾼다.
소셜 전용 회원(구글 · 네이버)은 비밀번호가 없으므로 둘 다 해당하지 않는다 — 찾기를 누르면 코드 대신 「구글 · 네이버로 로그인하세요」 안내 메일이 간다(미르 11/26).

## 1. 흐름

| 걸음 | API | 성공 | 하는 일 |
|---|---|---|---|
| ① 코드 받기 | `POST /api/v1/auth/password-reset/request` `{email}` | 200 `{"status":"accepted"}` | 가입된 이메일이면 6자리 코드 메일(15분). 계정 조회 · 코드 저장 · 메일 모두 응답을 보낸 **뒤** 한다 |
| ② 코드 확인 | `POST /api/v1/auth/password-reset/verify` `{email, code}` | 200 `{"reset_token"}` | 맞으면 재설정 증표(10분, 한 번) |
| ③ 새 비밀번호 | `POST /api/v1/auth/password-reset/complete` `{reset_token, new_password}` | 204 | 저장 · 그 회원의 **모든 세션 끊기** · 이메일 로그인 실패 잠금 해제. 로그인은 따로 한다 |
| 변경 | `POST /api/v1/me/password` `{current_password, new_password}` | 204 | 지금 비밀번호 확인 뒤 저장 · **이 브라우저 세션만 남기고**(같은 쿠키라 다른 탭도 유지) 다른 세션 끊기 · 진행 중이던 찾기 증표 무효 |

모든 쓰기 요청은 기존처럼 Origin 검사(403 `Origin not allowed.`)를 거친다. 응답은 모두 `Cache-Control: no-store`.

## 2. 가입 여부를 드러내지 않는다

- ①은 없는 이메일 · 소셜 전용 · 탈퇴 계정에도 같은 200 이다. 계정 조회부터 메일까지 응답 뒤 백그라운드에서 하므로 걸린 시간도 같다.
- 메일은 계정에 따라 다르다(받는 사람 메일함에서만 보인다): 비밀번호 회원 = 6자리 코드 · 소셜 전용 = 가입한 수단(Google · 네이버)으로 로그인하라는
  안내(코드 없음) · 없는 이메일 · 탈퇴 = 보내지 않음. 안내 메일도 코드 메일과 같은 재발송 한도로 센다(만들자마자 만료된 기록 행 하나).
- ②는 틀린 코드 · 만료 · 시도 5번 초과 · 받은 코드 없음 · 없는 계정을 모두 같은 401 `invalid_reset_code` 로 답한다. 실패는 가입 여부와
  상관없이 이메일마다 같은 방식으로 기록한다(행 하나 쓰기 — 걸린 시간으로 갈리지 않게).
- 이메일 하나가 하루 20번 틀리면(가입 여부와 상관없이 같다) 20번째부터 429 `reset_verify_locked` — 「내일 다시 시도하거나 고객센터로 문의」
  문장과 `Retry-After`(풀릴 때까지 남은 초). 잠금은 가입 여부를 드러내지 않으므로 따로 알린다(미르 11/27: 20번 잠금은 그대로, 다음에 할 일을 보인다).
- 메일 발송이 꺼져 있으면(`MAIL_BACKEND=disabled`) ①은 **계정을 찾기 전에** 503 `mail_unavailable`.

## 3. 한도

| 무엇 | 한도 |
|---|---|
| 같은 회원 재발송 | 60초에 한 번, 한 시간에 5통, 하루 10통(넘어도 200, 메일만 안 감). 동시 요청도 한 줄로 세어 넘지 않는다 |
| 코드 하나의 틀린 시도 | 5번 — 넘으면 그 코드는 맞아도 거절, 새 코드를 받아야 함 |
| 이메일 하나의 틀린 시도 | 하루 20번(코드를 바꿔도 이어 센다, 가입 여부와 상관없이) — 닿으면 창이 끝날 때까지 맞는 코드도 429 `reset_verify_locked` |
| 살아 있는 코드 | 회원당 하나 — 새 코드를 보내면 앞 코드는 바로 무효. 이미 맞혀서 받은 증표는 남이 새 코드를 요청해도 살아 있다(10분) |
| IP 요청 빈도 | ① 60초 10회 · ② 30회 · ③ 30회(`RATE_LIMIT_PASSWORD_RESET_*`), 넘으면 429 `rate_limited` |
| 변경의 지금 비밀번호 실패 | 로그인 · 탈퇴와 같은 이메일 실패 집계(15분 5회), 잠기면 429 `login_locked` |

## 4. 오류

| API | 상태 · code |
|---|---|
| ① | 422 `invalid_email` · `invalid_input`, 429 `rate_limited`, 503 `mail_unavailable` |
| ② | 401 `invalid_reset_code`, 422 `invalid_email` · `invalid_reset_code`(6자리 숫자 아님) · `invalid_input`, 429 `reset_verify_locked`(하루 잠금) · `rate_limited` |
| ③ | 401 `invalid_reset_token`(없음 · 10분 지남 · 이미 씀), 422 `invalid_password`(가입 규칙 위반 — 증표는 그대로) · `invalid_input`, 429 `rate_limited` |
| 변경 | 401 `Login required.` · `invalid_password`(지금 비밀번호 틀림), 403 `no_local_password`(소셜 전용), 422 `invalid_password` · `same_password` · `invalid_input`, 429 `login_locked` |

본문은 `{"detail": {"code", "message"}}` 이고 `message` 는 화면에 그대로 보여도 되는 한국어다. 형식 오류는 입력값(이메일 · 코드 · 증표 · 비밀번호)을 되돌려 보내지 않는다.
새 비밀번호 규칙은 가입과 같다(`validate_registration_password` — 8~128자, 대 · 소문자 · 숫자, 같은 글자 3번 연속 금지, 흔한 비밀번호 · 이메일 앞부분 · 닉네임 포함 금지).

## 4-1. 겹친 요청

- 새 비밀번호 저장(③ · 변경)과 이메일 로그인이 겹치면, 옛 비밀번호로 확인을 마친 로그인도 세션을 받지 못한다. 로그인은 자기가 확인한
  해시를 들고 가고, 세션을 만들기 직전(회원 행을 쥔 뒤) 지금 해시와 다르면 `401 Invalid email or password.` 로 답한다.
- 잠그는 순서는 모든 경로가 회원 행 → 코드 행이다(① · ② · ③ · 변경 · 탈퇴 · 로그인). ②는 그 사이에 확인 실패 행(`password_reset_verify_throttles`)을 잠근다 —
  탈퇴도 회원 행을 쥔 뒤 그 행을 지운다. 변경 도중 같은 계정이 탈퇴했으면 401 `Login required.`.
- 변경 · 탈퇴는 회원 행과 비밀번호 수단(`auth_identities`)을 **잠금 읽기**로 다시 읽는다. 요청 앞(`current_user`)의 일반 읽기 스냅숏을 쓰면
  그사이 커밋된 재설정 대신 옛 해시로 확인해, 재설정한 비밀번호를 덮어쓰거나 옛 비밀번호로 탈퇴됐다(11/27 리뷰).

## 5. 저장

새 표 둘(revision `b7e4c2a9d1f3`, 기존 표는 안 바꿈).

**`password_reset_codes`** — 코드 · 증표. 원문은 두지 않는다: 코드 = `HMAC-SHA256(PASSWORD_RESET_CODE_SECRET, "행id:코드")`,
증표 = SHA-256(32바이트 난수). 하루 지난 행은 그 회원이 다음에 코드를 요청할 때 지운다. 탈퇴하면 `account_withdrawal` 이 지운다.

**`password_reset_verify_throttles`** — 이메일당 코드 확인 실패 집계(11/27 `login_throttles` 에서 뗌 — 관리자 「로그인 잠김」은 로그인만 센다).

| 열 | 형식 | 뜻 |
|---|---|---|
| `key_hash` | CHAR(64) PK | `sha256("password-reset-verify:" + 정규화한 이메일)` — 원문 없음 |
| `failed_count` | INT NOT NULL | 창 안의 틀린 수. ②를 받으면 행부터 만든다(0) — 첫 동시 실패의 교착을 막는다 |
| `window_started_at` | DATETIME(6) NOT NULL · 색인 | 집계 창(1일) 시작. 창이 지나 다시 틀리면 0 부터 |
| `locked_until` | DATETIME(6) NULL | 20번째 실패 때 `window_started_at + 1일`. 그 전까지 맞는 코드도 429 |

- 파기(세진 후속 PR): `password_reset_codes` 는 `created_at <= now - 1일`, `password_reset_verify_throttles` 는
  `window_started_at < now - 1일 AND (locked_until IS NULL OR locked_until < now)`(정확히 1일인 순간은 아직 집계 중이라 `<`).
- 탈퇴하면 그 이메일의 행을 지운다. 탈퇴 **뒤에** 들어온 ②는 「없는 이메일」로 새 행을 남긴다(설계대로, 위 파기 기준으로 지워진다).

## 6. 메일 설정(운영 배포 때)

| 환경 변수 | 값 |
|---|---|
| `MAIL_BACKEND` | `smtp` (개발은 `console` — 서버 로그에 코드가 찍힌다. 운영에서 `console` 이면 API 가 시작되지 않는다) |
| `MAIL_FROM` | `"왜곡 <no-reply@k-escape.com>"`(큰따옴표 포함) — 발송 서비스에서 인증한 도메인 |
| `SMTP_HOST` · `SMTP_PORT` | AWS SES 서울: `email-smtp.ap-northeast-2.amazonaws.com` · `587` |
| `SMTP_USERNAME` · `SMTP_PASSWORD` | SES 「SMTP 자격 증명」 |
| `PASSWORD_RESET_CODE_SECRET` | 인증코드 HMAC 비밀값, 32자 이상(`openssl rand -hex 32`). 운영 `smtp` 면 필수 |
| `SMTP_STARTTLS` · `SMTP_SSL` | 587 이면 `true` · `false` (둘 다 false 면 운영에서 시작되지 않는다) |
| `MAIL_TEST_RECIPIENTS` | 시험 발송 기간에만. 쉼표로 구분한 주소에만 보내고, 목록 밖 이메일의 ①은 계정을 찾기 전에 503 `mail_unavailable`. 비우면 모두에게(12/4 처리방침 시행일에 비운다, 미르 11/27) |

SES 는 처음에 샌드박스(인증한 주소로만 발송)라 운영 전 「프로덕션 액세스」 요청과 도메인(DKIM) 인증이 필요하다. 설정 전에는 ①이 503 이고 화면은 「지금은 메일을 보낼 수 없습니다. 고객센터로 문의해 주세요.」를 보인다.
