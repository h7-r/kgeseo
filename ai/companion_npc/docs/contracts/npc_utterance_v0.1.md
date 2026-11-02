# NpcUtterance v0.1 (초안)

> 코드 `src/companion_npc/contracts/npc_utterance.py` · 견본 `tests/fixtures/npc_utterance_case_001.json`
> 표기: **[확정·호환]** 기존 계약 그대로 · **[제안]** 새로 제안 · **[미정]** 팀 결정 필요

## 1. 목적

NPC 의 결정(판단층), 발화(발화층), 그 근거, 안전 검사 결과를 한 객체에 담는다. 전체가 [제안]이다.
**`state_changes` 가 없다** — NPC 는 PlaySession 을 바꾸지 않는다. 붙이면 검증에서 거부된다.

## 2. 필드

| 필드 | 형식 | 설명 |
|---|---|---|
| `utterance_id`, `request_id`, `play_session_id`, `created_at` | | `request_id` = NpcContext.request_id |
| `decision.intervene` | bool | 끼어들까 |
| `decision.reason_code` | 닫힌 목록 | 개입: `player_requested`, `stuck_detected`, `repeated_incorrect`, `idle_too_long`, `zone_entered`, `progress_acknowledged` / 비개입: `not_needed`, `cooldown`, `paused`, `level_cap_reached`, `policy_blocked` |
| `decision.target_puzzle_id` | id \| null | |
| `decision.npc_hint_level` | 0·1·2 | backend `hint_levels` 와 **다른 축** (00 문서 §4). 3 은 없다 |
| `decision.confidence` | 0~1 | |
| `decision.method`, `model_version` | rule·logreg·lightgbm | 판단층 비교용 |
| `speech.text` | ≤280 | |
| `speech.display` | bubble·dialog | [미정] FE 표시 방식 |
| `grounding.pack_id`, `hint_ids[]`, `chunk_ids[]`, `max_spoiler_tier_used` | | 근거 추적 |
| `generation.method` | template·gpt_rag·qwen_local | 발화층 비교용 |
| `generation.model_name`, `prompt_version`, `latency_ms`, `tokens_in/out`, `cost_usd` | | 비용·지연 비교 (PRD ADM-098 토큰 예산과 같은 관점) |
| `safety.answer_leak_check` | passed·failed·not_run | |
| `safety.blocked_reason` | str \| null | |

## 3. 검증 규칙 (코드로 강제)

| 조건 | 규칙 |
|---|---|
| `intervene == false` | `speech`·`generation` 없음, `npc_hint_level == 0` |
| `intervene == true` | `speech`·`generation` 필수, `answer_leak_check == "passed"` |
| `npc_hint_level ≥ 1` | `target_puzzle_id` 필수, `grounding.hint_ids` 에 **승인 힌트 1개 이상** |
| 항상 | `max_spoiler_tier_used ≤ npc_hint_level` |

누설 검사에 실패하면 발화를 버리고 `intervene=false, reason_code="policy_blocked"` 로 바꾼다. 또는 승인 힌트 원문(템플릿)으로 대체한다 [미정].
