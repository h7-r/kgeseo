import json
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
