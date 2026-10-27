import ast
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import (
    ClueCombinationDefinition,
    ClueDefinition,
    InspectionDefinition,
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.npc_content_validation import (
    assess_npc_content,
    validate_npc_content_links,
)
from app.services.npc_reveal import evaluate_reveal_when

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 승인 대사가 아니다.
CASE_ID = "case_test"
HINTS = {
    (CASE_ID, "PUZZLE_A", 1): "(가상) A 1단계 원문",
    (CASE_ID, "PUZZLE_A", 2): "(가상) A 2단계 원문",
    (CASE_ID, "PUZZLE_B", 1): "(가상) B 1단계 원문",
}
ANSWER_A = "가상정답에이"


def effect(**kwargs) -> RuntimeEffect:
    return RuntimeEffect(**{"grant_clue_ids": [], "set_flags": {}, **kwargs})


def make_runtime() -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=CASE_ID,
        puzzles=[
            PuzzleDefinition(
                puzzle_id="PUZZLE_A",
                accepted_answers=[ANSWER_A],
                on_correct=effect(set_flags={"door_open": True}),
            ),
            PuzzleDefinition(
                puzzle_id="PUZZLE_B",
                accepted_answers=["가상정답비"],
                on_correct=effect(),
            ),
        ],
        clue_combinations=[
            ClueCombinationDefinition(
                combination_id="CB_1",
                clue_ids=["CLUE_ONE", "CLUE_TWO"],
                on_success=effect(complete_puzzle_ids=["SCENE_MARK_1"]),
            )
        ],
        inspections=[
            InspectionDefinition(
                inspect_id="IN_1",
                on_inspect=RuntimeEffect(grant_clue_ids=["CLUE_ONE"], set_flags={}),
            ),
            InspectionDefinition(
                inspect_id="IN_2",
                on_inspect=RuntimeEffect(grant_clue_ids=["CLUE_TWO"], set_flags={}),
            ),
        ],
        clues=[
            ClueDefinition(clue_id="CLUE_ONE", title="(가상) 단서 1"),
            ClueDefinition(clue_id="CLUE_TWO", title="(가상) 단서 2"),
        ],
    )


def hint_source(case_id: str, puzzle_id: str, level: int) -> str | None:
    return HINTS.get((case_id, puzzle_id, level))


def valid_pack() -> dict[str, Any]:
    return {
        "schema_version": "npc-pack 0.1",
        "case_id": CASE_ID,
        "npc_id": "NPC_COMPANION",
        "status": "draft",
        "general_nudges": [
            {
                "line_id": "NUDGE_LOOK_AROUND",
                "text": "(가상) 아직 안 본 곳이 있을지도.",
                "reveal_when": {"always": True},
            }
        ],
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_A",
                "nudges": [
                    {
                        "line_id": "NUDGE_PUZZLE_A_1",
                        "text": "(가상) 그 상자 근처를 다시 보자.",
                        "reveal_when": {
                            "all": [
                                {"clue_acquired": "CLUE_ONE"},
                                {
                                    "any": [
                                        {
                                            "hint_level": {
                                                "puzzle": "PUZZLE_A",
                                                "gte": 1,
                                            }
                                        },
                                        {"puzzle_completed": "SCENE_MARK_1"},
                                        {"flag": {"name": "door_open", "eq": True}},
                                    ]
                                },
                            ]
                        },
                    }
                ],
            }
        ],
    }


def assess(raw: Any):
    return assess_npc_content(raw, make_runtime(), hint_source=hint_source)


def codes(readiness) -> list[str]:
    return [issue.code for issue in readiness.issues]


def link_codes(raw: dict) -> list[tuple[str, str | None]]:
    pack = NpcContentPack.model_validate(raw)
    return [
        (issue.code, issue.reference)
        for issue in validate_npc_content_links(
            pack, make_runtime(), hint_source=hint_source
        )
    ]


# --- 정상 ---


def test_valid_pack_passes_schema_and_links_but_is_not_servable() -> None:
    readiness = assess(valid_pack())

    assert readiness.schema_valid is True
    assert readiness.links_valid is True
    assert readiness.publish_approved is False
    assert readiness.servable is False
    assert codes(readiness) == ["APPROVAL_UNVERIFIED"]


def test_published_status_with_approval_records_is_still_unapproved() -> None:
    raw = valid_pack()
    raw.update(
        status="published",
        content_version=3,
        content_fingerprint="sha256:00",
        approvals=[
            {
                "gate": "G3",
                "decision": "approved",
                "target_hash": "sha256:00",
                "at": "2026-10-27T03:00:00Z",
            }
        ],
    )

    readiness = assess(raw)

    assert (readiness.schema_valid, readiness.links_valid) == (True, True)
    assert readiness.publish_approved is False
    assert readiness.servable is False


# --- 스키마 ---


def nudge_path(raw: dict) -> dict:
    return raw["puzzles"][0]["nudges"][0]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.update(extra_field=1),
        lambda r: nudge_path(r).update(speaker="x"),
        lambda r: r["puzzles"][0].update(hints=[{"level": 1, "text": "(가상)"}]),
        lambda r: r["puzzles"][0].update(accepted_answers=["x"]),
        lambda r: r.update(accepted_answers=["x"]),
        lambda r: nudge_path(r).update(hints=[]),
        lambda r: r["general_nudges"][0].update(accepted_answers=["x"]),
    ],
)
def test_undefined_fields_including_hints_and_answers_are_rejected(mutate) -> None:
    raw = valid_pack()
    mutate(raw)

    readiness = assess(raw)

    assert readiness.schema_valid is False
    assert readiness.servable is False
    assert set(codes(readiness)) == {"SCHEMA_INVALID"}
    assert {issue.reference for issue in readiness.issues} == {"extra_forbidden"}


@pytest.mark.parametrize("field", ["schema_version", "case_id", "npc_id", "status"])
def test_missing_top_level_field_is_rejected(field: str) -> None:
    raw = valid_pack()
    del raw[field]

    assert assess(raw).schema_valid is False


@pytest.mark.parametrize("field", ["line_id", "text", "reveal_when"])
def test_missing_nudge_field_is_rejected(field: str) -> None:
    raw = valid_pack()
    del nudge_path(raw)[field]

    assert assess(raw).schema_valid is False


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.update(case_id=""),
        lambda r: r.update(case_id="   "),
        lambda r: r.update(npc_id=""),
        lambda r: nudge_path(r).update(text=""),
        lambda r: nudge_path(r).update(text="   "),
        lambda r: nudge_path(r).update(text="가" * 201),
        lambda r: r["puzzles"][0].update(puzzle_id=" "),
        lambda r: r["puzzles"][0].update(nudges=[]),
        lambda r: r.update(status="approved"),
        lambda r: r.update(schema_version="npc-pack 0.2"),
        lambda r: r.update(content_version=0),
        lambda r: r.update(
            approvals=[
                {
                    "gate": "G9",
                    "decision": "approved",
                    "target_hash": "h",
                    "at": "2026-10-27T00:00:00Z",
                }
            ]
        ),
    ],
)
def test_blank_or_out_of_range_values_are_rejected(mutate) -> None:
    raw = valid_pack()
    mutate(raw)

    assert assess(raw).schema_valid is False


@pytest.mark.parametrize(
    "line_id",
    ["nudge_lower", "NUDGE_", "HINT_A", "NUDGE-A", "NUDGE_가", "NUDGE_a", ""],
)
def test_invalid_line_id_format_is_rejected(line_id: str) -> None:
    raw = valid_pack()
    nudge_path(raw)["line_id"] = line_id

    assert assess(raw).schema_valid is False


def test_duplicate_line_id_across_general_and_puzzle_nudges_is_rejected() -> None:
    raw = valid_pack()
    nudge_path(raw)["line_id"] = "NUDGE_LOOK_AROUND"

    assert assess(raw).schema_valid is False


def test_duplicate_puzzle_entry_is_rejected() -> None:
    raw = valid_pack()
    second = deepcopy(raw["puzzles"][0])
    second["nudges"][0]["line_id"] = "NUDGE_PUZZLE_A_2"
    raw["puzzles"].append(second)

    assert assess(raw).schema_valid is False


@pytest.mark.parametrize(
    "condition",
    [
        {},
        {"always": False},
        {"zone_entered": "ZONE_A"},
        {"all": []},
        {"any": [{"clue_acquired": ""}]},
        {"hint_level": {"puzzle": "PUZZLE_A", "gte": 3}},
        {"flag": {"name": "door_open"}},
    ],
)
def test_invalid_reveal_when_is_rejected_by_schema(condition: dict) -> None:
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = condition

    assert assess(raw).schema_valid is False


def test_too_deep_reveal_when_is_rejected_by_schema() -> None:
    condition: dict = {"always": True}
    for _ in range(9):
        condition = {"all": [condition]}
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = condition

    assert assess(raw).schema_valid is False


def test_schema_issues_do_not_contain_input_values() -> None:
    raw = valid_pack()
    nudge_path(raw)["text"] = "가" * 201
    raw["puzzles"][0]["hints"] = [{"level": 2, "text": ANSWER_A}]

    readiness = assess(raw)

    dumped = repr(readiness)
    assert "가" * 201 not in dumped
    assert ANSWER_A not in dumped


# --- 교차 참조 ---


def test_case_id_mismatch() -> None:
    raw = valid_pack()
    raw["case_id"] = "other_case"

    assert ("CASE_ID_MISMATCH", "other_case") in link_codes(raw)


def test_unknown_puzzle_entry_and_references() -> None:
    raw = valid_pack()
    raw["puzzles"][0]["puzzle_id"] = "PUZZLE_MISSING"
    nudge_path(raw)["reveal_when"] = {
        "any": [
            {"puzzle_completed": "PUZZLE_GONE"},
            {"hint_level": {"puzzle": "PUZZLE_NOPE", "gte": 1}},
        ]
    }

    assert link_codes(raw) == [
        ("UNKNOWN_PUZZLE", "PUZZLE_MISSING"),
        ("UNKNOWN_PUZZLE", "PUZZLE_GONE"),
        ("UNKNOWN_PUZZLE", "PUZZLE_NOPE"),
    ]


def test_completion_marker_is_accepted_as_puzzle_completed_target() -> None:
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = {"puzzle_completed": "SCENE_MARK_1"}

    assert link_codes(raw) == []


def test_completion_marker_cannot_be_puzzle_entry() -> None:
    raw = valid_pack()
    raw["puzzles"][0]["puzzle_id"] = "SCENE_MARK_1"

    assert link_codes(raw) == [("UNKNOWN_PUZZLE", "SCENE_MARK_1")]


def test_unknown_clue_and_flag() -> None:
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = {
        "all": [
            {"clue_acquired": "CLUE_NONE"},
            {"flag": {"name": "no_flag", "eq": True}},
        ]
    }

    assert link_codes(raw) == [
        ("UNKNOWN_CLUE", "CLUE_NONE"),
        ("UNKNOWN_FLAG", "no_flag"),
    ]


@pytest.mark.parametrize(
    ("puzzle", "gte", "expected"),
    [
        ("PUZZLE_A", 1, []),
        ("PUZZLE_A", 2, []),
        ("PUZZLE_B", 1, []),
        ("PUZZLE_B", 2, [("UNDEFINED_HINT_LEVEL", "PUZZLE_B:2")]),
    ],
)
def test_hint_level_reference_must_have_defined_hint(
    puzzle: str, gte: int, expected: list
) -> None:
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = {"hint_level": {"puzzle": puzzle, "gte": gte}}

    assert link_codes(raw) == expected


@pytest.mark.parametrize(
    "condition",
    [
        {"scene_reached": "SCENE_A"},
        {"scene_cleared": "SCENE_A"},
        {"ending_reached": "A"},
        {"any": [{"always": True}, {"scene_reached": "SCENE_A"}]},
    ],
)
def test_scene_and_ending_conditions_block_publication(condition: dict) -> None:
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = condition

    readiness = assess(raw)

    assert readiness.schema_valid is True
    assert readiness.links_valid is False
    assert "UNSUPPORTED_CONDITION" in codes(readiness)


@pytest.mark.parametrize(
    ("text", "reference"),
    [
        ("(가상) 정답은 가상 정답 에이 같아", "PUZZLE_A"),
        ("(가상) 참고: (가상) B 1단계 원문", "PUZZLE_B"),
        ("(가상) (가상) A 2단계 원문 이야", "PUZZLE_A"),
    ],
)
def test_nudge_containing_answer_or_hint_text_is_protected(
    text: str, reference: str
) -> None:
    for place in ("general", "puzzle"):
        raw = valid_pack()
        target = raw["general_nudges"][0] if place == "general" else nudge_path(raw)
        target["text"] = text

        readiness = assess(raw)

        assert readiness.links_valid is False
        [issue] = [i for i in readiness.issues if i.code == "PROTECTED_TEXT"]
        assert issue.reference == reference
        assert text not in repr(readiness)
        assert ANSWER_A not in repr(readiness)


def test_puzzle_nudge_gets_no_exception_for_own_answer() -> None:
    raw = valid_pack()
    nudge_path(raw)["text"] = f"(가상) {ANSWER_A}"

    assert ("PROTECTED_TEXT", "PUZZLE_A") in link_codes(raw)


def test_validation_does_not_mutate_input() -> None:
    raw = valid_pack()
    before = json.dumps(raw, sort_keys=True)

    assess(raw)

    assert json.dumps(raw, sort_keys=True) == before


# --- 계층 의존성 · 문법 검사 위치 ---


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
        elif isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    return modules


def test_schemas_do_not_import_service_layer() -> None:
    schemas_dir = Path(__file__).resolve().parents[1] / "app" / "schemas"

    offenders = {
        path.name: sorted(
            m for m in _imported_modules(path) if m.startswith("app.services")
        )
        for path in schemas_dir.glob("*.py")
    }

    assert {name: mods for name, mods in offenders.items() if mods} == {}


def test_model_alone_accepts_any_reveal_object_but_assessment_rejects_bad_syntax() -> (
    None
):
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = {"zone_entered": "ZONE_A"}

    # 모델은 형식만 본다(게시 가능 판정이 아니다).
    NpcContentPack.model_validate(raw)
    readiness = assess(raw)

    assert readiness.schema_valid is False
    assert readiness.links_valid is False
    assert readiness.servable is False
    assert [(i.code, i.location, i.reference) for i in readiness.issues] == [
        ("SCHEMA_INVALID", "$.puzzles.0.nudges.0.reveal_when", "unknown_condition")
    ]


@pytest.mark.parametrize(
    ("condition", "reason"),
    [
        ({}, "invalid"),
        ({"always": False}, "invalid"),
        ({"all": []}, "empty_group"),
        ({"zone_entered": "Z"}, "unknown_condition"),
    ],
)
def test_reveal_syntax_reason_matches_evaluator(condition: dict, reason: str) -> None:
    raw = valid_pack()
    raw["general_nudges"][0]["reveal_when"] = condition

    [issue] = assess(raw).issues

    assert issue.code == "SCHEMA_INVALID"
    assert issue.location == "$.general_nudges.0.reveal_when"
    assert issue.reference == evaluate_reveal_when(condition, {}).reason == reason


def test_direct_link_validation_never_passes_bad_syntax() -> None:
    raw = valid_pack()
    nudge_path(raw)["reveal_when"] = {}

    assert link_codes(raw) == [("SCHEMA_INVALID", "invalid")]


# --- 힌트 단계 참조 (PM v0.4.1) ---


def with_hints(levels: list[Any], *, puzzle_id: str = "PUZZLE_A") -> dict[str, Any]:
    raw = valid_pack()
    if puzzle_id == "PUZZLE_A":
        raw["puzzles"][0]["hints"] = [{"level": level} for level in levels]
    else:
        raw["puzzles"].append(
            {
                "puzzle_id": puzzle_id,
                "nudges": [
                    {
                        "line_id": "NUDGE_OTHER_PUZZLE",
                        "text": "(가상) 다른 곳도 보자.",
                        "reveal_when": {"always": True},
                    }
                ],
                "hints": [{"level": level} for level in levels],
            }
        )
    return raw


@pytest.mark.parametrize("levels", [[1], [2], [1, 2], [2, 1]])
def test_hint_level_references_are_accepted(levels: list[int]) -> None:
    raw = with_hints(levels)

    pack = NpcContentPack.model_validate(raw)
    readiness = assess(raw)

    assert [hint.level for hint in pack.puzzles[0].hints] == levels
    assert (readiness.schema_valid, readiness.links_valid) == (True, True)
    # 형식 · 참조가 맞아도 승인 검증이 없으므로 내보내지 않는다.
    assert readiness.publish_approved is False
    assert readiness.servable is False


def test_hints_are_optional_and_default_empty() -> None:
    assert NpcContentPack.model_validate(valid_pack()).puzzles[0].hints == []


def test_duplicate_hint_level_is_rejected() -> None:
    readiness = assess(with_hints([1, 1]))

    assert readiness.schema_valid is False


@pytest.mark.parametrize("level", [0, 3, -1, True, False, "1", 1.0, 2.0, None])
def test_invalid_hint_level_is_rejected(level: Any) -> None:
    assert assess(with_hints([level])).schema_valid is False


@pytest.mark.parametrize(
    "hint",
    [
        {"level": 1, "text": "(가상) 원문"},
        {"level": 1, "answer": "x"},
        {"level": 1, "content": "x"},
        {"level": 2, "reveal_when": {"always": True}},
        {"text": "(가상) 원문"},
        {},
    ],
)
def test_hint_reference_rejects_text_and_extra_fields(hint: dict) -> None:
    raw = valid_pack()
    raw["puzzles"][0]["hints"] = [hint]

    readiness = assess(raw)

    assert readiness.schema_valid is False
    assert "(가상) 원문" not in repr(readiness)


def test_hint_reference_to_unknown_puzzle_reports_puzzle_only() -> None:
    assert link_codes(with_hints([1, 2], puzzle_id="PUZZLE_MISSING")) == [
        ("UNKNOWN_PUZZLE", "PUZZLE_MISSING")
    ]


def test_hint_level_missing_in_server_hint_source_blocks_publication() -> None:
    raw = with_hints([1, 2], puzzle_id="PUZZLE_B")

    readiness = assess(raw)
    [issue] = [i for i in readiness.issues if i.code == "UNDEFINED_HINT_LEVEL"]

    assert readiness.schema_valid is True
    assert readiness.links_valid is False
    assert issue.location == "$.puzzles.1.hints.1"
    assert issue.reference == "PUZZLE_B:2"
    for text in HINTS.values():
        assert text not in repr(readiness)


def test_hint_references_do_not_relax_text_protection() -> None:
    raw = with_hints([1, 2])
    nudge_path(raw)["text"] = "(가상) (가상) A 2단계 원문 그대로"

    assert ("PROTECTED_TEXT", "PUZZLE_A") in link_codes(raw)
