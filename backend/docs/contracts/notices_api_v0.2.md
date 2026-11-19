# 공지사항 API v0.2 (11/16 세진 — 구현 기준 문서)

> **확정 계약 문서가 저장소에 없어**, 11/16 작업 지시의 규칙으로 구현하고 지시에 없던 세부는 기존 관리자 API 관례로 정했다.
> 그렇게 정한 곳은 각 절에 **[확정 필요]** 로 표시했다(§8 모음). PM · FE 확인 뒤 이 문서를 확정본으로 바꾼다.

마이그레이션 `734021834040` (← `63566bb6005b` 감사 기록 확장, #163). 새 표 `notices` 하나만 만든다.

## 1. 표 `notices`

| 열 | 형 | NULL | 비고 |
|---|---|---|---|
| `id` | CHAR(36) PK | 아니오 | UUID 표준 표기(소문자) |
| `category` | VARCHAR(16) | 아니오 | `maintenance` · `event` · `update` · `info` |
| `title` | VARCHAR(200) | 아니오 | 1~200자(앞뒤 공백 제거) |
| `body` | MEDIUMTEXT | 아니오 | 일반 텍스트 1~20,000자. utf8mb4 최대 80,000바이트라 TEXT(65,535) 대신 MEDIUMTEXT |
| `is_pinned` | TINYINT(1) | 아니오 | 기본 0 |
| `published_at` | DATETIME(6) | 예 | UTC naive. NULL = 초안 |
| `created_by` | CHAR(36) FK → `app_users.id` | 예 | ON DELETE SET NULL |
| `created_at` · `updated_at` | DATETIME(6) | 아니오 | UTC naive |
| `deleted_at` | DATETIME(6) | 예 | 소프트 삭제. 복구 없음 |

색인: `ix_notices_public(deleted_at, published_at)` · `ix_notices_created_by(created_by)`.

## 2. 상태(서버 계산, 저장하지 않음)

`now` = 서버 UTC 시각.

| 상태 | 조건 |
|---|---|
| `draft` | `published_at` 없음 |
| `scheduled` | `published_at > now` |
| `published` | `published_at <= now` |

- 삭제(`deleted_at` 있음)된 공지는 어떤 상태로도 나오지 않는다 — 공개 · 관리자 목록에서 빠지고 상세 · 수정 · 삭제는 404.
- 예약 공지는 별도 작업 없이 시각이 지나는 순간부터 게시다(공개 응답 캐시 60초만큼 늦게 보일 수 있다).

## 3. 공개 API (인증 없음 · 감사 기록 없음)

### `GET /api/v1/notices`

쿼리: `page`(1~10000, 기본 1) · `page_size`(1~50, 기본 **6**) · `category`(없으면 전체). 그 밖의 값은 422 `invalid_query`.

```json
{
  "items": [
    {"id": "…", "category": "maintenance", "title": "…", "is_pinned": true, "published_at": "2026-11-16T03:00:00"}
  ],
  "page": 1,
  "page_size": 6,
  "total": 8,
  "total_pages": 2
}
```

- 게시된 것만(삭제 안 됨 · `published_at <= now`).
- 정렬: **고정 먼저(전체 순서의 맨 앞 — 1쪽부터 고정이 모두 나온 뒤 일반)** → 최근 게시 먼저 → id. **[확정 필요]**
- 쪽이 범위를 넘으면 `items: []`(200).
- 성공 `Cache-Control: public, max-age=60`, 오류 `no-store`.
- 감싸개(`data` · `success` 등) 없이 위 객체 그대로. 쪽 정보를 함께 주려고 배열이 아닌 객체다. **[확정 필요]**

### `GET /api/v1/notices/{notice_id}`

목록 항목 + `body` · `updated_at`. 없음 · 초안 · 예약 · 삭제는 모두 같은 404 `Notice not found.`(있는지 알리지 않는다). 캐시 규칙은 목록과 같다.

## 4. 관리자 API (`current_admin` · 응답 `Cache-Control: no-store`)

기존 관리자 API 규칙 그대로: 로그인 없음 401 `Login required.`, 관리자 아님 403 `Admin only.`, 쓰기는 Origin 검사 403 `Origin not allowed.`,
쿼리 값 오류 422 `invalid_query`, 본문 검증 오류는 FastAPI 기본 422 형식(입력 값은 되돌려 보내지 않는 기존 처리 그대로).

| 메서드 · 경로 | 내용 | 감사 기록 |
|---|---|---|
| `GET /api/v1/admin/notices` | 목록(삭제 제외, 최근 작성 먼저). `offset` · `limit`(1~50, 기본 50) · `status`(draft · scheduled · published) · `category`. 응답 `{items, next_offset}` | 없음 |
| `POST /api/v1/admin/notices` | 작성 → 201 + 상세 | `create_notice` |
| `GET /api/v1/admin/notices/{id}` | 상세(초안 · 예약 포함, 본문 포함) | 없음 |
| `PATCH /api/v1/admin/notices/{id}` | 보낸 필드만 수정 → 200 + 상세 | `update_notice` |
| `DELETE /api/v1/admin/notices/{id}` | 소프트 삭제 → 204 | `delete_notice` |

관리자 항목: `id · category · title · is_pinned · status · published_at(null 가능) · created_by({user_id, nickname} | null) · created_at · updated_at`, 상세는 `+ body`.
목록 · 상세 조회는 기록하지 않는다 — 개인정보가 보이지 않는 조회는 남기지 않는 기존 기준(콘텐츠 · 설정 읽기와 같음).

### 요청 본문

```json
{"category": "update", "title": "…", "body": "…", "is_pinned": false, "published_at": "2026-11-20T00:00:00Z"}
```

- `published_at` 은 **timezone 필수**: `Z` · `+09:00` 등. 없으면 422(`type: timezone_aware`). 서버가 UTC naive 로 저장 · 응답한다.
  생략 · `null` = 초안, 미래 = 예약, 지금 · 과거 = 바로 게시(과거 날짜로 소급 게시 가능).
- `status` 는 받지 않는다(서버 계산). 모르는 필드는 422.
- PATCH: 보낸 필드만 바꾼다. `published_at: null` = 초안으로 내림. `category` · `title` · `body` · `is_pinned` 에 `null` 은 422. 빈 본문 `{}` 은 422 `invalid_query`.
- 메서드는 기존 문의 수정과 같은 `PATCH`. 운영 웹(`www`)은 API 를 **다른 출처(`https://api.k-escape.com`)** 로 부른다(웹 CSP
  `connect-src` · 운영 인계 문서). 그래서 브라우저가 PATCH 앞에 CORS 사전 요청을 보내는데, 지금까지 `allow_methods` 에 PATCH 가 없어
  사전 요청이 400 `Disallowed CORS method` 로 막혔다(문의 상태 변경도 같다). **이 PR 에서 `allow_methods` 에 PATCH 를 더했다.**
  허용 출처(`settings.cors_origins`, 운영은 HTTPS 정확 origin 만)는 그대로다 — 목록 밖 출처는 PATCH 사전 요청도 거절된다.

## 5. 감사 기록

`_audit(db, admin, action, None, target_type="notice", target_id=<공지 UUID>)` — `target_user_id` 는 None(회원 개인정보가 아니다).
IP · User-Agent 는 관리자 라우터 공통 의존성이 자동으로 채운다(#163). `AUDIT_ACTIONS` 에 `create_notice` · `update_notice` · `delete_notice`
를 더해 `/admin/audit-logs?action=` 필터로 거를 수 있다.

## 6. 옛 공지 이전 (`scripts/import_legacy_notices.py`)

웹 `website/src/data/support.ts` 의 `NOTICES` 9건은 **분류 · 제목 · 날짜만 있고 본문이 없다**. 본문을 만들어 넣지 않는다.

```
python -m scripts.import_legacy_notices                                     # 확인만(DB 접속 없음)
python -m scripts.import_legacy_notices --bodies bodies.json                # 사람이 쓴 본문 파일을 붙여 확인
python -m scripts.import_legacy_notices --bodies bodies.json --execute --confirm <DB 이름>   # 등록
```

- 지금 원본으로는 **등록 0 · 제외 9(본문 없음)**.
- 본문 파일: `{"<legacy_key>": "본문"}` — `legacy_key` 는 확인 출력의 8자리. 사람이 쓰고 PM 이 승인한 본문만.
- 식별 · 중복 방지: 공지 id = `uuid5(고정 네임스페이스, "legacy-notice|<날짜>|<원본 분류>|<제목>")`. 이미 그 id 가 있으면(삭제된 것 포함)
  건너뛴다 → 여러 번 실행해도 한 번만 들어가고, 지운 공지를 되살리지 않는다.
- **UUID5 한계:** id 가 원본 글자로 정해지므로, 등록 뒤 웹 원본의 날짜 · 분류 · 제목을 한 글자라도 고치고 다시 실행하면 **다른 공지로 보고
  하나 더 들어간다**(앞의 것은 남는다). 등록은 원본을 고정한 채 한 번만 하고, 이후 수정은 관리자 화면(PATCH)으로 한다. 다시 실행할 때는
  먼저 확인 모드로 「등록 대상 0」 을 확인한다. 관리자 화면에서 고친 제목은 id 와 무관하다.
- 실패 · 누락: 넣을 것을 한 트랜잭션으로 커밋한다 — 도중 DB 오류면 이번 실행분은 하나도 남지 않고 종료 코드 4(다시 실행하면 이어서 된다).
  원본에서 공지를 하나도 못 읽거나 칸이 빠지면 쓰기 전에 종료 코드 2. 등록 대상이 0 이면 `--execute` 여도 DB 에 접속하지 않는다.
- 분류 대응: 점검 → maintenance · 이벤트 → event · 업데이트 → update · 안내 → info. 게시 시각 = 원본 날짜 00:00 KST. 고정 아님 · 작성자 없음.
- `--execute` 는 `--confirm` 에 지금 설정의 DB 이름을 정확히 적어야 실행된다. 감사 기록은 남기지 않는다(관리자 요청이 아님).
- 운영 DB 실행은 PM 승인 뒤. 웹의 하드코딩 데이터는 이 작업에서 고치지 않는다.

## 7. 응답 시각

모든 시각은 UTC naive ISO(`2026-11-16T03:00:00`, `Z` 없음) — 기존 API 와 같다. 화면이 KST 로 바꿔 보인다.

## 8. 확정 필요 · 남은 결정

1. **공개 목록 경로 · 응답 모양**: `GET /api/v1/notices` + `{items, page, page_size, total, total_pages}`.
2. **고정 공지 정렬**: 전체 순서의 맨 앞(쪽마다 반복하지 않음), 고정끼리는 최근 게시 먼저. 고정 개수 상한 없음.
3. **분류 값**: 영문 4종을 API 값으로, 한글(점검 · 이벤트 · 업데이트 · 안내)은 화면 표기.
4. **관리자 목록 쪽 나눔**: 기존 관리자 API 처럼 `offset` · `limit`(최대 50) · `next_offset`.
5. **감사 action 이름**: `create_notice` · `update_notice` · `delete_notice`.
6. **조회수(관리자 미리보기 화면의 `views`)**: 이번 범위 밖 — 열 없음.
7. **`updated_by`(마지막 수정 관리자)**: 열 없음 — 감사 기록으로 대신한다.
8. **CORS `PATCH`**: 이 PR 에서 `allow_methods` 에 더했다(허용 출처는 그대로). 병합 · 배포되면 이미 운영 중인 **문의 상태 변경(PATCH)
   도 함께 풀린다** — 지금 운영에서 그 기능이 막혀 있는지 PM · 해랑 확인 필요.
9. **옛 공지 9건 본문**: 원본에 없다 — 본문을 쓸지 · 제목만 공지는 버릴지 PM 결정.
