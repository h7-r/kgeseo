import json
from pathlib import Path

import pytest

from app.schemas.puzzle_runtime import (
    ClueCombinationDefinition,
    InspectionDefinition,
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services import case_content, puzzle_runtime
from app.services.content_integrity import (
    canonical_json_bytes,
    canonical_json_sha256,
    content_fingerprint,
    file_sha256,
    find_undefined_completion_references,
    format_completion_reference_warnings,
)
from scripts import validate_case

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
SAMPLE = {
    "case_id": "CASE_TEST",
    "zones": [{"zone_id": "Z_A", "name": "가상 방"}],
    "n": 1,
}


def encoded(data: object, **kwargs) -> bytes:
    return json.dumps(data, **kwargs).encode("utf-8")


# --- 해시 ---


def test_hashes_are_stable_for_same_bytes() -> None:
    content = encoded(SAMPLE, ensure_ascii=False)

    assert file_sha256(content) == file_sha256(content)
    assert canonical_json_sha256(content) == canonical_json_sha256(bytes(content))
    assert len(file_sha256(content)) == 64


def test_canonical_hash_ignores_formatting_but_file_hash_does_not() -> None:
    compact = encoded(SAMPLE, ensure_ascii=False, separators=(",", ":"))
    pretty = encoded(
        dict(reversed(list(SAMPLE.items()))), ensure_ascii=True, indent=2
    ).replace(b"\n", b"\r\n")

    assert file_sha256(compact) != file_sha256(pretty)
    assert canonical_json_sha256(compact) == canonical_json_sha256(pretty)


def test_canonical_form_is_sorted_compact_utf8() -> None:
    content = b'{ "b": [2, 1], "a": "\\uac00" }'

    assert canonical_json_bytes(content) == '{"a":"가","b":[2,1]}'.encode("utf-8")


@pytest.mark.parametrize(
    "changed",
    [
        {**SAMPLE, "n": 2},
        {**SAMPLE, "n": 1.0},
        {**SAMPLE, "zones": [{"zone_id": "Z_A", "name": "가상 방 "}]},
        {**SAMPLE, "extra": None},
    ],
)
def test_content_change_changes_both_hashes(changed: dict) -> None:
    before = encoded(SAMPLE)
    after = encoded(changed)

    assert file_sha256(before) != file_sha256(after)
    assert canonical_json_sha256(before) != canonical_json_sha256(after)


def test_array_order_is_preserved_in_canonical_hash() -> None:
    assert canonical_json_sha256(b"[1,2]") != canonical_json_sha256(b"[2,1]")


@pytest.mark.parametrize(
    "content",
    [b"\xef\xbb\xbf{}", b'{"a": NaN}', b'{"a": Infinity}', b"{", b"\xff"],
)
def test_canonical_hash_rejects_what_loaders_cannot_read(content: bytes) -> None:
    with pytest.raises(ValueError):
        canonical_json_sha256(content)


def test_fingerprint_combines_roles_and_detects_changes() -> None:
    client = encoded({"case_id": "CASE_TEST", "zones": []})
    server = encoded({"case_id": "CASE_TEST", "puzzles": []})
    idmap = encoded({"Z1": "ZONE_A"})

    base = content_fingerprint({"client": client, "server": server})
    reformatted = content_fingerprint(
        {"server": encoded(json.loads(server), indent=4), "client": client}
    )

    assert base == reformatted
    assert (
        content_fingerprint({"client": client, "server": server, "idmap": idmap})
        != base
    )
    assert content_fingerprint({"client": server, "server": client}) != base
    assert (
        content_fingerprint({"client": client, "server": encoded({"case_id": "X"})})
        != base
    )
    with pytest.raises(ValueError):
        content_fingerprint({})


# --- complete_puzzle_ids 참조 점검 ---


def effect(*complete: str) -> RuntimeEffect:
    return RuntimeEffect(
        grant_clue_ids=[], set_flags={}, complete_puzzle_ids=list(complete)
    )


def make_runtime(
    *,
    puzzle_completes: tuple[str, ...] = (),
    inspect_completes: tuple[str, ...] = (),
    combination_completes: tuple[str, ...] = (),
) -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id="CASE_TEST",
        puzzles=[
            PuzzleDefinition(
                puzzle_id="PZ_LOCK_01",
                accepted_answers=["가상정답"],
                on_correct=effect(*puzzle_completes),
            ),
            PuzzleDefinition(
                puzzle_id="PZ_LOCK_02",
                accepted_answers=["가상정답"],
                on_correct=effect(),
            ),
        ],
        clue_combinations=[
            ClueCombinationDefinition(
                combination_id="CB_01",
                clue_ids=["CL_A", "CL_B"],
                on_success=effect(*combination_completes),
            )
        ],
        inspections=[
            InspectionDefinition(
                inspect_id="IN_01", on_inspect=effect(*inspect_completes)
            )
        ],
    )


def test_defined_references_produce_no_warning() -> None:
    runtime = make_runtime(
        puzzle_completes=("PZ_LOCK_02",),
        inspect_completes=("PZ_LOCK_01",),
        combination_completes=("PZ_LOCK_01", "PZ_LOCK_02"),
    )

    assert find_undefined_completion_references(runtime) == []
    assert format_completion_reference_warnings([]) == []


def test_undefined_reference_is_marker_candidate() -> None:
    runtime = make_runtime(inspect_completes=("SCENE_1_DONE",))

    [reference] = find_undefined_completion_references(runtime)

    assert reference.puzzle_id == "SCENE_1_DONE"
    assert reference.kind == "marker_candidate"
    assert reference.owners == ("Inspection 'IN_01' on_inspect",)
    assert reference.duplicate_owners == ()
    assert reference.similar_to is None


@pytest.mark.parametrize(
    ("puzzle_id", "similar"),
    [
        ("pz_lock_01", "PZ_LOCK_01"),
        ("PZ_LOCK_1", "PZ_LOCK_01"),
        ("PZ_LOCKK_02", "PZ_LOCK_02"),
    ],
)
def test_reference_close_to_defined_puzzle_is_typo_suspect(
    puzzle_id: str, similar: str
) -> None:
    [reference] = find_undefined_completion_references(
        make_runtime(combination_completes=(puzzle_id,))
    )

    assert reference.kind == "near_defined_puzzle"
    assert reference.similar_to == similar


def test_duplicate_reference_in_same_effect_is_reported_once() -> None:
    [reference] = find_undefined_completion_references(
        make_runtime(puzzle_completes=("SCENE_X", "SCENE_X", "SCENE_X"))
    )

    assert reference.owners == ("Puzzle 'PZ_LOCK_01' on_correct",)
    assert reference.duplicate_owners == (
        "Puzzle 'PZ_LOCK_01' on_correct",
        "Puzzle 'PZ_LOCK_01' on_correct",
    )
    [line] = format_completion_reference_warnings([reference])
    assert "같은 효과 안 중복 2회" in line


@pytest.mark.parametrize("blank", ["", "   "])
def test_blank_reference_is_reported(blank: str) -> None:
    [reference] = find_undefined_completion_references(
        make_runtime(inspect_completes=(blank,))
    )

    assert reference.kind == "blank_id"
    assert reference.similar_to is None


def test_same_reference_from_multiple_effect_paths_lists_all_owners() -> None:
    references = find_undefined_completion_references(
        make_runtime(
            puzzle_completes=("SCENE_END",),
            inspect_completes=("SCENE_END", "OTHER_MARK"),
            combination_completes=("SCENE_END",),
        )
    )

    by_id = {reference.puzzle_id: reference for reference in references}
    assert set(by_id) == {"SCENE_END", "OTHER_MARK"}
    assert by_id["SCENE_END"].owners == (
        "Puzzle 'PZ_LOCK_01' on_correct",
        "Inspection 'IN_01' on_inspect",
        "Combination 'CB_01' on_success",
    )
    assert by_id["OTHER_MARK"].owners == ("Inspection 'IN_01' on_inspect",)


def test_reference_check_does_not_mutate_runtime_or_change_validation() -> None:
    runtime = make_runtime(inspect_completes=("SCENE_1_DONE",))
    before = runtime.model_dump()

    find_undefined_completion_references(runtime)

    assert runtime.model_dump() == before
    # 같은 데이터는 지금처럼 Server Runtime Schema 검증을 통과한다(경고만).
    PuzzleRuntimeDefinition.model_validate(runtime.model_dump(exclude_unset=True))


def test_warning_lines_do_not_include_answers() -> None:
    runtime = make_runtime(inspect_completes=("SCENE_1_DONE",))
    lines = format_completion_reference_warnings(
        find_undefined_completion_references(runtime)
    )

    assert lines == [
        "[WARN] Server Runtime: complete_puzzle_ids → 'SCENE_1_DONE' → 정의 없는 완료 마커 후보"
        " → 참조 1곳: Inspection 'IN_01' on_inspect"
    ]
    assert all("가상정답" not in line for line in lines)


# --- validate_case CLI ---


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    return tmp_path


def write_case(directory: Path, *, inspect_completes: list[str]) -> None:
    (directory / "CASE_TEST.client.json").write_text(
        json.dumps(
            {
                "case_id": "CASE_TEST",
                "entry_zone_id": "ZONE_01",
                "zones": [
                    {
                        "zone_id": "ZONE_01",
                        "zone_name": "First",
                        "zone_type": "room",
                        "description": "First zone",
                        "objects": [
                            {
                                "object_id": "OBJ_LOCK",
                                "object_name": "Lock",
                                "object_type": "lock",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "input",
                                    "target_id": "PZ_LOCK_01",
                                },
                            },
                            {
                                "object_id": "OBJ_NOTE",
                                "object_name": "Note",
                                "object_type": "note",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "inspect",
                                    "target_id": "IN_01",
                                },
                            },
                        ],
                        "navigation": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (directory / "CASE_TEST.server.json").write_text(
        json.dumps(
            {
                "schema_version": "0.1",
                "case_id": "CASE_TEST",
                "puzzles": [
                    {
                        "puzzle_id": "PZ_LOCK_01",
                        "accepted_answers": ["가상정답"],
                        "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                    }
                ],
                "clue_combinations": [],
                "inspections": [
                    {
                        "inspect_id": "IN_01",
                        "on_inspect": {
                            "grant_clue_ids": [],
                            "set_flags": {},
                            "complete_puzzle_ids": inspect_completes,
                        },
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_cli_without_warnings_keeps_previous_output(
    case_directory: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_case(case_directory, inspect_completes=["PZ_LOCK_01"])

    assert validate_case.main(["CASE_TEST"]) == 0
    output = capsys.readouterr()
    assert output.out.splitlines() == [
        "[OK] Client Content Schema",
        "[OK] Server Runtime Schema",
        "[OK] Client-Server Links",
        "Case 'CASE_TEST': VALID",
    ]
    assert output.err == ""


def test_cli_prints_warning_but_stays_valid(
    case_directory: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_case(case_directory, inspect_completes=["SCENE_1_DONE"])

    assert validate_case.main(["CASE_TEST"]) == 0
    output = capsys.readouterr()
    lines = output.out.splitlines()
    assert lines[:3] == [
        "[OK] Client Content Schema",
        "[OK] Server Runtime Schema",
        "[OK] Client-Server Links",
    ]
    assert lines[3].startswith(
        "[WARN] Server Runtime: complete_puzzle_ids → 'SCENE_1_DONE'"
    )
    assert lines[-1] == "Case 'CASE_TEST': VALID"
    assert len(lines) == 5
    assert output.err == ""
    assert "가상정답" not in output.out
