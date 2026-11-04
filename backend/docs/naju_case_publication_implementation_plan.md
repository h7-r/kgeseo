# 나주 케이스 승인 · 게시 파이프라인 구현 계획 (11/5, 설계 · 구현 전)

- 기준 코드: `origin/main` @ `85a6e50` (원격 확인 11/4 21:57). 이 문서는 코드를 바꾸지 않는다.
- PM v0.4.15 원문은 이 저장소 · 이 PC에 없다. v0.4.15 일반 팩 정책(`f25f74a`)과 `client_skill` 구현은 학원 PC 로컬 커밋에만 있다.
  **이 문서에서 v0.4.15에 걸리는 항목은 설계만 적고 확정하지 않는다.** 그 코드를 받은 뒤 다시 맞춘다.
- 목표: 승인 · 게시 검사를 우회하지 않고 나주 케이스(`naju-angam-01`)를 게시할 수 있는 실행 경로를 만든다.
  지금 나주 고정 세션이 409 `CASE_VERSION_UNAVAILABLE`인 것은 콘텐츠 미게시 때문이며, 그 경로를 여는 데 필요한 것만 다룬다.

---

## 1. 지금 409가 나는 경로

1. `POST /api/v1/play-sessions`에 `content_version`이 있으면 `app/api/v1/play_sessions.py`가
   `content_store.get_version(case_id, content_version)`을 부른다.
2. 저장소는 `app/services/session_content.py`의 `_PUBLISHED_STORE`(`PinnedContentStore`, 프로세스 메모리 하나)다.
   처음에는 비어 있고 등록 HTTP 경로는 없다. 묶음이 없으면 `PinnedContentError` → 409 `CASE_VERSION_UNAVAILABLE`.
3. 묶음이 있어도 새 세션은 `content_release.require_published_for_new_session`이 세션 INSERT 트랜잭션 안에서
   DB 게시 상태 행을 공유 잠금으로 읽고 `published` · 같은 fingerprint일 때만 허용한다.
4. NPC 턴(`app/api/v1/npc.py`)은 레거시 세션(버전 없음)이면 늘 409, 고정 세션이면 `npc_case_access.read_case_npc_access`가
   `npc_approval_reviews`의 `case_content` G1~G3와 게시 상태를 다시 판정한다.

저장소를 채우는 길은 둘뿐이다.

| 경로 | 코드 | 조건 |
|---|---|---|
| 최초 게시 + 등록 | `content_release.publish_and_register` → `NpcPublicationService.publish_new` → `publication_gate.evaluate_publication` | 게시 루트 원본 4파일 · 게이트 통과 · DB 승인 이력 |
| 재시작 복구 | `main.py` lifespan → `content_release.restore_on_startup` → `sync_published_content` | `PUBLISHED_CONTENT_ROOT` 설정 · DB 게시 기록 · 원본 fingerprint 일치 |

게시 루트 형식: `<root>/<case_id>/v<content_version>/{client,server,npc,idmap}.json`(`published_content_loader.read_bundle_snapshot`).
앱은 이 파일을 쓰지 않고, 게시한 버전의 파일을 바꾸면 fingerprint 불일치로 복구되지 않는다.

---

## 2. 구현 상태 분류

### 2-1. 실제 구현되어 있고 동작하는 것

| 기능 | 근거 |
|---|---|
| 게시 게이트 판정 — 파싱 · 공식 fingerprint · 파일 머리 · 버전 순서 · Client/Server 스키마와 교차 참조 · NPC 콘텐츠(스키마 · 힌트 참조 · 정답/원문 보호) · 넛지 범위 경고 · idmap · 장면 `clear_when` · Client 누출 · 일반 팩 재검사 · 승인 | `app/services/publication_gate.py` `evaluate_publication` 1~10단계 |
| 판정 상태 규칙: `PASS` · `NOT_APPLICABLE` · `WARN`만 통과, `FAIL` · `UNVERIFIED`는 차단 | `publication_gate.py` `NON_BLOCKING_STATUSES` |
| 나주 케이스는 장면 정의 필수 | `publication_gate.py` `SCENE_REQUIRED_CASES = {"naju-angam-01"}` |
| 승인 이력 저장(append-only, 기록 실행자 `actor`) · 대상별 필수 관문(`case_content` G1~G3, `dialogue_pack` G3) | `app/services/approval_history.py` `REQUIRED_GATES`, `npc_approval_reviews` 테이블(Alembic `b3f7c2e9a4d1`까지) |
| 승인 기록 함수 — 인증 관리자 · 인증 전 내부 CLI 두 경로 | `app/services/gate_review.py` `create_gate_review(VerifiedAdmin)` · `record_delegated_gate_review(InternalCliOperator)` |
| 게시 상태 전이 · 이력 · 게시 승인 재판정(한 트랜잭션) | `app/services/npc_publication.py` `NpcPublicationService.publish_new` · `resume` · 중단 · 차단 |
| 게시 + 메모리 등록, 등록 실패 재조정 | `content_release.publish_and_register` · `sync_published_content` |
| 재시작 복구(설정 없으면 하지 않음, 실패해도 서버 시작은 막지 않음) | `content_release.restore_on_startup`, `main.py` lifespan |
| 신규 세션 게시 guard | `content_release.require_published_for_new_session` |
| 승인 기록 CLI — **`dialogue_pack`만** | `scripts/record_gate_review.py` (`SUPPORTED_TARGET_TYPES = ("dialogue_pack",)`) |

### 2-2. 코드에 있지만 실행 경로(CLI · HTTP)에 연결되지 않은 것

| 기능 | 근거 | 빠진 연결 |
|---|---|---|
| 케이스 게시 `publish_and_register` | `content_release.py` | 케이스용 호출자가 없다(관리 CLI · HTTP 없음). 호출부는 일반 팩 쪽(`npc_general_pack.py`)뿐 |
| `case_content` 승인 기록 | `gate_review.record_delegated_gate_review`는 대상 종류를 가리지 않는다 | CLI가 `case_content`를 거부한다(게시 묶음 fingerprint 재계산 경로 미연결) |
| 게이트 dry-run | `evaluate_publication`은 순수 함수(DB 쓰기 없음) | 사람이 돌릴 명령이 없다 |
| 게이트 `ng_checker` · `local_ids` · `case_proper_names` 인자 | `evaluate_publication` · `publish_new` 시그니처 | 넘겨줄 실제 값의 출처가 없다(아래 2-3) |
| FE 로컬 ID 대조(`LOCAL_IDS`) | `publication_gate.py` 7단계 — idmap이 있는데 `local_ids`가 없으면 `UNVERIFIED` | 나주는 idmap이 있으므로 FE 배치 키(`<배치 무리>#<번호>`) 목록을 넘겨야 한다. 목록을 만드는 명령 · 파일이 main에 없다(로컬 전용 `dbb7e0d`의 `naju_fe_ids.dev.json` · `verify_naju_fe_ids`가 비슷한 일을 하지만 v0.4.14 이전 · 원격에 없음) |
| 등록 재조정 `sync_published_content` | `content_release.py` | 재시작 말고는 부를 방법이 없다 |

### 2-3. 실제 구현이 없는 것

| 기능 | 영향 |
|---|---|
| **게시 게이트 NG 검사기**(`NgChecker = Callable[[str], bool]` 타입만 있음 — 주석: 「NG(금지 왜곡) · U(해석 유보 단정)에 걸리면 True, 판정 기준이 아직 없어 주입식」) | 넘기지 않으면 `NG: UNVERIFIED` → **모든 케이스 게시가 막힌다** |
| FE 로컬 ID 목록 생성 | 넘기지 않으면 `LOCAL_IDS: UNVERIFIED` → 나주 게시가 막힌다 |
| `case_proper_names`(케이스 고유명 목록) 계약 필드 | `_publish`가 넘기지 않는다. `NPC_GENERAL_PACK`을 설정한 환경이면 `GEN_PACK` 재검사가 `UNVERIFIED` → 게시 차단. 설정하지 않으면 `NOT_APPLICABLE` |
| 게시 뒤 복구 확인 명령 | 재시작 로그(`published content unavailable ...`)로만 알 수 있다 |
| 나주 공식 콘텐츠 4파일 | 어느 브랜치에도 없다 |

### 2-4. v0.4.15 · `client_skill` 코드를 받은 뒤에만 구현할 것

- `solve.mode`(서버 판정 / `client_skill`) 스키마 · 완료 신고 action · 게이트에서 정답 없는 퍼즐 처리 — 지금 `PuzzleDefinition`은
  `extra="forbid"` · `accepted_answers` 1개 이상 필수라 손놀림 퍼즐을 등록할 수 없다(`app/schemas/puzzle_runtime.py`).
- v0.4.15 일반 팩 정책 변경(`f25f74a`) — 게이트 9-1단계 · `dialogue_pack_policy`가 바뀔 수 있다.
- 위 둘에 기대는 게시 CLI의 검사 결과 표시 · 테스트 기대값.
- 이 문서의 CLI 설계는 위 변경과 겹치지 않게 **게이트 호출부만** 다룬다. 게이트 · 스키마 자체는 바꾸지 않는다.

---

## 3. 케이스 승인 · 게시 CLI 설계 (기존 함수 재사용, 최소 변경)

원칙: 판정은 모두 기존 함수가 한다. CLI는 입력 확인 · 대상 확인 · 결과 표시만 한다. 승인 정책 · 게이트 규칙을 CLI에 다시 쓰지 않는다.

### 3-1. `scripts/record_gate_review.py` — `case_content` 열기

| 바꿀 것 | 내용 |
|---|---|
| `SUPPORTED_TARGET_TYPES` | `("dialogue_pack", "case_content")` |
| 대상 fingerprint 재계산 | `case_content`이면 `--content-root`(기본 `settings.published_content_root`)에서 `read_bundle_snapshot(root, target_id, target_version)` → `compute_content_fingerprint(client, server, npc, idmap)`. 파일 머리의 `content_fingerprint`와 재계산 값 · `--target-hash`가 모두 같아야 진행 |
| 관문 · 판정자 | 기존 `REQUIRED_GATES["case_content"]`(G1~G3) · 판정자 명단(G1 박지하 · 황미르, G2 이해랑 · 황미르, G3 황미르) 그대로 |
| 기록 | 기존 `record_delegated_gate_review` 그대로(같은 잠금 · append-only · `--commit --confirm-db`) |
| `--db` 확인 출력 | 대상의 현재 관문별 최종 판정(`approval_history`)과 게시 상태(`NpcPublicationRepository`)를 읽기 전용으로 |

하지 않는 것: 판정자 대신 기록, 여러 관문 한 번에 기록, 과거 시각 기록, 승인 없는 게시.

### 3-2. 새 `scripts/publish_case_content.py`

```
python -m scripts.publish_case_content --case-id naju-angam-01 --content-version 1 \
    --actor <실행자> --reason "<근거>" [--content-root <게시 루트>] [--local-ids <FE ID 파일>]
    [--db]                          # 대상 DB의 현재 승인 · 게시 상태를 읽어 게이트를 승인 포함으로 판정(쓰기 없음)
    [--commit --confirm-db <DB>]    # 실제 게시 + 이 프로세스 저장소 등록
```

| 단계 | 동작 | 재사용 |
|---|---|---|
| 1. 대상 확인 | `case_id` · `content_version` 형식, 게시 루트 위치(`<root>/<case_id>/v<n>/`), 4파일 존재, 파일 머리의 `case_id` · `content_version`이 인자와 같은지 | `read_bundle_snapshot` · `header_mismatches` |
| 2. dry-run(기본) | DB 없이 `evaluate_publication(... approval_source=None)` — 승인을 뺀 모든 검사 결과를 표로 낸다. 승인 단계는 `FAIL (no trusted approval source)`로 나오는 것이 정상이며, 이를 「승인 대기」로 표시 | `evaluate_publication` |
| 3. `--db` | 대상 DB의 `npc_approval_reviews`를 읽기 전용 승인 출처로 넘겨 같은 판정. Alembic revision · 게시 상태도 함께 표시 | `approval_history` · `NpcPublicationRepository` |
| 4. `--commit` | `--confirm-db`가 설정 DB 이름과 같을 때만. `publish_and_register(NpcPublicationService(...), store, root, ...)`. 결과 `published` / `already_published` · 등록 상태 출력 | `publish_and_register` |
| 5. 게시 후 안내 | 「앱 서버는 별도 프로세스다 — `PUBLISHED_CONTENT_ROOT`가 같은 루트인지 확인하고 재시작하라」 출력. CLI 프로세스의 저장소 등록은 앱 서버에 반영되지 않는다 | — |

출력에는 검사 코드 · 상태 · 이유 코드만 싣는다(정답 · 힌트 원문 · 비밀번호를 싣지 않는다). 종료 코드: 0 통과/게시, 1 입력 오류, 2 게이트 차단, 3 DB 대상 불일치.

**검사별 화면 메시지(제안).** 게이트 이유 코드는 그대로 두고 앞에 한 줄 안내를 붙인다.

| 게이트 코드(`publication_gate.CheckCode`) | 안내 |
|---|---|
| `PARSE` · `FINGERPRINT` · `HEADER` | 파일 형식 · fingerprint · 머리(`case_id` · `content_version`)가 맞지 않는다 — 파일을 고친 뒤 버전을 다시 계산 |
| `VERSION_ORDER` | 이전 게시본보다 큰 버전이어야 한다 |
| `CLIENT_SERVER` | Client · Server 스키마 · ID 교차 참조 오류(이유에 경로) |
| `NPC` | npc.json 스키마 · 힌트 단계 참조 · 정답/원문 보호 위반 |
| `NUDGE_COVERAGE` | (경고, 게시는 됨) 넛지가 없는 퍼즐 ID |
| `IDMAP` · `EXECUTABLE_REFS` | idmap 내부 · 교차 참조, 실행 불가 항목 참조 |
| `LOCAL_IDS` | `UNVERIFIED`면 「FE 로컬 ID 목록을 넘기지 않았다」, `FAIL`이면 FE에 없는 로컬 키 |
| `SCENES` | 장면 `clear_when` 오류(나주는 장면 필수) |
| `LEAK_CLIENT` | client.json에 정답 · 정식 힌트 원문이 들어 있다 |
| `NG` | `UNVERIFIED`면 「NG 검사기가 없다(§4)」, `FAIL`이면 걸린 `line_id` |
| `GEN_PACK` | 일반 팩 재검사. `UNVERIFIED`면 「케이스 고유명 계약이 없다(§5)」 |
| `APPROVALS` | 빠진 · 철회된 관문과 판정(G1~G3) |

### 3-3. 재시작 · 복구 확인

| 단계 | 방법 |
|---|---|
| 1. 앱 서버 설정 | `PUBLISHED_CONTENT_ROOT`가 CLI와 같은 루트 · 같은 DB |
| 2. 재시작 | 로그에 `published content unavailable`가 없어야 한다 |
| 3. 복구 확인 명령(새, 읽기 전용) | `python -m scripts.check_published_restore` — `NpcPublicationService.restorable_versions()` · 파일 읽기 · `rebuild_published_content`를 새 저장소에 해 보고 버전별 `registered` / `files_missing` / `rebuild_failed`를 낸다(DB 쓰기 없음) |
| 4. 실제 확인 | `POST /anonymous-sessions` → `POST /play-sessions {case_id, content_version}` 201 → `POST …/npc/turns` 200(`content_mode: "case"`) |

### 3-4. 테스트

- `record_gate_review`: `case_content` 대상 fingerprint 재계산 · 불일치 거부 · 관문 · 판정자 제한 · `--confirm-db` 불일치 거부(기존 테스트 형식 그대로).
- `publish_case_content`: 파일 없음 · 머리 불일치 · dry-run 결과 표 · 게이트 차단 종료 코드 2 · `--commit` 없이 DB 쓰기 0건.
  승인은 테스트용 승인 출처(기존 `tests`가 쓰는 방식)로만 넣는다. 실제 DB에 승인 기록을 만들지 않는다.
- MySQL 통합: 격리 DB에서 게시 → 재시작 복구 → 고정 세션 201(기존 `verify_*` 스크립트 형식). 운영 · 개발 DB는 쓰지 않는다.

### 3-5. 하지 않는 것

- 승인 기록 없이 게시, 게이트 결과를 CLI에서 무시하는 옵션, 저장소에 직접 넣는 경로(`ContentPublisher`만으로 등록), HTTP 게시 경로.

---

## 4. NG 검사기 설계 (기준은 PM 확인 전 — 제안)

### 4-1. 데이터 출처

- 게이트의 NG는 비속어 필터가 아니라 **설화 「금지 왜곡」(NG)과 「해석 유보 단정」(U)** 검사다(`publication_gate.py` `NgChecker` 주석).
- 이미 계약된 곳은 케이스 `npc.json`의 `ng[]`(`NpcPolicyRule`: `text` · `patterns`, `app/schemas/npc_content.py`)뿐이다.
- 같은 데이터를 이미 쓰는 곳: 실행 중 출력 검사 `npc_generation_policy.check_generated_line`의 3단계 NG(정규화 뒤 포함),
  일반 팩 정책 GEN-LEAK(`dialogue_pack_policy`, NG 데이터가 없으면 그 케이스 UNVERIFIED).
- 게이트 주석은 「NG · U(PUB-NG)」라 U(`open[]` 단정 표현)도 대상일 수 있다 — **PM 확인 필요**.
- 닉네임 금칙어(`nickname_policy.forbidden_terms_in`, GEN-WORD가 쓰는 것)를 케이스 넛지에도 쓸지 — **PM 확인 필요**.

### 4-2. 정답 · 미공개 정보 보호와의 관계

- 정답 · 정식 힌트 원문 보호는 NG가 아니라 이미 다른 단계가 한다: 게이트 6단계(NPC 콘텐츠의 정답/원문 보호), 8단계(Client 누출).
- NG는 「케이스가 금지한 주제 · 표현」만 본다. 두 검사를 합치지 않는다(실패 이유가 섞이지 않게).

### 4-3. 인터페이스(최소 변경)

- 게이트 쪽 타입 `NgChecker = Callable[[str], bool]`은 바꾸지 않는다. 지금 게이트는 걸린 넛지의 `line_id`를 이유로 남긴다.
- 새 함수(제안): `build_ng_checker(npc_pack: NpcContentPack) -> NgChecker | None`
  - `npc_pack.ng`가 `None`이면 `None`을 돌려준다 → 게이트 `NG: UNVERIFIED`(차단, fail closed).
  - 규칙의 비교 문자열이 비면(정규화 뒤 빈 값) 그 규칙은 판정 불가 → 검사기 자체를 `None`으로(차단).
  - 맞춤은 `npc_generation_policy`의 정규화 · 포함 규칙을 그대로 쓴다. 지금 그 함수(`_forms` · `_contains`)는 내부용이라
    공개 helper 하나로 드러내는 것만 바꾼다(동작 변경 없음).
- 게시 CLI가 묶음의 `npc.json`으로 검사기를 만들어 `publish_new(ng_checker=...)`에 넘긴다.
- 검사 범위: 지금 게이트는 퍼즐별 넛지만 본다(`_located_nudges`). `general_nudges` · `fallback_lines`까지 넓힐지 — **PM 확인 필요**.

### 4-4. 실패 처리

- `FAIL`(걸린 `line_id` 목록) · `UNVERIFIED`(데이터 · 검사기 없음) 모두 게시 차단(기존 `NON_BLOCKING_STATUSES` 그대로).
- 실행 중 출력 검사는 그대로 둔다(게시 때 통과해도 실행 중 다시 본다).

### 4-5. 테스트

- 단위: `ng` 없음 → `None`, 패턴 맞음/안 맞음, 조사 · 공백 · 구두점 정규화, 빈 패턴 규칙 → `None`.
- 게이트 회귀: 검사기 없음 `UNVERIFIED`, 걸린 넛지 `FAIL`과 `line_id`, 통과 `PASS` — 기존 `publication_gate` 테스트에 더한다.
- 출력 검사와의 일치: 같은 문장 · 같은 규칙에서 `check_generated_line`의 NG 판정과 결과가 같아야 한다.

---

## 5. 케이스 고유명(GEN-CASE)

- `NpcPublicationService._publish`는 `evaluate_publication`에 `case_proper_names`를 넘기지 않는다.
- `NPC_GENERAL_PACK`을 설정하면 새 케이스 게시 때 일반 팩 재검사의 GEN-CASE가 `UNVERIFIED` → 차단.
- 고유명을 담는 계약 필드가 없다(팀 결정 11/4: 기존 이름 필드를 고유명으로 간주하지 않음). 필드 위치 · 작성자는 **PM 결정**.
  v0.4.15 일반 팩 정책에서 바뀌었을 수 있어 학원 PC 코드를 받은 뒤 정한다.

---

## 6. 작업 순서

| 순서 | 작업 | 선행 | 지금 시작 가능 |
|---|---|---|---|
| 1 | 학원 PC `f25f74a` · `client_skill` 브랜치 push 확인, PM v0.4.15 원문 확보 | — | 확인만 |
| 2 | `record_gate_review` `case_content` 열기(3-1) | 1(일반 팩 경로와 겹치는지 확인) | 설계 확정 뒤 바로 |
| 3 | `publish_case_content` dry-run · `--db`(3-2 1~3단계) | 2 | 예 — 게이트는 그대로 부르기만 한다 |
| 4 | `publish_case_content --commit`(3-2 4단계) · 복구 확인 명령(3-3) | 3 | 예 |
| 5 | NG 검사기(4) | PM: NG 범위 · U 포함 · 금칙어 · 일반 넛지 포함 | 데이터 출처 · 인터페이스까지만 |
| 5-1 | FE 로컬 ID 목록 생성 명령(`LOCAL_IDS`) — FE 배치 키를 FE 커밋에서 읽어 파일로(`dbb7e0d`의 대조 방식 참고, v0.4.14 이후 기준으로 새로) | FE: 코드로 만든 물건의 로컬 키 형식(대응표 문서 §5) | 배치 무리 키(`씬N.무리#i`)까지는 예 |
| 6 | GEN-CASE 고유명(5) | PM · v0.4.15 | 아니오 |
| 7 | `solve.mode` · `client_skill`(2-4) | 학원 PC 코드 | 아니오(재구현 금지) |
| 8 | 나주 4파일 작성 → dry-run 통과(승인 제외) | 대응표(`docs/naju/naju_puzzle_object_mapping_review.md`) · 7 | 아니오 |
| 9 | 실제 판정자가 G1~G3 기록(3-1 CLI) → 게시(3-2) → 재시작 복구 → 고정 세션 · NPC 200 확인 | 8 | 아니오 |

## 7. PM · 팀 확인 질문

1. PUB-NG 범위: `ng[]`만인가, U(`open[]`) · 닉네임 금칙어도 포함인가. 넛지 외 `general_nudges` · `fallback_lines`도 보는가.
2. 케이스 고유명 목록의 계약 필드 · 작성자(GEN-CASE).
3. 게시 실행자(`actor`) 기준 — 인증 운영 전 CLI 실행을 누가 하는가(일반 팩 G3 때와 같은 방식인가).
4. 게시 루트의 위치 · 불변성 보장(이전 결정 대기 항목).
5. v0.4.15에서 게이트 · 승인 · 일반 팩 정책 중 바뀐 것.
