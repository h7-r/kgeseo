"""backend services/interaction.py 의 apply_runtime_effect 를 그대로 옮긴 것.

backend 함수는 sqlalchemy 를 끌고 오므로 실험 환경에서 import 하지 않는다.
대신 같은 순서·같은 조건을 지킨다(test_simulation 의 고정 기대값 테스트로 확인).
  ① 퍼즐 완료 (채점한 퍼즐 → 효과의 completes) — 이미 완료면 건너뜀
  ② 단서 획득 — 이미 있으면 건너뜀
  ③ flag — 값이 바뀔 때만
"""

from copy import deepcopy
from typing import Any

from companion_npc.contracts.scenario_pack import PackPuzzle


def apply_correct(
    state: dict[str, Any], puzzle: PackPuzzle
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    updated = deepcopy(state)
    changes: list[dict[str, Any]] = []
    for pid in [puzzle.puzzle_id, *puzzle.completes_puzzle_ids]:
        if pid not in updated["completed_puzzle_ids"]:
            updated["completed_puzzle_ids"].append(pid)
            changes.append({"type": "puzzle_completed", "puzzle_id": pid})
    for cid in puzzle.grants_clue_ids:
        if cid not in updated["acquired_clue_ids"]:
            updated["acquired_clue_ids"].append(cid)
            changes.append({"type": "clue_acquired", "clue_id": cid})
    for flag, value in puzzle.sets_flags.items():
        if updated["flags"].get(flag) != value:
            updated["flags"][flag] = value
            changes.append({"type": "flag_updated", "flag": flag, "value": value})
    return updated, changes
