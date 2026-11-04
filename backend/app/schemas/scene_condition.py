"""장면 완료 조건 `clear_when` 문법 v0.1 (팀 검토 대기). 정적 검증과 런타임 판정이 함께 쓴다.

게시 게이트(`app.services.scene_validation`)와 Server Runtime 모델(`PuzzleRuntimeDefinition.scenes`)은
모두 `assess_scene_list`로 장면 목록을 판정하고, 런타임 판정(`app.services.scene_progress`)은
`parse_clear_when`이 돌려준 잎만 평가한다. 문법을 한 곳에 두어 둘이 다른 조건을 받아들이지 않게 한다.

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
  `ending_reached`, 중첩 `all`). 게시를 막고, 런타임 모델도 받지 않는다.
FAIL이 하나라도 있으면 전체가 FAIL이다. 결과에는 이유 코드와 ID만 담고 콘텐츠 원문은 담지 않는다.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

SceneStatus = Literal["PASS", "FAIL", "UNVERIFIED"]

SCENE_FIELDS = frozenset({"scene_id", "clear_when"})
# 잎 조건. 런타임 판정기는 이 종류만 평가한다.
LEAF_CONDITIONS = frozenset({"puzzle_completed", "flag"})
# reveal_when 계약에 있지만 clear_when에서는 아직 받지 않는 조건
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

# (조건 종류, 값). 값은 puzzle_completed면 퍼즐 ID, flag면 {"name", "eq"}다.
ClearWhenLeaf = tuple[str, Any]


@dataclass(frozen=True)
class SceneAssessment:
    status: SceneStatus
    reasons: tuple[str, ...] = ()
    # 형식이 올바른 장면의 ID와 `puzzle_completed` 참조(게이트의 실행 가능 참조 검사에 쓴다)
    scene_ids: tuple[str, ...] = ()
    puzzle_references: tuple[tuple[str, str], ...] = ()


class UnsupportedClearWhen(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class InvalidClearWhen(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def assess_scene_list(
    raw_scenes: Any,
    defined_puzzles: Iterable[str],
    settable_flags: Iterable[tuple[str, bool]],
) -> SceneAssessment:
    if not isinstance(raw_scenes, list):
        return SceneAssessment("FAIL", ("scenes:not_a_list",))

    defined_puzzles = set(defined_puzzles)
    settable_flags = set(settable_flags)
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
            leaves = parse_clear_when(scene["clear_when"])
        except UnsupportedClearWhen as error:
            reasons.append(f"{prefix}:unsupported_condition:{error.kind}")
            unsupported = True
            continue
        except InvalidClearWhen as error:
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


def parse_clear_when(condition: Any) -> tuple[ClearWhenLeaf, ...]:
    """최상위 조건을 잎 목록으로 돌려준다. 잎 하나이거나 잎들의 `all`이다(모두 만족해야 완료)."""

    kind, value = _single_key(condition)
    if kind != "all":
        return (_leaf(kind, value),)
    if not isinstance(value, list):
        raise InvalidClearWhen("invalid")
    if not value:
        raise InvalidClearWhen("empty_group")
    leaves: list[ClearWhenLeaf] = []
    for child in value:
        child_kind, child_value = _single_key(child)
        if child_kind == "all":
            raise UnsupportedClearWhen("all")
        leaves.append(_leaf(child_kind, child_value))
    keys = [(kind, _freeze(value)) for kind, value in leaves]
    if len(keys) != len(set(keys)):
        raise InvalidClearWhen("duplicate_condition")
    return tuple(leaves)


def _is_id(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _single_key(condition: Any) -> tuple[str, Any]:
    if not isinstance(condition, Mapping) or len(condition) != 1:
        raise InvalidClearWhen("invalid")
    [(kind, value)] = condition.items()
    if not isinstance(kind, str):
        raise InvalidClearWhen("invalid")
    return kind, value


def _leaf(kind: str, value: Any) -> ClearWhenLeaf:
    if kind in UNSUPPORTED_CONDITIONS:
        raise UnsupportedClearWhen(kind)
    if kind == "puzzle_completed":
        if not _is_id(value):
            raise InvalidClearWhen("invalid")
        return kind, value
    if kind == "flag":
        # set_flags 값은 bool뿐이라 eq도 bool만 받는다(1 · "true"는 다른 값이다).
        if (
            not isinstance(value, Mapping)
            or set(value) != {"name", "eq"}
            or not _is_id(value["name"])
            or not isinstance(value["eq"], bool)
        ):
            raise InvalidClearWhen("invalid")
        return kind, value
    raise InvalidClearWhen("unknown_condition")


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return tuple(sorted(value.items()))
    return value
