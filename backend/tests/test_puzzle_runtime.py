import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.services import puzzle_runtime
from app.services.puzzle_runtime import (
    CaseRuntimeJSONDecodeError,
    CaseRuntimeNotFoundError,
    CaseRuntimeValidationError,
    InvalidCaseIdError,
    load_case_runtime,
    normalize_answer,
)


@pytest.fixture
def cases_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    return tmp_path


@pytest.fixture
def valid_runtime_data() -> dict:
    return {
        "schema_version": "0.1",
        "case_id": "case_001",
        "puzzles": [
            {
                "puzzle_id": "puzzle_01",
                "accepted_answers": ["아랑사"],
                "on_correct": {
                    "grant_clue_ids": ["clue_03"],
                    "set_flags": {"archive_unlocked": True},
                },
            },
        ],
        "clue_combinations": [
            {
                "combination_id": "combination_01",
                "clue_ids": ["clue_03", "clue_07"],
                "on_success": {
                    "grant_clue_ids": ["clue_10"],
                    "set_flags": {"truth_fragment_01": True},
                },
            },
        ],
    }


def write_runtime(
    cases_directory: Path,
    runtime_data: dict,
    *,
    case_id: str = "case_001",
) -> None:
    runtime_path = cases_directory / f"{case_id}.server.json"
    runtime_path.write_text(
        json.dumps(runtime_data, ensure_ascii=False),
        encoding="utf-8",
    )


def test_load_case_runtime(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    write_runtime(cases_directory, valid_runtime_data)

    runtime = load_case_runtime("case_001")

    assert runtime.schema_version == "0.1"
    assert runtime.case_id == "case_001"
    assert runtime.puzzles[0].puzzle_id == "puzzle_01"
    assert runtime.puzzles[0].accepted_answers == ["아랑사"]
    assert runtime.puzzles[0].on_correct.complete_puzzle_ids == []
    assert runtime.clue_combinations[0].clue_ids == ["clue_03", "clue_07"]


def test_load_case_runtime_accepts_unique_puzzle_ids(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["puzzles"].append(
        {
            "puzzle_id": "puzzle_02",
            "accepted_answers": ["different"],
            "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        }
    )
    write_runtime(cases_directory, valid_runtime_data)

    runtime = load_case_runtime("case_001")

    assert [puzzle.puzzle_id for puzzle in runtime.puzzles] == [
        "puzzle_01",
        "puzzle_02",
    ]


def test_load_case_runtime_rejects_duplicate_puzzle_id(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["puzzles"].append(
        {
            "puzzle_id": "puzzle_01",
            "accepted_answers": ["different"],
            "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        }
    )
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert "puzzle_01" in str(error.value.__cause__)


def test_load_case_runtime_reads_complete_puzzle_ids(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["clue_combinations"][0]["on_success"]["complete_puzzle_ids"] = [
        "puzzle_02"
    ]
    write_runtime(cases_directory, valid_runtime_data)

    runtime = load_case_runtime("case_001")

    assert runtime.clue_combinations[0].on_success.complete_puzzle_ids == [
        "puzzle_02",
    ]


@pytest.mark.parametrize(
    "clue_ids",
    [
        ["clue_03"],
        ["clue_03", "clue_07", "clue_10"],
    ],
)
def test_load_case_runtime_rejects_invalid_clue_count(
    cases_directory: Path,
    valid_runtime_data: dict,
    clue_ids: list[str],
) -> None:
    valid_runtime_data["clue_combinations"][0]["clue_ids"] = clue_ids
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError):
        load_case_runtime("case_001")


def test_load_case_runtime_rejects_empty_accepted_answers(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["puzzles"][0]["accepted_answers"] = []
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError):
        load_case_runtime("case_001")


def test_load_case_runtime_raises_for_missing_file(
    cases_directory: Path,
) -> None:
    with pytest.raises(CaseRuntimeNotFoundError):
        load_case_runtime("missing_case")


def test_load_case_runtime_rejects_invalid_json(cases_directory: Path) -> None:
    runtime_path = cases_directory / "case_001.server.json"
    runtime_path.write_text("{invalid json", encoding="utf-8")

    with pytest.raises(CaseRuntimeJSONDecodeError):
        load_case_runtime("case_001")


def test_load_case_runtime_rejects_invalid_schema(
    cases_directory: Path,
) -> None:
    write_runtime(
        cases_directory,
        {
            "schema_version": "0.1",
            "case_id": "case_001",
            "puzzles": "not-a-list",
            "clue_combinations": [],
        },
    )

    with pytest.raises(CaseRuntimeValidationError):
        load_case_runtime("case_001")


INSPECTION = {
    "inspect_id": "inspect_01",
    "on_inspect": {"grant_clue_ids": [], "set_flags": {}},
}


def put_field(data: dict, path: tuple, key: str, value: object) -> None:
    node = data
    for part in path:
        node = node[part]
    node[key] = value


def validation_errors(error: pytest.ExceptionInfo) -> list[tuple[tuple, str]]:
    return [(item["loc"], item["type"]) for item in error.value.__cause__.errors()]


def test_load_case_runtime_accepts_all_defined_optional_fields(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["puzzles"][0]["on_correct"]["complete_puzzle_ids"] = []
    valid_runtime_data["puzzles"][0]["on_correct"]["set_object_states"] = [
        {"zone_id": "ZONE_01", "object_id": "OBJ_01", "visible": True}
    ]
    valid_runtime_data["inspections"] = [deepcopy(INSPECTION)]
    write_runtime(cases_directory, valid_runtime_data)

    runtime = load_case_runtime("case_001")

    assert runtime.inspections[0].inspect_id == "inspect_01"
    assert runtime.puzzles[0].on_correct.set_object_states[0].visible is True


@pytest.mark.parametrize(
    ("path", "key", "value", "expected_loc"),
    [
        pytest.param((), "version_note", "x", ("version_note",), id="top_level"),
        pytest.param(
            ("puzzles", 0), "hint_text", "x", ("puzzles", 0, "hint_text"), id="puzzle"
        ),
        pytest.param(
            ("inspections", 0),
            "note",
            "x",
            ("inspections", 0, "note"),
            id="inspection",
        ),
        pytest.param(
            ("clue_combinations", 0),
            "combo_hint",
            "x",
            ("clue_combinations", 0, "combo_hint"),
            id="clue_combination",
        ),
        pytest.param(
            ("puzzles", 0, "on_correct"),
            "set_clue_states",
            {},
            ("puzzles", 0, "on_correct", "set_clue_states"),
            id="on_correct_effect",
        ),
        pytest.param(
            ("clue_combinations", 0, "on_success"),
            "unlock_ending",
            True,
            ("clue_combinations", 0, "on_success", "unlock_ending"),
            id="on_success_effect",
        ),
        pytest.param(
            ("inspections", 0, "on_inspect"),
            "play_sound",
            "x",
            ("inspections", 0, "on_inspect", "play_sound"),
            id="on_inspect_effect",
        ),
        pytest.param(
            ("puzzles", 0),
            "requires_clue_ids",
            ["clue_03"],
            ("puzzles", 0, "requires_clue_ids"),
            id="puzzle_requires_clue_ids",
        ),
        pytest.param(
            ("inspections", 0),
            "requires_clue_ids",
            ["clue_03"],
            ("inspections", 0, "requires_clue_ids"),
            id="inspection_requires_clue_ids",
        ),
        pytest.param(
            (),
            "clues",
            [{"clue_id": "clue_03", "title": "Letter"}],
            ("clues",),
            id="top_level_clues",
        ),
    ],
)
def test_load_case_runtime_rejects_unsupported_field(
    cases_directory: Path,
    valid_runtime_data: dict,
    path: tuple,
    key: str,
    value: object,
    expected_loc: tuple,
) -> None:
    valid_runtime_data["inspections"] = [deepcopy(INSPECTION)]
    put_field(valid_runtime_data, path, key, value)
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert validation_errors(error) == [(expected_loc, "extra_forbidden")]


def test_load_case_runtime_reports_renamed_effect_field(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    puzzle = valid_runtime_data["puzzles"][0]
    puzzle["success_effects"] = puzzle.pop("on_correct")
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert sorted(validation_errors(error)) == [
        (("puzzles", 0, "on_correct"), "missing"),
        (("puzzles", 0, "success_effects"), "extra_forbidden"),
    ]


def test_load_case_runtime_reports_every_unsupported_field(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["clues"] = []
    valid_runtime_data["puzzles"][0]["requires_clue_ids"] = []
    valid_runtime_data["puzzles"][0]["on_correct"]["set_clue_states"] = {}
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert sorted(validation_errors(error)) == [
        (("clues",), "extra_forbidden"),
        (("puzzles", 0, "on_correct", "set_clue_states"), "extra_forbidden"),
        (("puzzles", 0, "requires_clue_ids"), "extra_forbidden"),
    ]


def test_load_case_runtime_rejects_path_traversal(
    cases_directory: Path,
) -> None:
    with pytest.raises(InvalidCaseIdError):
        load_case_runtime("../../secret")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("아랑사", "아랑사"),
        (" 아랑사 ", "아랑사"),
        ("아랑 사", "아랑사"),
        ("아 랑 사", "아랑사"),
        (" Answer ", "answer"),
        ("1 2 3 4", "1234"),
    ],
)
def test_normalize_answer(value: str, expected: str) -> None:
    assert normalize_answer(value) == expected
