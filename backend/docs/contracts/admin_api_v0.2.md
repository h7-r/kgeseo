# 관리자 API v0.2 계약 초안 (2026-11-11, FE 최종 확인 · PM 잠정 방향 반영 · PM 최종 결정 대기)

- 상태: **초안.** FE(해랑님) 검토 · 최종 확인과, 해랑님을 통해 전달받은 PM 잠정 방향을 반영했다(§0). **PM 최종 결정 전에는 확정 계약이 아니다.** 코드 · DB · 운영 설정은 바꾸지 않았다. 11/13 베타가 끝난 뒤 구현한다.
- 기준: origin/main `3f1f6a4e` 의 실제 모델과 라우터. `4ea32212` 에서 다시 확인 — `admin.py` · `me.py` · `schemas/account_data.py` · `user_session.py` · 관련 모델 · `website/src/admin/api` · `lib/format.ts` · `tests/test_account_data_api.py` 변경 없음.
- 범위: `GET /api/v1/admin/users`, `GET /api/v1/admin/users/{user_id}`, `GET /api/v1/admin/stats/summary`, `GET /api/v1/admin/audit-logs`, `GET /api/v1/me`.
- 범위 밖: NPC 승인용 `VerifiedAdmin`, 관리자 2단계 인증(`npc_general_pack.md` §4 · `npc_approval_persistence.md` 의 미결 그대로), 1:1 문의 API, 탈퇴 · 정지, 로비 동시접속 수집.

표기: **[현행]** 지금 코드가 이미 하는 것 · **[제안]** 이 초안이 정하자고 하는 것 · **[FE 동의]** FE 가 검토해 동의한 것(PM 최종 결정 대기) · **[PM 잠정]** 해랑님을 통해 전달받은 PM 방향(PM 최종 승인 아님, 베타 이후 확정 필요) · **[결정 필요]** PM·FE 확정 전에는 구현하지 않는 것(§7 번호).

---

## 0. FE 검토 반영 (2026-11-11, 해랑님)

FE 동의는 "FE 화면 · 구현 쪽에서 이 안으로 문제없다"는 뜻이다. **정책 결정(개인정보 노출 · 감사 기록 · 오류 형식 통일 여부)은 PM 이 최종 확정한다.** PM 확정 전에는 구현하지 않는다.

| 항목 | FE 검토 결과 | 반영 위치 | 상태 |
|---|---|---|---|
| D1 | 기존 관리자 API 401 · 403 · 404 오류 형식 유지 | §2.2 | FE 동의 · PM 확정 대기 |
| D2 | 닉네임 부분 일치, 이메일 완전 일치 검색 | §3.1 `q` | FE 동의 · PM 확정 대기 |
| D3 | 회원 목록 이메일 서버 마스킹 | §2.5 · §3.1 | FE 동의 · PM 확정 대기 |
| D5(새로고침 부분) | 관리자 화면 자동 새로고침 없음. 추후 도입하면 최소 60초 간격 | §3.3 감사 | FE 동의. **감사 action 을 따로 둘지 · 검색어 미기록은 PM 미결 그대로** |
| D12 | DB 근거가 없는 목업 지표는 계약에서 빼고, FE 는 '준비 중' 으로 표시 | §3.3 · §3.4 FE 호환 | FE 동의 · PM 확정 대기(원천을 나중에 만들지는 PM) |
| D16 | `/me` 추가 필드 네 가지 확인 | §3.5 | FE 확인 · PM 확정 대기 |
| 시각 | 응답 시각은 지금처럼 시간대 표기 없는 UTC 문자열 | §2.4 | FE 동의(현행 유지) |
| providers | 복수 로그인 수단을 표현하는 배열 유지 | §3.1 · §3.5 | FE 동의 |
| 목록 이어 받기 | FE 가 이어 받을 때 중복 `user_id` 를 제거할 예정 | §2.3 | FE 구현 예정 |
| 추가 필드 | "추가로 필요한 필드 없음" = **현재 초안의 필드로 충분하다**는 뜻으로 확인(11/11 추가 회신) | — | FE 확인 완료 |
| 초안 필드 유지 | 회원 목록 `region` · `providers` · `last_session_started_at`, 회원 상세 `account`(`identities` · 동의 기록 · `active_session_count`), `/me` `created_at` · `providers` · `has_password` · `terms_version` 을 초안 그대로 유지 | §3.1 · §3.2 · §3.5 | FE 확인 완료 · PM 확정 대기 |
| 최근 로그인 표시 | `last_login_at` 이 있으면 그 값, 없으면 `last_session_started_at` 을 '추정' 으로, 둘 다 없으면 '기록 없음' | §3.1 | FE 표시 규칙(11/11) |

### 0.1 PM 잠정 방향 (해랑님 전달, 2026-11-11)

아래는 **해랑님을 통해 전달받은 PM 방향이며 PM 최종 승인이 아니다.** 베타 이후 PM 이 직접 확정해야 구현한다.

| 항목 | 전달받은 방향 | 반영 위치 | 남은 결정 |
|---|---|---|---|
| D4 | 실제 로그인 시각을 우선하고, 없으면 추정값을 표시 | §3.1 `last_login_at` · §6 | 갱신 시점 · 세션 복원 처리 · 과거 기록 · 노출 범위(§7 D4-a~d). `last_login_at` 은 **DB 컬럼 · 마이그레이션 필요** |
| D7 | 회원 수에서 관리자 · 테스트 계정 제외 | §3.3 | 관리자는 `role='admin'` 으로 뺄 수 있다. **테스트 계정은 자동 판별 수단이 없다** → 식별 방법 미결(§7 D7-a) |
| D8 | DAU 는 이전에 정한 정의를 사용 | §3.3 | **저장소에서 정의 근거를 찾지 못했다**(§3.3 참고) → 미결 유지 |
| D14 | 감사 로그 보존 기간 1년 | §3.4 | 삭제 방법 · 시점은 설계하지 않았다(§7 D14-a) |

PM 미결 그대로: D6 · D9 · D10 · D11 · D13 · D15 · D17, D5 의 감사 기록 방식, D4 · D7 · D14 의 세부(§0.1), D8 전체(§7).

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

- **[현행 유지]** 모든 `/admin/*` 는 `Depends(current_admin)`. 역할 판정을 요청 값으로 받지 않는다.
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
| `GET /admin/stats/summary` | **없음(신규)** | 전체 | — (DAU · MAU 정의는 미결, 로비 동시접속은 미연결) |
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

(`last_login_at` 이 `null` 인 예: 컬럼을 추가하기 전이거나, 추가 뒤 아직 로그인 기록이 없는 회원.)

| 필드 | 상태 | 출처 · 규칙 |
|---|---|---|
| `user_id, nickname, role, created_at` | 현행 | `app_users` |
| `email` | 현행 필드 · **값 변경 제안** | `app_users.email` 을 §2.5 규칙으로 가림. D3 |
| `stage, save_updated_at` | 현행 | `game_play_saves`(slot 0 outer join), 없으면 `null` |
| `region` | 제안 | `app_users.region`(nullable) |
| `providers` | 제안 · **FE 동의**(배열 유지) | `auth_identities.provider` 중복 제거 · 알파벳순. 연결 없으면 `[]`. 다중 연결을 그대로 보인다(대표 provider 를 고르지 않는다) |
| `last_login_at` | `string \| null` · 제안 · D4 **[PM 잠정]** | **실제 로그인 성공 시각.** `app_users.last_login_at`(**현재 DB 에 없음 — 컬럼 추가 · 마이그레이션 필요**, §6). 무엇을 로그인으로 셀지는 §7 D4-a · D4-b |
| `last_session_started_at` | `string \| null` · 제안 · D4 · **FE 확인** | `MAX(user_sessions.created_at)`. **추정값**: 로그인 · 가입 때만 생기므로 14일 쿠키로 계속 쓰는 사람은 갱신되지 않는다. 세션 기록이 없으면 `null`. 이름에 `login` 을 쓰지 않아 확정 `last_login_at` 과 섞이지 않게 한다 |

**최근 로그인 표시 규칙(FE, 11/11)**: `last_login_at` 이 있으면 그 값을 보인다 → 없으면 `last_session_started_at` 을 **'추정'** 표시와 함께 보인다 → 둘 다 없으면 '기록 없음'. 서버는 두 값을 섞거나 대신 채우지 않는다(각 필드는 자기 출처의 값만).

두 필드를 목록 · 상세 모두에 둘지는 PM · BE 구현 전 결정(§7 D4-d). 초안은 목록 · 상세 모두에 둔다.

- 정렬: `created_at DESC, id DESC`.
- 현행 쿼리의 `outerjoin(GamePlaySave)` 는 slot 을 거르지 않는다. 지금은 slot 0 만 쓰므로 문제가 없지만, 구현 때 `slot = 0` 조건을 명시해서 한 사용자가 두 줄로 나오지 않게 한다.
- `providers` · `last_session_started_at` 은 쪽에 들어온 user_id 들로 별도 쿼리 2개(GROUP BY)를 해서 붙인다. 목록 행 수를 바꾸지 않는다.

**오류** 401 · 403(현행), 422 `invalid_query`(제안).

**감사** **[현행 유지]** 한 번 부를 때마다 `action="list_users"`, `target_user_id=NULL`. 검색 · 필터 사용 여부와 검색어는 **기록하지 않는다**(컬럼 없음, 이메일 원문이 로그에 남지 않게). 검색을 따로 표시할지는 D5.

**FE 호환** 기존 필드 이름 · 형식 · 기본 50 · `next_offset` 이 그대로다. `email` 이 가려져 와도 `maskEmail` 이 그대로 둔다. 새 필드는 무시해도 된다.

**DB 변경** `last_login_at` 을 넣으려면 **`app_users.last_login_at` 컬럼 추가 마이그레이션이 필요**하다(D4 확정 후). 그 밖의 필드는 기존 테이블로 된다. 선택: `app_users(created_at, id)` 인덱스(§6).

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
| `account.terms_* · privacy_accepted_at · age_confirmed_at` | 제안 · D6 · **FE 확인**(노출 여부는 PM 미결) | `app_users` 동의 기록(nullable; 소셜 가입은 약관 없이 생길 수 있음) |
| `account.active_session_count` | 제안 · D6 · **FE 확인**(노출 여부는 PM 미결) | `user_sessions` 중 `revoked_at IS NULL AND expires_at > now`. 세션 id · 토큰 · 해시는 내보내지 않는다 |
| `save, character, items` | 현행 | 변경 없음 |

**오류** 401 · 403 · 404 `User not found.`(현행).

**감사** **[현행 유지]** `action="read_user"`, `target_user_id=<user_id>`. 404 일 때는 기록하지 않는다(현행 그대로).

**FE 호환** `user` · `save` · `character` · `items` 가 그대로다. `account` 는 새 블록이라 무시해도 된다.

**DB 변경** `user.last_login_at` 만 3.1 과 같은 컬럼 추가 · 마이그레이션이 필요하다. 나머지는 없음.

### 3.3 `GET /api/v1/admin/stats/summary` — 대시보드 요약 (신규)

**목적** 대시보드 · 회원 통계 첫 숫자. **권한** `current_admin`.

**Query** **[제안]** `date`(KST `YYYY-MM-DD`, 기본 오늘 KST). 미래 날짜 · 400일 넘게 지난 날짜는 422 `invalid_query`. "이번 달" 은 `date` 가 속한 달의 1일부터 `date` 끝까지다.

**응답 200** — 확정 지표와 추정 · 미연결 지표를 구조로 나눈다.

```json
{
  "generated_at": "2026-11-14T03:00:00.000000",
  "timezone": "Asia/Seoul",
  "date": "2026-11-14",
  "range_utc": {
    "day": ["2026-11-13T15:00:00", "2026-11-14T15:00:00"],
    "month": ["2026-10-31T15:00:00", "2026-11-14T15:00:00"]
  },
  "members": {
    "total": 412,
    "admins": 3,
    "signups_on_date": 57,
    "signups_in_month": 398
  },
  "play_sessions": {
    "created_on_date": 233,
    "created_on_date_by_member": 140,
    "created_on_date_by_guest": 93
  },
  "estimated": {
    "active_players_on_date": { "value": 121, "basis": "interaction_events" },
    "active_players_last_5m": { "value": 8, "basis": "interaction_events" }
  },
  "unavailable": {
    "lobby_concurrent": "lobby_metrics_not_connected",
    "mau": "definition_pending"
  }
}
```

| 지표 | 상태 | 출처 · 집계 기준 |
|---|---|---|
| `members.total` | 확정 가능 · D7 **[PM 잠정]** | `COUNT(app_users)` (`date` 와 상관없이 지금 시점 누적). **PM 잠정 방향: 관리자 · 테스트 계정 제외.** 관리자는 조회 시점 `role = 'admin'` 으로 뺄 수 있다(`admins` 는 뺀 수를 따로 준다). **테스트 계정은 자동으로 가려낼 수 없다** — 아래 "테스트 계정 식별" 참고 |
| `members.signups_on_date` · `signups_in_month` | 확정 가능 | `app_users.created_at` 이 §2.4 범위 안 |
| `play_sessions.created_on_date[...]` | 확정 가능 | `play_sessions.created_at` 범위 안. 회원 = `owner_user_id IS NOT NULL`, 게스트 = 그 외(`owner_anonymous_session_id`) |
| `estimated.active_players_on_date` | **추정 · D8** | 범위 안 `interaction_events` 가 있는 `play_sessions` 의 주체 수(회원은 `owner_user_id`, 게스트는 `owner_anonymous_session_id` 로 세고 더함). 웹만 보고 플레이하지 않은 사람은 빠진다 |
| `estimated.active_players_last_5m` | **추정 · D8** | `interaction_events.created_at >= now-5m` 기준, 같은 주체 규칙 |
| DAU · MAU 명칭 | **결정 필요 · D8** | 정의가 정해지기 전에는 `dau`/`mau` 키를 쓰지 않는다. MAU 는 정의 전까지 `unavailable`. PM 잠정 방향은 "이전에 정한 DAU 정의 사용"이지만 그 정의를 저장소에서 찾지 못했다(아래) |
| `lobby_concurrent` | **미연결** | 백엔드 DB 에 없음(입장권 JWT 만 발급, 저장 없음). 로비 서버 지표가 필요 · D9 |
| 스테이지 · 퍼즐별 통계 | **범위 밖** | v0.3 `GET /admin/stats/gameplay` 로 분리 · D10 |

- `unavailable` 값은 이유 code 다(`lobby_metrics_not_connected`, `definition_pending`). FE 는 "준비 중" 으로 보인다.
- 추정 지표를 확정 지표 키 안에 섞지 않는다. 정의가 확정되면 `estimated` 에서 확정 블록으로 옮기고 버전을 올린다.
- 탈퇴: 현재 탈퇴 기능 · 컬럼이 없어 탈퇴 회원은 0 이다. 탈퇴가 생기면 `total` 에서 빼는지와 가입 통계를 소급 수정하는지를 정한다(D11). 지금 응답에는 탈퇴 키를 두지 않는다.
- 성능: 베타 규모에서는 인덱스 없이도 충분하다. `interaction_events.created_at` 범위 조회가 느려지면 §6 의 인덱스를 추가한다. 캐시는 두지 않는다(초안).

**테스트 계정 식별(D7 PM 잠정 방향 관련 — 4ea32212 기준 확인)**

- `app_users` 에는 테스트 계정 표시가 없다(`role` 값은 `user` · `admin` 둘뿐이고, 그 밖의 계정 종류 컬럼 없음).
- `scripts/seed_test_account.py` 는 고정 이메일 · 닉네임 `TEST` 의 **일반 `user`** 계정을 만든다. 닉네임 · 이메일로 가려내는 것은 사람이 바꿀 수 있어 판별 근거로 쓰지 않는다.
- 따라서 테스트 계정 제외는 **별도 정책이 정해져야** 구현할 수 있다(§7 D7-a). 후보: (1) 운영 담당자가 관리하는 회원 ID 제외 목록(설정값 또는 별도 테이블), (2) 계정 종류 컬럼 · 역할 추가(마이그레이션 필요). 초안은 어느 것도 정하지 않는다.
- 같은 제외를 가입 통계(`signups_*`) · 회원 플레이 세션 수에도 적용할지 함께 정한다.

**DAU 기존 정의 확인 결과(D8)**

- PM 잠정 방향은 "이전에 정한 DAU 정의 사용"이다. origin/main `4ea32212` 의 문서 · 코드 · 계약(`.md` · `.ts` · `.tsx` · `.py` · `.json` · `.txt`)에서 `DAU` · `MAU` · 활성 사용자 정의를 찾았으나 **정의 문서는 없다.**
- 있는 것은 관리자 FE 화면 문구뿐이다: 대시보드 · 트래픽 "오늘 DAU — 오늘 0시부터", "MAU — 최근 30일", 회원 관리 "활성 — 최근 30일 접속"(`website/src/admin/pages/*`). 이는 **집계 구간의 단서**일 뿐, 무엇을 활동으로 셀지 · 게스트를 넣을지 · 기준 시간대를 정하지 않는다.
- 그래서 D8 은 **미결로 유지**한다. PM 이 이전 정의의 출처(회의록 등)를 주면 이 절에 옮겨 적고 `estimated` 블록에서 확정 블록으로 옮긴다.

**오류** 401 · 403, 422 `invalid_query`.

**감사** **[제안]** `action="view_stats_summary"`, 대상 없음. 개인 식별값이 없지만 "열람은 기록" 원칙에 맞춘다(별도 action 으로 둘지는 PM 미결 · D5). **[FE 동의]** 관리자 화면은 자동 새로고침을 두지 않는다. 나중에 도입하면 최소 60초 간격으로 한다(새로고침마다 감사 기록이 한 행씩 쌓이므로).

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

**응답 200** — 저장된 다섯 컬럼과, 그 id 로 조인한 닉네임만 보인다. **IP · User-Agent · 요청 경로 · 검색어는 저장하지 않으므로 응답에도 없다.**

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
| `view_stats_summary` | 제안 | 3.3 |
| `list_audit_logs` | 제안 | 3.4 |

목록에 없는 값이 DB 에 있으면(이후 버전에서 추가) 그대로 문자열로 내보낸다. FE 는 모르는 값을 원문 그대로 보인다.

**조회 행위 자체의 기록** **[제안]** 이 API 를 부를 때마다 `action="list_audit_logs"`, `target_user_id` = 필터의 `target_user_id`(있으면) 또는 `NULL`. 기존 `_audit` 처럼 **조회 결과를 만든 뒤** 쓰므로 방금 한 조회는 그 응답에 나오지 않고 다음 조회부터 보인다. 필터 값(날짜 · 관리자)은 저장하지 않는다(컬럼 없음).

**보존 · 불변** 수정 · 삭제 API 를 만들지 않는다. 저장 필드는 현재 다섯 컬럼 그대로다. 보존 기간은 **PM 잠정 방향 1년**(D14, PM 최종 승인 아님). 1년이 지난 기록을 어떻게 · 언제 지울지(자동 삭제 작업 여부, 실행 주체, 삭제 전 보관 등)는 **설계하지 않았고 정하지 않는다**(§7 D14-a). 정해지기 전에는 아무것도 지우지 않는다.

**오류** 401 · 403, 422 `invalid_query`.

**FE 호환** 신규. FE 목업의 `level(INFO/WARN/ERROR)` · `ip` · 문장형 `target` 은 원천 데이터가 없어 계약에 넣지 않는다. 활동 로그 화면은 이 구조에 맞춰야 한다(D12). **[FE 동의]** 목업에만 있는 칸은 '준비 중' 으로 표시한다.

**DB 변경** 필수 없음. 선택: `admin_audit_logs(created_at)` 또는 `(admin_user_id, id)` 인덱스(§6). IP · UA 등을 저장하기로 하면 컬럼 추가 마이그레이션(D15).

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
| 활동 주체 | `interaction_events.created_at` ⋈ `play_sessions` 소유자 | **추정** |
| 관리자 열람 | `admin_audit_logs` 5컬럼 | 확정 |
| 로비 동시접속 | 없음 | 미연결 |

---

## 5. 보안 및 감사 기록 정책

1. **비공개 유지:** `password_hash`, 세션 토큰 · `token_hash`, `guest_sessions.token_hash`, `provider_subject`, `login_throttles` 키는 어떤 관리자 · `/me` 응답에도 넣지 않는다. 구현 때 응답 스키마에 이 이름의 필드가 없음을 테스트로 고정한다.
2. **권한:** `current_admin` 그대로. 쿼리 · 본문의 역할 값을 믿지 않는다. 관리자 2단계 인증과 NPC `VerifiedAdmin` 은 이 계약에서 정하지 않는다(기존 미결).
3. **최소 노출:** 목록은 이메일을 가리고, 상세만 전체를 보인다. 이메일 검색은 완전 일치만 허용한다(부분 검색으로 이메일을 알아내지 못하게).
4. **감사 기록 원칙:** 관리자 GET 한 번에 감사 기록 한 행(§3 표). 기록에 실패하면 응답도 실패한다(현행 방식 유지 — 기록 없는 열람을 만들지 않는다).
5. **감사 로그 내용 한계:** 현재 컬럼 밖의 값(IP · UA · 검색어 · 필터)은 저장하지도 응답하지도 않는다. 필요하면 D15 로 컬럼을 추가하되, IP 를 저장한다면 원문 대신 해시 또는 앞자리만 저장하고 보존 기간을 함께 정한다.
6. **입력 제한:** `q` 64자, 날짜 범위 상한, `limit` ≤50. 422 응답은 입력값을 되돌려 보내지 않는다.
7. **캐시:** `Cache-Control: no-store` 유지.
8. **요청 제한:** 관리자 경로에는 현재 요청 제한이 없다. 관리자 수가 적으므로 v0.2 에서도 두지 않는다(D17).

---

## 6. DB 변경 필요 여부

**v0.2 마이그레이션:** `last_login_at` 을 빼면 위 계약은 모두 기존 테이블 · 컬럼으로 만들 수 있다. **`last_login_at` 을 넣으려면(D4 PM 잠정 방향) 마이그레이션 1건이 필요하다** — 아래 표의 `app_users.last_login_at`. 이 문서 작업에서는 마이그레이션을 쓰지 않았다.

`last_login_at` 마이그레이션 메모(설계 확정 아님):

- `app_users.last_login_at DATETIME(6) NULL` 추가 — 기존 행은 `NULL` 로 시작한다(과거 로그인을 채울지는 D4-c).
- 갱신 지점은 로그인 성공 처리(현재 `auth.py` `_establish_login` 이 이메일 로그인 · 가입 · 소셜 로그인 · 소셜 가입 완료에서 공통으로 불린다). 어느 경로에서 갱신할지는 D4-a, 세션 쿠키 복원(`current_user`)을 로그인으로 볼지는 D4-b.
- 로그인 경로를 건드리므로 로그인 · 가입 · 게스트 승계 회귀 테스트가 필요하다.

선택(성능 · 결정 결과에 따라):

| 변경 | 이유 | 시점 |
|---|---|---|
| `app_users(created_at, id)` 인덱스 | 목록 정렬 · 가입 집계 | 회원 수가 늘면 |
| `admin_audit_logs(created_at)` 또는 `(admin_user_id, id)` | 감사 로그 기간 · 관리자 필터 | 기록이 수만 행을 넘으면 |
| `interaction_events(created_at)` | 활성 주체 추정 범위 조회 | 통계 응답이 느려지면 |
| `play_sessions(created_at)` | 일별 플레이 세션 집계 | 같음 |
| **`app_users.last_login_at` 컬럼 + 로그인 성공 때 갱신** | 확정 "최근 로그인" (D4 **PM 잠정: 실제 로그인 시각 우선**) | D4 최종 확정 · D4-a~c 결정 후. 로그인 경로 변경이므로 회귀 테스트 필요 |
| (D14 결정 시) 감사 로그 보존 처리 | 보존 기간 1년(PM 잠정) | 삭제 방식 · 실행 주체가 정해진 뒤(D14-a). 지금은 설계 없음 |
| (D7-a 결정 시) 테스트 계정 표시 컬럼 또는 제외 목록 테이블 | 회원 수에서 테스트 계정 제외(PM 잠정) | 식별 방법이 정해진 뒤. 설정값 목록이면 마이그레이션 없음 |
| `admin_audit_logs` 에 `ip_hash` · `user_agent` · `detail_json` | 감사 정밀도 (D15) | 결정 시 |
| 탈퇴 · 정지 컬럼(`deleted_at`, `suspended_until` 등) | 회원 탭 · 통계 (D11) | 계정 관리 API 와 함께, 이 계약 범위 밖 |

선택 인덱스는 모두 추가만이라 기존 API 동작에 영향이 없다. 운영 적용은 PM 승인 뒤 일반 배포 절차를 따른다.

---

## 7. PM·FE 와 확정해야 할 결정사항

상태: **FE 동의** = FE 검토 완료(11/11, §0), PM 최종 결정 대기 · **PM 잠정 방향** = 해랑님을 통해 전달받은 PM 방향(§0.1), PM 최종 승인 아님 · **PM 미결** = 아직 아무도 확정하지 않음. 이 표의 어떤 항목도 PM 확정 전에는 구현하지 않는다.

| # | 결정 | 초안 기본안 | 상대 | 상태 |
|---|---|---|---|---|
| D1 | 기존 관리자 문장형 오류(401 · 403 · 404)를 `code` 로 바꿀지 (`api_error_contract.md` P7 과 같이) | 바꾸지 않음. 새 오류만 `CodedError` | PM | FE 동의(기존 형식 유지) · PM 확정 대기 |
| D2 | 회원 검색 허용 범위 | 닉네임 부분 일치 + 이메일 완전 일치 | PM · FE | FE 동의 · PM 확정 대기 |
| D3 | 목록 이메일을 서버에서 가릴지 | 서버에서 가림(FE 이미 대응) | PM · FE | FE 동의 · PM 확정 대기 |
| D4 | "최근 로그인"을 추정값(`last_session_started_at`)으로 둘지, 컬럼을 추가해 확정값을 둘지 | 두 필드 모두 두고 FE 가 `last_login_at` 우선 · 없으면 추정 표시(§3.1) | PM | **PM 잠정 방향**(해랑님 전달): 실제 로그인 시각 우선, 없으면 추정값 · 베타 이후 최종 확정 필요 |
| D4-a | `last_login_at` 을 이메일 로그인 · OAuth(Google · Naver) 로그인 성공 모두에서 갱신할지(가입 · 소셜 가입 완료 포함 여부) | — | PM · BE | PM 미결 |
| D4-b | 세션 쿠키 복원(로그인 없이 기존 쿠키로 들어온 것)을 로그인으로 볼지 | — | PM · BE | PM 미결 |
| D4-c | 기존 회원의 과거 로그인 기록 처리(`NULL` 로 시작 / `user_sessions` 로 채우기 등) | — | PM · BE | PM 미결 |
| D4-d | 회원 목록과 상세에 두 필드를 모두 노출할지 | 초안은 둘 다 | PM | PM 미결 |
| D5 | 검색 · 통계 · 감사 로그 조회를 별도 action 으로 기록할지, 자동 새로고침 간격 | 별도 action, 검색어 미기록, 새로고침 ≥60초 | PM · FE | 새로고침: FE 동의(자동 새로고침 없음, 도입 시 ≥60초). 감사 action · 검색어 기록: **PM 미결** |
| D6 | 상세에 동의 기록 · 유효 세션 수를 보일지 | 보임 | PM | FE 확인(필드 유지) · 노출 정책은 PM 미결 |
| D7 | 회원 수에서 관리자 · 테스트 계정(`seed_test_account.py`) 제외 여부 | 관리자 · 테스트 계정 제외, `admins` 따로 | PM | **PM 잠정 방향**(해랑님 전달): 둘 다 제외 · 베타 이후 최종 확정 필요 |
| D7-a | 테스트 계정 식별 방법(회원 ID 제외 목록 · 계정 종류 컬럼 등). 현재 자동 판별 수단 없음(§3.3) | — | PM · BE | PM 미결 |
| D8 | DAU · MAU · "최근 5분 활성"의 정의(회원만/게스트 포함, 무엇을 활동으로 볼지) | interaction 기준 추정, `estimated` 블록 | PM | PM 잠정 방향은 "이전 정의 사용"이나 **저장소에 정의 근거 없음 → PM 미결 유지**(§3.3) |
| D9 | 로비 동시접속 지표 수집 방식 | 미연결 표시 | PM · 로비 담당(미르님) | PM 미결 |
| D10 | 스테이지 · 퍼즐 통계 지표 정의(진입 · 완료 · 시도 · 오답 · 힌트) | v0.3 로 분리 | PM · 콘텐츠 | PM 미결 |
| D11 | 탈퇴 회원 처리(소프트 · 하드 삭제, 통계 반영) | 계정 관리 API 와 함께 결정 | PM | PM 미결 |
| D12 | 목업에만 있는 지표(증감률 · 이탈률 · 7일 추이 · 로그 레벨 · IP)를 버릴지, 원천을 만들지 | 계약에서 제외, FE '준비 중' 표시 | PM · FE | FE 동의(제외 · '준비 중') · 원천을 나중에 만들지는 PM 확정 대기 |
| D13 | 감사 로그를 모든 관리자가 볼지, 상위 역할만 볼지(현재 역할은 `user` · `admin` 둘뿐) | 모든 관리자 | PM | PM 미결 |
| D14 | 감사 로그 보존 기간 | 1년 | PM | **PM 잠정 방향**(해랑님 전달): 1년 · 베타 이후 최종 확정 필요 |
| D14-a | 1년이 지난 감사 로그를 지우는 방법 · 시점 · 실행 주체(자동 작업을 둘지 포함) | 설계 없음 — 정해지기 전에는 지우지 않음 | PM · 운영 | PM 미결 |
| D15 | 감사 로그에 IP · UA · 상세를 저장할지 | 저장 안 함 | PM | PM 미결 |
| D16 | `/me` 추가 필드(`created_at: string` · `providers: string[]` · `has_password: boolean` · `terms_version: string \| null`, §3.5) | 4개 추가 | FE | FE 확인 · PM 확정 대기 |
| D17 | 관리자 경로 요청 제한 | 두지 않음 | PM | PM 미결 |

범위 밖으로 남겨 둔 기존 미결: 관리자 2단계 인증, NPC 승인용 `VerifiedAdmin` 생성 경로(`npc_general_pack.md` §4).

---

## 8. 베타 이후 권장 구현 순서

각 단계는 PR 하나씩, MySQL 테스트를 붙인다. 앞 단계가 뒤 단계의 공통 부품(KST 범위 함수 · 마스킹 · `invalid_query`)을 만든다.

1. **공통 부품 + `GET /me` 필드 추가** — KST 날짜 → UTC 범위 함수, 이메일 마스킹 함수, `providers` 조회 함수. 위험 가장 낮음(추가만). 테스트: KST 경계(15:00 UTC 전후), 다중 provider, 응답에 해시 없음.
2. **`GET /admin/users` 보강** — `limit`, 정렬 동률, `slot = 0` 명시, 추가 필드, 목록 마스킹, 이어서 검색 · 필터(D2 확정 후). 테스트: 기존 필드 회귀, 50/51명 경계 `next_offset`, 마스킹 규칙(FE 결과와 동일), 이메일 부분 검색 불가.
3. **`GET /admin/users/{id}` 보강** — `account` 블록. 테스트: `provider_subject` · `password_hash` · 토큰 미노출, 404 감사 미기록.
4. **`GET /admin/audit-logs`** — 조회 · 필터 · 자기 기록. 테스트: 방금 조회가 다음 조회에 보임, 사라진 사용자 `nickname: null`, IP · UA 키 없음.
5. **`GET /admin/stats/summary`** — 확정 지표 먼저, 추정 지표는 D8 확정 후. 테스트: KST 하루 · 달 경계, 회원/게스트 구분, 미래 날짜 422.
6. (결정 시) `last_login_at` 마이그레이션 + 로그인 성공 처리 갱신(D4 최종 확정 · D4-a~c 후, 로그인 회귀 테스트 필수), 선택 인덱스 · 감사 컬럼, 테스트 계정 식별(D7-a), 감사 로그 보존 처리(D14-a), v0.3 게임 통계.

FE 는 1 · 2 가 머지된 뒤 회원 목록 검색 · 통계 카드를, 4 · 5 가 머지된 뒤 활동 로그 · 대시보드를 연다. main 머지는 백엔드 자동 배포를 시작하므로 머지 시점은 PM 이 정한다. **이 계약 문서 자체도 `backend/docs/` 아래라, 문서만 바뀐 PR 이라도 main 에 머지되면 `deploy-backend.yml` 의 `backend/**` 조건에 걸린다**(main `4ea32212` 기준).
