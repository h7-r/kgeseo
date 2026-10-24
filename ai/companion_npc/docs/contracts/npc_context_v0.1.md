# NpcContext v0.1 (초안)

> 코드 `src/companion_npc/contracts/npc_context.py` · 견본 `tests/fixtures/npc_context_case_001.json`
> 표기: **[확정·호환]** 기존 계약 그대로 · **[제안]** 새로 제안 · **[미정]** 팀 결정 필요

## 1. 목적

NPC 에게 「지금 어떤 상황인가」를 한 번에 건네는 입력이다. NPC 서비스(서버 쪽)가 조립한다 [제안].

| 재료 | NpcContext 필드 |
|---|---|
| `GET /play-sessions/{id}` 의 `data.state` | `state` (모양 그대로) |
| `interaction_events` | `recent_interactions` |
| FE 순간 정보 (겨냥 · 대화 요청) | `trigger` · `focus` · `player_message` |

FE 가 이 객체를 직접 만들어 보내는 구조는 피한다. 정답 근처 정보가 클라이언트를 거치지 않게 하려는 것이다. 다만 FE→NPC 서비스 경로는 아직 [미정]이다.

## 2. 필드

| 필드 | 형식 | 상태 |
|---|---|---|
| `contract` / `contract_version` | `"npc_context"` / `"0.1"` | [제안] |
| `request_id` | str ≤64 | [제안] NpcUtterance 와 짝 |
| `requested_at` | timezone 포함 시각 | [확정·호환] backend 의 timestamp 규칙 |
| `play_session_id` | str ≤36 | [확정·호환] |
| `case_id`, `pack_id` | | case_id [확정·호환], pack_id [제안] |
| `trigger` | `type`, `source`(fe·backend·timer·debug), `event_ref` | [제안] type: `player_request`, `clue_acquired`, `zone_entered`, `puzzle_completed`(← npc-follow `gameEvents.ts`), `interaction_result`, `idle_tick` |
| `state` | `current_zone_id`, `completed_puzzle_ids`, `acquired_clue_ids`, `hint_levels`, `attempt_counts`, `flags` | **[확정·호환]** `PlaySessionState` 와 필드가 같다 (테스트로 검사). backend 가 key 를 더해도 거부하지 않고 버린다 |
| `recent_interactions[]` (≤50, 오래된 순) | 아래 표 | 대부분 [확정·호환] |
| `npc_history[]` (≤20) | `utterance_id`, `spoken_at`, `puzzle_id`, `npc_hint_level`, `hint_ids[]` | [제안] 같은 말 반복 방지 · 단계 올리기 |
| `timing` | `session_active_sec`, `since_last_progress_sec`, `since_last_interaction_sec`, `since_last_npc_utterance_sec`, `paused` | [제안] 일시정지·창 열림 동안은 세지 않음 (PRD: UI 열면 타이머 정지) |
| `focus` | `zone_id`, `object_id`, `puzzle_id` | [제안] FE 조사시스템의 겨냥·열림 |
| `player_message` | `text` ≤200 | [제안] `player_request` 트리거면 필수 |
| `npc_behavior` | `Idle`·`Follow`·`Interact` | [제안] npc-follow `behaviorState.ts` 와 같은 값 |
| `limits` | `max_npc_hint_level`(기본 2), `allow_llm`(기본 false), `cooldown_sec`(기본 30) | [제안] 운영 설정 |

### InteractionRecord

| 필드 | 상태 |
|---|---|
| `source` (live·event_log, 기본 live) | [제안 · P2-B] 이 기록을 어디서 얻었나 |
| `client_event_id`, `interaction_id` | [확정·호환] |
| `zone_id` | [확정·호환] live 는 필수. **event_log 는 null** — interaction_events 에 저장되지 않는다 |
| `target_id` | [확정·호환] 관측된 외부 target(input 이면 오브젝트). **event_log 는 null** — 그 테이블의 target_id 는 puzzle_id 다 |
| `inferred_object_id` | [제안 · P2-B] 팩에서 puzzle→오브젝트로 거꾸로 짚은 **추정값**. target_id 가 null 일 때만, 특성에는 쓰지 않음 |
| `action` (inspect·navigate·input·select·combine_clues) | [확정·호환] 외부 계약 5종. 내부 이름 `submit_answer` 는 받지 않음 |
| `target_type` (object·puzzle·clue·zone) | [확정·호환] |
| `result_type` (ok·correct·incorrect·already_completed) | [확정·호환] 외부 응답 값 |
| `attempt_count` | [확정·호환] |
| `state_changes[]` → `{type, target_id}` | type 은 [확정·호환] 5종. 모양은 NPC 용으로 줄인 [제안] |
| `occurred_at` | [제안] `interaction_events.created_at` (서버 시각) 기준 |
| `resolved_puzzle_id` | [제안] object→puzzle 로 풀린 값. event_log 는 interaction_events.target_id 를 그대로 옮긴다 |
| `answer_fingerprint` | [제안] 서버가 정규화한 답을 세션별 salt 로 해시. **원문(`payload.answer`)은 넣지 않는다** |

## 3. 검증 규칙

- 모든 시각은 timezone offset 을 가져야 한다.
- `recent_interactions` 는 오래된 것부터 순서대로 와야 한다.
- `player_request` 트리거에는 `player_message` 가 있어야 한다.
- 정의하지 않은 필드(예: `payload`)는 거부한다. 단, `state` 안의 새 key 는 버린다.
