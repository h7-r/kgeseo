"""장면 완료 조건 `clear_when` 정적 검증기 v0.1 (팀 검토 대기, 게시 게이트에서만 쓴다).

Server Runtime 문서의 `scenes`를 읽어, 서버가 이미 가진 상태만으로 판정할 수 있는 조건인지 확인한다.
조건을 평가하거나 PlaySession에 장면 완료를 기록하지는 않는다(판정 엔진은 아직 없다).

    "scenes": [{"scene_id": "<scene_id>", "clear_when": <조건>}]

조건 문법은 NPC `reveal_when`(`app.services.npc_reveal`)과 같은 모양의 부분집합이다. 키가 정확히 하나다.

    {"puzzle_completed": "<puzzle_id>"}          → 정의된 퍼즐만
    {"flag": {"name": "<flag>", "eq": true|false}} → 어떤 효과의 set_flags가 그 값으로 설정하는 flag만
    {"all": [<잎 조건>, …]}                        → 비어 있지 않고 중복 없는 잎의 AND(중첩 없음)

[판정]
- PASS: 모든 장면이 위 문법이고 참조가 모두 정의돼 있다.
- FAIL: 형식 · 타입 오류, 중복, 빈 조건, 모르는 조건 키, 정의되지 않은 퍼즐 · flag 참조.
- UNVERIFIED: `reveal_when` 계약에는 있지만 여기서 아직 지원하지 않는 조건
  (`any` · `always` · `clue_acquired` · `hint_level` · `scene_reached` · `scene_cleared` ·
  `ending_reached`, 중첩 `all`). 게시를 막는다.
FAIL이 하나라도 있으면 전체가 FAIL이다. 결과에는 이유 코드와 ID만 담고 콘텐츠 원문은 담지 않는다.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition

SceneStatus = Literal["PASS", "FAIL", "UNVERIFIED"]

SCENE_FIELDS = frozenset({"scene_id", "clear_when"})
# reveal_when 계약에 있지만 clear_when에서는 아직 정적 검증 대상으로 받지 않는 조건
UNSUPPORTED_CONDITIONS = frozenset(
    {
        "any",
        "always",
        "clue_acquired",
        "hint_level",
        "scene_reached",
        "scene_cleared",
        "ending_reached",
    }
)


@dataclass(frozen=True)
class SceneAssessment:
    status: SceneStatus
    reasons: tuple[str, ...] = ()
    # 형식이 올바른 장면의 ID와 `puzzle_completed` 참조(게이트의 실행 가능 참조 검사에 쓴다)
    scene_ids: tuple[str, ...] = ()
    puzzle_references: tuple[tuple[str, str], ...] = ()


class _Unsupported(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind


class _Invalid(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason


def assess_scenes(raw_scenes: Any, server: PuzzleRuntimeDefinition) -> SceneAssessment:
    if not isinstance(raw_scenes, list):
        return SceneAssessment("FAIL", ("scenes:not_a_list",))

    defined_puzzles = {puzzle.puzzle_id for puzzle in server.puzzles}
    settable_flags = _settable_flags(server)
    # 장면 순서대로 쌓는다. 실패와 미지원은 따로 세어 판정한다.
    reasons: list[str] = []
    failed = unsupported = False
    scene_ids: list[str] = []
    puzzle_references: list[tuple[str, str]] = []

    for index, scene in enumerate(raw_scenes):
        if (
            not isinstance(scene, Mapping)
            or set(scene) != SCENE_FIELDS
            or not _is_id(scene["scene_id"])
        ):
            reasons.append(f"scenes.{index}:invalid")
            failed = True
            continue
        scene_id = scene["scene_id"]
        if scene_id in scene_ids:
            reasons.append(f"duplicate_scene:{scene_id}")
            failed = True
            continue
        scene_ids.append(scene_id)

        prefix = f"clear_when:{scene_id}"
        try:
            leaves = _leaves(scene["clear_when"])
        except _Unsupported as error:
            reasons.append(f"{prefix}:unsupported_condition:{error.kind}")
            unsupported = True
            continue
        except _Invalid as error:
            reasons.append(f"{prefix}:{error.reason}")
            failed = True
            continue

        for kind, value in leaves:
            if kind == "puzzle_completed":
                if value not in defined_puzzles:
                    reasons.append(f"{prefix}:unknown_puzzle:{value}")
                    failed = True
                else:
                    puzzle_references.append((scene_id, value))
            elif (value["name"], value["eq"]) not in settable_flags:
                reasons.append(f"{prefix}:unknown_flag:{value['name']}")
                failed = True

    if failed:
        status: SceneStatus = "FAIL"
    elif unsupported:
        status = "UNVERIFIED"
    else:
        status = "PASS"
    return SceneAssessment(
        status, tuple(reasons), tuple(scene_ids), tuple(puzzle_references)
    )


def _settable_flags(server: PuzzleRuntimeDefinition) -> set[tuple[str, bool]]:
    effects = [puzzle.on_correct for puzzle in server.puzzles]
    effects += [combination.on_success for combination in server.clue_combinations]
    effects += [inspection.on_inspect for inspection in server.inspections]
    return {
        (name, value) for effect in effects for name, value in effect.set_flags.items()
    }


def _is_id(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _leaves(condition: Any) -> list[tuple[str, Any]]:
    """최상위 조건을 잎 목록으로 돌려준다. 잎 하나이거나 잎들의 `all`이다."""

    kind, value = _single_key(condition)
    if kind != "all":
        return [_leaf(kind, value)]
    if not isinstance(value, list):
        raise _Invalid("invalid")
    if not value:
        raise _Invalid("empty_group")
    leaves: list[tuple[str, Any]] = []
    for child in value:
        child_kind, child_value = _single_key(child)
        if child_kind == "all":
            raise _Unsupported("all")
        leaves.append(_leaf(child_kind, child_value))
    keys = [(kind, _freeze(value)) for kind, value in leaves]
    if len(keys) != len(set(keys)):
        raise _Invalid("duplicate_condition")
    return leaves


def _single_key(condition: Any) -> tuple[str, Any]:
    if not isinstance(condition, Mapping) or len(condition) != 1:
        raise _Invalid("invalid")
    [(kind, value)] = condition.items()
    if not isinstance(kind, str):
        raise _Invalid("invalid")
    return kind, value


def _leaf(kind: str, value: Any) -> tuple[str, Any]:
    if kind in UNSUPPORTED_CONDITIONS:
        raise _Unsupported(kind)
    if kind == "puzzle_completed":
        if not _is_id(value):
            raise _Invalid("invalid")
        return kind, value
    if kind == "flag":
        # set_flags 값은 bool뿐이라 eq도 bool만 받는다(1 · "true"는 다른 값이다).
        if (
            not isinstance(value, Mapping)
            or set(value) != {"name", "eq"}
            or not _is_id(value["name"])
            or not isinstance(value["eq"], bool)
        ):
            raise _Invalid("invalid")
        return kind, value
    raise _Invalid("unknown_condition")


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return tuple(sorted(value.items()))
    return value
