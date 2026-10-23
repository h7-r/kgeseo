import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.services import case_content, puzzle_runtime
from scripts import validate_case

CASE_ID = "CASE_TEST"


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    return tmp_path


def write_client(directory: Path, *, target_id: str = "PUZZLE_01") -> None:
    (directory / f"{CASE_ID}.client.json").write_text(
        json.dumps(
            {
                "case_id": CASE_ID,
                "entry_zone_id": "ZONE_01",
                "zones": [
                    {
                        "zone_id": "ZONE_01",
                        "zone_name": "First",
                        "zone_type": "room",
                        "description": "First zone",
                        "objects": [
                            {
                                "object_id": "OBJ_01",
                                "object_name": "Lock",
                                "object_type": "lock",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "input",
                                    "target_id": target_id,
                                },
                            }
                        ],
                        "navigation": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def write_server(directory: Path) -> None:
    (directory / f"{CASE_ID}.server.json").write_text(
        json.dumps(
            {
                "schema_version": "0.1",
                "case_id": CASE_ID,
                "puzzles": [
                    {
                        "puzzle_id": "PUZZLE_01",
                        "accepted_answers": ["answer"],
                        "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                    }
                ],
                "clue_combinations": [],
            }
        ),
        encoding="utf-8",
    )


def test_valid_case_reports_all_stages(
    case_directory: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_client(case_directory)
    write_server(case_directory)

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 0
    assert output.out.splitlines() == [
        "[OK] Client Content Schema",
        "[OK] Server Runtime Schema",
        "[OK] Client-Server Links",
        "Case 'CASE_TEST': VALID",
    ]
    assert output.err == ""


def test_missing_client_stops_before_server_and_links(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_call(*args: object) -> None:
        raise AssertionError("Later stage was called")

    monkeypatch.setattr(validate_case, "load_case_runtime", unexpected_call)
    monkeypatch.setattr(validate_case, "validate_case_content_links", unexpected_call)

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert output.out == ""
    assert "[FAIL] Client Content Schema: CaseClientContentNotFoundError" in output.err
    assert "Case 'CASE_TEST': INVALID" in output.err
    assert "Traceback" not in output.err


@pytest.mark.parametrize(
    ("contents", "error_name"),
    [
        ("{invalid json", "CaseClientContentJSONDecodeError"),
        (
            '{"case_id": "CASE_TEST", "zones": "invalid"}',
            "CaseClientContentValidationError",
        ),
    ],
)
def test_invalid_client_content_fails(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
    contents: str,
    error_name: str,
) -> None:
    (case_directory / f"{CASE_ID}.client.json").write_text(contents, encoding="utf-8")

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert f"[FAIL] Client Content Schema: {error_name}" in output.err
    assert "[OK] Server Runtime Schema" not in output.out


def test_invalid_entry_zone_fails_at_client_schema(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    write_client(case_directory)
    client_path = case_directory / f"{CASE_ID}.client.json"
    client_data = json.loads(client_path.read_text(encoding="utf-8"))
    client_data["entry_zone_id"] = "ZONE_MISSING"
    client_path.write_text(json.dumps(client_data), encoding="utf-8")

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert "[FAIL] Client Content Schema: CaseClientContentValidationError" in (
        output.err
    )
    assert "[OK] Server Runtime Schema" not in output.out


def test_missing_server_stops_before_links(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    write_client(case_directory)

    def unexpected_links(*args: object) -> None:
        raise AssertionError("Link validation was called")

    monkeypatch.setattr(validate_case, "validate_case_content_links", unexpected_links)

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert "[OK] Client Content Schema" in output.out
    assert "[FAIL] Server Runtime Schema: CaseRuntimeNotFoundError" in output.err
    assert "[OK] Client-Server Links" not in output.out


@pytest.mark.parametrize(
    ("contents", "error_name"),
    [
        ("{invalid json", "CaseRuntimeJSONDecodeError"),
        (
            '{"case_id": "CASE_TEST", "puzzles": "invalid"}',
            "CaseRuntimeValidationError",
        ),
    ],
)
def test_invalid_server_runtime_fails(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
    contents: str,
    error_name: str,
) -> None:
    write_client(case_directory)
    (case_directory / f"{CASE_ID}.server.json").write_text(contents, encoding="utf-8")

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert f"[FAIL] Server Runtime Schema: {error_name}" in output.err
    assert "[OK] Client-Server Links" not in output.out


def test_missing_puzzle_target_fails_at_links(
    case_directory: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_client(case_directory, target_id="PUZZLE_MISSING")
    write_server(case_directory)

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert "[OK] Client Content Schema" in output.out
    assert "[OK] Server Runtime Schema" in output.out
    assert "[FAIL] Client-Server Links: CaseContentLinkValidationError" in output.err
    assert "OBJ_01" in output.err
    assert "PUZZLE_MISSING" in output.err
    assert "Case 'CASE_TEST': INVALID" in output.err


def test_unsafe_case_id_fails_without_traceback(
    case_directory: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = validate_case.main(["../secret"])

    output = capsys.readouterr()
    assert exit_code == 1
    assert "[FAIL] Client Content Schema: InvalidClientCaseIdError" in output.err
    assert "Traceback" not in output.err


def test_module_entry_point_does_not_require_db_settings() -> None:
    environment = os.environ.copy()
    environment["DB_PORT"] = "not-a-port"
    repository_root = Path(__file__).resolve().parents[1]

    result = subprocess.run(
        [sys.executable, "-m", "scripts.validate_case", "--help"],
        cwd=repository_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0
    assert "case_id" in result.stdout
    assert result.stderr == ""


def rewrite_server(directory: Path, change) -> None:
    write_server(directory)
    server_path = directory / f"{CASE_ID}.server.json"
    server_data = json.loads(server_path.read_text(encoding="utf-8"))
    change(server_data)
    server_path.write_text(json.dumps(server_data), encoding="utf-8")


def test_unsupported_server_field_reports_file_path_type_and_message(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    write_client(case_directory)

    def add_requires(data: dict) -> None:
        data["puzzles"][0]["accepted_answers"] = ["SECRET_ANSWER"]
        data["puzzles"][0]["requires_clue_ids"] = ["SECRET_CLUE"]

    rewrite_server(case_directory, add_requires)

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert "[OK] Client Content Schema" in output.out
    assert output.err.splitlines() == [
        "[FAIL] Server Runtime Schema: CaseRuntimeValidationError",
        "CASE_TEST.server.json → puzzles.0.requires_clue_ids → extra_forbidden"
        " → Extra inputs are not permitted",
        "Case 'CASE_TEST': INVALID",
    ]
    assert "SECRET_ANSWER" not in output.err
    assert "SECRET_CLUE" not in output.err
    assert "Traceback" not in output.err


def test_every_server_schema_error_is_reported(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    write_client(case_directory)

    def break_runtime(data: dict) -> None:
        data["clues"] = []
        puzzle = data["puzzles"][0]
        puzzle["success_effects"] = puzzle.pop("on_correct")

    rewrite_server(case_directory, break_runtime)

    exit_code = validate_case.main([CASE_ID])

    error_lines = capsys.readouterr().err.splitlines()
    assert exit_code == 1
    assert sorted(error_lines[1:-1]) == [
        "CASE_TEST.server.json → clues → extra_forbidden"
        " → Extra inputs are not permitted",
        "CASE_TEST.server.json → puzzles.0.on_correct → missing → Field required",
        "CASE_TEST.server.json → puzzles.0.success_effects → extra_forbidden"
        " → Extra inputs are not permitted",
    ]


def test_client_schema_error_reports_location(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    write_client(case_directory)
    client_path = case_directory / f"{CASE_ID}.client.json"
    client_data = json.loads(client_path.read_text(encoding="utf-8"))
    client_data["zones"][0]["objects"][0]["visible"] = "sometimes"
    client_path.write_text(json.dumps(client_data), encoding="utf-8")

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert (
        "CASE_TEST.client.json → zones.0.objects.0.visible → bool_parsing"
        " → Input should be a valid boolean, unable to interpret input"
    ) in output.err.splitlines()
    assert "sometimes" not in output.err


def test_invalid_server_json_reports_line_and_column(
    case_directory: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    write_client(case_directory)
    (case_directory / f"{CASE_ID}.server.json").write_text(
        '{\n  "case_id": CASE_TEST\n}', encoding="utf-8"
    )

    exit_code = validate_case.main([CASE_ID])

    output = capsys.readouterr()
    assert exit_code == 1
    assert "[FAIL] Server Runtime Schema: CaseRuntimeJSONDecodeError" in output.err
    assert (
        "CASE_TEST.server.json → line 2, column 14 → json_invalid → Expecting value"
    ) in output.err.splitlines()


def test_detail_output_survives_stream_without_arrow_support(
    case_directory: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    write_client(case_directory)
    rewrite_server(case_directory, lambda data: data.update({"clues": []}))
    stream = io.TextIOWrapper(io.BytesIO(), encoding="ascii")
    monkeypatch.setattr(sys, "stderr", stream)

    exit_code = validate_case.main([CASE_ID])

    stream.flush()
    written = stream.buffer.getvalue().decode("ascii")
    assert exit_code == 1
    assert "CASE_TEST.server.json \\u2192 clues \\u2192 extra_forbidden" in written
    assert "Case 'CASE_TEST': INVALID" in written
