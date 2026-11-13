# 관리자 API v0.2 — 2단계 계약 초안 (2026-11-12, FE 해랑 → BE 세진 확인 요청)

PR #119 계약서(`admin_api_v0.2.md`)의 공통 규칙(§2)을 그대로 따르는 **조회 전용** API 넷 + 활성 세션 목록 하나.
미르님 결정(11/12): 기존 테이블만 읽고 마이그레이션 없음 · 규칙은 1단계와 같게(KST · 이메일 가림 · 매 요청 관리자 검사 · 조회도 감사 기록) ·
BE 리뷰 세진 · 머지 미르 · DB 바꾸는 2단계는 세진 몫. **구현은 이 문서를 세진이 확인한 뒤 머지한다(베타 뒤).**

| API | 화면 | 감사 기록 | 까닭 |
|---|---|---|---|
| `GET /api/v1/admin/stats/traffic` | 접속 통계 · 대시보드 추이 | 안 남김 | 집계뿐, 사람이 안 보인다(`stats/summary` 와 같게, D5-b) |
| `GET /api/v1/admin/stats/active-sessions` | 접속 통계 「활성 세션」 | `view_active_sessions` | 닉네임이 보인다 |
| `GET /api/v1/admin/stats/members` | 회원 통계 · 대시보드 「오늘 신규 가입」 상세 | `view_member_stats` | 가입자 목록(이메일)이 든다 |
| `GET /api/v1/admin/stats/game` | 게임 데이터 · 대시보드 완료율 | 안 남김 | 집계뿐 |
| `GET /api/v1/admin/security/summary` | 보안 | `view_security_summary` | 관리자 로그인 이름이 든다 |

공통: `current_admin` 매 요청 · `Cache-Control: no-store` · 날짜 질의는 KST `YYYY-MM-DD`, 미래·400일 전은 422 `invalid_query` · 숫자 질의 범위 밖도 422 ·
시각은 시간대 없는 UTC · 비밀번호 해시 · 토큰 · `login_throttles` 키 · IP · User-Agent 는 어떤 응답에도 없다(§5).
`include_internal` 은 §3.3 과 같다(기본 `false` = 관리자 제외, 테스트 계정 표시는 아직 없음).
`unavailable` 칸은 원천이 없는 지표의 이유 코드 — 화면은 「준비 중」으로 보인다.

## P2-1 `GET /admin/stats/traffic` — 날짜별 접속

Query: `date`(끝 날짜, 기본 오늘) · `days`(1~92, 기본 7) · `include_internal`.

```json
{
  "generated_at": "2026-11-12T03:00:00", "timezone": "Asia/Seoul", "date": "2026-11-12", "days": 7, "include_internal": false,
  "daily": [
    { "date": "2026-11-06", "members_dau": 12, "guests_dau": 5, "signups": 3, "play_sessions_created": 20 }
  ],
  "live": { "active_play_sessions_5m": 4, "basis": "play_sessions.updated_at" },
  "unavailable": { "lobby_concurrent": "lobby_metrics_not_connected", "peak_concurrent": "lobby_metrics_not_connected", "per_minute": "no_time_series_source" }
}
```

- `members_dau` · `guests_dau` · `signups` · `play_sessions_created` 는 §3.3 정의 그대로(날짜마다 같은 쿼리) — 단 **게스트 · 회원 구분은 「세션 생성 당시 소유자」 기준**으로 바뀐다(아래, 1단계 `stats/summary` 도 같은 함수라 함께 바뀜).
- **세션 생성 당시 소유자 기준(미르 11/12 결정, 표현은 세진 11/12):** 복원하는 것은 플레이 중 모든 활동 시점의 신분이 아니라 **Play Session 을 만든 순간의 소유자**다. 게스트로 만든 세션이 뒤에 로그인으로 계정에 승계되어도 그날 숫자는 게스트에 남는다(과거 날짜가 안 움직인다). 승계 뒤 그 세션을 이어 해도 새 세션이 아니라 DAU 에 새로 들지 않는다(DAU 는 세션 「생성」만 본다, §3.3 D8 그대로). 판정: `guest_session_transfers` 에 같은 익명 세션(`play_sessions.anonymous_session_id`)의 승계 기록이 있고 세션 `created_at < transferred_at` 이고 **그 승계가 세션을 하나라도 옮겼으면(`play_session_count > 0`)** 「게스트 때 만든 세션」. 게스트는 본문 익명 id = 쿠키 익명 id 가 강제되므로(`owner_for_new_play_session`) 이 연결은 정확하다. **옮긴 세션 조건(세진 6차 M1, 11/13):** 게스트 발급 창구는 로그인 쿠키가 있어도 새 게스트를 내주므로, 로그인한 채 발급된 게스트의 익명 id 로 회원이 만든 세션(소유자는 처음부터 계정)이 있을 수 있다. 그 게스트는 다음 로그인 때 옮길 세션 없이(`play_session_count` 0) 승계 기록만 남기므로, 그 기록으로 회원 세션을 게스트 것으로 읽지 않게 옮긴 세션이 있는 승계만 본다(격리 MySQL 검사 ⑤). **G안 조건 둘(세진 11/13):** 승계는 옮긴 세션의 `owner_user_id` 를 승계 계정으로, `updated_at` 을 승계 시각과 같은 값으로 쓰므로 `play_sessions.owner_user_id = transfers.app_user_id` 와 `play_sessions.updated_at >= transfers.transferred_at` 도 함께 본다. 그러면 한 게스트에 회원 세션과 게스트 세션이 섞인 경우(로그인 → 로그인한 채 게스트 발급 → 로그아웃 → 같은 쿠키로 게스트 플레이 → 로그인)에도 승계 뒤 안 건드린 회원 세션은 회원으로 남는다(격리 MySQL 검사 ⑥). **남는 한계(열만으로 못 가름, 미르 11/13 결정 — 이번 베타는 알려진 제한으로 수용):** 그 섞인 경우에서 승계 뒤에 이어 한 회원 세션(`updated_at` 이 승계 뒤로 밀림)은 게스트로 센다. 소유권 · 저장에는 영향 없고 관리자 숫자만 어긋난다. 베타 뒤 세진이 DB 보완(승계 때 `play_sessions` 에 옮긴 표시 남기기 또는 회원 Play Session 의 호환용 익명 id 분리)으로 없앤다 — 베타 중엔 플레이 세션 · 저장 경로를 안 건드린다. 적용 칸: `members_dau` · `guests_dau`(+ summary 의 MAU) · `created_on_date_by_member/by_guest`. 소유자 없는 옛 세션(11/6 전)은 전처럼 DAU 어디에도 안 든다. 마이그레이션 없음. 게임 집계의 「같은 사람 합치기」(P2-3)와는 기준이 다르다 — 그쪽은 사람을 합치고, 여기는 그날 누구였나를 본다. `days` 만큼 하루씩 센다 — 하루에 **5쿼리**(회원 DAU · 게스트 DAU · 가입 · 회원 플레이 세션 · 게스트 플레이 세션) + `live` 1회 → **최대 92일 × 5 + 1 = 461회**(세진 11/13 지적으로 368 → 461 로 바로잡음), **`created_at` 에는 인덱스가 없다**(세진 11/13 정정 — 실제 인덱스: `play_sessions` 는 `anonymous_session_id` · `owner_user_id` · `owner_anonymous_session_id`, `user_sessions` 는 `app_user_id`, `app_users` 는 `email` · `nickname`(유일), `guest_session_transfers` 는 `app_user_id` · `guest_session_id`(유일)). 날짜 범위 COUNT 는 표를 훑는다 — **아직 실측하지 않았다(세진 11/13).** 베타 규모(회원 수백 명 · 세션 수천 줄)면 한 요청 수백 ms 안일 것으로 **예상**할 뿐이고, 실제 값은 운영 반영 뒤 p95 측정(아래)으로 확인한다. 커지면 `created_at` 인덱스(DB 변경, 세진)나 GROUP BY 집계로 바꾼다(아래).
  - **GROUP BY 전환 기준(세진 11/12, 잠정 — 아직 측정값 없음):** 회원 수가 아니라 **응답 시간**으로 본다. 이 API 의 p95 응답이 **1초**를 넘으면 최적화를 검토하고, **2초**를 넘으면 우선 개선한다. 92일 조회는 베타 뒤 따로 재고, 필요하면 날짜별 반복 쿼리를 `GROUP BY DATE(CONVERT_TZ(created_at, …))` 집계로 바꾼다(응답 모양은 그대로).
- `live.active_play_sessions_5m` = `play_sessions.updated_at >= now − 5분` 인 세션 수. **근사 지표**다 — `updated_at` 은 실제 접속이 아니라 세션 줄이 마지막으로 갱신된 시각(저장 · 진행 기록)이라, 조용히 보고만 있는 플레이어는 빠지고 갱신 직후 나간 플레이어는 든다. 화면도 「저장 갱신 기준 근사치」라고 적는다(세진 11/12). 로비 동시접속이 아니다.
- 분 단위 · 최대 동시접속은 원천이 없다 → `unavailable`.

## P2-1b `GET /admin/stats/active-sessions` — 지금 플레이 중

Query 없음. 최근 5분 안에 갱신된 플레이 세션 최대 50개, 최신순.

```json
{ "generated_at": "…", "window_minutes": 5,
  "sessions": [ { "nickname": "조사관", "user_id": "…", "case_id": "CASE-01", "started_at": "…", "last_seen_at": "…" } ] }
```
게스트는 `nickname` · `user_id` null. 세션 id · 토큰 · IP 는 없다. **기록: `view_active_sessions`**(대상 없음).

## P2-2 `GET /admin/stats/members` — 회원 통계

Query: `date`(기준, 기본 오늘) · `months`(1~24, 기본 6) · `include_internal`.

```json
{
  "generated_at": "…", "timezone": "Asia/Seoul", "date": "2026-11-12", "include_internal": false, "months": 6,
  "totals": { "total": 50, "total_at_prev_month_end": 40, "signups_this_month": 10, "signups_prev_month": 8, "mau": 31, "mau_prev_30_days": 20 },
  "monthly_signups": [ { "month": "2026-06", "signups": 0 } ],
  "by_region": [ { "label": "광주", "count": 30 }, { "label": "(미입력)", "count": 5 } ],
  "by_provider": [ { "label": "local", "count": 40 }, { "label": "google", "count": 12 } ],
  "signups_on_date": [ { "user_id": "…", "nickname": "…", "email": "a@b.c", "region": null, "created_at": "…", "stage": "naju" } ],
  "recent_signups": [ "…같은 모양, 최신 20명" ],
  "unavailable": { "withdrawals": "withdrawal_not_implemented", "churn_rate": "withdrawal_not_implemented", "suspended": "suspension_not_implemented" }
}
```
- `total_at_prev_month_end` = 이번 달 1일 00:00 KST 전에 가입한 수(「지난달 대비」 증감의 분모). `mau_prev_30_days` = 기준일 −59 ~ −30일.
- `by_provider` 는 회원 수(한 회원이 두 수단이면 둘 다 센다). `by_region` 의 null 은 `(미입력)`.
- 가입자 목록 이메일은 1단계 목록처럼 **전체** — 화면이 maskEmail 로 가린다. **적용 시점(세진 11/12):** 1단계 `users` 목록을 §2.5 서버 가림(`mask_email`) + 정확 검색(`q=이메일`)으로 바꾸는 그 PR 에서 `signups_on_date` · `recent_signups` 도 같이 가린다 — 베타 뒤, 이 2단계 머지 다음. 그 전까지는 두 API 가 같은 규칙(전체 반환 · 화면 가림). `stage` 는 저장 slot 0 의 단계.
- **기록: `view_member_stats`**.

## P2-3 `GET /admin/stats/game` — 게임 진행 집계(beta_events)

Query: `date`(끝, 기본 오늘) · `days`(1~92, 기본 30). `received_at` 이 범위 안인 `beta_events` 중 `stage_reached` · `objective_state` · `puzzle_attempt` · `help_event` · `run_state` 만 읽어(최대 200,000행) 사람 단위로 센다.
사람 = `app_user_id` > `guest_session_id` > `tab_id`.
**게스트 → 회원 전환 중복 방지(세진 11/12):**
- 확인한 사실: 로그인한 사람의 기록엔 `guest_session_id` 가 **남지 않는다**(`play_principal` 이 user 면 None, `beta_events.py` 는 그 값을 그대로 적음). 그래서 기록 안에서 두 id 를 함께 볼 수는 없다.
- 연결 원천은 **`guest_session_transfers`**(로그인 순간 게스트 진행을 계정으로 옮긴 기록 · `guest_session_id` 유일). 읽은 기록에 보이는 게스트(회원 id 없는 줄의 `guest_session_id`)를 이 표에서 찾아 `게스트 → 회원` 표(`guest_links`)를 만들고, 그 게스트의 기록을 그 회원으로 센다.
- **확보 범위:** 연결 표는 기록 20만 행 상한과 **무관하게 표 전체**에서 찾는다(별도 쿼리). 그래서 전환(로그인)이 있었으면 연결은 빠지지 않는다. 다만 게스트 기록 자체가 상한에 잘려 안 읽혔으면 그 사람은 회원 기록만으로 센다(중복이 아니라 누락).
- **예외:** 한 게스트가 서로 다른 회원 둘에 걸리면 임의로 합치지 않고 그 게스트는 게스트로 둔다(표가 유일 제약이라 실제론 안 생긴다). 전환 기록이 없는 게스트(로그인 안 함)는 게스트로 센다. 회원이 지워지면 전환 기록도 함께 지워져(CASCADE) 게스트로 돌아간다.

```json
{
  "generated_at": "…", "timezone": "Asia/Seoul", "date": "2026-11-12", "days": 30, "people": 23,
  "funnel": [ { "phase": "character_open", "people": 23 }, { "phase": "character_done", "people": 20 }, { "phase": "headquarters", "people": 18 }, { "phase": "naju_ready", "people": 15 }, { "phase": "naju_controllable", "people": 15 } ],
  "stages": [ { "stage": 1, "entered": 15, "completed": 9 }, { "stage": 2, "entered": 9, "completed": 3 }, { "stage": 3, "entered": 3, "completed": 1 } ],
  "puzzles": [ { "objective_id": "P01", "judge": "server", "attempts": 40, "wrong": 22, "hint_requests": 6, "completed_people": 12 } ],
  "avg_completion_minutes": 48.5, "completed_runs": 1,
  "unavailable": {}
}
```
- 스테이지 묶음 · 서버 판정 목록은 `naju01/src/dialogue/objectives.ts`(STAGE_OF · SERVER_JUDGED)를 서버에 옮긴 표(`services/admin_stats.py`). 1 = 나루터, 2 = 바위 아래 + 물굴, 3 = 증언 능선. 스테이지 「완료」 = 끝 걸음(S1_SMOKE · C_SOCKET · S3_RIFT) 완료.
- `entered` = 그 스테이지 목표를 하나라도 본(available · focus · complete) 사람 수. `completed_people` = `objective_state complete` 이고 `data.origin` 이 `live`(복원 제외)인 사람 수.
- `attempts` = `puzzle_attempt` 건수(sent_back 포함), `wrong` = phase `fail` · `incorrect`. `hint_requests` = `help_event request` 건수. `judge` = server · screen · step.
- `avg_completion_minutes` = `run_state start/resume → dawn` 까지 분의 평균(같은 `run_id`). 없으면 null + `unavailable.avg_completion_minutes`.
- **200,000행 상한(`unavailable.truncated = first_200000_events_only`):** `id` 오름차순으로 앞 20만 건만 읽으므로 걸리면 **기간 뒤쪽(최근) 기록이 빠진다.** 그러면 `people` · `funnel` · `stages` · `puzzles` · `avg_completion_minutes` **전부** 불완전하다(최근 사람 · 최근 완료가 빠져 작게 나온다). 화면은 그 사실을 한 줄로 적고 기간을 줄이라고 안내한다. 상한을 넘기는 날이 오면 날짜별 사전 집계 표(DB 변경 → 세진 몫)로 바꾼다.
- 기록 안 남김. 정답 값은 어디에도 없다.

## P2-4 `GET /admin/security/summary` — 보안 집계

Query 없음.

```json
{
  "generated_at": "…", "timezone": "Asia/Seoul",
  "login_throttle": { "locked_now": 1, "keys_with_failures": 3, "failures_in_window": 7 },
  "admin_logins_7d": [ { "user_id": "…", "nickname": "운영자", "at": "…" } ],
  "audit_actions_24h": [ { "label": "list_users", "count": 12 } ],
  "unavailable": { "rate_limited_429": "memory_only", "request_errors": "not_stored", "chat_rejections": "not_stored", "hot_ips": "ip_not_stored", "admin_login_ip": "ip_not_stored" }
}
```
- `login_throttles` 는 현재 창의 값뿐(이력 없음). 키 해시는 싣지 않는다. **`failures_in_window` 는 실제 로그인 실패 요청 수가 아니라 제한 키(이메일 키 · IP 키)별 `failed_count` 의 합**이다 — 한 번의 실패가 이메일 키와 IP 키에 각각 더해지므로 요청 수보다 크다(세진 6차). `keys_with_failures` 는 그 키 수. 화면도 「로그인 실패 횟수 합(제한 키별)」로 적는다. 429 횟수는 서버 메모리뿐이라 `unavailable`(미르 11/12 — 쌓을지는 그때 정한다).
- **창 기준(세진 11/13 지적 반영):** `record_login_failure` 는 `window_started_at` 이 15분(`THROTTLE_WINDOW`)보다 오래된 줄을 다음 실패 때 새 창으로 바꾼다(옛 실패 수는 버린다). `keys_with_failures` · `failures_in_window` 는 그 규칙과 같게 **`window_started_at ≥ now − 15분` 인 줄만** 센다. 단 **아직 잠긴 줄(`locked_until > now`)은 창이 지났어도 센다** — 잠김이 유효한 동안 그 실패 수가 살아 있고, 잠긴 키가 실패 키 수에서 빠지면 안 맞는다. `locked_now` 는 전처럼 `locked_until > now`. 창이 지나고 잠김도 풀린 줄은 어디에도 안 든다(표에는 남아 있다 — 삭제는 로그인 성공 때만).
- `admin_logins_7d` = role admin 회원의 `user_sessions.created_at`(로그인 · 가입 때 생기는 세션) 최근 7일, 최대 50. IP 는 없다(D15 뒤).
- **기록: `view_security_summary`**.

## 감사 기록 action 추가(§3.4 필터 값)
`view_member_stats` · `view_active_sessions` · `view_security_summary`. 화면 이름표: 회원 통계 조회 · 활성 세션 조회 · 보안 집계 조회.

## 세진 1차 확인(11/12) 반영
- 감사 기록 범위(위 표) — **동의.** 사람이 보이는 조회만 남기고 순수 집계는 안 남긴다.
- `updated_at` 근사 지표 명시 → P2-1 에 적고 화면 설명도 바꿈.
- 20만 행 상한 때 불완전해지는 범위 → P2-3 에 적음. 게스트 → 회원 중복 → `guest_session_transfers` 로 묶음(위 · 세진 2차 확인 반영: 확보 범위 · 예외 규칙 · 로그인 뒤 guest id 없음 확인).
- 조회 비용(92일 × 5쿼리 + 1 = 461회, 세진 11/13 정정) · GROUP BY 전환 기준 → P2-1 에 p95 1초 검토 · 2초 우선 개선(잠정)으로 적음.
- 이메일 전체 반환의 가림 전환 시점 → P2-2 에 적음.

## 세진 8차 확인(11/13) · 미르 결정 반영
- **미르 결정(11/13): 1번 — 이번 베타는 M1 남는 한계를 알려진 제한으로 수용**, 베타 뒤 세진 DB 보완. 베타 중 플레이 세션 · 저장 경로는 안 건드림. 세진 조건부 승인 → 베타 뒤 미르 머지 · 배포.
- G안 조건 둘(`owner_user_id = transfers.app_user_id` · `updated_at >= transferred_at`) 승계 로직(`_transfer` 가 둘 다 세움)과 대조해 추가(P2-1). 격리 MySQL 검사 ⑥(섞인 사례) · 보안 「창은 지났지만 잠김 유효」 사례 추가.

## 세진 7차 확인(11/13) 반영
- 「수백 ms 안」은 실측 전 예상치로 표현 바꿈(P2-1).
- M1 남는 한계(한 익명 세션에 회원 플레이와 게스트 플레이가 섞인 뒤 승계)는 **미르 결정 대기** — 이번 베타는 알려진 제한으로 수용할지, 회원 Play Session 생성 때 호환용 익명 id 를 분리하는 백엔드 수정까지 갈지. 수용이면 세진 조건부 승인.

## 세진 6차 확인(11/13) 반영
- `failures_in_window` 는 제한 키별 실패 횟수 합(요청 수 아님)임을 P2-4 와 화면에 명시.
- 461회는 집계 SQL 만 센 것(인증 조회 1회를 더하면 462).
- M1(로그인한 채 발급된 게스트 → 회원 세션 오분류): 승계 조인에 `play_session_count > 0` 조건을 더하고 격리 MySQL 검사 ⑤ 추가. 열만으로 못 가르는 섞인 경우는 P2-1 에 한계로 적음(완전한 해결은 DB 변경).
- P2-1 「인덱스 있는 created_at」 문구 정정 — created_at 인덱스는 없다, 실제 인덱스 목록으로 바꿈.

## 세진 5차 확인(11/13) 반영
- `security/summary` 의 `keys_with_failures` · `failures_in_window` 에 기간 조건이 없었다 → 현재 창(15분) + 잠긴 줄만 세게 고침(P2-4). 격리 MySQL 검사 추가.
- `traffic` 일별 조회 수 368 → 461(하루 5쿼리 + live 1)로 정정(P2-1).
- GitHub mergeable=false 는 main 이 앞서 나간 것(겹친 파일 없음) → main 을 합쳐 둠(충돌 없음).
- DAU 경계 사례 넷을 격리 MySQL 로 검증(위 4).

## 세진이 남은 확인(베타 뒤 계약 수정본 공유 때)
1. `guest_session_transfers` 로 묶는 구현(P2-3) — 코드 리뷰 때 함께.
2. `play_sessions.updated_at` · `beta_events.received_at` 인덱스 없음 — 베타 규모면 되고, 커지면 세진이 인덱스(DB 변경).
3. 응답 시간 p95 는 아직 안 재고 있다 — 측정 환경은 세진이 베타 뒤 검토(베타 전엔 추가 않음). 그 뒤 테스트 환경에서 7일 · 92일 조회를 비교해 GROUP BY 전환 여부를 정한다.
4. ~~날짜별 DAU 의 게스트 · 회원 구분 기준~~ → **미르 결정(11/12): 세션 생성 당시 소유자 기준으로 고침(P2-1 참고, summary 포함). 세진 4차(11/12): 조인 조건 확인, 이견 없음.**
   **최종 리뷰 때 추가로 볼 검사(세진):** ① 게스트 승계 뒤 기존 세션 재사용(새 세션 아님 → DAU 변화 없음) ② 회원 로그인 뒤 신규 세션 생성(회원 쪽) ③ 승계 없는 게스트(게스트 쪽 그대로) ④ 날짜 경계(KST 자정 · 생성과 승계가 다른 날). → **11/13 격리 MySQL 로 넷 다 검증함** — `backend/tests/test_admin_api_phase2_mysql.py`(실행 조건은 `test_admin_api_mysql.py` 와 같음). 아래는 결정 전 기록.
   **날짜별 DAU 의 게스트 · 회원 구분 기준(세진 3차, 11/12):** 지금 `members_dau` · `guests_dau` 는 `play_sessions` 의 **현재 소유자**로 가른다. 로그인(승계)이 세션의 `owner_user_id` 를 채우고 `owner_anonymous_session_id` 를 비우므로, 게스트로 플레이한 날의 세션이 뒤에 로그인하면 **그 날 숫자가 게스트 → 회원으로 옮겨 간다**(과거 날짜가 바뀐다). 「플레이 당시」 기준으로 가르려면 `guest_session_transfers.transferred_at` 과 세션 `created_at` 을 비교해야 하는데, 승계 때 익명 세션 id 가 지워져 어느 게스트였는지는 transfers 의 `anonymous_session_id` 로만 되짚을 수 있다. 게임 데이터(같은 사람 합치기)와 DAU(그날 누구였나)는 기준이 다르다는 세진 지적이 맞다 — 최종 계약 리뷰 때 「현재 소유자 기준 유지 + 설명 문구」 또는 「transferred_at 로 당시 기준 복원」 중 고른다.
