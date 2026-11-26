# 관리자 감사 기록 확장 — `admin_audit_logs` 열 넷 (11/16 세진)

미르 · 세진 11/13 확정(「IP · UA · 대상 ID 를 세진이 한 번에」, `admin_api_v0.3_phase3.md` §IP 방침)을 구현한다.
마이그레이션 `63566bb6005b` (← `e7a1b2c3d4f5`, #154 뒤 단일 head).

## 1. 표

| 열 | 형 | NULL | 뜻 |
|---|---|---|---|
| `client_ip` | VARCHAR(45) | 허용 | 서버가 판별한 요청 IP **원문**(IPv4 · IPv6 표준 표기). 응답 · 화면에는 앞 두 자리만 |
| `user_agent` | VARCHAR(512) | 허용 | 요청 `User-Agent` 앞 512자, 제어 문자는 공백 |
| `target_type` | VARCHAR(32) | 허용 | 대상 물건의 종류 — `user` · `inquiry` · `setting` · `notice` |
| `target_id` | VARCHAR(64) | 허용 | 대상 물건의 id — 회원 id · 문의 id · 설정 키 · 공지 UUID |

- 모두 NULL 허용 · 기본값 없음 · 백필 없음. **확장 전 기록은 네 열 모두 NULL** 로 남는다.
- 기존 열(`id` · `admin_user_id` · `action` · `target_user_id` · `created_at`) · 색인(`ix_admin_audit_logs_target`)은 그대로.
- 새 색인은 만들지 않았다(대상 표기로 거르는 조회가 아직 없다 — 생기면 그때 더한다).
- downgrade 는 네 열을 지운다(쌓인 IP · UA · 대상 표기도 함께 사라진다).

## 2. IP · User-Agent 를 잡는 곳

- 관리자 라우터(`/api/v1/admin/*`) 전체에 의존성 `capture_audit_request`(`app/services/admin_audit.py`)를 걸었다.
  요청마다 IP · UA 를 잡아 두고 `_audit()` 가 쓸 때 읽는다 → **호출부는 IP · UA 를 넘기지 않는다.**
- IP 는 Uvicorn 이 판별한 `request.client.host` 만 쓴다(`request_rate_limit.client_ip` · 문의 `inquiries.client_ip` 와 같은 규칙).
  Uvicorn 은 `--forwarded-allow-ips` 에 든 믿는 프록시(운영 Caddy → 127.0.0.1)에서 온 연결일 때만 `X-Forwarded-For` 를
  반영한다. 코드에서 `X-Forwarded-For` · `X-Real-IP` 원문을 직접 읽지 않는다.
- IP 주소 모양이 아니면(시험 클라이언트 `testclient` · 빈 값) NULL.
- 관리자 라우터 밖에서 `_audit()` 를 부르면(스크립트 등) IP · UA 는 NULL 이다.

## 3. `_audit()` 계약 (해랑 후속 작업용)

```python
await _audit(db, admin, action, target_user_id, *, target_type=None, target_id=None)
```

- 앞 네 인자는 예전 그대로 — 기존 호출은 고치지 않아도 동작하고 IP · UA 가 채워진다.
- `target_type` · `target_id` 는 **키워드만**, **둘 다 주거나 둘 다 생략**. 한쪽만 · 정해 두지 않은 종류 · 64자 넘는 id 는
  `ValueError`(부른 코드의 실수 — 기록을 쓰기 전에 멈춘다).
- 허용 종류(`AUDIT_TARGET_TYPES`): `user` · `inquiry` · `setting` · `notice` 넷뿐. 늘리려면 이 문서와 함께 늘린다.
- **`notice` 의 `target_id` 는 공지 UUID 표준 표기(소문자 · 하이픈 포함 36자, `str(uuid4())` 모양)** 만 받는다 —
  대문자 · 하이픈 없는 32자 · 중괄호 · 숫자 순번은 `ValueError`. 나머지 세 종류는 형식을 따로 보지 않는다(기존 그대로).
- 새 action 이름(예: 공지의 `create_notice` · `update_notice` · `delete_notice`)은 `_audit()` 가 따로 막지 않지만,
  `/audit-logs?action=` 필터는 `admin.py` 의 `AUDIT_ACTIONS` 에 든 이름만 받는다 — **새 action 을 쓰는 PR 은 거기에도 더한다.**

### `target_user_id` 와 `target_type/target_id` 의 관계

- **`target_user_id` = 개인정보가 보인 회원**(기존 의미 그대로). `/audit-logs?target_user_id=` 필터와 닉네임 표시가 이 열을 쓴다.
- **`target_type/target_id` = 열람 · 변경한 대상 물건.** 회원 자신이 대상이면 `user`, 문의면 `inquiry`, 설정이면 `setting`,
  공지면 `notice`.
- 둘은 독립이다. 문의처럼 물건과 회원이 함께 있으면 둘 다 채운다.

| action | target_user_id | target_type / target_id | 채운 곳 |
|---|---|---|---|
| `read_user` | 그 회원 | `user` / 회원 id | **이 PR** |
| `read_inquiry` · `reply_inquiry` · `update_inquiry` | 접수 회원(있으면) | `inquiry` / 문의 id | **해랑 후속**(phase3 계약 §감사) |
| `update_setting` | 없음 | `setting` / 설정 키 | **해랑 후속** |
| `create_notice` · `update_notice` · `delete_notice`(이름은 공지 PR 에서 확정) | 없음 | `notice` / 공지 UUID | **공지 API(세진 다음 작업)** |
| `list_users` · `list_audit_logs` · `export_beta_events` · `view_*` · `list_inquiries` · `list_admins` | 기존 그대로 | 없음(목록 · 집계라 한 물건이 아니다) | — |

해랑 후속 예(인자만 늘어난다):

```python
await _audit(db, admin, "read_inquiry", row.app_user_id, target_type="inquiry", target_id=row.id)
await _audit(db, admin, "update_setting", None, target_type="setting", target_id=key)
# 공지(생성은 새 UUID 를 정한 뒤 · 삭제는 지우기 전 id 로)
await _audit(db, admin, "create_notice", None, target_type="notice", target_id=notice.id)
```

## 4. `GET /api/v1/admin/audit-logs` 응답

`logs[]` 각 줄에 필드 넷을 **덧붙인다**(기존 필드 · 형식 · 필터 · 쪽 넘김은 그대로 → 지금 화면은 깨지지 않는다).

| 필드 | 형 | 값 |
|---|---|---|
| `target_type` | string \| null | `user` · `inquiry` · `setting` · `notice` |
| `target_id` | string \| null | 위 표 |
| `client_ip_display` | string \| null | IP **앞 두 자리** — IPv4 `203.0.*.*` · IPv6 `2001:db8:*` (문의 `client_ip_display` 와 같은 `ip_display`) |
| `user_agent` | string \| null | 저장값 그대로(앞 512자) |

- **IP 원문은 응답 어디에도 넣지 않는다**(서버가 가린다 — phase3 계약의 「서버가 가려 주면 그대로」).
- 확장 전 기록은 네 필드 모두 `null` — 화면은 「기록 없음」 등으로 보이면 된다.
- 새 필터(대상 표기 · IP)는 이번에 없다.

## 5. 남은 일(이 PR 밖)

- ~~1년 지난 `client_ip` · `user_agent` NULL 파기 배치(D14-a · 문의 IP 와 함께) — 세진, 방식 · 일정 PM 결정 후.~~
  → **11/26 PM 최종 결정: 수집 후 달력 1년 지난 감사 기록은 행 전체 삭제**(WD-09 유지, IP · UA 만 NULL 은 폐기). `target_type` · `target_id` 도
  행과 함께 파기되고 따로 지우지 않는다. 구현 1차 `scripts/purge_retention_data.py` 의 `audit_log_purge`(운영 등록 · 실행은 PM) —
  `account_withdrawal_v0.2.md` §10 ③.
- 로그인 경로 IP(`user_sessions` 등) — 베타 뒤 세진.
- 활동 로그 화면 표시(앞 두 자리 IP · 대상 표기) — 해랑.
- 격리 MySQL 에서 upgrade · downgrade 왕복과 쓰기 · 조회 확인 — 격리 DB 준비 후.
