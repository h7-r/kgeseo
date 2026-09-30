import json
from pathlib import Path

import pytest

from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services import case_content, puzzle_runtime
from app.services.case_content_validation import (
    CaseContentLinkValidationError,
    validate_case_content_links,
)


@pytest.fixture
def client_data() -> dict:
    return {
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
                        "object_id": "OBJ_01",
                        "object_name": "Lock",
                        "object_type": "lock",
                        "visible": True,
                        "enabled": True,
                        "interaction": {"type": "input", "target_id": "PUZZLE_01"},
                    }
                ],
                "navigation": [],
            }
        ],
    }


@pytest.fixture
def server_data() -> dict:
    return {
        "schema_version": "0.1",
        "case_id": "CASE_TEST",
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_01",
                "accepted_answers": ["answer"],
                "on_correct": {"grant_clue_ids": [], "set_flags": {}},
            }
        ],
        "clue_combinations": [],
    }


def validate_data(client_data: dict, server_data: dict) -> None:
    validate_case_content_links(
        CaseClientContent.model_validate(client_data),
        PuzzleRuntimeDefinition.model_validate(server_data),
    )


def test_input_target_exists(client_data: dict, server_data: dict) -> None:
    validate_data(client_data, server_data)


def test_missing_input_target_raises_link_error(
    client_data: dict, server_data: dict
) -> None:
    client_data["zones"][0]["objects"][0]["interaction"]["target_id"] = "PUZZLE_999"

    with pytest.raises(
        CaseContentLinkValidationError,
        match="Client Object 'OBJ_01' references missing puzzle 'PUZZLE_999'",
    ):
        validate_data(client_data, server_data)


def test_case_id_mismatch_is_checked_before_object_links(
    client_data: dict, server_data: dict
) -> None:
    server_data["case_id"] = "OTHER_CASE"
    client_data["zones"][0]["objects"][0]["interaction"]["target_id"] = "MISSING"

    with pytest.raises(
        CaseContentLinkValidationError,
        match="Client case_id 'CASE_TEST' does not match Server case_id 'OTHER_CASE'",
    ):
        validate_data(client_data, server_data)


def test_later_zone_object_is_validated(client_data: dict, server_data: dict) -> None:
    client_data["zones"].append(
        {
            "zone_id": "ZONE_02",
            "zone_name": "Second",
            "zone_type": "room",
            "description": "Second zone",
            "objects": [
                {
                    "object_id": "OBJ_02",
                    "object_name": "Second lock",
                    "object_type": "lock",
                    "visible": True,
                    "enabled": True,
                    "interaction": {"type": "input", "target_id": "PUZZLE_02"},
                }
            ],
            "navigation": [],
        }
    )
    server_data["puzzles"].append(
        {
            "puzzle_id": "PUZZLE_02",
            "accepted_answers": ["other answer"],
            "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        }
    )

    validate_data(client_data, server_data)

    client_data["zones"][1]["objects"][0]["interaction"]["target_id"] = "PUZZLE_999"
    with pytest.raises(CaseContentLinkValidationError, match="OBJ_02"):
        validate_data(client_data, server_data)


def test_object_without_interaction_is_skipped(
    client_data: dict, server_data: dict
) -> None:
    del client_data["zones"][0]["objects"][0]["interaction"]

    validate_data(client_data, server_data)


@pytest.mark.parametrize("interaction_type", ["inspect", "select", "navigate"])
def test_non_input_interaction_is_not_mapped_to_server_target(
    client_data: dict, server_data: dict, interaction_type: str
) -> None:
    client_data["zones"][0]["objects"][0]["interaction"] = {
        "type": interaction_type,
        "target_id": "UNMAPPED",
    }

    validate_data(client_data, server_data)


def test_equal_object_and_target_ids_can_be_valid(
    client_data: dict, server_data: dict
) -> None:
    client_data["zones"][0]["objects"][0]["interaction"]["target_id"] = "OBJ_01"
    server_data["puzzles"][0]["puzzle_id"] = "OBJ_01"

    validate_data(client_data, server_data)


def test_validator_does_not_mutate_models(client_data: dict, server_data: dict) -> None:
    client = CaseClientContent.model_validate(client_data)
    server = PuzzleRuntimeDefinition.model_validate(server_data)
    original_client = client.model_dump()
    original_server = server.model_dump()

    validate_case_content_links(client, server)

    assert client.model_dump() == original_client
    assert server.model_dump() == original_server


def test_first_error_follows_zone_and_object_order(
    client_data: dict, server_data: dict
) -> None:
    client_data["zones"][0]["objects"][0]["interaction"]["target_id"] = "MISSING_1"
    second = dict(client_data["zones"][0]["objects"][0])
    second["object_id"] = "OBJ_02"
    second["interaction"] = {"type": "input", "target_id": "MISSING_2"}
    client_data["zones"][0]["objects"].append(second)

    with pytest.raises(CaseContentLinkValidationError, match="OBJ_01.*MISSING_1"):
        validate_data(client_data, server_data)


def test_loaders_then_link_validation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client_data: dict,
    server_data: dict,
) -> None:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    (tmp_path / "CASE_TEST.client.json").write_text(
        json.dumps(client_data), encoding="utf-8"
    )
    (tmp_path / "CASE_TEST.server.json").write_text(
        json.dumps(server_data), encoding="utf-8"
    )

    client = case_content.load_case_client_content("CASE_TEST")
    server = puzzle_runtime.load_case_runtime("CASE_TEST")

    validate_case_content_links(client, server)
