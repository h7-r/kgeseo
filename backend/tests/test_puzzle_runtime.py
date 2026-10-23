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
CLUES = [
    {"clue_id": clue_id, "title": clue_id}
    for clue_id in ("clue_03", "clue_07", "clue_10")
]


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
            "companion",
            {"npc_id": "companion_01"},
            ("companion",),
            id="top_level_companion",
        ),
        pytest.param(
            ("clues", 0),
            "carrier_kind",
            "letter",
            ("clues", 0, "carrier_kind"),
            id="clue_carrier_kind",
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
    valid_runtime_data["clues"] = deepcopy(CLUES)
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
    valid_runtime_data["companion"] = {}
    valid_runtime_data["puzzles"][0]["requires_clue_ids"] = []
    valid_runtime_data["puzzles"][0]["on_correct"]["set_clue_states"] = {}
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert sorted(validation_errors(error)) == [
        (("companion",), "extra_forbidden"),
        (("puzzles", 0, "on_correct", "set_clue_states"), "extra_forbidden"),
        (("puzzles", 0, "requires_clue_ids"), "extra_forbidden"),
    ]


def test_load_case_runtime_reads_clue_definitions(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["clues"] = [
        {"clue_id": "clue_03", "title": "낡은 서신", "summary": "요약", "body": "본문"},
        {"clue_id": "clue_07", "title": "일기"},
        {"clue_id": "clue_10", "title": "진실", "summary": None},
    ]
    write_runtime(cases_directory, valid_runtime_data)

    runtime = load_case_runtime("case_001")

    assert [clue.clue_id for clue in runtime.clues] == ["clue_03", "clue_07", "clue_10"]
    assert runtime.clues[0].body == "본문"
    assert (runtime.clues[1].summary, runtime.clues[1].body) == (None, None)


def test_load_case_runtime_without_clues_keeps_id_only_clues(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    write_runtime(cases_directory, valid_runtime_data)

    runtime = load_case_runtime("case_001")

    assert runtime.clues == []
    assert runtime.puzzles[0].on_correct.grant_clue_ids == ["clue_03"]


@pytest.mark.parametrize(
    "clue",
    [
        pytest.param({"clue_id": "", "title": "t"}, id="empty_id"),
        pytest.param({"clue_id": "   ", "title": "t"}, id="blank_id"),
        pytest.param({"clue_id": "clue_03"}, id="missing_title"),
        pytest.param({"clue_id": "clue_03", "title": "  "}, id="blank_title"),
        pytest.param(
            {"clue_id": "clue_03", "title": "t", "summary": ""}, id="empty_summary"
        ),
        pytest.param(
            {"clue_id": "clue_03", "title": "t", "body": " \n"}, id="blank_body"
        ),
        pytest.param({"clue_id": "clue_03", "title": 3}, id="non_string_title"),
        pytest.param(
            {"clue_id": "clue_03", "title": "t", "asset_key": "x"}, id="asset_key"
        ),
    ],
)
def test_load_case_runtime_rejects_invalid_clue(
    cases_directory: Path,
    valid_runtime_data: dict,
    clue: dict,
) -> None:
    # 다른 참조는 모두 정의해 두고, 잘못된 단서 정의 자체 때문에 실패하는지 확인한다.
    valid_runtime_data["clues"] = [clue, *deepcopy(CLUES[1:])]
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    locations = [loc for loc, _ in validation_errors(error)]
    assert locations and all(loc[:2] == ("clues", 0) for loc in locations)


def test_load_case_runtime_rejects_duplicate_clue_id(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["clues"] = deepcopy(CLUES) + [deepcopy(CLUES[0])]
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert "Duplicate clue_id: 'clue_03'" in str(error.value.__cause__)


@pytest.mark.parametrize(
    ("missing", "owner"),
    [
        pytest.param("clue_03", "Puzzle 'puzzle_01'", id="puzzle_grant"),
        pytest.param(
            "clue_07", "Clue combination 'combination_01'", id="combination_input"
        ),
        pytest.param(
            "clue_10", "Clue combination 'combination_01'", id="combination_grant"
        ),
        pytest.param("clue_99", "Inspection 'inspect_01'", id="inspection_grant"),
    ],
)
def test_load_case_runtime_rejects_undefined_clue_reference(
    cases_directory: Path,
    valid_runtime_data: dict,
    missing: str,
    owner: str,
) -> None:
    inspection = deepcopy(INSPECTION)
    inspection["on_inspect"]["grant_clue_ids"] = ["clue_99"]
    valid_runtime_data["inspections"] = [inspection]
    valid_runtime_data["clues"] = [
        clue
        for clue in deepcopy(CLUES) + [{"clue_id": "clue_99", "title": "t"}]
        if clue["clue_id"] != missing
    ]
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert f"{owner} references clue '{missing}' not defined in clues" in str(
        error.value.__cause__
    )


def test_load_case_runtime_explicit_empty_clues_requires_definitions(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["clues"] = []
    write_runtime(cases_directory, valid_runtime_data)

    with pytest.raises(CaseRuntimeValidationError) as error:
        load_case_runtime("case_001")

    assert "references clue 'clue_03' not defined in clues" in str(
        error.value.__cause__
    )


def test_load_case_runtime_allows_defined_but_never_granted_clue(
    cases_directory: Path,
    valid_runtime_data: dict,
) -> None:
    valid_runtime_data["clues"] = deepcopy(CLUES) + [
        {"clue_id": "clue_extra", "title": "t"}
    ]
    write_runtime(cases_directory, valid_runtime_data)

    assert len(load_case_runtime("case_001").clues) == 4


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
