# ScenarioPack v0.1 (초안)

> 코드 `src/companion_npc/contracts/scenario_pack.py` · 견본 `tests/fixtures/scenario_pack_*.json`
> 표기: **[확정·호환]** 기존 계약 그대로 · **[제안]** 새로 제안 · **[미정]** 팀 결정 필요

## 1. 목적

자동 생성된 시나리오든 사람이 만든 시나리오든, NPC 가 사건 하나를 이해하는 데 필요한 **공통 데이터**다.
승인된 콘텐츠를 **오프라인에서** 이 모양으로 변환한다(변환기는 P2). NPC 코드는 이 모양만 읽는다.

## 2. 들어가지 않는 것

- `accepted_answers`, 정답 정규화·판정 규칙
- `clue_combinations` 의 정답 쌍과 성공 Effect
- 정적 힌트 2단계(「정답 보기」) 문구
- `flags` 의 현재 값 (팩은 정적 데이터다. 현재 값은 NpcContext.state 에 있다)

모든 모델이 `extra="forbid"` 라서 위 필드가 섞여 들어오면 검증에서 거부된다.

## 3. 필드

| 필드 | 형식 | 출처 · 상태 |
|---|---|---|
| `contract` / `contract_version` | `"scenario_pack"` / `"0.1"` | [제안] |
| `pack_id` | id | [제안] |
| `case_id` | `^[A-Za-z0-9_-]+$`, ≤64 | [확정·호환] backend `CASE_ID_PATTERN` |
| `case_version` | str \| null | [제안] PRD ADM-090 `case_version`. 형식 [미정] |
| `locale` | 기본 `ko-KR` | [제안] |
| `source` | `producer`(human·agent·mixed), `client_content_ref`, `server_runtime_sha256`, `artifact_ids[]` | [제안] artifact_ids 는 파이프라인 §9.2 `artifact_id` |
| `publication` | `status`(draft·approved·published·withdrawn), `approved_by`, `approved_at` | [제안] approved·published 면 승인자·시각 필수 |
| `premise` | `title`, `public_synopsis` | [제안] 브리핑 수준까지만 |
| `persona` | `npc_id`, `display_name`, `role`, `speech_style`, `forbidden_topics[]` | [제안] 마스코트·사투리 방향은 PRD USR-108 비고 |
| `entry_zone_id` | id | [확정·호환] `CaseClientContent.entry_zone_id` |
| `zones[]` | `zone_id`, `zone_name`, `zone_type`, `description` | [확정·호환] `CaseClientContent.zones[]` |
| `objects[]` | `object_id`, `zone_id`, `object_name`, `object_type`, `interaction_type`, `puzzle_id` | [확정·호환] `zones[].objects[]`. `puzzle_id` = `interaction.target_id` (Bundle 에서는 숨기지만 팩은 서버 쪽 데이터) |
| `puzzles[]` | `puzzle_id`, `title`, `puzzle_type`, `zone_id`, `host_object_ids[]`, `prerequisite_puzzle_ids[]`, `required_clue_ids[]`, `grants_clue_ids[]`, `required_discovery_ref` | `puzzle_id`·`grants_clue_ids` [확정·호환] server.json. `puzzle_type` 7종은 파이프라인 §4.4. 나머지 [제안] |
| `clues[]` | `clue_id`, `title`, `description`, `source_object_id` | [제안] backend 에 Clue registry 가 아직 없다 (Contract Gap) |
| `hints[]` (ApprovedHint) | `hint_id`, `puzzle_id`, `npc_hint_level`(1·2), `text`(≤300), `approved_by`, `approved_at`, `provenance` | [제안] **사람 승인 필수** |
| `knowledge[]` (KnowledgeChunk) | `chunk_id`, `kind`, `text`(≤1200), `spoiler_tier`(0·1·2), `gate`, `puzzle_id`, `hint_id`, `provenance` | [제안] RAG 검색 단위 |
| `safety_audit` | `answer_leak_check`(passed·failed), `checked_at`, `checker_version` | [제안] published 면 passed 필수 |

### Provenance [확정·호환 — 파이프라인 §9.3 형식]

`provenance_mode`(direct·inherited·mechanical), `source_refs[]`, `fact_grade`(F·U·GF·NG), `inherited_from[]`, `rationale`

### KnowledgeGate [제안]

적힌 조건을 **모두** 만족해야 열린다. 빈 조건이면 항상 열린다.

| 조건 | 의미 |
|---|---|
| `requires_zone_ids` | 현재 zone 이 이 중 하나 |
| `requires_clue_ids` | 모두 획득 |
| `requires_completed_puzzle_ids` | 모두 완료 |
| `requires_flags` | 값이 정확히 같음. 없는 flag 는 닫힌 것으로 봄 |

## 4. 검증 규칙 (코드로 강제)

- 각 ID 목록은 중복되면 안 된다.
- 모든 참조(object→zone, puzzle→zone·object·clue·선행 puzzle, hint→puzzle, gate→zone·clue·puzzle)는 실제로 있어야 한다.
- `kind == "hint"` 조각은 `hint_id` 가 있어야 하고, `spoiler_tier` 가 그 힌트의 `npc_hint_level` 과 같아야 한다. 등급을 낮춰 적어 일찍 꺼내지는 일을 막는다.
- `published` 팩은 `safety_audit.answer_leak_check == "passed"` 여야 한다.

## 5. 기존 콘텐츠로 만드는 방법 (P2 변환기 기준)

| ScenarioPack | 원천 |
|---|---|
| zones · objects · entry_zone_id | `<case_id>.client.json` 그대로 |
| puzzles.puzzle_id · grants_clue_ids | `<case_id>.server.json` `puzzles[].puzzle_id`, `on_correct.grant_clue_ids` |
| `server_runtime_sha256` | server.json 파일 해시 (내용은 복사하지 않음) |
| hints · knowledge · persona · premise | 사람이 승인한 별도 데이터 [미정: 저장 위치·작성 주체] |
| puzzle_type · 선행관계 · 필수 발견 | 생성 에이전트 산출물(CompiledPuzzleSpec 등) [미정: 스키마 없음] |
