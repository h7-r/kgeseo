import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.services import case_content
from app.services.case_content import (
    CaseClientContentJSONDecodeError,
    CaseClientContentNotFoundError,
    CaseClientContentValidationError,
    InvalidClientCaseIdError,
    load_case_client_content,
)


@pytest.fixture
def cases_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    return tmp_path


@pytest.fixture
def valid_client_data() -> dict:
    return {
        "case_id": "case_001",
        "entry_zone_id": "ZONE_001",
        "zones": [
            {
                "zone_id": "ZONE_001",
                "zone_name": "Arrival",
                "zone_type": "room",
                "description": "First zone",
                "objects": [
                    {
                        "object_id": "OBJ_LOCK_01",
                        "object_name": "Lock",
                        "object_type": "lock",
                        "asset_key": "lock_asset",
                        "visible": False,
                        "enabled": False,
                        "interaction": {
                            "type": "input",
                            "target_id": "PUZZLE_002",
                        },
                    },
                    {
                        "object_id": "OBJ_DOOR_01",
                        "object_name": "Door",
                        "object_type": "door",
                        "visible": True,
                        "enabled": True,
                    },
                ],
                "navigation": [
                    {
                        "door_object_id": "OBJ_DOOR_01",
                        "target_zone_id": "ZONE_002",
                    },
                ],
                "metadata": {},
            },
            {
                "zone_id": "ZONE_002",
                "zone_name": "Archive",
                "zone_type": "room",
                "description": "Second zone",
                "objects": [],
                "navigation": [],
            },
        ],
    }


def write_client_content(directory: Path, content: dict) -> None:
    (directory / "case_001.client.json").write_text(
        json.dumps(content, ensure_ascii=False),
        encoding="utf-8",
    )


def test_load_case_client_content(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    write_client_content(cases_directory, valid_client_data)

    content = load_case_client_content("case_001")

    assert content.case_id == "case_001"
    assert content.entry_zone_id == "ZONE_001"
    assert [zone.zone_id for zone in content.zones] == ["ZONE_001", "ZONE_002"]
    first_object = content.zones[0].objects[0]
    assert first_object.object_id == "OBJ_LOCK_01"
    assert first_object.interaction.target_id == "PUZZLE_002"
    assert content.zones[0].navigation[0].target_zone_id == "ZONE_002"
    assert content.zones[0].metadata.model_dump() == {}
    assert content.zones[1].metadata.model_dump() == {}


def test_missing_client_content_raises_not_found(cases_directory: Path) -> None:
    with pytest.raises(CaseClientContentNotFoundError):
        load_case_client_content("case_001")


def test_invalid_json_raises_decode_error(cases_directory: Path) -> None:
    (cases_directory / "case_001.client.json").write_text(
        "{invalid json",
        encoding="utf-8",
    )

    with pytest.raises(CaseClientContentJSONDecodeError):
        load_case_client_content("case_001")


def test_invalid_schema_raises_validation_error(cases_directory: Path) -> None:
    write_client_content(cases_directory, {"case_id": "case_001", "zones": "bad"})

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


@pytest.mark.parametrize(
    "case_id",
    ["", "../../secret", "../case", "/absolute", "C:\\absolute"],
)
def test_unsafe_case_id_is_rejected(cases_directory: Path, case_id: str) -> None:
    with pytest.raises(InvalidClientCaseIdError):
        load_case_client_content(case_id)


def test_duplicate_zone_id_is_rejected(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"][1]["zone_id"] = "ZONE_001"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_entry_zone_must_exist_in_case(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["entry_zone_id"] = "ZONE_MISSING"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_entry_zone_is_required(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    del valid_client_data["entry_zone_id"]
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_entry_zone_must_not_be_empty(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["entry_zone_id"] = ""
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_entry_zone_is_independent_of_zone_order(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"].reverse()
    write_client_content(cases_directory, valid_client_data)

    content = load_case_client_content("case_001")

    assert content.entry_zone_id == "ZONE_001"
    assert content.zones[0].zone_id == "ZONE_002"


def test_later_zone_can_be_entry_zone(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["entry_zone_id"] = "ZONE_002"
    write_client_content(cases_directory, valid_client_data)

    content = load_case_client_content("case_001")

    assert content.entry_zone_id == "ZONE_002"


def test_empty_zones_are_rejected_by_entry_zone_reference(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"] = []
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_duplicate_object_id_in_zone_is_rejected(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"][0]["objects"][1]["object_id"] = "OBJ_LOCK_01"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_navigation_door_must_exist_in_its_zone(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"][0]["navigation"][0]["door_object_id"] = "MISSING"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_navigation_target_must_exist_in_case(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"][0]["navigation"][0]["target_zone_id"] = "MISSING"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_hidden_object_remains_in_client_content(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    write_client_content(cases_directory, valid_client_data)

    content = load_case_client_content("case_001")

    assert content.zones[0].objects[0].visible is False
    assert len(content.zones[0].objects) == 2


def test_disabled_object_remains_in_client_content(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    write_client_content(cases_directory, valid_client_data)

    content = load_case_client_content("case_001")

    assert content.zones[0].objects[0].enabled is False
    assert len(content.zones[0].objects) == 2


@pytest.mark.parametrize(
    "location",
    ["case", "zone", "object", "interaction", "navigation"],
)
def test_server_only_fields_are_rejected_at_every_defined_level(
    cases_directory: Path,
    valid_client_data: dict,
    location: str,
) -> None:
    content = deepcopy(valid_client_data)
    locations = {
        "case": content,
        "zone": content["zones"][0],
        "object": content["zones"][0]["objects"][0],
        "interaction": content["zones"][0]["objects"][0]["interaction"],
        "navigation": content["zones"][0]["navigation"][0],
    }
    locations[location]["accepted_answers"] = ["secret"]
    write_client_content(cases_directory, content)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_input_target_may_equal_object_id(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["zones"][0]["objects"][0]["interaction"]["target_id"] = (
        "OBJ_LOCK_01"
    )
    write_client_content(cases_directory, valid_client_data)

    content = load_case_client_content("case_001")

    assert content.zones[0].objects[0].interaction.target_id == "OBJ_LOCK_01"


@pytest.mark.parametrize(
    "field", ["accepted_answers", "on_success", "set_flags", "theme"]
)
def test_unconfirmed_metadata_fields_are_rejected(
    cases_directory: Path,
    valid_client_data: dict,
    field: str,
) -> None:
    valid_client_data["zones"][0]["metadata"][field] = "not_public"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")


def test_case_id_must_match_requested_file(
    cases_directory: Path,
    valid_client_data: dict,
) -> None:
    valid_client_data["case_id"] = "case_002"
    write_client_content(cases_directory, valid_client_data)

    with pytest.raises(CaseClientContentValidationError):
        load_case_client_content("case_001")
