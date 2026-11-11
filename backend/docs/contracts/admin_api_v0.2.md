# 관리자 API v0.2 계약 초안 (2026-11-11, FE 최종 확인 · PM 직접 결정 반영)

- 상태: **초안.** FE(해랑님) 검토 · 최종 확인(§0)과 **미르님(PM)의 2026-11-11 직접 답변**(§0.1)을 반영했다. PM 이 직접 정한 정책과, 아직 FE 동의만 있거나 상세 설계가 남은 항목을 구분한다(§7). 정책이 정해진 항목도 **상세 설계가 남은 부분은 구현 전 확정이 필요하다.** 코드 · DB · 운영 설정은 바꾸지 않았다. 11/13 베타가 끝난 뒤 구현한다.
- 기준: origin/main `3f1f6a4e` 의 실제 모델과 라우터. `4ea32212` 에서 다시 확인 — `admin.py` · `me.py` · `schemas/account_data.py` · `user_session.py` · 관련 모델 · `website/src/admin/api` · `lib/format.ts` · `tests/test_account_data_api.py` 변경 없음.
- 범위: `GET /api/v1/admin/users`, `GET /api/v1/admin/users/{user_id}`, `GET /api/v1/admin/stats/summary`, `GET /api/v1/admin/audit-logs`, `GET /api/v1/me`.
- 범위 밖: NPC 승인용 `VerifiedAdmin`, 관리자 2단계 인증(`npc_general_pack.md` §4 · `npc_approval_persistence.md` 의 미결 그대로), 1:1 문의 API, 탈퇴 · 정지, 로비 동시접속 수집.

표기: **[현행]** 지금 코드가 이미 하는 것 · **[제안]** 이 초안이 정하자고 하는 것 · **[FE 동의]** FE 가 검토해 동의한 것(PM 최종 결정 대기) · **[PM 확정]** 미르님이 2026-11-11 직접 답변으로 정한 정책(세부 설계가 남은 부분은 따로 표시) · **[결정 필요]** PM·FE 확정 전에는 구현하지 않는 것(§7 번호).

---

## 0. FE 검토 반영 (2026-11-11, 해랑님)

FE 동의는 "FE 화면 · 구현 쪽에서 이 안으로 문제없다"는 뜻이다. **정책 결정(개인정보 노출 · 감사 기록 · 오류 형식 통일 여부)은 PM 이 최종 확정한다.** PM 확정 전에는 구현하지 않는다.

| 항목 | FE 검토 결과 | 반영 위치 | 상태 |
|---|---|---|---|
| D1 | 기존 관리자 API 401 · 403 · 404 오류 형식 유지 | §2.2 | FE 동의 · PM 확정 대기 |
| D2 | 닉네임 부분 일치, 이메일 완전 일치 검색 | §3.1 `q` | FE 동의 · PM 확정 대기 |
| D3 | 회원 목록 이메일 서버 마스킹 | §2.5 · §3.1 | FE 동의 · PM 확정 대기 |
| D5(새로고침 부분) | 관리자 화면 자동 새로고침 없음. 추후 도입하면 최소 60초 간격 | §3.3 감사 | FE 동의 · PM 확정 대기. (감사 로그 조회 기록은 PM 직접 결정 §0.1) |
| D12 | DB 근거가 없는 목업 지표는 계약에서 빼고, FE 는 '준비 중' 으로 표시 | §3.3 · §3.4 FE 호환 | FE 동의 · PM 확정 대기(원천을 나중에 만들지는 PM) |
| D16 | `/me` 추가 필드 네 가지 확인 | §3.5 | FE 확인 · PM 확정 대기 |
| 시각 | 응답 시각은 지금처럼 시간대 표기 없는 UTC 문자열 | §2.4 | FE 동의(현행 유지) |
| providers | 복수 로그인 수단을 표현하는 배열 유지 | §3.1 · §3.5 | FE 동의 |
| 목록 이어 받기 | FE 가 이어 받을 때 중복 `user_id` 를 제거할 예정 | §2.3 | FE 구현 예정 |
| 추가 필드 | "추가로 필요한 필드 없음" = **현재 초안의 필드로 충분하다**는 뜻으로 확인(11/11 추가 회신) | — | FE 확인 완료 |
| 초안 필드 유지 | 회원 목록 `region` · `providers` · `last_session_started_at`, 회원 상세 `account`(`identities` · 동의 기록 · `active_session_count`), `/me` `created_at` · `providers` · `has_password` · `terms_version` 을 초안 그대로 유지 | §3.1 · §3.2 · §3.5 | FE 확인 완료 · PM 확정 대기 |
| 최근 로그인 표시 | `last_login_at` 이 있으면 그 값, 없으면 `last_session_started_at` 을 '추정' 으로, 둘 다 없으면 '기록 없음' | §3.1 | FE 표시 규칙(11/11) — 두 필드 공존 구조는 PM 이 유지로 결정(§0.1 D4) |

### 0.1 PM 직접 결정 (2026-11-11, 미르님)

미르님이 직접 답변한 정책이다. 앞서 해랑님을 통해 전달받았던 잠정 방향(D4 · D7 · D8 · D14)은 **이 직접 답변으로 대체한다**(내용이 다르면 이 표가 우선). 표의 "남은 상세 설계" 는 구현 전에 정해야 한다.

| 항목 | PM 결정 | 반영 위치 | 남은 상세 설계(§7) |
|---|---|---|---|
| D4 최근 로그인 | 지금은 `user_sessions` 기반 `last_session_started_at` 을 제공하고 FE 는 추정값임을 표시한다. 실제 `last_login_at` 컬럼과 갱신 로직은 **베타 이후 개발**. FE 가 제안한 두 필드 공존 구조를 유지 | §3.1 · §3.2 · §6 | 로그인 성공 시 갱신 규칙(D4-a · D4-b), 과거 기록 처리(D4-c) |
| D5 감사 기록 | 관리자 감사 로그 **조회도 감사 로그에 기록**하고, 조회 기록은 별도 action(제안: `list_audit_logs`)으로 구분 | §3.4 · §5 | 기록 실패 시 응답 처리(D5-a). 통계 조회 · 검색 기록 방식(D5-b) |
| D6 회원 상세 | 동의 기록을 제공한다. 세션은 **유효 세션 수와 마지막 세션 시각만** 제공. 세션 토큰 · 쿠키 비밀값은 절대 노출하지 않는다 | §3.2 | — |
| D7 회원 통계 제외 | 관리자와 테스트 계정은 **기본 회원 통계에서 제외**하고, 포함해서 볼 수 있는 토글을 둔다 | §3.3 | 토글 파라미터 이름(제안 `include_internal`) |
| D7-a 테스트 계정 식별(추가 답변) | 베타 통계는 **PM 이 주는 회원 ID 목록**으로 제외. 베타 이후 `app_users` 에 **`is_test` 표시를 추가**하는 방향. `role` 과 `is_test` 는 **독립**(관리자이면서 테스트 계정도 허용). `is_test` 변경은 **`set_user_role.py` 와 같은 운영 서버 명령으로만**. 컬럼 · 명령 구현은 베타 이후 | §3.3 · §6 | 컬럼 정의 확정, 기존 계정 표시 방법(마이그레이션 세부), 명령 세부(D7-b~d) |
| D8 DAU · MAU | DAU = 해당 KST 날짜에 **로그인 세션 또는 플레이 세션을 생성한 고유 회원 수**. MAU = 같은 기준의 최근 30일 고유 회원 수. 중복은 한 번만, 게스트는 별도 통계, 관리자 · 테스트 계정은 D7 기본 제외와 같게 | §3.3 | 게스트 통계의 세는 단위(D8-a), "최근 5분 활성" 정의(D8-b) |
| D14 감사 로그 보존 | 1년 | §3.4 | 자동 삭제 방식 · 일정 · 수행 주체(D14-a) |
| D15 IP · UA | 감사 로그에 IP 와 User-Agent 를 기록하는 방향 | §3.4 · §5 · §6 | 신규 컬럼 · 수집 지점 · 보안 · 개인정보 검토, 세부 정책은 베타 이후(D15-a) |
| D17 요청 제한 | 관리자 전용 요청 제한은 베타 이후 설계. 지금은 모든 관리자 API 에서 `current_admin` 역할 검증을 유지 | §2.1 · §5 | 요청 제한 설계(D17-a) |

이번 직접 답변에 없는 FE 합의사항(D1 · D2 · D3 · D12 · D16 · D5 의 새로고침 부분)은 **PM 확정으로 처리하지 않았다** — 그대로 "FE 동의 · PM 확정 대기"(§0 · §7).

여전히 PM 미결: D9 · D10 · D11 · D13, 그리고 위 표의 상세 설계 항목.

## 1. 기존 구현 현황

| 항목 | 현행 |
|---|---|
| 등록된 관리자 라우터 | `app/api/v1/admin.py` 의 2개뿐: `GET /admin/users`, `GET /admin/users/{user_id}` (prefix `/api/v1`) |
| 권한 | `current_admin` = `current_user`(세션 쿠키 → `user_sessions.token_hash`) + `role == "admin"`. 관리자 지정은 `scripts/set_user_role.py` 로만 |
| 응답 헤더 | `current_user` 가 `Cache-Control: no-store` 를 붙인다 |
| 목록 | `offset`(≥0)만 받는다. 50명 고정(`PAGE_SIZE`), `created_at DESC`, 다음 쪽이 있으면 `next_offset`, 없으면 `null` |
| 목록 항목 `AdminUserSummary` | `user_id, email(전체), nickname, role, created_at, stage, save_updated_at` |
| 상세 `AdminUserDetail` | `{user: AdminUserSummary, save, character, items}` |
| 감사 기록 | 조회 뒤 `admin_audit_logs` 에 `list_users`(대상 없음) · `read_user`(대상 id)를 쓰고 commit. 쓰기 실패면 조회도 500 |
| `admin_audit_logs` 컬럼 | `id BIGINT AI, admin_user_id CHAR(36), action VARCHAR(64), target_user_id CHAR(36) NULL, created_at DATETIME(6)` · 인덱스 `target_user_id` 하나 · FK 없음 |
| 오류 본문 | 관리자 경로는 모두 `ErrorMessage` 문장형: 401 `{"detail":"Login required."}`, 403 `{"detail":"Admin only."}`, 404 `{"detail":"User not found."}`. 쿼리 형식 오류는 FastAPI 기본 422 목록형 |
| 응답에서 빠지는 것 | 비밀번호 해시(`auth_identities.password_hash`), 세션 토큰 · 해시, `provider_subject` |
| 테스트 | `tests/test_account_data_api.py`: 세션 없음 401, 일반 사용자 403 |
| 관리자 계약 문서 | 없음. 결정된 원칙은 `admin.py` 주석의 "해시 · 토큰은 어떤 응답에도 넣지 않는다 · 열람은 기록으로 남긴다" 두 가지 |
| `/me` | `GET /api/v1/me`(`/auth/me` 는 없다) → `{user_id, email, nickname, region, role}` |

FE 현행(`website/src/admin`):

- `api/client.ts` 는 **상태 코드만** 본다(401 · 403 · 404 · 502~504 · 그 외). 오류 본문은 읽지 않는다.
- `api/users.ts` 는 위 서버 스키마를 그대로 옮겼고, `USER_PAGE_SIZE = 50`, `next_offset` 이 `null` 이 될 때까지 이어 받는다.
- 목록의 이메일은 FE `maskEmail()` 이 가린다. **`*` 가 이미 들어 있으면 그대로 둔다**(서버 마스킹을 미리 대비해 둠). 상세 화면은 전체 이메일을 보인다.
- 시각은 "시간대 표기 없는 UTC" 로 읽는다(`parseServerTime` 이 `Z` 를 붙인다).
- 검색 칸 · 탈퇴/정지 탭 · 통계 카드 · 활동 로그 화면은 "준비 중".
- `/admin` 진입 판정은 `GET /api/v1/me` 의 `role`. 웹사이트(`services/session.ts`)는 `/me` 의 `user_id, email, nickname, region` 을 읽는다.

데이터 사실(설계 근거):

- `app_users` 에 **provider · last_login_at · 탈퇴/정지 컬럼이 없다.**
- provider 는 `auth_identities.provider`(`local` · `google` · `naver`). 한 사용자에 여러 행 가능(`uq(provider, provider_subject)` 만 유일).
- `user_sessions` 는 로그인 · 가입 성공 때 한 행이 생기고(`start_session`), 로그아웃은 `revoked_at` 만 채운다(삭제 없음). 수명 14일.
- 모든 시각은 UTC 를 시간대 없이 담은 `DATETIME(6)`(`utc_now()`).

---

## 2. 공통 규칙

### 2.1 권한 · 헤더

- **[현행 유지 · PM 확정 D17]** 모든 `/admin/*` 는 `Depends(current_admin)` 로 매 요청 `role == "admin"` 을 검증한다. 역할 판정을 요청 값으로 받지 않는다. 관리자 전용 요청 제한은 베타 이후 설계한다(D17-a) — v0.2 에서는 두지 않는다.
- **[현행 유지]** `Cache-Control: no-store`.
- 모두 GET 이라 Origin 검사(`require_same_origin`)는 적용되지 않는다(GET 면제, 현행과 같음). 관리자 쓰기 API 를 만들면 그때 붙인다.

### 2.2 오류 본문

| 상황 | 상태 | 본문 | 비고 |
|---|---|---|---|
| 세션 없음 · 만료 | 401 | `{"detail":"Login required."}` | **[현행 유지]** |
| 관리자 아님 | 403 | `{"detail":"Admin only."}` | **[현행 유지]** |
| 사용자 없음(상세) | 404 | `{"detail":"User not found."}` | **[현행 유지]** |
| 쿼리 값 오류(신규 파라미터) | 422 | `{"detail":{"code":"invalid_query","message":"..."}}` | **[제안]** 검색어를 되돌려 보내지 않으려고 FastAPI 목록형 대신 `CodedError`(인증 경로와 같은 이유) |
| 통계 기준일 범위 밖 등 신규 업무 오류 | 422 | `{"detail":{"code":"...","message":"..."}}` | **[제안]** 새 오류는 `CodedError` 만 쓴다 |

- 기존 문장형 3종을 `code` 로 바꾸는 것은 `api_error_contract.md` P7(PM 결정)에 묶여 있으므로 v0.2 에서 바꾸지 않는다. FE 는 상태 코드만 보므로 어느 쪽이든 깨지지 않는다. **[FE 동의]** 기존 형식 유지(PM 확정 대기). → §7 D1
- 기존 `offset` 의 형식 오류(음수 등)는 지금처럼 FastAPI 422 목록형이다. 목록형이 검색어를 되돌려 보내는 문제는 `q` 에만 해당하므로, `q` 를 추가할 때 이 라우터의 422 를 `invalid_query` 로 모은다. → §7 D1

### 2.3 페이지네이션

- **[현행 유지]** `offset`(정수, ≥0, 기본 0), 응답 `next_offset`(다음 쪽 시작 위치 또는 `null`).
- **[제안]** `limit`(정수, 1~50, 기본 50). 기본값이 현행과 같으므로 기존 FE 는 그대로 동작한다. 50 초과는 422 `invalid_query`.
- **[제안]** 정렬 동률 깨기: `ORDER BY created_at DESC, id DESC`. 지금은 `created_at` 만이라 같은 시각 가입자가 쪽 경계에서 겹치거나 빠질 수 있다.
- 알려진 한계: offset 방식이라 목록을 넘기는 사이 신규 가입이 생기면 한 명이 두 쪽에 나올 수 있다. **FE 는 이어 받을 때 `user_id` 로 중복을 제거한다(FE 11/11 구현 예정).** 서버는 중복을 막지 않는다. 커서 방식은 v0.2 범위 밖.

### 2.4 시각 · 날짜

- 응답 시각: **[현행 유지 · FE 동의]** 시간대 표기 없는 UTC 문자열(예 `"2026-11-14T03:12:45.123456"`). FE `parseServerTime` 과 맞는다. 신규 API · 신규 필드도 같은 형식이다.
- 날짜 입력 · 일 단위 집계: **[제안]** `Asia/Seoul` 날짜(`YYYY-MM-DD`). 서버가 KST 경계를 UTC naive 로 바꿔 조회한다.
  - `start_utc = datetime(d, 00:00) - 9h`, `end_utc = datetime(d+1, 00:00) - 9h`, 조건 `col >= start_utc AND col < end_utc`.
  - 달 경계도 같다(그 달 1일 00:00 KST ~ 다음 달 1일 00:00 KST). KST 는 일광절약시간이 없어 +9h 고정.
  - 예: KST 2026-11-14 하루 = UTC `2026-11-13 15:00:00` 이상 `2026-11-14 15:00:00` 미만.
  - DB 쪽 `CONVERT_TZ` · 세션 time_zone 에 기대지 않는다(RDS 시간대 테이블 의존 회피).

### 2.5 이메일 노출

| 위치 | 노출 | 근거 |
|---|---|---|
| 목록 `GET /admin/users` | **[제안 · FE 동의]** 서버가 가린 값(PM 확정 대기) | FE 가 이미 `*` 포함 값을 그대로 쓴다 → 호환 |
| 상세 `GET /admin/users/{id}` | 전체 이메일 **[현행 유지]** | 상세 열람은 `read_user` 로 대상별 기록이 남는다 |
| 감사 로그 | 이메일 없음 **[제안]** | 닉네임 · id 로만 보인다 |
| 통계 | 개인 식별값 없음 | 집계 숫자만 |

마스킹 규칙 **[제안]**(FE `maskEmail` 과 같은 결과): 로컬 부분이 3자 이상이면 앞 2자, 2자 이하면 앞 1자 + `***` + `@도메인`. `@` 가 없거나 맨 앞이면 `***`. 예 `minsoo@example.com → mi***@example.com`, `ab@example.org → a***@example.org`.

---

## 3. API별 계약

### 3.0 현행 응답과 제안 응답 한눈에 보기

아래 JSON 예시는 모두 **제안 응답**(현행 키 + 제안 키)이다. 지금 운영 중인 응답은 "현행 응답 키" 열뿐이다.

| API | 현행 응답 키(origin/main `4ea32212`) | 제안으로 추가 · 바뀌는 것 | 현재 DB 에 없는 것 |
|---|---|---|---|
| `GET /admin/users` | `users[]{user_id, email(전체), nickname, role, created_at, stage, save_updated_at}`, `next_offset` · Query `offset` 만 | 추가: `region` · `providers` · `last_login_at` · `last_session_started_at`. 변경: `email` 값을 서버에서 가림. Query 추가: `limit` · `q` · `role` · `provider` · `joined_from/to` | `last_login_at`(컬럼 · 마이그레이션 필요) |
| `GET /admin/users/{id}` | `{user, save, character, items}` | 추가: `user` 안의 위 네 필드, `account` 블록 | `user.last_login_at` |
| `GET /admin/stats/summary` | **없음(신규)** | 전체(DAU · MAU 는 PM 확정 정의 D8, 내부 계정 기본 제외 + `include_internal` 토글 D7) | — (기존 테이블로 계산. 로비 동시접속은 미연결) |
| `GET /admin/audit-logs` | **없음(신규)** | 전체(저장된 다섯 컬럼 + 닉네임 조인만) | — |
| `GET /me` | `{user_id, email, nickname, region, role}` | 추가: `created_at` · `providers` · `has_password` · `terms_version` | — |
| 오류 | 401 `Login required.` · 403 `Admin only.` · 404 `User not found.`(문장형) | 그대로. 신규 오류만 `CodedError`(`invalid_query`) | — |

### 3.1 `GET /api/v1/admin/users` — 회원 목록

**목적** 관리자가 회원을 훑어보고 상세로 들어갈 대상을 고른다. **권한** `current_admin`.

**Query**

| 이름 | 형식 | 기본 | 상태 | 설명 |
|---|---|---|---|---|
| `offset` | int ≥0 | 0 | 현행 | |
| `limit` | int 1~50 | 50 | 제안 | |
| `q` | string 1~64자, 앞뒤 공백 제거 | 없음 | 제안 · D2 **FE 동의**(PM 확정 대기) | 닉네임 부분 일치(대소문자 무시). `@` 가 있으면 **정규화한 이메일의 완전 일치**만(이메일 부분 검색 금지) |
| `role` | `user` \| `admin` | 없음 | 제안 | |
| `provider` | `local` \| `google` \| `naver` | 없음 | 제안 | 해당 연결이 하나라도 있는 사용자 |
| `joined_from` · `joined_to` | KST `YYYY-MM-DD` | 없음 | 제안 | 가입일 포함 범위(양 끝 포함, §2.4 변환). `from > to` 는 422 |

**응답 200** (제안 필드는 모두 *추가*만이다)

```json
{
  "users": [
    {
      "user_id": "6f1c2a7e-0b9d-4d55-9b0e-2f3c4a5b6c7d",
      "email": "mi***@example.com",
      "nickname": "가나다",
      "role": "user",
      "region": "naju",
      "created_at": "2026-11-13T05:21:07.412000",
      "providers": ["google", "local"],
      "last_login_at": null,
      "last_session_started_at": "2026-11-14T01:02:03.000000",
      "stage": "naju",
      "save_updated_at": "2026-11-14T01:40:11.000000"
    }
  ],
  "next_offset": 50
}
```

(`last_login_at` 이 `null` 인 예: 컬럼을 추가하기 전(1단계 — 지금부터 베타 이후 개발 전까지는 **항상** `null`)이거나, 추가 뒤 아직 로그인 기록이 없는 회원.)

| 필드 | 상태 | 출처 · 규칙 |
|---|---|---|
| `user_id, nickname, role, created_at` | 현행 | `app_users` |
| `email` | 현행 필드 · **값 변경 제안** | `app_users.email` 을 §2.5 규칙으로 가림. D3 |
| `stage, save_updated_at` | 현행 | `game_play_saves`(slot 0 outer join), 없으면 `null` |
| `region` | 제안 | `app_users.region`(nullable) |
| `providers` | 제안 · **FE 동의**(배열 유지) | `auth_identities.provider` 중복 제거 · 알파벳순. 연결 없으면 `[]`. 다중 연결을 그대로 보인다(대표 provider 를 고르지 않는다) |
| `last_login_at` | `string \| null` · D4 **[PM 확정: 두 필드 공존 · 베타 이후 개발]** | **실제 로그인 성공 시각.** `app_users.last_login_at`(**현재 DB 에 없음 — 컬럼 추가 · 마이그레이션 · 로그인 경로 변경 필요**, §6). **[제안]** 컬럼이 생기기 전 1단계에도 키는 두고 값은 `null` 로 보낸다(FE 표시 규칙이 그대로 동작). 무엇을 로그인으로 셀지는 후속 설계(§7 D4-a · D4-b) |
| `last_session_started_at` | `string \| null` · 제안 · D4 · **FE 확인** | `MAX(user_sessions.created_at)`. **추정값**: 로그인 · 가입 때만 생기므로 14일 쿠키로 계속 쓰는 사람은 갱신되지 않는다. 세션 기록이 없으면 `null`. 이름에 `login` 을 쓰지 않아 확정 `last_login_at` 과 섞이지 않게 한다 |

**최근 로그인 표시 규칙(FE, 11/11)**: `last_login_at` 이 있으면 그 값을 보인다 → 없으면 `last_session_started_at` 을 **'추정'** 표시와 함께 보인다 → 둘 다 없으면 '기록 없음'. 서버는 두 값을 섞거나 대신 채우지 않는다(각 필드는 자기 출처의 값만).

**[PM 확정 D4]** 지금 실제로 제공하는 최근 로그인 정보는 `last_session_started_at`(추정값)뿐이고 FE 는 '추정' 으로 표시한다. 두 필드가 함께 있는 구조는 유지하며, 초안대로 목록 · 상세 모두에 둔다.

- 정렬: `created_at DESC, id DESC`.
- 현행 쿼리의 `outerjoin(GamePlaySave)` 는 slot 을 거르지 않는다. 지금은 slot 0 만 쓰므로 문제가 없지만, 구현 때 `slot = 0` 조건을 명시해서 한 사용자가 두 줄로 나오지 않게 한다.
- `providers` · `last_session_started_at` 은 쪽에 들어온 user_id 들로 별도 쿼리 2개(GROUP BY)를 해서 붙인다. 목록 행 수를 바꾸지 않는다.

**오류** 401 · 403(현행), 422 `invalid_query`(제안).

**감사** **[현행 유지]** 한 번 부를 때마다 `action="list_users"`, `target_user_id=NULL`. 검색 · 필터 사용 여부와 검색어는 **기록하지 않는다**(컬럼 없음, 이메일 원문이 로그에 남지 않게). 검색을 따로 표시할지는 D5.

**FE 호환** 기존 필드 이름 · 형식 · 기본 50 · `next_offset` 이 그대로다. `email` 이 가려져 와도 `maskEmail` 이 그대로 둔다. 새 필드는 무시해도 된다.

**DB 변경** 1단계(지금 계약)는 기존 테이블로 된다(`last_login_at` 은 `null`). 2단계(베타 이후)에 **`app_users.last_login_at` 컬럼 추가 마이그레이션과 로그인 성공 처리 변경이 필요**하다(D4 · §6). 선택: `app_users(created_at, id)` 인덱스(§6).

### 3.2 `GET /api/v1/admin/users/{user_id}` — 회원 상세

**목적** 한 회원의 계정 · 진행 · 캐릭터 · 아이템을 본다(문의 대응 · 장애 조사). **권한** `current_admin`.

**Path** `user_id` — 36자 UUID 문자열. **[제안]** 형식이 다르면 DB 를 조회하지 않고 404(존재 여부를 형식으로 알리지 않음, 현행 404 와 같은 본문).

**응답 200** (`user` 안의 제안 필드와 `account` 블록은 추가만)

```json
{
  "user": {
    "user_id": "6f1c2a7e-0b9d-4d55-9b0e-2f3c4a5b6c7d",
    "email": "minsoo@example.com",
    "nickname": "가나다",
    "role": "user",
    "region": "naju",
    "created_at": "2026-11-13T05:21:07.412000",
    "providers": ["google", "local"],
    "last_login_at": "2026-11-14T01:02:00.000000",
    "last_session_started_at": "2026-11-14T01:02:03.000000",
    "stage": "naju",
    "save_updated_at": "2026-11-14T01:40:11.000000"
  },
  "account": {
    "identities": [
      { "provider": "google", "linked_at": "2026-11-13T05:21:07.412000" },
      { "provider": "local", "linked_at": "2026-11-13T05:25:00.000000" }
    ],
    "terms_version": "2026-11-01",
    "terms_accepted_at": "2026-11-13T05:21:07.412000",
    "privacy_accepted_at": "2026-11-13T05:21:07.412000",
    "age_confirmed_at": "2026-11-13T05:21:07.412000",
    "active_session_count": 1
  },
  "save": { "revision": 3, "schema_version": 1, "stage": "naju", "state": {}, "updated_at": "2026-11-14T01:40:11.000000" },
  "character": { "display_name": "가나다", "appearance": {}, "updated_at": "2026-11-13T05:30:00.000000" },
  "items": [
    { "item_id": "naju_badge", "kind": "badge", "name": "나주 배지", "quantity": 1, "source": "clear", "acquired_at": "2026-11-14T01:40:11.000000" }
  ]
}
```

(`user.last_login_at` 값은 **컬럼을 추가한 뒤의 예**다. 현재 DB 에는 이 컬럼이 없다 — §6.)

| 필드 | 상태 | 출처 · 규칙 |
|---|---|---|
| `user` | 현행 + 3.1 의 제안 필드(`last_login_at` · `last_session_started_at` 포함, 표시 규칙 3.1) | **email 은 전체**(현행). 상세는 대상별로 기록된다 |
| `account.identities[]` | 제안 · **FE 확인** | `auth_identities` 의 `provider`, `created_at`(→`linked_at`). **`provider_subject` · `password_hash` 는 절대 넣지 않는다** |
| `account.terms_* · privacy_accepted_at · age_confirmed_at` | 제안 · D6 **[PM 확정: 동의 기록 제공]** · FE 확인 | `app_users` 동의 기록(nullable; 소셜 가입은 약관 없이 생길 수 있음) |
| `account.active_session_count` | 제안 · D6 **[PM 확정: 유효 세션 수만]** · FE 확인 | `user_sessions` 중 `revoked_at IS NULL AND expires_at > now`. 세션 id · 토큰 · 해시는 내보내지 않는다 |
| 마지막 세션 시각 | D6 **[PM 확정]** | `user.last_session_started_at`(= `MAX(user_sessions.created_at)`, 세션 **시작** 시각). 세션별 마지막 활동 시각은 DB 에 없어 내지 않는다 |

**[PM 확정 D6]** 세션 정보는 **유효 세션 수와 마지막 세션 시각만** 준다. 세션 목록 · 세션 id · 세션 토큰 · `token_hash` · 쿠키 값 · 만료 시각 목록 등은 어떤 형태로도 내보내지 않는다.
| `save, character, items` | 현행 | 변경 없음 |

**오류** 401 · 403 · 404 `User not found.`(현행).

**감사** **[현행 유지]** `action="read_user"`, `target_user_id=<user_id>`. 404 일 때는 기록하지 않는다(현행 그대로).

**FE 호환** `user` · `save` · `character` · `items` 가 그대로다. `account` 는 새 블록이라 무시해도 된다.

**DB 변경** `user.last_login_at` 만 3.1 과 같은 컬럼 추가 · 마이그레이션이 필요하다. 나머지는 없음.

### 3.3 `GET /api/v1/admin/stats/summary` — 대시보드 요약 (신규)

**목적** 대시보드 · 회원 통계 첫 숫자. **권한** `current_admin`.

**Query** **[제안]**

| 이름 | 형식 | 기본 | 설명 |
|---|---|---|---|
| `date` | KST `YYYY-MM-DD` | 오늘 KST | 미래 날짜 · 400일 넘게 지난 날짜는 422 `invalid_query`. "이번 달" 은 `date` 가 속한 달의 1일부터 `date` 끝까지 |
| `include_internal` | `true` \| `false` | `false` | **[PM 확정 D7: 기본 제외 + 포함 토글]** · 파라미터 이름은 **제안**. `false` 면 관리자 · 테스트 계정을 회원 통계에서 뺀다 |

**응답 200** — 확정 지표와 추정 · 미연결 지표를 구조로 나눈다.

```json
{
  "generated_at": "2026-11-14T03:00:00.000000",
  "timezone": "Asia/Seoul",
  "date": "2026-11-14",
  "include_internal": false,
  "range_utc": {
    "day": ["2026-11-13T15:00:00", "2026-11-14T15:00:00"],
    "month": ["2026-10-31T15:00:00", "2026-11-14T15:00:00"],
    "last_30_days": ["2026-10-15T15:00:00", "2026-11-14T15:00:00"]
  },
  "excluded": {
    "admins": 3,
    "test_accounts": null
  },
  "members": {
    "total": 409,
    "signups_on_date": 57,
    "signups_in_month": 397
  },
  "activity": {
    "members_dau": 128,
    "members_mau": 352,
    "guests_dau": 61,
    "guests_mau": 240
  },
  "play_sessions": {
    "created_on_date": 233,
    "created_on_date_by_member": 140,
    "created_on_date_by_guest": 93
  },
  "estimated": {
    "active_players_last_5m": { "value": 8, "basis": "interaction_events" }
  },
  "unavailable": {
    "lobby_concurrent": "lobby_metrics_not_connected"
  }
}
```

(`excluded.test_accounts` 가 `null` 이면 테스트 계정을 가려낼 `is_test` 표시가 아직 없어 **테스트 계정을 빼지 못했다**는 뜻이다 — D7-a. 베타 이후 `is_test` 가 생기면 뺀 수가 들어간다. 응답 구조 · 키 이름은 제안 그대로다.)

| 지표 | 상태 | 출처 · 집계 기준 |
|---|---|---|
| `excluded.admins` | D7 **[PM 확정]** | `include_internal=false` 일 때 `role = 'admin'`(조회 시점)인 계정 수. `true` 면 0 |
| `excluded.test_accounts` | D7 · D7-a **[PM 방향: `is_test`]** | `include_internal=false` 일 때 `is_test = true` 인 계정 수. `is_test` 가 생기기 전(베타 이후 구현 전)에는 `null`(= 빼지 못함) |
| `members.total` | 확정 가능 · D7 **[PM 확정: 기본 제외]** | `COUNT(app_users)`(`date` 와 상관없이 지금 시점 누적)에서 **내부 계정**(아래 정의)을 뺀 값 |
| `members.signups_on_date` · `signups_in_month` | 확정 가능 · D7 제외 적용 | `app_users.created_at` 이 §2.4 범위 안, 내부 계정 제외 |
| `activity.members_dau` | **[PM 확정 D8]** | 아래 "DAU · MAU 정의" |
| `activity.members_mau` | **[PM 확정 D8]** | 아래 "DAU · MAU 정의" |
| `activity.guests_dau` · `guests_mau` | **[PM 확정: 게스트는 별도]** · 세는 단위는 **제안**(D8-a) | 같은 기간에 회원 소유가 아닌 `play_sessions` 를 만든 고유 `owner_anonymous_session_id` 수(브라우저 쿠키 단위 — 한 사람이 여러 번 셀 수 있다). 회원 수와 더하지 않는다 |
| `play_sessions.created_on_date[...]` | 확정 가능 · 회원 쪽은 D7 제외 적용 | `play_sessions.created_at` 범위 안. 회원 = `owner_user_id IS NOT NULL`, 게스트 = 그 외(`owner_anonymous_session_id`) |
| `estimated.active_players_last_5m` | **추정 · D8-b 미결** | `interaction_events.created_at >= now-5m` 기준(회원 `owner_user_id` · 게스트 `owner_anonymous_session_id`). PM 이 정의하지 않았다 |
| `lobby_concurrent` | **미연결** | 백엔드 DB 에 없음(입장권 JWT 만 발급, 저장 없음). 로비 서버 지표가 필요 · D9 |
| 스테이지 · 퍼즐별 통계 | **범위 밖** | v0.3 `GET /admin/stats/gameplay` 로 분리 · D10 |

- `unavailable` 값은 이유 code 다(`lobby_metrics_not_connected`). FE 는 "준비 중" 으로 보인다.
- 추정 지표를 확정 지표 키 안에 섞지 않는다. 이전 초안의 `estimated.active_players_on_date`(interaction 기준 추정)는 PM 이 DAU 를 정의했으므로 **뺐다**(서로 다른 "활성" 숫자가 둘 생기지 않게).
- 내부 계정 제외(D7)는 이 API 의 **회원 통계 전체**(`members` · `activity.members_*` · `play_sessions.created_on_date_by_member`)에 같은 규칙으로 적용한다(PM "기본 회원 통계에서 제외" 를 회원 통계 전체로 적용한 것 — 범위가 다르면 PM 확인).
- 탈퇴: 현재 탈퇴 기능 · 컬럼이 없어 탈퇴 회원은 0 이다. 탈퇴가 생기면 `total` 에서 빼는지와 가입 통계를 소급 수정하는지를 정한다(D11). 지금 응답에는 탈퇴 키를 두지 않는다.
- 성능: 베타 규모에서는 인덱스 없이도 충분하다. `interaction_events.created_at` 범위 조회가 느려지면 §6 의 인덱스를 추가한다. 캐시는 두지 않는다(초안).

**테스트 계정 식별(D7-a — PM 추가 답변 2026-11-11)**

현재 상태(origin/main `4ea32212`): `app_users` 에는 테스트 계정 표시가 없다(`role` 값은 `user` · `admin` 둘뿐, 계정 종류 컬럼 없음). `scripts/seed_test_account.py` 는 고정 이메일 · 닉네임 `TEST` 의 일반 `user` 계정을 만든다 — 닉네임 · 이메일은 바뀔 수 있어 판별 근거로 쓰지 않는다.

PM 이 정한 설계 방향:

| 시기 | 테스트 계정을 가려내는 방법 |
|---|---|
| **베타 통계**(11/13 베타 분석) | **PM 이 주는 회원 ID 목록**으로 뺀다. 이 API 가 아니라 운영 담당자가 돌리는 읽기 전용 SQL(PR #117 의 `@exclude_user_ids`)에서 쓴다. 이 API 에 회원 ID 목록 설정을 따로 두지는 않는다 |
| **베타 이후** | `app_users` 에 **`is_test` 표시를 추가**하고, 이 API 의 내부 계정 제외는 `is_test` 로 한다 |

- **`role` 과 `is_test` 는 독립적으로 관리한다.** 관리자이면서 테스트 계정인 경우도 허용한다(`role = 'admin'` 이고 `is_test = true`).
- **`is_test` 변경은 운영 서버 명령으로만 한다** — 관리자 권한을 주는 `scripts/set_user_role.py`(서버에서 `python -m scripts.set_user_role <이메일> admin` 으로 실행)와 같은 방식. 관리자 API 나 화면으로 바꾸는 경로는 만들지 않는다.
- **컬럼 추가와 명령 구현은 베타 이후**에 한다. 그 전까지 이 API 는 관리자만 빼고 `excluded.test_accounts` 는 `null` 이다.

**[설계안 — 확정 스키마 아님]** `app_users.is_test BOOLEAN NOT NULL DEFAULT FALSE`. 기존 계정은 기본값 `FALSE` 로 시작하는 안이다. 어떤 기존 계정을 테스트 계정으로 표시할지 · 언제 표시할지 등 마이그레이션 세부는 후속 결정(§7 D7-b · D7-c).

**내부 계정 정의와 제외 일관성(D7)**

- 내부 계정 = `role = 'admin'` **또는** `is_test = true`(`is_test` 가 생긴 뒤). 판정은 조회 시점 값이다.
- `include_internal=false` 이면 이 API 의 **회원 통계 전체**에서 같은 내부 계정 집합을 뺀다: `members.total` · `members.signups_*` · `activity.members_dau` · `activity.members_mau` · `play_sessions.created_on_date_by_member`. 지표마다 다른 기준을 쓰지 않는다.
- **이중 계산 주의:** 관리자이면서 테스트 계정인 사람은 `excluded.admins` 에도 `excluded.test_accounts` 에도 세어진다(각 칸은 "그 조건에 해당하는 수"). 그래서 **두 칸을 더하면 실제로 뺀 인원보다 클 수 있다.** 회원 수 등에서 빼는 것은 두 조건의 합집합(한 사람은 한 번)이다. FE 는 두 칸을 더해 "제외 인원" 으로 보이지 않는다. 합집합 인원을 따로 내는 키가 필요하면 응답 구조 제안을 바꿔야 하므로 그때 정한다(D7-d).
- 게스트 통계(`guests_*`)는 회원 계정이 아니므로 내부 계정 제외와 관계없다.

**DAU · MAU 정의(D8 — PM 확정 2026-11-11)**

이전 초안에서는 저장소에 정의 근거가 없어 미결이었다(관리자 FE 문구 "오늘 0시부터" · "최근 30일" 만 있었다). 미르님 직접 답변으로 아래처럼 정한다.

| 지표 | 정의 | 기간(KST → UTC naive, §2.4) |
|---|---|---|
| `members_dau` | 해당 KST 날짜에 **로그인 세션 또는 플레이 세션을 생성한** 고유 회원 수 | `[date 00:00 KST, date+1 00:00 KST)` = `[date−1 15:00 UTC, date 15:00 UTC)` |
| `members_mau` | 같은 기준으로 **최근 30일**(`date` 포함 30개 KST 날짜) 고유 회원 수 | `[date−29 00:00 KST, date+1 00:00 KST)` = `[date−30 15:00 UTC, date 15:00 UTC)` |

- 출처: 기간 안의 `user_sessions.app_user_id`(`user_sessions.created_at` 기준) ∪ 기간 안의 `play_sessions.owner_user_id`(`play_sessions.created_at` 기준, `owner_user_id IS NOT NULL`). 둘을 합친 뒤 **`app_user_id` 기준 중복 제거**(로그인도 하고 플레이도 한 회원은 한 번).
- 내부 계정: `include_internal=false`(기본)이면 D7 과 같은 규칙으로 뺀다.
- 게스트: 회원 숫자에 넣지 않고 `guests_*` 로 따로 낸다(세는 단위는 제안 · D8-a).
- 시각 변환: 저장값은 모두 UTC naive `DATETIME(6)` 이다. 서버가 KST 날짜를 UTC naive 경계로 바꿔 `col >= start AND col < end` 로 조회한다(DB 의 `CONVERT_TZ` 에 기대지 않는다). KST 는 일광절약시간이 없어 −9시간 고정.

**집계 한계(D8 — 보고서 · 화면 문구에 함께 적는다)**

- **세션을 새로 만들지 않은 방문은 세지 않는다.** 로그인 세션은 로그인 · 가입 때만 생기고(14일 쿠키로 계속 쓰면 새 행 없음), 플레이 세션은 새로 시작할 때만 생긴다(이어 하기는 기존 세션을 다시 쓴다). 그래서 "들어와서 이어서 플레이만 한 회원" 은 그날 DAU 에서 빠질 수 있다 — DAU 는 **하한값**이다.
- **게스트 → 회원 승계:** 승계하면 그 게스트의 플레이 세션 소유자가 회원으로 바뀐다(`owner_anonymous_session_id` 는 지워진다). 같은 날짜를 나중에 다시 조회하면 그 세션이 게스트에서 회원 쪽으로 옮겨 세어진다(과거 숫자가 조회 시점에 따라 달라질 수 있다).
- **소유권 기준은 조회 시점이다.** 관리자 여부(`role`)도 조회 시점 값이다. 나중에 관리자가 된 사람의 과거 활동은 기본 통계에서 빠진다.
- **중복 계정:** 같은 사람이 계정을 여러 개 쓰면 계정마다 센다(사람을 합칠 근거가 DB 에 없다). "한 번만" 은 같은 `app_user_id` 기준이다.
- **게스트 단위:** 게스트는 익명 세션(브라우저 쿠키) 단위라 한 사람이 기기 · 브라우저마다 따로 세어진다.
- 플레이 세션의 `owner_user_id` 는 회원 삭제 시 `NULL` 이 된다(FK `ON DELETE SET NULL`). 지금은 탈퇴 기능이 없어 영향이 없다(D11).

**PR #117(베타 퍼즐 통계 SQL)과의 역할 구분**

| | 이 API(`stats/summary`) | PR #117 `docs/naju/베타_퍼즐통계_*` |
|---|---|---|
| 목적 | 관리자 대시보드의 상시 운영 지표 | 베타 이후 P01 · P03 · P07 · P09 난이도 분석(1회성 분석) |
| 실행 | 관리자 API(앱 코드) | 운영 담당자가 승인된 환경에서 읽기 전용 SQL 실행 |
| "활성" 기준 | 로그인 세션 · 플레이 세션 **생성**(DAU · MAU) | 베타 코호트 세션 중 나주 **상호작용 이벤트**가 있는 세션(Q4 분모) |
| 제외 | D7(관리자 + 베타 이후 `is_test`, 토글) | 조회 시점 관리자 + **PM 이 주는 테스트 회원 ID 목록**(D7-a 베타 통계 방식) |

두 숫자는 정의가 달라 **서로 비교하거나 맞추지 않는다.** 이 계약은 PR #117 의 SQL · 정의를 바꾸지 않는다.

**오류** 401 · 403, 422 `invalid_query`.

**감사** **[제안]** `action="view_stats_summary"`, 대상 없음. 개인 식별값이 없지만 "열람은 기록" 원칙에 맞춘다(통계 조회를 별도 action 으로 남길지는 PM 미결 · D5-b — PM 이 정한 것은 감사 로그 조회 기록뿐이다). **[FE 동의]** 관리자 화면은 자동 새로고침을 두지 않는다. 나중에 도입하면 최소 60초 간격으로 한다(새로고침마다 감사 기록이 한 행씩 쌓이므로).

**FE 호환** 신규. `preview/types.ts` 의 목업 필드(`totalDelta`, `churnRate`, `visitors7d` 등)는 이 계약에 **없다** — 증감률 · 이탈률 · 7일 추이는 정의와 시계열 원천이 정해진 뒤에 추가한다(D12). **[FE 동의]** DB 근거가 없는 목업 지표는 계약에서 빼고, FE 는 그 자리를 '준비 중' 으로 표시한다. `unavailable` 의 이유 code(§3.3 응답)도 '준비 중' 으로 보인다.

**DB 변경** 필수 없음. 선택 인덱스(§6).

### 3.4 `GET /api/v1/admin/audit-logs` — 관리자 감사 기록 조회 (신규)

**목적** 누가 언제 어떤 회원 기록을 열람했는지 확인한다. **권한** `current_admin`(모든 관리자 · D13).

**Query** **[제안]**

| 이름 | 형식 | 기본 | 설명 |
|---|---|---|---|
| `offset` · `limit` | §2.3 | 0 · 50 | |
| `admin_user_id` | UUID | 없음 | 행위한 관리자 |
| `target_user_id` | UUID | 없음 | 대상 회원(기존 인덱스 사용) |
| `action` | 아래 목록 값 | 없음 | 모르는 값은 422 |
| `from` · `to` | KST `YYYY-MM-DD` | 최근 30일 | 양 끝 포함, 최대 92일 범위 |

**응답 200(v0.2)** — 저장된 다섯 컬럼과, 그 id 로 조인한 닉네임만 보인다. **IP · User-Agent · 요청 경로 · 검색어는 지금 테이블에 컬럼이 없으므로 응답에도 없다.** PM 은 IP · UA 를 기록하는 방향을 정했다(D15) — 컬럼이 생긴 뒤 응답에 넣을지 · 어떤 형태(가림 · 해시)로 넣을지는 D15-a 에서 함께 정한다.

```json
{
  "logs": [
    {
      "id": 1042,
      "created_at": "2026-11-14T02:10:00.123000",
      "action": "read_user",
      "admin": { "user_id": "0b5e...-admin", "nickname": "운영자" },
      "target": { "user_id": "6f1c...-user", "nickname": "가나다" }
    },
    {
      "id": 1041,
      "created_at": "2026-11-14T02:09:58.000000",
      "action": "list_users",
      "admin": { "user_id": "0b5e...-admin", "nickname": "운영자" },
      "target": null
    }
  ],
  "next_offset": null
}
```

- 정렬 `id DESC`(삽입 순서 = 시간 순서). `created_at` 동률 문제가 없다.
- `admin_user_id` · `target_user_id` 에 FK 가 없으므로 사용자가 사라진 경우 `nickname: null` 로 두고 `user_id` 는 그대로 보인다.
- 이메일은 넣지 않는다.

**action 값**

| 값 | 상태 | 기록 위치 |
|---|---|---|
| `list_users` | 현행 | 3.1 |
| `read_user` | 현행 | 3.2 |
| `view_stats_summary` | 제안(기록 여부 D5-b 미결) | 3.3 |
| `list_audit_logs` | **[PM 확정 D5: 감사 로그 조회도 기록]** · action 이름은 제안 | 3.4 |

목록에 없는 값이 DB 에 있으면(이후 버전에서 추가) 그대로 문자열로 내보낸다. FE 는 모르는 값을 원문 그대로 보인다.

**조회 행위 자체의 기록** **[PM 확정 D5]** 감사 로그를 조회하는 행위도 감사 로그에 남기고, 다른 열람과 구분되는 action 으로 남긴다. **[제안]** 이 API 를 부를 때마다 `action="list_audit_logs"`, `target_user_id` = 필터의 `target_user_id`(있으면) 또는 `NULL`. 기존 `_audit` 처럼 **조회 결과를 만든 뒤** 쓰면 방금 한 조회는 그 응답에 나오지 않고 다음 조회부터 보인다. 필터 값(날짜 · 관리자)은 저장하지 않는다(컬럼 없음).

**기록 실패 시 응답** **[미결 D5-a]** 현행 `list_users` · `read_user` 는 기록을 쓰다 실패하면 응답도 500 이 된다(`_audit` 가 조회 뒤 commit). 신규 API 에서 같은 방식(기록 없으면 응답도 없음)을 쓸지, 다른 방식을 쓸지는 **정하지 않았다.**

**보존 · 불변** 수정 · 삭제 API 를 만들지 않는다. v0.2 의 저장 필드는 현재 다섯 컬럼 그대로다. 보존 기간은 **1년(PM 확정 D14)**. 1년이 지난 기록을 어떻게 · 언제 · 누가 지울지(자동 삭제 방식, 일정, 수행 주체)는 **후속 결정**이며 이 계약에서 설계하지 않는다(§7 D14-a). 정해지기 전에는 아무것도 지우지 않는다.

**오류** 401 · 403, 422 `invalid_query`.

**FE 호환** 신규. FE 목업의 `level(INFO/WARN/ERROR)` · `ip` · 문장형 `target` 은 원천 데이터가 없어 계약에 넣지 않는다. 활동 로그 화면은 이 구조에 맞춰야 한다(D12). **[FE 동의]** 목업에만 있는 칸은 '준비 중' 으로 표시한다.

**DB 변경** v0.2 조회 API 자체는 필수 없음. 선택: `admin_audit_logs(created_at)` 또는 `(admin_user_id, id)` 인덱스(§6). **PM 이 IP · UA 기록 방향을 정했으므로(D15) 베타 이후 `admin_audit_logs` 컬럼 추가 마이그레이션이 필요하다** — 컬럼 형태 · 수집 지점 · 보안 · 개인정보 검토는 D15-a.

### 3.5 `GET /api/v1/me` — 내 정보

실제 경로는 **`GET /api/v1/me`** 다. `/api/v1/auth/me` 는 없고 만들지 않는다(같은 정보를 두 경로로 두지 않는다).

**목적** 웹 세션 복원 · 관리자 화면 진입 판정. **권한** `current_user`(로그인 사용자 누구나).

**Query** 없음.

**응답 200** — 기존 5개 그대로, 제안 필드는 추가만(D16).

```json
{
  "user_id": "6f1c2a7e-0b9d-4d55-9b0e-2f3c4a5b6c7d",
  "email": "minsoo@example.com",
  "nickname": "가나다",
  "region": "naju",
  "role": "user",
  "created_at": "2026-11-13T05:21:07.412000",
  "providers": ["google", "local"],
  "has_password": true,
  "terms_version": "2026-11-01"
}
```

| 필드 | 타입 | 상태 | 출처 |
|---|---|---|---|
| `user_id, email, nickname, region, role` | 현행 그대로 | 현행 | `app_users` |
| `created_at` | `string` — 시간대 표기 없는 UTC(§2.4), null 아님 | 제안 · D16 **FE 확인** | `app_users.created_at`(`DATETIME(6)` NOT NULL) |
| `providers` | `string[]` — 값은 `"local"` · `"google"` · `"naver"`, 중복 제거 · 알파벳순, 연결 없으면 `[]` | 제안 · D16 **FE 확인** | `auth_identities.provider`(3.1 과 같은 규칙) |
| `has_password` | `boolean` | 제안 · D16 **FE 확인** | `local` 연결이 있고 `password_hash IS NOT NULL` 이면 `true`. **해시 값 자체는 내보내지 않는다.** 비밀번호 변경 화면 표시용 |
| `terms_version` | `string \| null` — 소셜 가입처럼 약관 기록이 없으면 `null` | 제안 · D16 **FE 확인** | `app_users.terms_version`(`VARCHAR(32)` NULL 허용). 재동의 안내용 |

타입 근거: v0.2 초안 원문은 네 필드의 이름과 예시 값만 적었다. 위 타입은 예시 값과 실제 모델 컬럼(NULL 허용 여부 · provider 값)으로 정했다. FE 는 네 필드를 확인했고(11/11), PM 확정 전에는 구현하지 않는다.

- 본인 정보이므로 이메일 전체를 그대로 준다(현행).
- 최근 로그인 시각은 넣지 않는다(확정값이 없다).
- 감사 기록 없음(관리자 열람이 아님, 현행).

**오류** 401 `Login required.`(현행).

**FE 호환** 웹사이트는 4개 필드, 관리자는 `role` 만 읽는다. 추가만 하므로 깨지지 않는다.

**DB 변경** 없음.

---

## 4. 데이터 출처 요약

| 값 | 테이블 · 컬럼 | 확정/추정 |
|---|---|---|
| 회원 기본 | `app_users.(id, email, nickname, role, region, created_at, terms_*, privacy_accepted_at, age_confirmed_at)` | 확정 |
| 로그인 방식 | `auth_identities.provider` (다중) | 확정 |
| 비밀번호 보유 | `auth_identities.password_hash IS NOT NULL` (값은 비공개) | 확정 |
| 최근 로그인 | `app_users.last_login_at` — **아직 없음(마이그레이션 필요)** | 확정(컬럼 추가 · 갱신 이후부터) |
| 최근 세션 시작 | `MAX(user_sessions.created_at)` | **추정**(최근 로그인 아님) |
| 유효 세션 수 | `user_sessions` `revoked_at IS NULL AND expires_at > now` | 확정 |
| 진행 단계 | `game_play_saves.(stage, updated_at)` slot 0 | 확정 |
| 플레이 세션 생성 | `play_sessions.(created_at, owner_user_id, owner_anonymous_session_id)` | 확정 |
| 회원 DAU · MAU | `user_sessions(app_user_id, created_at)` ∪ `play_sessions(owner_user_id, created_at)`, `app_user_id` 중복 제거 | 확정 정의(D8) · 세션을 새로 만들지 않은 방문은 빠지는 하한값 |
| 게스트 DAU · MAU | `play_sessions(owner_anonymous_session_id, created_at)`(회원 소유가 아닌 세션) | 단위는 제안(D8-a) |
| 최근 5분 활성 | `interaction_events.created_at` ⋈ `play_sessions` 소유자 | **추정**(D8-b) |
| 관리자 열람 | `admin_audit_logs` 5컬럼(IP · UA 컬럼은 D15 이후) | 확정 |
| 로비 동시접속 | 없음 | 미연결 |

---

## 5. 보안 및 감사 기록 정책

1. **비공개 유지:** `password_hash`, 세션 토큰 · `token_hash`, `guest_sessions.token_hash`, `provider_subject`, `login_throttles` 키는 어떤 관리자 · `/me` 응답에도 넣지 않는다. 구현 때 응답 스키마에 이 이름의 필드가 없음을 테스트로 고정한다.
2. **권한:** `current_admin` 그대로. 쿼리 · 본문의 역할 값을 믿지 않는다. 관리자 2단계 인증과 NPC `VerifiedAdmin` 은 이 계약에서 정하지 않는다(기존 미결).
3. **최소 노출:** 목록은 이메일을 가리고, 상세만 전체를 보인다. 이메일 검색은 완전 일치만 허용한다(부분 검색으로 이메일을 알아내지 못하게).
4. **감사 기록 원칙:** 관리자 GET 한 번에 감사 기록 한 행(§3 표). **감사 로그 조회도 기록한다(PM 확정 D5).** 현행 두 API(`list_users` · `read_user`)는 기록에 실패하면 응답도 실패한다. 신규 API 의 실패 처리는 **미결**(D5-a).
5. **감사 로그 내용 한계:** v0.2 에서는 현재 컬럼 밖의 값(IP · UA · 검색어 · 필터)을 저장하지도 응답하지도 않는다. **PM 은 IP · UA 를 기록하는 방향을 정했다(D15)** — 베타 이후 신규 컬럼과 함께 수집 지점(프록시 뒤 실제 클라이언트 IP 를 어디서 읽을지), 저장 형태(원문 · 해시 · 앞자리), 접근 권한, 개인정보 처리 근거와 1년 보존(D14) 적용을 검토해 정한다(D15-a). 그 전에는 수집하지 않는다.
6. **입력 제한:** `q` 64자, 날짜 범위 상한, `limit` ≤50. 422 응답은 입력값을 되돌려 보내지 않는다.
7. **캐시:** `Cache-Control: no-store` 유지.
8. **요청 제한:** 관리자 경로에는 현재 요청 제한이 없고 v0.2 에서도 두지 않는다. 관리자 전용 요청 제한은 베타 이후 설계한다(PM 확정 D17 · D17-a). 그동안 모든 관리자 API 는 매 요청 `current_admin` 역할 검증을 유지한다.
9. **세션 정보 노출(PM 확정 D6):** 회원 상세에는 유효 세션 수와 마지막 세션 시각만 준다. 세션 토큰 · `token_hash` · 쿠키 값 · 세션 id 는 어떤 응답에도 넣지 않는다.

---

## 6. DB 변경 필요 여부

**v0.2(1단계) 마이그레이션: 없다.** 지금 계약(`last_login_at` 은 `null`, IP · UA 미수집, DAU · MAU 는 기존 세션 테이블)은 모두 기존 테이블 · 컬럼으로 만들 수 있다.

**베타 이후(2단계) 필요한 DB 변경 — PM 결정으로 생긴 것:**
1. `app_users.last_login_at` 컬럼(D4) + 로그인 성공 처리 변경
2. `admin_audit_logs` IP · User-Agent 컬럼(D15, 형태는 D15-a)
3. `app_users.is_test` 표시(D7-a PM 방향, 설계안 `BOOLEAN NOT NULL DEFAULT FALSE` — 확정 스키마 아님) + 운영 서버 변경 명령
4. 방식에 따라: 감사 로그 1년 보존 처리(D14-a)

이 문서 작업에서는 마이그레이션을 쓰지 않았다.

`last_login_at` 마이그레이션 메모(설계 확정 아님):

- `app_users.last_login_at DATETIME(6) NULL` 추가 — 기존 행은 `NULL` 로 시작한다(과거 로그인을 채울지는 D4-c).
- 갱신 지점은 로그인 성공 처리(현재 `auth.py` `_establish_login` 이 이메일 로그인 · 가입 · 소셜 로그인 · 소셜 가입 완료에서 공통으로 불린다). 어느 경로에서 갱신할지는 D4-a, 세션 쿠키 복원(`current_user`)을 로그인으로 볼지는 D4-b.
- 로그인 경로를 건드리므로 로그인 · 가입 · 게스트 승계 회귀 테스트가 필요하다.

선택(성능 · 결정 결과에 따라):

| 변경 | 이유 | 시점 |
|---|---|---|
| `app_users(created_at, id)` 인덱스 | 목록 정렬 · 가입 집계 | 회원 수가 늘면 |
| `admin_audit_logs(created_at)` 또는 `(admin_user_id, id)` | 감사 로그 기간 · 관리자 필터 | 기록이 수만 행을 넘으면 |
| `interaction_events(created_at)` | 최근 5분 활성 추정 범위 조회 | 통계 응답이 느려지면 |
| `play_sessions(created_at)` | 일별 플레이 세션 집계 · DAU · MAU | 같음 |
| `user_sessions(created_at)` | DAU · MAU(로그인 세션 생성 기준, D8) | 같음 |
| **`app_users.last_login_at` 컬럼 + 로그인 성공 때 갱신** | 실제 "최근 로그인"(D4 **PM 확정: 두 필드 공존 · 베타 이후 개발**) | **베타 이후 필요.** 갱신 규칙(D4-a · D4-b) · 과거 기록(D4-c) 설계 후. 로그인 경로 변경이므로 회귀 테스트 필요 |
| **`admin_audit_logs` 에 IP · User-Agent 컬럼** | 감사 로그에 IP · UA 기록(D15 **PM 확정 방향**) | **베타 이후 필요.** 컬럼 형태(원문 · 해시 · 앞자리), 수집 지점(신뢰 프록시 뒤의 클라이언트 IP), 보안 · 개인정보 검토(D15-a) 후 |
| 감사 로그 1년 보존 처리 | 보존 기간 1년(D14 **PM 확정**) | 자동 삭제 방식 · 일정 · 수행 주체가 정해진 뒤(D14-a). 방식에 따라 마이그레이션이 없을 수도 있다 |
| **`app_users.is_test` 컬럼**(설계안 `BOOLEAN NOT NULL DEFAULT FALSE`, 확정 스키마 아님) + `set_user_role.py` 와 같은 운영 서버 변경 명령 | 테스트 계정 기본 제외(D7 · D7-a **PM 방향**). `role` 과 독립 | **베타 이후 필요.** 컬럼 정의 확정 · 기존 계정 표시 방법(D7-b · D7-c) · 명령 세부(D7-d) 후 |
| 탈퇴 · 정지 컬럼(`deleted_at`, `suspended_until` 등) | 회원 탭 · 통계 (D11) | 계정 관리 API 와 함께, 이 계약 범위 밖 |

선택 인덱스는 모두 추가만이라 기존 API 동작에 영향이 없다. 운영 적용은 PM 승인 뒤 일반 배포 절차를 따른다.

---

## 7. PM·FE 와 확정해야 할 결정사항

상태:
- **PM 확정** = 미르님 2026-11-11 직접 답변(§0.1). 세부 설계가 남은 부분은 하위 번호(D4-a 등)로 따로 둔다.
- **FE 동의 · PM 확정 대기** = FE 검토 완료(§0), PM 이 직접 언급하지 않아 자동 확정하지 않음.
- **미결** = 아직 정하지 않음.

이전 초안의 "PM 잠정 방향(해랑님 전달)" 표기는 이번 직접 답변으로 대체했다. 이 표의 미결 · 확정 대기 항목은 확정 전에는 구현하지 않는다.

| # | 결정 | 계약 반영 | 상대 | 상태 |
|---|---|---|---|---|
| D1 | 기존 관리자 문장형 오류(401 · 403 · 404)를 `code` 로 바꿀지 (`api_error_contract.md` P7 과 같이) | 바꾸지 않음. 새 오류만 `CodedError` | PM | FE 동의 · PM 확정 대기 |
| D2 | 회원 검색 허용 범위 | 닉네임 부분 일치 + 이메일 완전 일치 | PM · FE | FE 동의 · PM 확정 대기 |
| D3 | 목록 이메일을 서버에서 가릴지 | 서버에서 가림(FE 이미 대응) | PM · FE | FE 동의 · PM 확정 대기 |
| D4 | 최근 로그인 | 지금은 `last_session_started_at`(추정) 제공 · FE '추정' 표시, `last_login_at` 은 베타 이후 개발, 두 필드 공존 · 목록 · 상세 모두(§3.1) | PM | **PM 확정** |
| D4-a | `last_login_at` 갱신 경로: 이메일 · OAuth(Google · Naver) 로그인 성공 모두인지, 가입 · 소셜 가입 완료 포함인지 | — | PM · BE | 미결(후속 설계) |
| D4-b | 세션 쿠키 복원(로그인 없이 기존 쿠키로 들어온 것)을 로그인으로 볼지 | — | PM · BE | 미결(후속 설계) |
| D4-c | 기존 회원의 과거 로그인 기록 처리(`NULL` 로 시작 / `user_sessions` 로 채우기 등) | — | PM · BE | 미결(후속 설계) |
| D5 | 감사 로그 조회 기록 | 감사 로그 조회도 기록, 별도 action(제안 `list_audit_logs`)(§3.4) | PM | **PM 확정** |
| D5-a | 감사 기록 실패 시 신규 API 의 응답 처리(현행 두 API 는 응답도 실패) | — | PM · BE | 미결 |
| D5-b | 통계 조회 · 검색을 별도 action 으로 기록할지, 검색어 미기록 유지 | 제안: `view_stats_summary`, 검색어 미기록 | PM | 미결 |
| D5(새로고침) | 관리자 화면 자동 새로고침 | 없음, 도입 시 최소 60초 | FE | FE 동의 · PM 확정 대기 |
| D6 | 회원 상세의 동의 기록 · 세션 정보 | 동의 기록 제공, 세션은 유효 세션 수 · 마지막 세션 시각만, 토큰 · 쿠키 비밀값 절대 비노출(§3.2) | PM | **PM 확정** |
| D7 | 회원 통계에서 내부 계정 제외 | 관리자 · 테스트 계정 기본 제외 + 포함 토글(제안 이름 `include_internal`)(§3.3) | PM | **PM 확정**(파라미터 이름은 제안) |
| D7-a | 테스트 계정 식별 방식 | 베타 통계: PM 제공 회원 ID 목록(운영 SQL). 베타 이후: `app_users.is_test`, `role` 과 독립(관리자 겸 테스트 허용), 변경은 운영 서버 명령으로만. 구현 전까지 `excluded.test_accounts: null`(§3.3) | PM | **PM 확정(설계 방향)** · 컬럼 · 명령 구현은 베타 이후 |
| D7-b | `is_test` 컬럼 정의 확정(설계안 `BOOLEAN NOT NULL DEFAULT FALSE`) | 설계안만 제시 | PM · BE | 미결(베타 이후) |
| D7-c | 기존 계정 중 테스트 계정 표시 방법 · 시점(베타 ID 목록을 옮길지 등 마이그레이션 세부) | — | PM · BE | 미결(후속 결정) |
| D7-d | 운영 서버 명령의 세부(대상 지정 방식 · 기록 남기기 등), 합집합 제외 인원 키가 필요한지 | 제안: `set_user_role.py` 와 같은 방식 | PM · BE | 미결(베타 이후) |
| D8 | DAU · MAU 정의 | KST 날짜 기준 로그인 세션 또는 플레이 세션 생성 고유 회원, MAU 최근 30일, 게스트 별도, D7 제외 적용(§3.3) | PM | **PM 확정** |
| D8-a | 게스트 통계를 세는 단위 | 제안: 익명 세션(`owner_anonymous_session_id`) 단위 | PM | 미결 |
| D8-b | "최근 5분 활성" 정의 | 추정(interaction 기준) 그대로 | PM | 미결 |
| D9 | 로비 동시접속 지표 수집 방식 | 미연결 표시 | PM · 로비 담당(미르님) | 미결 |
| D10 | 스테이지 · 퍼즐 통계 지표 정의(진입 · 완료 · 시도 · 오답 · 힌트) | v0.3 로 분리(PR #117 은 별도 1회성 분석) | PM · 콘텐츠 | 미결 |
| D11 | 탈퇴 회원 처리(소프트 · 하드 삭제, 통계 반영) | 계정 관리 API 와 함께 결정 | PM | 미결 |
| D12 | 목업에만 있는 지표(증감률 · 이탈률 · 7일 추이 · 로그 레벨 · IP)를 버릴지, 원천을 만들지 | 계약에서 제외, FE '준비 중' 표시 | PM · FE | FE 동의 · PM 확정 대기 |
| D13 | 감사 로그를 모든 관리자가 볼지, 상위 역할만 볼지(현재 역할은 `user` · `admin` 둘뿐) | 모든 관리자 | PM | 미결 |
| D14 | 감사 로그 보존 기간 | 1년(§3.4) | PM | **PM 확정** |
| D14-a | 1년이 지난 감사 로그의 자동 삭제 방식 · 일정 · 수행 주체 | 설계 없음 — 정해지기 전에는 지우지 않음 | PM · 운영 | 미결(후속 결정) |
| D15 | 감사 로그에 IP · User-Agent 기록 | 기록하는 방향, v0.2 응답에는 없음(컬럼 없음)(§3.4) | PM | **PM 확정(방향)** |
| D15-a | IP · UA 컬럼 형태 · 수집 지점 · 보안 · 개인정보 검토 · 응답 노출 방식 | — | PM · BE | 미결(베타 이후) |
| D16 | `/me` 추가 필드(`created_at: string` · `providers: string[]` · `has_password: boolean` · `terms_version: string \| null`, §3.5) | 4개 추가 | FE | FE 확인 · PM 확정 대기 |
| D17 | 관리자 경로 요청 제한 | v0.2 에는 없음, 모든 관리자 API 에서 `current_admin` 역할 검증 유지(§2.1) | PM | **PM 확정** |
| D17-a | 관리자 전용 요청 제한 설계 | — | PM · BE | 미결(베타 이후) |

범위 밖으로 남겨 둔 기존 미결: 관리자 2단계 인증, NPC 승인용 `VerifiedAdmin` 생성 경로(`npc_general_pack.md` §4).

---

## 8. 베타 이후 권장 구현 순서

각 단계는 PR 하나씩, MySQL 테스트를 붙인다. 앞 단계가 뒤 단계의 공통 부품(KST 범위 함수 · 마스킹 · `invalid_query`)을 만든다.

1. **공통 부품 + `GET /me` 필드 추가** — KST 날짜 → UTC 범위 함수, 이메일 마스킹 함수, `providers` 조회 함수. 위험 가장 낮음(추가만). 테스트: KST 경계(15:00 UTC 전후), 다중 provider, 응답에 해시 없음.
2. **`GET /admin/users` 보강** — `limit`, 정렬 동률, `slot = 0` 명시, 추가 필드, 목록 마스킹, 이어서 검색 · 필터(D2 확정 후). 테스트: 기존 필드 회귀, 50/51명 경계 `next_offset`, 마스킹 규칙(FE 결과와 동일), 이메일 부분 검색 불가.
3. **`GET /admin/users/{id}` 보강** — `account` 블록. 테스트: `provider_subject` · `password_hash` · 토큰 미노출, 404 감사 미기록.
4. **`GET /admin/audit-logs`** — 조회 · 필터 · 자기 기록(D5). 테스트: 방금 조회가 다음 조회에 보임, 사라진 사용자 `nickname: null`, v0.2 응답에 IP · UA 키 없음. 기록 실패 처리는 D5-a 결정 후.
5. **`GET /admin/stats/summary`** — 회원 통계 · DAU · MAU(D8) · 내부 계정 제외와 `include_internal`(D7). 테스트: KST 하루 · 30일 경계(15:00 UTC 전후), 로그인 세션과 플레이 세션 양쪽에 있는 회원 1회 집계, 게스트 분리, 관리자 제외 · 포함 토글, 모든 회원 지표에 같은 제외 집합 적용, 미래 날짜 422.
6. **베타 이후 후속** — `last_login_at` 마이그레이션 + 로그인 성공 처리 갱신(D4-a~c 설계 후, 로그인 회귀 테스트 필수), 감사 로그 IP · UA 컬럼(D15-a 검토 후), `app_users.is_test` 컬럼 + 운영 서버 변경 명령(D7-b~d 후, 테스트: 관리자 겸 테스트 계정이 회원 수에서 한 번만 빠짐 · `excluded` 두 칸 각각의 수), 감사 로그 1년 보존 처리(D14-a), 관리자 요청 제한(D17-a), 선택 인덱스, v0.3 게임 통계.

FE 는 1 · 2 가 머지된 뒤 회원 목록 검색 · 통계 카드를, 4 · 5 가 머지된 뒤 활동 로그 · 대시보드를 연다. main 머지는 백엔드 자동 배포를 시작하므로 머지 시점은 PM 이 정한다. **이 계약 문서 자체도 `backend/docs/` 아래라, 문서만 바뀐 PR 이라도 main 에 머지되면 `deploy-backend.yml` 의 `backend/**` 조건에 걸린다**(main `4ea32212` 기준).
