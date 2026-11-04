"""장면 완료 판정 v0.1 (팀 검토 대기).

상호작용 처리 결과(최신 세션 상태)로 `PuzzleRuntimeDefinition.scenes`의 `clear_when`을 평가해,
처음 만족한 장면을 `completed_scene_ids`에 기록하고 `scene_cleared`를 만든다.

- 조건은 `app.schemas.scene_condition.parse_clear_when`이 돌려준 잎만 평가한다. 런타임 모델이
  게이트와 같은 규칙으로 검증한 장면만 들어오므로, 모르는 잎이 오면 우회하지 않고 오류로 멈춘다.
- 이미 완료한 장면은 다시 판정하지 않는다(조건이 나중에 거짓이 돼도 완료 그대로다).
- 여러 장면이 한꺼번에 완료되면 콘텐츠에 정의한 순서대로 기록 · 알린다.
- Case 완료(`completed_at`)와는 별개다. 장면을 모두 끝내도 Case 완료로 기록하지 않는다.
"""

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any

from app.schemas.interaction import SceneClearedStateChange
from app.schemas.puzzle_runtime import SceneDefinition
from app.schemas.scene_condition import ClearWhenLeaf


def clear_scenes(
    scenes: Sequence[SceneDefinition], state: dict[str, Any]
) -> tuple[dict[str, Any], list[SceneClearedStateChange]]:
    completed = state.get("completed_scene_ids", [])
    cleared = [
        scene.scene_id
        for scene in scenes
        if scene.scene_id not in completed
        and all(_leaf_met(leaf, state) for leaf in scene.clear_when_leaves)
    ]
    if not cleared:
        return state, []

    updated_state = deepcopy(state)
    updated_state["completed_scene_ids"] = [*completed, *cleared]
    return updated_state, [
        SceneClearedStateChange(type="scene_cleared", scene_id=scene_id)
        for scene_id in cleared
    ]


def _leaf_met(leaf: ClearWhenLeaf, state: Mapping[str, Any]) -> bool:
    kind, value = leaf
    if kind == "puzzle_completed":
        return value in state.get("completed_puzzle_ids", [])
    if kind == "flag":
        # 설정된 적 없는 flag는 어느 값과도 같지 않다. 저장값은 bool이어야 같다(1 · "true"는 다르다).
        flags = state.get("flags", {})
        return value["name"] in flags and flags[value["name"]] is value["eq"]
    raise ValueError(f"unsupported clear_when condition: {kind}")
