from copy import deepcopy

import pytest

from app.schemas.case_content import CaseClientContent
from app.schemas.play_session import PlaySessionState
from app.services.case_content import load_case_client_content
from app.services.object_resolver import ObjectNotFoundError, ZoneNotFoundError
from app.services.object_state import (
    EffectiveObjectState,
    InvalidObjectStatesError,
    parse_object_states,
    resolve_effective_object_state,
    resolve_effective_object_states,
    validate_object_state_references,
)


@pytest.fixture
def content() -> CaseClientContent:
    return CaseClientContent.model_validate(
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
                            "object_id": "OBJ_LETTER",
                            "object_name": "Letter",
                            "object_type": "clue",
                            "visible": False,
                            "enabled": True,
                        },
                        {
                            "object_id": "OBJ_DOOR",
                            "object_name": "Door",
                            "object_type": "door",
                            "visible": True,
                            "enabled": False,
                        },
                    ],
                    "navigation": [
                        {"door_object_id": "OBJ_DOOR", "target_zone_id": "ZONE_02"},
                    ],
                },
                {
                    "zone_id": "ZONE_02",
                    "zone_name": "Second",
                    "zone_type": "room",
                    "description": "Second zone",
                    "objects": [
                        {
                            "object_id": "OBJ_DOOR",
                            "object_name": "Door",
                            "object_type": "door",
                            "visible": True,
                            "enabled": False,
                        },
                    ],
                    "navigation": [],
                },
            ],
        }
    )


def legacy_state() -> dict:
    return {
        "current_zone_id": "ZONE_01",
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
    }


def test_legacy_state_without_object_states_parses_as_empty() -> None:
    state = PlaySessionState.model_validate(legacy_state())

    assert state.object_states == {}
    assert state.model_dump()["object_states"] == {}


def test_state_parses_stored_object_states() -> None:
    raw = {
        **legacy_state(),
        "object_states": {"ZONE_01": {"OBJ_LETTER": {"visible": True}}},
    }

    state = PlaySessionState.model_validate(raw)

    assert state.object_states == {"ZONE_01": {"OBJ_LETTER": {"visible": True}}}


@pytest.mark.parametrize(
    "object_states",
    [
        {"ZONE_01": {"OBJ_LETTER": {"hidden": True}}},
        {"ZONE_01": {"OBJ_LETTER": {"visible": "true"}}},
        {"ZONE_01": {"OBJ_LETTER": {"enabled": 1}}},
        {"ZONE_01": {"OBJ_LETTER": {"visible": None}}},
        {"ZONE_01": {"OBJ_LETTER": True}},
        {"ZONE_01": ["OBJ_LETTER"]},
        {"": {"OBJ_LETTER": {"visible": True}}},
        {"ZONE_01": {"": {"visible": True}}},
        ["ZONE_01/OBJ_LETTER"],
    ],
)
def test_invalid_object_states_are_rejected(object_states: object) -> None:
    with pytest.raises(InvalidObjectStatesError):
        parse_object_states(object_states)

    with pytest.raises(ValueError):
        PlaySessionState.model_validate(
            {**legacy_state(), "object_states": object_states}
        )


def test_visible_override_keeps_enabled_initial_value(
    content: CaseClientContent,
) -> None:
    state = resolve_effective_object_state(
        content,
        {"ZONE_01": {"OBJ_LETTER": {"visible": True}}},
        "ZONE_01",
        "OBJ_LETTER",
    )

    assert state == EffectiveObjectState(
        zone_id="ZONE_01",
        object_id="OBJ_LETTER",
        visible=True,
        enabled=True,
    )


def test_enabled_override_keeps_visible_initial_value(
    content: CaseClientContent,
) -> None:
    state = resolve_effective_object_state(
        content,
        {"ZONE_01": {"OBJ_DOOR": {"enabled": True}}},
        "ZONE_01",
        "OBJ_DOOR",
    )

    assert state.visible is True
    assert state.enabled is True


def test_override_can_turn_initial_true_values_off(
    content: CaseClientContent,
) -> None:
    state = resolve_effective_object_state(
        content,
        {"ZONE_01": {"OBJ_LETTER": {"enabled": False}}},
        "ZONE_01",
        "OBJ_LETTER",
    )

    assert state.visible is False
    assert state.enabled is False


def test_unrecorded_object_uses_content_initial_values(
    content: CaseClientContent,
) -> None:
    state = resolve_effective_object_state(content, {}, "ZONE_01", "OBJ_LETTER")

    assert (state.visible, state.enabled) == (False, True)


def test_same_object_id_in_another_zone_is_not_affected(
    content: CaseClientContent,
) -> None:
    object_states = {"ZONE_01": {"OBJ_DOOR": {"enabled": True}}}

    first = resolve_effective_object_state(
        content, object_states, "ZONE_01", "OBJ_DOOR"
    )
    second = resolve_effective_object_state(
        content, object_states, "ZONE_02", "OBJ_DOOR"
    )

    assert first.enabled is True
    assert second.enabled is False


def test_resolve_all_objects(content: CaseClientContent) -> None:
    effective = resolve_effective_object_states(
        content,
        {
            "ZONE_01": {"OBJ_LETTER": {"visible": True}},
            "ZONE_02": {"OBJ_DOOR": {"enabled": True, "visible": False}},
        },
    )

    assert list(effective) == [
        ("ZONE_01", "OBJ_LETTER"),
        ("ZONE_01", "OBJ_DOOR"),
        ("ZONE_02", "OBJ_DOOR"),
    ]
    assert effective[("ZONE_01", "OBJ_LETTER")].visible is True
    assert effective[("ZONE_01", "OBJ_DOOR")].enabled is False
    assert effective[("ZONE_02", "OBJ_DOOR")] == EffectiveObjectState(
        zone_id="ZONE_02",
        object_id="OBJ_DOOR",
        visible=False,
        enabled=True,
    )


def test_inputs_are_not_mutated(content: CaseClientContent) -> None:
    object_states = {"ZONE_01": {"OBJ_LETTER": {"visible": True}}}
    original_states = deepcopy(object_states)
    original_content = deepcopy(content.model_dump())

    resolve_effective_object_state(content, object_states, "ZONE_01", "OBJ_LETTER")
    resolve_effective_object_states(content, object_states)
    parsed = parse_object_states(object_states)
    parsed["ZONE_01"]["OBJ_LETTER"]["visible"] = False

    assert object_states == original_states
    assert content.model_dump() == original_content


@pytest.mark.parametrize(
    ("object_states", "error"),
    [
        ({"ZONE_99": {"OBJ_LETTER": {"visible": True}}}, ZoneNotFoundError),
        ({"ZONE_01": {"OBJ_MISSING": {"visible": True}}}, ObjectNotFoundError),
        ({"ZONE_02": {"OBJ_LETTER": {"visible": True}}}, ObjectNotFoundError),
    ],
)
def test_unknown_object_state_references_are_rejected(
    content: CaseClientContent,
    object_states: dict,
    error: type[Exception],
) -> None:
    with pytest.raises(error):
        validate_object_state_references(content, object_states)

    with pytest.raises(error):
        resolve_effective_object_states(content, object_states)

    with pytest.raises(error):
        resolve_effective_object_state(content, object_states, "ZONE_01", "OBJ_DOOR")


@pytest.mark.parametrize(
    ("zone_id", "object_id", "error"),
    [
        ("ZONE_99", "OBJ_DOOR", ZoneNotFoundError),
        ("ZONE_01", "OBJ_MISSING", ObjectNotFoundError),
    ],
)
def test_unknown_lookup_target_is_rejected(
    content: CaseClientContent,
    zone_id: str,
    object_id: str,
    error: type[Exception],
) -> None:
    with pytest.raises(error):
        resolve_effective_object_state(content, {}, zone_id, object_id)


def test_case_001_loads_unchanged_and_resolves_with_empty_states() -> None:
    content = load_case_client_content("case_001")

    effective = resolve_effective_object_states(content, {})
    lock = effective[("ZONE_SECRET_CORRIDOR", "OBJ_FIRE_CABINET_LOCK")]
    obj = next(
        obj
        for zone in content.zones
        if zone.zone_id == "ZONE_SECRET_CORRIDOR"
        for obj in zone.objects
        if obj.object_id == "OBJ_FIRE_CABINET_LOCK"
    )

    assert (lock.visible, lock.enabled) == (obj.visible, obj.enabled)
