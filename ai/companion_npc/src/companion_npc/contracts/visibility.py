"""RAG 검색 단계의 차단 규칙 — 지식 조각을 꺼내도 되는가.

검색기(P4)는 유사도 순위를 매기기 **전에** 이 함수로 후보를 거른다.
뒤에서 거르면 순위 상위에 스포일러가 남아 프롬프트로 새어 나가기 쉽다.
"""

from companion_npc.contracts.common import PlaySessionStateSnapshot
from companion_npc.contracts.scenario_pack import (
    KnowledgeChunk,
    KnowledgeGate,
    ScenarioPack,
)


def gate_open(gate: KnowledgeGate, state: PlaySessionStateSnapshot) -> bool:
    if gate.requires_zone_ids and state.current_zone_id not in gate.requires_zone_ids:
        return False
    acquired = set(state.acquired_clue_ids)
    if any(c not in acquired for c in gate.requires_clue_ids):
        return False
    completed = set(state.completed_puzzle_ids)
    if any(p not in completed for p in gate.requires_completed_puzzle_ids):
        return False
    # flags 는 bool 로 정확히 같아야 한다 — 없는 flag 는 열리지 않은 것으로 본다.
    return all(
        state.flags.get(name) is value for name, value in gate.requires_flags.items()
    )


def visible_chunks(
    pack: ScenarioPack,
    case_id: str,
    state: PlaySessionStateSnapshot,
    max_tier: int,
) -> list[KnowledgeChunk]:
    """지금 플레이어에게 근거로 써도 되는 조각만 돌려준다."""

    # ① 공개된 팩만 ② 플레이 중인 사건의 팩만 — 다른 사건·미공개 사건은 통째로 막는다.
    if pack.publication.status != "published" or pack.case_id != case_id:
        return []
    completed = set(state.completed_puzzle_ids)
    result = []
    for chunk in pack.knowledge:
        if chunk.spoiler_tier > max_tier:
            continue
        # 이미 푼 퍼즐의 힌트는 다시 꺼낼 이유가 없다.
        if chunk.kind == "hint" and chunk.puzzle_id in completed:
            continue
        if gate_open(chunk.gate, state):
            result.append(chunk)
    return result
