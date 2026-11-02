from copy import deepcopy
from typing import Any

import pytest

from app.services.npc_reveal import (
    MAX_DEPTH,
    MAX_NODES,
    evaluate_reveal_when,
    is_revealed,
)

# 가상 서버 상태. 실제 PM 콘텐츠가 아니다.
STATE: dict[str, Any] = {
    "current_zone_id": "ZONE_TEST",
    "completed_puzzle_ids": ["PUZZLE_DONE"],
    "completed_inspect_ids": [],
    "acquired_clue_ids": ["CLUE_HAVE"],
    "hint_levels": {"PUZZLE_ONE": 1, "PUZZLE_TWO": 2, "PUZZLE_ZERO": 0},
    "attempt_counts": {},
    "flags": {"door_open": True, "count": 1, "mode": "night", "nothing": None},
    "object_states": {},
}

TRUE = {"clue_acquired": "CLUE_HAVE"}
FALSE = {"clue_acquired": "CLUE_MISSING"}


def decide(condition: Any, state: dict | None = None):
    return evaluate_reveal_when(condition, STATE if state is None else state)


# --- 단일 조건 ---


def test_always_true_is_revealed() -> None:
    assert decide({"always": True}).revealed is True
    assert decide({"always": True}).reason == "revealed"


@pytest.mark.parametrize("value", [False, 1, "true", None, {}])
def test_always_requires_literal_true(value: Any) -> None:
    assert decide({"always": value}) == decide({"always": value})
    assert decide({"always": value}).revealed is False
    assert decide({"always": value}).reason == "invalid"


@pytest.mark.parametrize(
    ("condition", "expected"),
    [
        ({"clue_acquired": "CLUE_HAVE"}, True),
        ({"clue_acquired": "CLUE_MISSING"}, False),
        ({"puzzle_completed": "PUZZLE_DONE"}, True),
        ({"puzzle_completed": "PUZZLE_OPEN"}, False),
    ],
)
def test_clue_and_puzzle_conditions(condition: dict, expected: bool) -> None:
    decision = decide(condition)

    assert decision.revealed is expected
    assert decision.reason == ("revealed" if expected else "not_met")


@pytest.mark.parametrize(
    ("puzzle", "gte", "expected"),
    [
        ("PUZZLE_ZERO", 1, False),
        ("PUZZLE_ZERO", 2, False),
        ("PUZZLE_ONE", 1, True),
        ("PUZZLE_ONE", 2, False),
        ("PUZZLE_TWO", 1, True),
        ("PUZZLE_TWO", 2, True),
        ("PUZZLE_UNSEEN", 1, False),
    ],
)
def test_hint_level_uses_that_puzzle_only(
    puzzle: str, gte: int, expected: bool
) -> None:
    assert (
        is_revealed({"hint_level": {"puzzle": puzzle, "gte": gte}}, STATE) is expected
    )


@pytest.mark.parametrize(
    ("name", "eq", "expected"),
    [
        ("door_open", True, True),
        ("door_open", False, False),
        ("count", 1, True),
        ("count", True, False),
        ("count", 1.0, False),
        ("mode", "night", True),
        ("mode", "day", False),
        ("nothing", None, True),
        ("missing_flag", None, False),
        ("missing_flag", False, False),
    ],
)
def test_flag_requires_same_type_and_value(name: str, eq: Any, expected: bool) -> None:
    assert is_revealed({"flag": {"name": name, "eq": eq}}, STATE) is expected


# --- 조합 ---


@pytest.mark.parametrize(
    ("children", "all_expected", "any_expected"),
    [
        ([TRUE], True, True),
        ([FALSE], False, False),
        ([TRUE, TRUE], True, True),
        ([TRUE, FALSE], False, True),
        ([FALSE, FALSE], False, False),
    ],
)
def test_all_and_any(children: list, all_expected: bool, any_expected: bool) -> None:
    assert is_revealed({"all": children}, STATE) is all_expected
    assert is_revealed({"any": children}, STATE) is any_expected


def test_nested_combination() -> None:
    condition = {
        "any": [
            {"all": [TRUE, {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": 2}}]},
            {
                "all": [
                    {"puzzle_completed": "PUZZLE_DONE"},
                    {"flag": {"name": "mode", "eq": "night"}},
                ]
            },
        ]
    }

    assert decide(condition).revealed is True
    assert decide({"all": [condition, FALSE]}).revealed is False


@pytest.mark.parametrize("group", ["all", "any"])
def test_empty_group_is_closed(group: str) -> None:
    decision = decide({group: []})

    assert decision.revealed is False
    assert decision.reason == "empty_group"
    assert decide({"any": [TRUE, {group: []}]}).revealed is False


# --- 잘못된 조건 ---


@pytest.mark.parametrize("condition", [None])
def test_missing_condition_is_closed(condition: Any) -> None:
    assert decide(condition).revealed is False
    assert decide(condition).reason == "missing"


@pytest.mark.parametrize(
    "condition",
    [
        {"scene_reached": "SCENE_A"},
        {"scene_cleared": "SCENE_A"},
        {"ending_reached": "A"},
    ],
)
def test_contract_conditions_without_server_state_are_closed(condition: dict) -> None:
    # 내용을 잘 만든 flag가 있어도 장면 조건은 판정하지 않는다.
    state = {
        **STATE,
        "flags": {"scene_reached:SCENE_A": True, "scene_cleared:SCENE_A": True},
    }

    decision = decide(condition, state)

    assert decision.revealed is False
    assert decision.reason == "unsupported_condition"


@pytest.mark.parametrize(
    "condition",
    [{"zone_entered": "ZONE_TEST"}, {"scene_entered": "SCENE_A"}, {"ALWAYS": True}],
)
def test_unknown_condition_is_closed(condition: dict) -> None:
    assert decide(condition).reason == "unknown_condition"
    assert decide(condition).revealed is False


@pytest.mark.parametrize(
    "condition",
    [
        {},
        {"always": True, "clue_acquired": "CLUE_HAVE"},
        [],
        "always",
        True,
        1,
        {1: True},
        {"clue_acquired": ""},
        {"clue_acquired": "   "},
        {"clue_acquired": ["CLUE_HAVE"]},
        {"puzzle_completed": 3},
        {"hint_level": {"puzzle": "PUZZLE_ONE"}},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": 0}},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": 3}},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": True}},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": "1"}},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": 1.0}},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": 1, "lt": 2}},
        {"hint_level": "PUZZLE_ONE"},
        {"flag": {"name": "door_open"}},
        {"flag": {"name": "", "eq": True}},
        {"flag": {"name": "door_open", "eq": [True]}},
        {"flag": {"name": "door_open", "eq": {"v": True}}},
        {"all": TRUE},
        {"any": "CLUE_HAVE"},
    ],
)
def test_invalid_shape_or_type_is_closed(condition: Any) -> None:
    decision = decide(condition)

    assert decision.revealed is False
    assert decision.reason == "invalid"


def test_one_invalid_branch_closes_whole_tree() -> None:
    assert decide({"any": [TRUE, {"unknown": 1}]}).reason == "unknown_condition"
    assert (
        decide({"any": [TRUE, {"scene_reached": "S"}]}).reason
        == "unsupported_condition"
    )
    assert decide({"all": [TRUE, {"clue_acquired": ""}]}).reason == "invalid"


def nest(depth: int) -> dict:
    condition: dict = TRUE
    for _ in range(depth - 1):
        condition = {"all": [condition]}
    return condition


def test_nesting_depth_limit() -> None:
    assert decide(nest(MAX_DEPTH)).revealed is True
    assert decide(nest(MAX_DEPTH + 1)) == decide(nest(MAX_DEPTH + 1))
    assert decide(nest(MAX_DEPTH + 1)).reason == "too_deep"
    assert decide(nest(500)).reason == "too_deep"


def test_node_count_limit() -> None:
    assert decide({"any": [TRUE] * (MAX_NODES - 1)}).revealed is True
    assert decide({"any": [TRUE] * MAX_NODES}).reason == "too_large"


def test_self_referencing_object_terminates_closed() -> None:
    children: list = []
    condition = {"any": children}
    children.append(condition)

    assert decide(condition).revealed is False
    assert decide(condition).reason in {"too_deep", "too_large"}


# --- 서버 상태 ---


def test_evaluation_never_changes_state() -> None:
    state = deepcopy(STATE)
    before = deepcopy(state)
    conditions = [
        {"always": True},
        TRUE,
        FALSE,
        {"puzzle_completed": "PUZZLE_DONE"},
        {"hint_level": {"puzzle": "PUZZLE_NEW", "gte": 1}},
        {"flag": {"name": "new_flag", "eq": True}},
        {"any": [FALSE, {"all": [TRUE]}]},
        {"scene_reached": "SCENE_A"},
    ]

    for condition in conditions:
        evaluate_reveal_when(condition, state)

    assert state == before


@pytest.mark.parametrize(
    "state",
    [
        {},
        {"acquired_clue_ids": "CLUE_HAVE", "completed_puzzle_ids": None},
        {"hint_levels": {"PUZZLE_ONE": "2"}},
        {"hint_levels": {"PUZZLE_ONE": True}},
        {"hint_levels": ["PUZZLE_ONE"]},
        {"flags": ["door_open"]},
    ],
)
def test_malformed_or_legacy_state_reads_as_not_met(state: dict) -> None:
    for condition in (
        TRUE,
        {"puzzle_completed": "PUZZLE_DONE"},
        {"hint_level": {"puzzle": "PUZZLE_ONE", "gte": 1}},
        {"flag": {"name": "door_open", "eq": True}},
    ):
        decision = decide(condition, state)
        assert decision.revealed is False
        assert decision.reason == "not_met"


def test_decision_carries_no_condition_values() -> None:
    decision = decide({"flag": {"name": "secret_flag_name", "eq": "비밀값"}})

    assert set(vars(decision)) == {"revealed", "reason"}
    assert "비밀값" not in repr(decision)
    assert "secret_flag_name" not in repr(decision)
