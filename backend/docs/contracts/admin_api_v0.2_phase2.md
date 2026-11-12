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

- `members_dau` · `guests_dau` · `signups` · `play_sessions_created` 는 §3.3 정의 그대로(날짜마다 같은 쿼리). `days` 만큼 하루씩 센다(최대 92회 × 4쿼리 — 베타 규모에선 충분, 커지면 날짜 GROUP BY 로 바꾼다).
- `live.active_play_sessions_5m` = `play_sessions.updated_at >= now − 5분` 인 세션 수. 「지금 플레이 중」의 근사값이다(로비 동시접속이 아니다).
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
- 가입자 목록 이메일은 1단계 목록처럼 **전체** — 화면이 maskEmail 로 가린다(§2.5 서버 가림 전환 때 함께 바꾼다). `stage` 는 저장 slot 0 의 단계.
- **기록: `view_member_stats`**.

## P2-3 `GET /admin/stats/game` — 게임 진행 집계(beta_events)

Query: `date`(끝, 기본 오늘) · `days`(1~92, 기본 30). `received_at` 이 범위 안인 `beta_events` 중 `stage_reached` · `objective_state` · `puzzle_attempt` · `help_event` · `run_state` 만 읽어(최대 200,000행) 사람 단위로 센다.
사람 = `app_user_id` > `guest_session_id` > `tab_id`.

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
- `avg_completion_minutes` = `run_state start/resume → dawn` 까지 분의 평균(같은 `run_id`). 없으면 null + `unavailable.avg_completion_minutes`. 200,000행에 걸리면 `unavailable.truncated`.
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
- `login_throttles` 는 현재 창의 값뿐(이력 없음). 키 해시는 싣지 않는다. 429 횟수는 서버 메모리뿐이라 `unavailable`(미르 11/12 — 쌓을지는 그때 정한다).
- `admin_logins_7d` = role admin 회원의 `user_sessions.created_at`(로그인 · 가입 때 생기는 세션) 최근 7일, 최대 50. IP 는 없다(D15 뒤).
- **기록: `view_security_summary`**.

## 감사 기록 action 추가(§3.4 필터 값)
`view_member_stats` · `view_active_sessions` · `view_security_summary`. 화면 이름표: 회원 통계 조회 · 활성 세션 조회 · 보안 집계 조회.

## 세진이 확인해 줄 것
1. 감사 기록 범위(위 표) — 특히 `stats/traffic` · `stats/game` 을 안 남기는 것.
2. `active_play_sessions_5m` 과 활성 세션 목록을 `play_sessions.updated_at` 으로 보는 것(인덱스 없음 — 베타 규모면 됨, 커지면 인덱스).
3. `stats/game` 이 `beta_events` 를 그대로 읽는 것(최대 200,000행, 범위 조건은 `received_at` 인덱스 없음 → 필요하면 인덱스).
4. 날짜별 접속(`days` × 4쿼리) 비용.
