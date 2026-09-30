from copy import deepcopy

import pytest

from app.schemas.case_content import CaseClientContent
from app.services.object_resolver import (
    InteractionTypeMismatchError,
    ObjectInteractionNotFoundError,
    ObjectNotFoundError,
    ResolvedObjectInteraction,
    UnsupportedObjectInteractionTypeError,
    ZoneNotFoundError,
    resolve_object_interaction,
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
                        "object_id": "OBJ_LOCK_01",
                        "object_name": "Lock",
                        "object_type": "lock",
                        "visible": False,
                        "enabled": False,
                        "interaction": {
                            "type": "input",
                            "target_id": "PUZZLE_002",
                        },
                    },
                    {
                        "object_id": "OBJ_PLAIN_01",
                        "object_name": "Plain object",
                        "object_type": "decoration",
                        "visible": True,
                        "enabled": True,
                    },
                ],
                "navigation": [],
            },
            {
                "zone_id": "ZONE_02",
                "zone_name": "Second",
                "zone_type": "room",
                "description": "Second zone",
                "objects": [
                    {
                        "object_id": "OBJ_LOCK_02",
                        "object_name": "Second lock",
                        "object_type": "lock",
                        "visible": True,
                        "enabled": True,
                        "interaction": {
                            "type": "input",
                            "target_id": "PUZZLE_003",
                        },
                    }
                ],
                "navigation": [],
            },
        ],
    }


def test_resolves_input_target(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)

    result = resolve_object_interaction(content, "ZONE_01", "OBJ_LOCK_01", "input")

    assert result == ResolvedObjectInteraction(
        zone_id="ZONE_01",
        object_id="OBJ_LOCK_01",
        interaction_type="input",
        target_id="PUZZLE_002",
    )


def test_missing_zone_raises(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)

    with pytest.raises(ZoneNotFoundError, match="ZONE_MISSING"):
        resolve_object_interaction(content, "ZONE_MISSING", "OBJ_LOCK_01", "input")


def test_missing_object_in_zone_raises(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)

    with pytest.raises(ObjectNotFoundError, match="OBJ_LOCK_02.*ZONE_01"):
        resolve_object_interaction(content, "ZONE_01", "OBJ_LOCK_02", "input")


def test_object_without_interaction_raises(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)

    with pytest.raises(ObjectInteractionNotFoundError, match="OBJ_PLAIN_01"):
        resolve_object_interaction(content, "ZONE_01", "OBJ_PLAIN_01", "input")


def test_interaction_type_mismatch_raises(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)

    with pytest.raises(InteractionTypeMismatchError, match="input.*inspect"):
        resolve_object_interaction(content, "ZONE_01", "OBJ_LOCK_01", "inspect")


def test_equal_object_and_target_ids_resolve(client_data: dict) -> None:
    client_data["zones"][0]["objects"][0]["interaction"]["target_id"] = "OBJ_LOCK_01"
    content = CaseClientContent.model_validate(client_data)

    result = resolve_object_interaction(content, "ZONE_01", "OBJ_LOCK_01", "input")

    assert result.target_id == "OBJ_LOCK_01"


def test_later_zone_object_resolves(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)

    result = resolve_object_interaction(content, "ZONE_02", "OBJ_LOCK_02", "input")

    assert result.target_id == "PUZZLE_003"


def test_resolver_does_not_mutate_client_content(client_data: dict) -> None:
    content = CaseClientContent.model_validate(client_data)
    original = deepcopy(content.model_dump())

    resolve_object_interaction(content, "ZONE_01", "OBJ_LOCK_01", "input")

    assert content.model_dump() == original


def test_combine_clues_is_not_object_based(client_data: dict) -> None:
    client_data["zones"][0]["objects"][0]["interaction"]["type"] = "combine_clues"
    content = CaseClientContent.model_validate(client_data)

    with pytest.raises(UnsupportedObjectInteractionTypeError, match="combine_clues"):
        resolve_object_interaction(content, "ZONE_01", "OBJ_LOCK_01", "combine_clues")


@pytest.mark.parametrize("interaction_type", ["inspect", "select", "navigate"])
def test_other_declared_types_only_resolve_mapping(
    client_data: dict, interaction_type: str
) -> None:
    client_data["zones"][0]["objects"][0]["interaction"]["type"] = interaction_type
    content = CaseClientContent.model_validate(client_data)

    result = resolve_object_interaction(
        content, "ZONE_01", "OBJ_LOCK_01", interaction_type
    )

    assert result.interaction_type == interaction_type
    assert result.target_id == "PUZZLE_002"
