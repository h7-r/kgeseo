# 관리자 API v0.3 — 3단계 계약 초안 (2026-11-13, FE 해랑 → BE 세진 확인 요청)

미르 11/13 결정: 플레이 핵심 경로(로그인 · 세션 생성 · 저장 · 판정)는 안 건드리고, 나머지 「준비 중」을 지금 연다.
역할(세진 11/13): 공지사항 = 세진 · **문의(CS 관리) · 설정 · 콘텐츠 = 해랑 구현, 세진 백엔드 리뷰** · 구독 관리 = 메뉴에서 뺌.
문의 API 는 미르가 11/12 「베타 뒤 필요 여부부터」로 두었던 것을 **11/13 「지금 만들어요 — 접수 · 목록 · 상태 · 답변, 답변은 내 문의에, 웹 폼도 살림」으로 바꿨다**(세진 확인 요청에 대한 답).
순서는 2단계와 같다 — 이 계약서 → 세진 확인 → 구현(격리 MySQL 검사) → PR → 세진 리뷰 → 미르 머지(밤에 하나씩).

## 0. 공통 규칙(1 · 2단계와 같음)
- 매 요청 관리자 검사(`current_admin`) · 사람이 보이는 조회와 모든 쓰기는 감사 기록 · KST 날짜 입력 · 새 오류는 `{code, message}`.
- 이메일은 목록에서 가림, 상세는 전체(1단계 규칙).
- 본문(문의 · 답변)은 **글자만** 저장하고 돌려준다. HTML 해석 없음, 자동 링크 없음(공지 · 문의 화면 규칙).
- 퍼즐 정답 · 서버 런타임 · 콘텐츠 원문은 어떤 응답에도 싣지 않는다.
- **IP 방침(미르 11/13):** 원문 저장 · 화면은 앞 두 자리(`203.0.*.*`) · 1년 보존. **이 PR 이 IP 를 새로 남기는 곳은 문의 접수(`inquiries.client_ip`) 하나뿐**이다. 관리자 감사 기록(`admin_audit_logs`)에 IP · UA · 대상 ID 열을 넣는 것은 **세진이 이번 주에 한 번에**(미르 11/13 — 같은 표를 둘이 바꾸면 마이그레이션이 겹친다). 해랑은 그 열이 생기면 활동 로그 화면에 앞 두 자리로 보여 주기만 한다. 로그인 IP(`user_sessions` · `login_throttles` 는 해시 키)는 로그인 경로라 베타 뒤 세진. 1년 지난 IP 지우기(배치)도 세진 몫으로 기록만 한다.

## 1. 마이그레이션 순서(Alembic 머리 하나 유지)
- 지금 main 머리: `a3f9c2e7b1d4`(create_beta_events). 세진의 **공지 마이그레이션이 먼저** 그 뒤에 붙는다.
- 이 단계 마이그레이션은 **하나**로 묶는다(`inquiries` · `inquiry_replies` · `admin_settings`). **`admin_audit_logs` 는 건드리지 않는다**(세진이 IP · UA · 대상 ID 를 한 번에 넣음). `down_revision` = 세진 공지 revision(세진 감사 기록 마이그레이션이 그 뒤에 또 오면 그것 뒤). 세진이 id 를 공유하면 그때 파일을 만든다. 세진 것이 머지되기 전엔 PR 을 Ready 로 올리지 않는다.
- 콘텐츠는 DB 변경 없음.

## 2. 감사 기록 action 추가(§3.4 필터 값)
| action | 언제 | target |
|---|---|---|
| `list_inquiries` | 문의 목록 조회(닉네임 · 가린 이메일이 보인다) | — |
| `read_inquiry` | 문의 상세(본문 · 전체 이메일 · IP 앞 두 자리) | `target_user_id` = 접수한 회원(있으면) |
| `reply_inquiry` | 답변 등록 | 같음 |
| `update_inquiry` | 상태 · 우선순위 변경 | 같음 |
| `update_setting` | 설정 값 변경 | — |
| `list_admins` | 관리자 목록 조회(이메일이 보인다) | — |
콘텐츠 조회(P3-3)와 설정 읽기는 사람이 안 보여 안 남긴다(2단계 D5-b 와 같은 기준). **대상 표기(세진 감사 로그 확장 열 `target_type` · `target_id`, 11/13 확정):** `read_inquiry` · `reply_inquiry` · `update_inquiry` 는 `target_type="inquiry"`, `target_id=<inquiry id>`(+ 접수 회원이 있으면 `target_user_id`), `update_setting` 은 `target_type="setting"`, `target_id=<key>`. 세진 마이그레이션이 내 PR 보다 먼저 머지되면 바로 채우고, 뒤면 후속 커밋으로 채운다(`_audit()` 인자만 늘어남).

---

## P3-1 문의(CS 관리) — 접수 · 목록 · 상태 · 답변, 답변은 「내 문의」에

### 표
`inquiries`
| 열 | 형 | 뜻 |
|---|---|---|
| `seq` | BIGINT AUTO_INCREMENT **PK** | 구현에서 기본 키(SQLAlchemy 가 비기본 키 AUTO_INCREMENT 를 안 만든다). 밖으로 보이는 식별자는 `id` |
| `id` | CHAR(36) UNIQUE NOT NULL | 답변 표가 가리킨다 |
| ~~`seq`~~ | — | 접수 번호의 순번 원천 — DB 가 매기므로 동시 요청에도 겹치지 않는다(세진 ①) |
| `number` | VARCHAR(24) UNIQUE | 접수 번호 `INQ-YYYYMMDD-NNNNN`(KST 접수 날짜 + `seq` 다섯 자리, 넘치면 자릿수 늘어남). 삽입 → flush 로 `seq` 를 받아 같은 트랜잭션에서 채운다. 사용자에게 보여 주는 값 |
| `app_user_id` | CHAR(36) NULL, FK app_users ON DELETE SET NULL | 접수 때 로그인돼 있었으면 |
| `email` | VARCHAR(254) | 답변 받을 이메일(폼 입력값, 로그인 이메일과 다를 수 있음) |
| `category` | VARCHAR(16) | `account` · `gameplay` · `payment` · `tech` · `other` (화면 표기 계정 · 게임플레이 · 결제 · 기술지원 · 기타 — 웹 폼의 목록 그대로) |
| `title` | VARCHAR(100) | |
| `body` | TEXT | 글자만, 최대 4000자 |
| `status` | VARCHAR(16) | `open`(미답변) · `answered`(답변 완료) · `closed`(종료) |
| `priority` | VARCHAR(8) | `normal` · `urgent`(관리자가 바꾼다. 접수 때는 normal) |
| `client_ip` | VARCHAR(45) NULL | 접수 요청 IP 원문(IPv6 포함). 화면은 앞 두 자리 |
| `created_at` · `updated_at` · `answered_at`(NULL) | DATETIME(6) | UTC naive(저장 형식 그대로) |
인덱스: `(status, created_at)` · `app_user_id` · `created_at`.

`inquiry_replies`
| 열 | 형 |
|---|---|
| `id` CHAR(36) PK · `inquiry_id` CHAR(36) FK inquiries ON DELETE CASCADE · `admin_user_id` CHAR(36) FK app_users · `body` TEXT(최대 4000자) · `created_at` DATETIME(6) |
인덱스: `(inquiry_id, created_at)`.

첨부 파일: **이번엔 없음**(파일 저장소가 없다). 웹 폼의 첨부 칸은 숨기고 「첨부가 필요하면 메일로」 한 줄만 둔다. 뒤에 저장소가 생기면 `inquiry_attachments` 로.

### 공개 API(웹 고객센터 · 마이페이지)
`POST /api/v1/inquiries` — 요청 빈도 제한(`rate_limit_inquiry_create`, 기본 **IP 당 10분에 5건**, 설정값은 config). 로그인 쿠키가 있으면 `app_user_id` 를 채운다(없어도 접수된다).
```json
요청 { "category": "gameplay", "title": "…", "body": "…", "email": "me@example.com" }
응답 201 { "id": "…", "number": "INQ-20261113-0007", "created_at": "2026-11-13T05:10:00" }
```
- 검증: category 는 다섯 값 중 하나 · title 1~100자 · body 1~4000자(공백만은 안 됨) → FastAPI 422. email 은 가입과 같은 EMAIL_PATTERN(254자) → 422 `{code: "invalid_email", message}`(구현: 400 은 쓰지 않는다). 제한 초과 429 `rate_limited` + `Retry-After`. 본문은 글자 그대로 저장(HTML 해석 없음).
- 접수 번호는 `seq`(AUTO_INCREMENT) 로 만든다 — 날짜별로 1부터 시작하지 않고 전체 순번이 이어진다(예: `INQ-20261113-00042`, 다음 날 `INQ-20261114-00043`). 날짜는 보기용, 유일성은 `seq` 가 보장. 재시도 · 잠금 없음(세진 ① 확정).

`GET /api/v1/me/inquiries` — 로그인 필수. 내 `app_user_id` 로 접수한 문의 전부(최신순), 답변 포함.
```json
{ "items": [ { "id": "…", "number": "…", "category": "gameplay", "title": "…", "body": "…", "status": "answered",
               "created_at": "…", "answered_at": "…",
               "replies": [ { "body": "…", "created_at": "…" } ] } ] }
```
- 답변에 관리자 이름 · id 는 싣지 않는다(「운영팀」으로 표시).
- **비회원 접수 안내(세진 ②):** 비로그인으로 접수한 문의는 `app_user_id` 가 없어 「내 문의」에 안 나오고, 서버에 이메일 자동 발송도 없다. 그래서 웹 폼은 접수 전에 이렇게 적는다 — 「로그인하고 접수하면 답변을 마이페이지 〉 내 문의에서 바로 볼 수 있어요. 로그인 없이 접수하면 답변은 운영팀이 입력하신 이메일로 따로 보내 드려요(자동 발송 아님).」 접수 완료 카드에도 접수 번호와 같은 문구를 다시 보여 준다. 관리자 상세에는 「비회원 — 메일로 답변」 표시를 둬 운영자가 메일을 따로 보내게 한다. 이메일 주소로 회원 문의와 묶는 것은 하지 않는다(가입 이메일 검증 여부와 무관하게 남의 문의가 보일 위험).

### 관리자 API
`GET /api/v1/admin/inquiries` — Query `status`(`all`(기본) · `open` · `answered` · `closed`) · `priority`(`urgent` 만 거를 때) · `offset` · `limit`(기본 50, 최대 50 — 1단계 회원 목록과 같은 `next_offset` 방식, 구현에서 cursor 대신). **기록 `list_inquiries`.**
```json
{ "stats": { "total": 120, "open": 7, "today": 3, "avg_first_reply_hours": 5.4 },
  "items": [ { "id": "…", "number": "INQ-…", "title": "…", "category": "gameplay", "status": "open", "priority": "normal",
               "email": "m***@example.com", "nickname": "닉네임" , "user_id": "…" ,
               "created_at": "…", "answered_at": null, "reply_count": 0 } ],
  "next_offset": 50 }
```
- `stats.today` 는 KST 오늘 0시부터. `avg_first_reply_hours` = 답변이 있는 문의의 (첫 답변 − 접수) 평균(시간, 소수 1자리), 없으면 null.
- `nickname` · `user_id` 는 접수 때 로그인했을 때만, 아니면 null. 이메일은 가림.

`GET /api/v1/admin/inquiries/{id}` — 본문 · 전체 이메일 · `client_ip_display`(앞 두 자리) · 답변 전부(관리자 닉네임 포함). **기록 `read_inquiry`.** 없으면 404.

`POST /api/v1/admin/inquiries/{id}/replies` — `{ "body": "…" }`(1~4000자). 저장 뒤 문의 `status` 가 `open` 이면 `answered` 로, `answered_at` 이 비었으면 지금으로. 응답 201 = 상세와 같은 모양. **기록 `reply_inquiry`.** `closed` 문의에 답변하면 409 `{code: "inquiry_closed"}`.

`PATCH /api/v1/admin/inquiries/{id}` — `{ "status"?: "open|answered|closed", "priority"?: "normal|urgent" }`. 하나 이상 필수. **기록 `update_inquiry`.**

대시보드: `stats/summary` 응답에 `inquiries: { "open": 7 }` 칸 추가(2단계 `unavailable` 과 나란히). 미답변 카드가 산다.

### 웹 화면(해랑)
- 고객센터 1:1 문의: 「준비 중」 안내를 치우고 접수 양식을 켠다(`InquiryPanel` 의 서버 호출 자리). 접수 번호는 서버 값. 첨부 칸은 숨김.
- 마이페이지 「내 문의」: 로그인이면 `GET /me/inquiries` 로 바꾼다. 옛 브라우저 저장본(「전달 안 됨」)은 그대로 보여 주되 아래에 둔다.
- 관리자 CS 관리: 목록(필터 전체 · 미답변 · 답변 완료 · 긴급) · 상세 창(본문 · 답변 쓰기 · 상태 · 우선순위). 담당자 열은 뺀다(원천 없음).

---

## P3-2 설정 — 점검 모드 · 서버 값 읽기 · 관리자 목록

범위를 둘로 나눈다(세진 11/13): **(a) 값 저장** = `admin_settings` 표 · GET/PUT · 감사 기록, **(b) 점검 적용** = 공개 `GET /site/status` + 웹사이트가 그 값을 읽어 `/maintenance` 로 보내는 것. (b) 는 웹사이트만이고 게임(play) · API 는 이번에 안 막는다. 둘 다 이번 단계에 넣되 PR 설명에서 구분한다.

### 표 `admin_settings`
| 열 | 형 |
|---|---|
| `key` VARCHAR(64) PK · `value_json` JSON · `updated_by` CHAR(36) FK app_users · `updated_at` DATETIME(6) |
처음 키: `maintenance_mode`(`{"on": false, "message": ""}`). 뒤에 키를 더해도 표는 그대로.

### API
`GET /api/v1/admin/settings` — 기록 없음(사람 안 보임).
```json
{ "editable": { "maintenance_mode": { "on": false, "message": "", "updated_at": null, "updated_by": null } },
  "readonly": { "hint_initial_balance": 3, "hint_fun_minigames_per_session": 2, "hint_special_minigames_per_session": 1,
                "rate_limit_window_sec": 60, "beta_events_enabled": true,
                "user_session_days": 14, "guest_lifetime_hours": 24 } }
```
- `readonly` 는 **실행 중인 서버의 실제 값**을 읽어 준다 — `app.core.config.settings` 의 `hint_initial_balance` · `hint_fun_minigames_per_session` · `hint_special_minigames_per_session` · `rate_limit_window_sec` · `beta_events_enabled` 와, 코드 상수 `USER_SESSION` 기간(`user_session.py`) · `GUEST_LIFETIME`(`guest_session.py`). 위 JSON 의 숫자는 **예시**일 뿐 화면에 박지 않는다(세진 지적). 비밀값(키 · 시크릿 · DB 주소)은 싣지 않는다. 바꾸려면 배포.

`PUT /api/v1/admin/settings/maintenance_mode` — `{ "on": true, "message": "점검 중입니다 (~06:00)" }`(message 최대 200자). 응답 = 그 키의 `editable` 항목. **기록 `update_setting`**(어떤 키인지는 detail 에).

`GET /api/v1/site/status` — **공개 · 인증 없음 · 기록 없음.** `{ "maintenance": { "on": false, "message": "" } }`. 웹사이트가 처음 뜰 때 읽어 `on` 이면 `/maintenance`(점검 화면)로 보낸다. 관리자 주소(`/admin`)는 예외(점검을 끌 수 있어야 한다). **게임(play) 은 이번에 안 막는다**(플레이 경로 안 건드림, 세진 확인 ③). `Cache-Control: no-store`.

`GET /api/v1/admin/admins` — role admin 회원 목록 `{ items: [ { user_id, nickname, email(가림), created_at, last_login_at | null, last_session_started_at | null } ] }`. **기록 `list_admins`.** 지정 · 해제는 전처럼 서버 스크립트(`scripts/set_user_role.py`)로만 — 화면은 읽기.

---

## P3-3 콘텐츠 — 읽기 전용(미르 11/13: 게시 상태 · 판 · fingerprint 포함, 정답은 절대 안 나감)

DB 변경 없음. 원천은 셋: 레거시 콘텐츠 폴더(`app/content/cases`, `load_case_client_content`), 게시 저장소(`session_content.get_pinned_content_store()`), 게시 상태 표(`npc_content_versions` · `npc_publication_states` · `npc_publication_events`).

`GET /api/v1/admin/contents` — 기록 없음.
```json
{ "cases": [ { "case_id": "naju-angam-01", "source": "published", "title": "앙암바위의 전설",
               "counts": { "zones": 5, "objects": 42, "interactions": 61 },
               "versions": [ { "content_version": 3, "content_fingerprint": "sha256:…", "publication_status": "published",
                               "registered_at": "…", "state_updated_at": "…" } ],
               "legacy": false } ] }
```
- `counts` 는 **client 콘텐츠**(공개 번들과 같은 원천)에서만 센다 — 존 · 오브젝트 · 상호작용(`interaction` 이 있는 오브젝트). NPC 수는 client 콘텐츠에 없어 싣지 않는다(npc 파일은 안 읽는다). server runtime(판정 · 정답) · npc 대사 원문은 읽지 않는다. 그 판이 게시 저장소(메모리)에 없으면 `counts: null`(세진 기준 — 추측하지 않음).
- `publication_status` 는 `npc_publication_states.status` 그대로(없으면 null). 레거시 케이스(`case_001` 등)는 `legacy: true`, 버전 없음.
- fingerprint 는 저장된 값(`npc_content_versions.content_fingerprint`)을 보여 줄 뿐 다시 계산하지 않는다(세진 확인 ④ — 계산기 v0.1 은 「연결하지 않음」 상태).

`GET /api/v1/admin/contents/{case_id}` — 존 목록(`zone_id` · 이름 · 물건 수) · 상호작용 종류별 수 · 게시 이력 최근 20건(`from_status` · `to_status` · `reason` · `actor` · `at`). 정답 · 서버 런타임 · 대사 원문 없음. 없으면 404. 기록 없음.

관리자 화면: 카드 목록(사건 · 출처 · 버전 · 게시 상태 배지 · fingerprint 앞 12자, 눌러 복사) → 상세(존 · 이력). 미리보기용 「홈 영상 · 미디어」 분류는 뺀다(서버 원천 없음).

---

## P3-4 구독 관리 — 메뉴에서 뺀다(미르 11/13). 화면 파일은 남기지 않고 지운다(결제 연동이 생기면 그때 다시).

## P3-5 IP — 문의 접수 IP 와 감사 기록 표시
- **감사 기록 표(`admin_audit_logs`)의 확장 열 넷 `client_ip` · `user_agent` · `target_type` · `target_id` 는 세진이 한 번에 넣는다(미르 · 세진 11/13 확정).** 이 PR 은 그 표를 바꾸지 않는다. 세진 열이 들어오면 `GET /admin/audit-logs` 응답에서 IP 를 **앞 두 자리로 보여 주는 것**과 대상(`target_type/id`)을 활동 로그 화면에 표시하는 것만 해랑이 한다(IP 가림을 서버가 해 주면 그대로, 원문을 주면 화면에서 가림 — 세진 계약 때 정함). 마이그레이션 순서(세진 `is_test` · 감사 로그 확장 · 공지)는 세진이 정리해 공유하고, 내 것은 그 맨 뒤.
- 문의 접수 IP(`inquiries.client_ip`)는 **서버가 확인한 클라이언트 IP**(`request.client.host`)만 쓴다 — 지금 `_throttle_keys` 와 같은 규칙. 프록시(CloudFront/ALB) 뒤에서 실제 IP 를 받으려면 uvicorn `--proxy-headers --forwarded-allow-ips` 설정이 필요하고 그건 **배포 구성(세진)** 에서 켠다. 앱 코드는 헤더를 직접 읽지 않는다(세진 ⑤).
- **1년 보존 뒤 파기(세진 ⑤):** 행은 남기고 `client_ip` 만 NULL 로 바꾼다(`created_at < now − 365일`). 매일 한 번 도는 배치(관리 스크립트 + 운영 cron)는 **세진 후속**(감사 기록 IP 와 같은 배치로) — 이 PR 은 문의 표의 열과 규칙만 둔다.
- 보안 화면 `hot_ips` · `admin_login_ip` 는 로그인 IP 가 쌓여야 열린다 → 그대로 `unavailable`, 까닭 문구를 「로그인 IP 기록은 베타 뒤」로 바꾼다.

---

## 미르 11/13 추가 결정 반영
- 감사 기록 표(IP · UA · 대상 ID)는 세진이 이번 주 한 번에 — 해랑은 문의 표 IP 만, 활동 로그 화면은 표시만. 구독 빼기 · 로그인 IP · 삭제 배치 세진 · 점검 모드 웹만 — 확정.

## 세진 1차 보완(11/13) 반영
- ① 접수 번호 → `seq` AUTO_INCREMENT 로 확정(재시도 없음). ② 비회원 접수 안내 문구 · 관리자 표시 확정. ③ 점검은 웹만(게임 · API 안 막음) 유지. ④ fingerprint 저장값만. ⑤ IP 는 서버 확인 IP + 배포 구성의 proxy-headers, 1년 뒤 NULL 파기 배치(세진 후속). ⑥ 마이그레이션은 세진 공지 revision 뒤. ⑦ 빈도 제한 10분 5건 + 프록시 확인. 설정 읽기 전용 값은 실제 서버 값.

## 구현 기록(11/13 해랑)
- 백엔드 d6aaf5e · 웹 674c78c(+ 후속) — #154. 격리 MySQL 검사 5개(접수 → 목록 → 답변 → 내 문의 · 동시 접수 20건 번호 유일 · 실패 롤백 · 빈도 제한 · 설정 · 콘텐츠) 포함 전체 2836 통과, 운영 빌드 + 로컬 백엔드 라이브 확인 28/28(비회원 · 회원 접수, 내 문의 답변, CS 관리 · 설정 점검 모드 · 관리자 목록 · 콘텐츠 · 활동 로그).
- 마이그레이션 `e7a1b2c3d4f5` 의 `down_revision` 은 임시(a3f9c2e7b1d4). 세진 revision(is_test → 감사 로그 확장 → 공지) 뒤로 옮긴 뒤 Ready.
- 감사 기록의 대상 표기(`target_type/id`)는 세진 열이 들어온 뒤 후속 커밋.

## 세진 확인 요청
① 접수 번호 순번 방식(유일 제약 충돌 재시도 3회) — 다른 방식이 좋으면 알려 줘(예: AUTO_INCREMENT 보조 열).
② 문의 답변 이메일 발송 — 이번엔 없음(서버에 발송 수단 없음). 넣을지는 베타 뒤.
③ 점검 모드는 웹사이트만 막고 게임(play) · API 는 안 막는다 — 맞나.
④ 콘텐츠 fingerprint 는 저장값 표시만, 재계산 안 함 — 맞나. `session_content.get_pinned_content_store()` 는 있는데 케이스 **목록**을 주는 공개 함수는 못 찾았어 — `PinnedContentStore` 에 목록 메서드가 있는지, 없으면 `npc_content_versions` 표(case_id · content_version · fingerprint · registered_at)를 목록 원천으로 써도 되는지. 레거시는 `app/content/cases/case_001` 하나.
⑤ 요청 IP — 지금 `_throttle_keys` 는 `request.client.host` 만 본다(프록시 헤더 안 읽음). 같은 규칙으로 갈게. 운영이 프록시 뒤라 전부 같은 IP 로 보이면 `X-Forwarded-For` 를 신뢰할지는 네가 정해 줘(uvicorn `--proxy-headers` · `--forwarded-allow-ips`).
⑥ 마이그레이션 하나로 묶는 것 · `down_revision` 을 네 공지 revision 으로 거는 것.
⑦ `rate_limit_inquiry_create` 기본값(IP 당 10분 5건) — 기존 `SlidingWindowLimiter`(`rate_limit_window_sec` 창)에 키 하나 더하는 식. 운영 서버가 프록시 뒤라 모든 요청이 같은 IP 로 보이면 제한이 전체에 걸리니, ⑤ 의 proxy-headers 설정과 함께 확인(세진 ⑦).

## 해랑 할 일(확인 뒤)
백엔드: 모델 · 마이그레이션 1개 · 라우터(`inquiries.py` 공개 · `admin.py` 추가 · `site.py` 상태) · 스키마 · 감사 action · 격리 MySQL 검사(접수 → 목록 → 답변 → 내 문의, 설정 켜고 끄기, 콘텐츠 목록 정답 미포함 검사).
웹: 고객센터 문의 폼 켜기 · 내 문의 · 점검 화면 리다이렉트 · 관리자 CS 관리 · 설정 · 콘텐츠 · 활동 로그 IP 열 · 구독 메뉴 제거 · screens.ts 상태 live.
