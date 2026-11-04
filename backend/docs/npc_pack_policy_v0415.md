# NPC 일반 팩 정책 검사 — PM v0.4.15 (2026-11-04)

기준: `339c3446370b81d4b41e42d74fbad3796d08d9fb` / `feat/SJ-npc-pack-policy-v0414-1104`.
작업 브랜치: `feat/SJ-npc-pack-policy-v0415`. v0.4.14 문서는 당시 계약의 기록으로 유지한다.

## 구현 규칙

- NPC 최상위 `proper_nouns`와 `ng`는 게시 필수 검수 데이터다. 누락 또는 `null`이면 `POLICY_DATA:FAIL`이며 일반 팩 설정 여부와 무관하게 게시하지 않는다. `[]`는 유효하다.
- `proper_nouns[]`는 `text`, `kind`, `aliases`를 받는다. `kind`는 `person` 또는 `place`만 허용한다. `aliases`는 배열이며 빈 배열도 유효하다. 이름과 별칭의 빈 문자열·공백 문자열은 거부한다. 잘못된 형식은 `NPC:FAIL`이다.
- GEN-CASE는 `proper_nouns[].text`, 모든 `aliases[]`, Client의 모든 `zones[].objects[].object_name`을 기존 정규화/포함 규칙으로 검사한다. 숨김·비활성 물건도 포함한다. 중복 이름은 순서를 유지해 제거한다.
- 실제 `CaseClientContent`는 `case_id`, `entry_zone_id`, `zones`를 가지며, 퍼즐/단서는 별도 표시 이름 필드 없이 상호작용 물건으로 표현된다. 따라서 `object_name`을 수집한다. `object_id`, `interaction.target_id`, `zone_id` 등 내부 ID는 수집하지 않는다. 장소는 수동 검수 목록의 계약이므로 `zone_name`을 자동 수집하지 않는다. Server의 clue title을 Client 이름으로 대신 취급하지 않는다.
- 현재 Client에 없는 퍼즐/단서 전용 이름 필드를 추측해 추가하지 않았다. 별도 표시 이름이 필요하면 Client 스키마 계약과 수집기를 함께 확장해야 한다.
- 게시 게이트와 게시본 조회가 동일한 수집기를 쓴다. 과거의 게시 게이트용 `case_proper_names` 주입 인자는 제거하여 검수 목록을 외부 인자로 우회하지 못하게 했다.
- GEN-LEAK의 정답·미공개 단서·힌트·NG 검사 규칙은 유지한다. `ng` 미제공은 계속 UNVERIFIED이며 게시 필수 검증에서도 실패한다.
- 일반 팩은 검수 데이터가 없는 게시본이 하나라도 있으면 PASS할 수 없다. 전체 게시본을 확인할 수 없는 경우에도 기존 fail closed 처리를 유지한다.

## 호환성과 콘텐츠 영향

`NpcContentPack`은 기존 게시본의 읽기·재시작 복원을 위해 두 필드의 미제공을 `None`으로 보존한다. 이 호환 표현은 게시 허용 기본값이 아니다. 신규 게시와 다음 버전 재게시에서는 `POLICY_DATA`가 필수를 강제하며, 일반 팩 대조에서는 미제공이 UNVERIFIED다. 누락 값을 `[]`로 자동 보충하지 않는다. 이미 게시된 버전의 원본·fingerprint·승인은 변경하지 않는다.

저장소 전체 JSON 조사에서 다음 AI fixture 3개에 `proper_nouns`와 `ng`가 모두 없다. 이들은 현재 Backend 게시본과 동일한 스키마라고 볼 수 없으며, 게시용으로 전환할 때 신규 필드와 기존 게시 계약을 함께 검수해야 한다. 원본은 수정하지 않았다.

| 파일 | 필요한 검수 |
|---|---|
| `ai/companion_npc/tests/fixtures/npc/case_001.npc.json` | 인물·장소·별칭 목록 및 NG 목록을 콘텐츠 담당자가 확정 |
| `ai/companion_npc/tests/fixtures/npc/case_fixture_archive.npc.json` | 동일 |
| `ai/companion_npc/tests/fixtures/npc/case_fixture_lighthouse.npc.json` | 동일 |

Backend의 `app/content/cases/case_001`에는 client/server만 있으며 NPC JSON은 없다. 기존 게시 체계 밖의 레거시 케이스는 기존 대조 범위 그대로 유지한다. 공식 일반 팩 `backend/content/npc_general/general_default/v1.json`의 원문과 fingerprint는 변경하지 않았다.

운영 DB와 외부 게시 루트는 조회하거나 수정하지 않았다. 따라서 실제 게시 버전별 누락 목록은 미확인이다. 콘텐츠 담당자는 published/suspended/blocked 버전의 원본을 조사하고, 누락 시 내용에 근거해 두 목록을 작성한 새 버전을 제출해야 한다. 검수 결과 실제 항목이 없을 때만 명시적으로 `[]`을 작성한다. 콘텐츠 변경은 fingerprint를 바꾸므로 기존 G1/G2/G3 승인 재사용 없이 기존 승인 절차를 따라야 한다.

## 보호한 동작 및 남은 승인

NPC Turn·Hint·Interaction·게시 HTTP API, G1/G2/G3 판정, 긴급 중단, GEN-WORD/SYS/TIME/LEN 및 Alembic revision은 변경하지 않았다. `npc.py` 변경은 설명 문구 갱신뿐이다. 테스트 데이터 생성 함수에 명시적인 가상 검수 빈 목록을 추가했으며 실제 콘텐츠에는 추가하지 않았다.

일반 팩 정책 PASS는 활성화가 아니다. 실제 G3 승인과 운영자의 명시적 공급 설정이 필요하다. 공급 설정·승인 기록은 변경하지 않았으며 이 작업으로 활성화하지 않는다. 소셜 인증 작업 공간과 파일은 변경하지 않는다. push, PR, 병합 및 운영 DB 변경은 수행하지 않는다.

## 변경 파일

- `app/schemas/npc_content.py`: 인물/장소 검수 항목 스키마와 레거시 읽기 표현.
- `app/services/dialogue_pack_policy.py`: 표시 이름·수동 고유명·별칭 수집.
- `app/services/npc_general_pack.py`: 게시본 이름 수집 연결.
- `app/services/publication_gate.py`: 필수 검수 데이터와 게시 시 자동 수집·재검사.
- `app/api/v1/npc.py`: 정책 설명 문구.
- `tests/test_publication_gate.py`: 유효한 가상 콘텐츠 생성 시 명시적 검수 목록.
- `tests/test_npc_pack_policy_v0414.py`, `tests/test_npc_pack_policy_v0414_mysql.py`: v0.4.15 운영 경로에 맞춘 회귀 검증.
- `tests/test_npc_pack_policy_v0415.py`, `tests/test_npc_pack_policy_v0415_mysql.py`: 필수 데이터·이름·별칭·ID 제외·게시/재게시 테스트.
- 이 문서.

## 검증

- 기본 Backend 전체 pytest: **2,199 passed / 142 skipped** (MySQL 격리 설정 전).
- Ruff: `python -m ruff check backend` PASS.
- 격리 MySQL 정책·게시 테스트: **10 passed**. MySQL 8.0.46, `127.0.0.1:33317`, worktree `tmp/mysql-policy-v0415/data`, 새 전용 schema 사용. 테스트 안전 장치가 포트·schema 이름·실제 datadir·빈 테이블을 확인한다. 기존 migration 체인을 매 시나리오 적용하고 정리한다.
- 격리 MySQL을 포함한 Backend 전체 pytest: **2,317 passed / 28 skipped**, 280.08초. NPC Turn·Hint·Interaction·게시·승인·긴급 중단 및 기존 정책 회귀를 포함한다.
- 미실행 28개: 별도 `APPROVAL_MYSQL_ISOLATED` 설정이 필요한 승인 저장 13개 및 저장 승인 게시 7개, `ONBOARDING_MYSQL_TESTS` opt-in 소셜 온보딩 7개, 환경상 생성 불가한 심볼릭 링크 1개. 승인/G3의 단위·게시 및 NPC 통합 검증은 위 통과 결과에 포함된다.
- 전체 실행 경고 35건은 기존 라이브러리 및 테스트의 deprecation 경고다(httpx/BlockingPortal, datetime.utcnow).
- Ruff 및 `git diff --check` PASS. 테스트 전용 MySQL은 datadir를 재확인한 뒤 종료했다.
