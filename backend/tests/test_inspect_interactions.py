import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.interaction import InspectInteraction, InspectPayload
from app.schemas.interaction_api import InteractionApiRequest
from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services import case_content, puzzle_runtime
from app.services.case_content_validation import CaseContentLinkValidationError
from app.services.external_interaction import process_external_interaction
from app.services.interaction import (
    InspectionNotFoundError,
    ObjectNotEnabledError,
    ObjectNotVisibleError,
    process_interaction,
)
from app.services.object_resolver import (
    InteractionTypeMismatchError,
    ObjectInteractionNotFoundError,
    ObjectNotFoundError,
    ZoneNotFoundError,
)
from app.services.object_state import resolve_effective_object_state
from tests.conftest import FakeAsyncSession

PLAY_SESSION_ID = "22222222-2222-4222-8222-222222222222"
OTHER_PLAY_SESSION_ID = "33333333-3333-4333-8333-333333333333"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"


def obj(object_id: str, *, visible: bool = True, enabled: bool = True, **interaction):
    data = {
        "object_id": object_id,
        "object_name": object_id,
        "object_type": "prop",
        "visible": visible,
        "enabled": enabled,
    }
    if interaction:
        data["interaction"] = interaction
    return data


CLIENT_DATA = {
    "case_id": "case_001",
    "entry_zone_id": "ZONE_SARANG",
    "zones": [
        {
            "zone_id": "ZONE_SARANG",
            "zone_name": "Sarang",
            "zone_type": "room",
            "description": "Sarang room",
            "objects": [
                obj("OBJ_BEDDING", type="inspect", target_id="INSPECT_BEDDING"),
                obj(
                    "OBJ_LETTER",
                    visible=False,
                    type="inspect",
                    target_id="INSPECT_LETTER",
                ),
                obj(
                    "OBJ_CHEST",
                    enabled=False,
                    type="inspect",
                    target_id="INSPECT_CHEST",
                ),
                obj("OBJ_SCREEN", type="inspect", target_id="INSPECT_SCREEN"),
                obj("OBJ_LOCK", type="input", target_id="PUZZLE_LOCK"),
                obj("OBJ_PLAIN"),
            ],
            "navigation": [],
        },
        {
            "zone_id": "ZONE_HALL",
            "zone_name": "Hall",
            "zone_type": "room",
            "description": "Hall",
            "objects": [
                obj("OBJ_LETTER", type="inspect", target_id="INSPECT_HALL_LETTER"),
            ],
            "navigation": [],
        },
    ],
}


def effect(**values) -> dict:
    return {"grant_clue_ids": [], "set_flags": {}, **values}


def object_effect(object_id: str, zone_id: str = "ZONE_SARANG", **values: bool) -> dict:
    return {"zone_id": zone_id, "object_id": object_id, **values}


RUNTIME_DATA = {
    "schema_version": "0.1",
    "case_id": "case_001",
    "puzzles": [
        {
            "puzzle_id": "PUZZLE_LOCK",
            "accepted_answers": ["VALVE"],
            "on_correct": effect(
                set_object_states=[object_effect("OBJ_CHEST", enabled=True)],
            ),
        },
    ],
    "clue_combinations": [
        {
            "combination_id": "COMBO_01",
            "clue_ids": ["CLUE_LETTER", "CLUE_CHEST"],
            "on_success": effect(grant_clue_ids=["CLUE_TRUTH"]),
        },
    ],
    "inspections": [
        {
            "inspect_id": "INSPECT_BEDDING",
            "on_inspect": effect(
                set_object_states=[object_effect("OBJ_LETTER", visible=True)],
            ),
        },
        {
            "inspect_id": "INSPECT_LETTER",
            "on_inspect": effect(
                grant_clue_ids=["CLUE_LETTER"],
                set_flags={"letter_read": True},
                set_object_states=[object_effect("OBJ_LETTER", visible=False)],
            ),
        },
        {
            "inspect_id": "INSPECT_CHEST",
            "on_inspect": effect(grant_clue_ids=["CLUE_CHEST"]),
        },
        {"inspect_id": "INSPECT_SCREEN", "on_inspect": effect()},
        {
            "inspect_id": "INSPECT_HALL_LETTER",
            "on_inspect": effect(grant_clue_ids=["CLUE_HALL"]),
        },
    ],
}


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    write_case(tmp_path)
    return tmp_path


def write_case(
    directory: Path,
    *,
    client: dict | None = None,
    runtime: dict | None = None,
) -> None:
    (directory / "case_001.client.json").write_text(
        json.dumps(client or CLIENT_DATA), encoding="utf-8"
    )
    (directory / "case_001.server.json").write_text(
        json.dumps(runtime or RUNTIME_DATA), encoding="utf-8"
    )


def make_state(**overrides) -> dict:
    return {
        "current_zone_id": "ZONE_SARANG",
        "completed_puzzle_ids": [],
        "completed_inspect_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
        "object_states": {},
        **overrides,
    }


def make_play_session(
    state: dict | None = None,
    *,
    play_session_id: str = PLAY_SESSION_ID,
) -> PlaySession:
    now = datetime(2026, 10, 23, 1, 2, 3)
    return PlaySession(
        id=play_session_id,
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json=state if state is not None else make_state(),
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


EVENT_IDS = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 10_000))


def request_body(
    object_id: str,
    *,
    zone_id: str = "ZONE_SARANG",
    action: str = "inspect",
    client_event_id: str | None = None,
    payload: dict | None = None,
) -> dict:
    return {
        "client_event_id": client_event_id or next(EVENT_IDS),
        "client_timestamp": "2026-10-23T09:10:00+09:00",
        "zone_id": zone_id,
        "action": action,
        "target_type": "object",
        "target_id": object_id,
        "payload": payload if payload is not None else {},
    }


async def inspect(
    play_session: PlaySession,
    object_id: str,
    *,
    db: FakeAsyncSession | None = None,
    **body_options,
):
    db = db or FakeAsyncSession()
    db.get_result = play_session
    request = TypeAdapter(InteractionApiRequest).validate_python(
        request_body(object_id, **body_options)
    )
    result = await process_external_interaction(db, play_session.id, request)
    return result, db


def changes(result) -> list[dict]:
    return [change.model_dump() for change in result.result.state_changes]


def revealed(object_id: str, zone_id: str = "ZONE_SARANG") -> dict:
    return {"type": "object_revealed", "zone_id": zone_id, "object_id": object_id}


def hidden(object_id: str, zone_id: str = "ZONE_SARANG") -> dict:
    return {"type": "object_hidden", "zone_id": zone_id, "object_id": object_id}


# ── 조사 흐름 ──


@pytest.mark.anyio
async def test_inspect_host_reveals_hidden_letter(case_directory: Path) -> None:
    play_session = make_play_session()

    result, db = await inspect(play_session, "OBJ_BEDDING")

    assert result.result.result_type == "inspected"
    assert changes(result) == [revealed("OBJ_LETTER")]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_LETTER": {"visible": True}},
    }
    assert play_session.state_json["completed_inspect_ids"] == ["INSPECT_BEDDING"]
    assert play_session.state_json == result.result.state.model_dump()
    event = db.added[0]
    assert isinstance(event, InteractionEvent)
    assert (event.interaction_type, event.target_id, event.payload_json) == (
        "inspect",
        "INSPECT_BEDDING",
        {},
    )
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_inspect_revealed_letter_grants_clue_and_hides_it(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    await inspect(play_session, "OBJ_BEDDING")

    result, db = await inspect(play_session, "OBJ_LETTER")

    assert result.result.result_type == "inspected"
    assert changes(result) == [
        {"type": "clue_acquired", "clue_id": "CLUE_LETTER"},
        {"type": "flag_updated", "flag": "letter_read", "value": True},
        hidden("OBJ_LETTER"),
    ]
    assert play_session.state_json["acquired_clue_ids"] == ["CLUE_LETTER"]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_LETTER": {"visible": False}},
    }
    assert play_session.state_json["completed_inspect_ids"] == [
        "INSPECT_BEDDING",
        "INSPECT_LETTER",
    ]
    # 단서 획득·flag·Object 숨김이 하나의 commit과 이벤트로 저장된다.
    assert db.commit_count == 1
    assert len(db.added) == 1


@pytest.mark.anyio
async def test_reinspecting_host_does_not_reveal_letter_again(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    await inspect(play_session, "OBJ_BEDDING")
    await inspect(play_session, "OBJ_LETTER")
    state_before = deepcopy(play_session.state_json)

    result, db = await inspect(play_session, "OBJ_BEDDING")

    assert result.result.result_type == "already_inspected"
    assert changes(result) == []
    assert play_session.state_json == state_before
    assert db.commit_count == 1
    assert len(db.added) == 1


@pytest.mark.anyio
async def test_reinspecting_clue_object_does_not_grant_clue_again(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    await inspect(play_session, "OBJ_BEDDING")
    await inspect(play_session, "OBJ_LETTER")
    state_before = deepcopy(play_session.state_json)

    # 서신은 조사 후 숨겨졌지만 이미 조사한 대상이므로 오류 대신 변화 없음으로 응답한다.
    result, _ = await inspect(play_session, "OBJ_LETTER")

    assert result.result.result_type == "already_inspected"
    assert changes(result) == []
    assert play_session.state_json == state_before
    assert play_session.state_json["acquired_clue_ids"] == ["CLUE_LETTER"]


@pytest.mark.anyio
async def test_inspect_with_empty_effect_completes_without_changes(
    case_directory: Path,
) -> None:
    play_session = make_play_session()

    result, _ = await inspect(play_session, "OBJ_SCREEN")

    assert result.result.result_type == "inspected"
    assert changes(result) == []
    assert play_session.state_json["completed_inspect_ids"] == ["INSPECT_SCREEN"]


@pytest.mark.anyio
async def test_hidden_object_cannot_be_inspected(case_directory: Path) -> None:
    play_session = make_play_session()
    original = deepcopy(play_session.state_json)
    db = FakeAsyncSession()

    with pytest.raises(ObjectNotVisibleError):
        await inspect(play_session, "OBJ_LETTER", db=db)

    assert play_session.state_json == original
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_object_hidden_by_session_state_cannot_be_inspected(
    case_directory: Path,
) -> None:
    state = make_state(
        object_states={"ZONE_SARANG": {"OBJ_SCREEN": {"visible": False}}}
    )
    play_session = make_play_session(state)

    with pytest.raises(ObjectNotVisibleError):
        await inspect(play_session, "OBJ_SCREEN")


@pytest.mark.anyio
async def test_disabled_object_cannot_be_inspected_until_unlocked(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db = FakeAsyncSession()

    with pytest.raises(ObjectNotEnabledError):
        await inspect(play_session, "OBJ_CHEST", db=db)
    assert db.commit_count == 0
    assert db.rollback_count == 1

    unlocked, _ = await inspect(
        play_session,
        "OBJ_LOCK",
        action="input",
        payload={"answer": "valve"},
    )
    result, _ = await inspect(play_session, "OBJ_CHEST")

    assert unlocked.result.result_type == "correct"
    assert changes(unlocked)[1:] == [
        {"type": "object_unlocked", "zone_id": "ZONE_SARANG", "object_id": "OBJ_CHEST"},
    ]
    assert result.result.result_type == "inspected"
    assert changes(result) == [{"type": "clue_acquired", "clue_id": "CLUE_CHEST"}]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("zone_id", "object_id", "error"),
    [
        ("ZONE_MISSING", "OBJ_BEDDING", ZoneNotFoundError),
        ("ZONE_SARANG", "OBJ_MISSING", ObjectNotFoundError),
        ("ZONE_HALL", "OBJ_BEDDING", ObjectNotFoundError),
        ("ZONE_SARANG", "OBJ_PLAIN", ObjectInteractionNotFoundError),
        ("ZONE_SARANG", "OBJ_LOCK", InteractionTypeMismatchError),
    ],
)
async def test_invalid_inspect_target_is_rejected(
    case_directory: Path,
    zone_id: str,
    object_id: str,
    error: type[Exception],
) -> None:
    play_session = make_play_session()
    original = deepcopy(play_session.state_json)
    db = FakeAsyncSession()

    with pytest.raises(error):
        await inspect(play_session, object_id, zone_id=zone_id, db=db)

    assert play_session.state_json == original
    assert db.added == []
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_missing_inspection_id_is_rejected() -> None:
    play_session = make_play_session()
    db = FakeAsyncSession()
    db.get_result = play_session

    with pytest.raises(InspectionNotFoundError):
        await process_interaction(
            db,
            play_session.id,
            InspectInteraction(
                client_event_id="event-1",
                interaction_type="inspect",
                target_id="INSPECT_MISSING",
                zone_id="ZONE_SARANG",
                object_id="OBJ_BEDDING",
                payload=InspectPayload(),
            ),
            runtime_loader=lambda case_id: PuzzleRuntimeDefinition.model_validate(
                RUNTIME_DATA
            ),
        )

    assert db.added == []
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_client_inspect_target_missing_on_server_is_content_error(
    case_directory: Path,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["inspections"] = [
        item
        for item in runtime["inspections"]
        if item["inspect_id"] != "INSPECT_SCREEN"
    ]
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session()

    with pytest.raises(InspectionNotFoundError):
        await inspect(play_session, "OBJ_SCREEN")
    # 다른 조사도 Object 상태 판정 전에 콘텐츠 교차 검증에서 막힌다.
    with pytest.raises(CaseContentLinkValidationError, match="INSPECT_SCREEN"):
        await inspect(play_session, "OBJ_BEDDING")
    assert play_session.state_json == make_state()


@pytest.mark.anyio
async def test_same_client_event_id_replays_same_response(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    event_id = "44444444-4444-4444-8444-444444444444"
    first, first_db = await inspect(
        play_session, "OBJ_BEDDING", client_event_id=event_id
    )
    state_after_first = deepcopy(play_session.state_json)
    replay_db = FakeAsyncSession()
    replay_db.scalar_result = first_db.added[0]

    replayed, _ = await inspect(
        play_session, "OBJ_BEDDING", client_event_id=event_id, db=replay_db
    )

    assert replayed.interaction_id == first.interaction_id
    assert replayed.result == first.result
    assert play_session.state_json == state_after_first
    assert replay_db.added == []
    assert replay_db.commit_count == 0


@pytest.mark.anyio
async def test_play_sessions_keep_inspection_state_separate(
    case_directory: Path,
) -> None:
    first = make_play_session()
    second = make_play_session(play_session_id=OTHER_PLAY_SESSION_ID)

    await inspect(first, "OBJ_BEDDING")

    assert first.state_json["completed_inspect_ids"] == ["INSPECT_BEDDING"]
    assert second.state_json == make_state()
    with pytest.raises(ObjectNotVisibleError):
        await inspect(second, "OBJ_LETTER")


@pytest.mark.anyio
async def test_same_object_id_in_other_zone_is_separate(case_directory: Path) -> None:
    play_session = make_play_session(make_state(current_zone_id="ZONE_HALL"))

    result, _ = await inspect(play_session, "OBJ_LETTER", zone_id="ZONE_HALL")

    assert changes(result) == [{"type": "clue_acquired", "clue_id": "CLUE_HALL"}]
    assert play_session.state_json["completed_inspect_ids"] == ["INSPECT_HALL_LETTER"]
    play_session.state_json["current_zone_id"] = "ZONE_SARANG"
    with pytest.raises(ObjectNotVisibleError):
        await inspect(play_session, "OBJ_LETTER")


@pytest.mark.anyio
async def test_legacy_session_without_new_keys_can_inspect(
    case_directory: Path,
) -> None:
    state = make_state()
    del state["object_states"]
    del state["completed_inspect_ids"]
    del state["attempt_counts"]
    play_session = make_play_session(state)

    first, _ = await inspect(play_session, "OBJ_BEDDING")
    again, _ = await inspect(play_session, "OBJ_BEDDING")

    assert changes(first) == [revealed("OBJ_LETTER")]
    assert again.result.result_type == "already_inspected"
    assert play_session.state_json["completed_inspect_ids"] == ["INSPECT_BEDDING"]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_LETTER": {"visible": True}},
    }


@pytest.mark.anyio
async def test_invalid_effect_reference_applies_nothing(case_directory: Path) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["inspections"][0]["on_inspect"] = effect(
        grant_clue_ids=["CLUE_X"],
        set_object_states=[
            object_effect("OBJ_LETTER", visible=True),
            object_effect("OBJ_MISSING", visible=True),
        ],
    )
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session()
    db = FakeAsyncSession()

    with pytest.raises(CaseContentLinkValidationError, match="OBJ_MISSING"):
        await inspect(play_session, "OBJ_BEDDING", db=db)

    assert play_session.state_json == make_state()
    assert db.added == []
    assert db.commit_count == 0


@pytest.mark.anyio
async def test_commit_failure_rolls_back_inspection(case_directory: Path) -> None:
    play_session = make_play_session()
    db = FakeAsyncSession()
    db.commit_error = RuntimeError("commit failed")

    with pytest.raises(RuntimeError, match="commit failed"):
        await inspect(play_session, "OBJ_BEDDING", db=db)

    assert db.commit_count == 1
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_saved_state_reads_back_through_play_session_state(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    await inspect(play_session, "OBJ_BEDDING")
    await inspect(play_session, "OBJ_LETTER")

    state = PlaySessionState.model_validate(play_session.state_json)
    content = case_content.load_case_client_content("case_001")
    letter = resolve_effective_object_state(
        content, state.object_states, "ZONE_SARANG", "OBJ_LETTER"
    )

    assert state.completed_inspect_ids == ["INSPECT_BEDDING", "INSPECT_LETTER"]
    assert state.acquired_clue_ids == ["CLUE_LETTER"]
    assert (letter.visible, letter.enabled) == (False, True)


@pytest.mark.anyio
async def test_puzzle_and_combination_still_work_with_inspections(
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        make_state(acquired_clue_ids=["CLUE_LETTER", "CLUE_CHEST"])
    )

    wrong, _ = await inspect(
        play_session, "OBJ_LOCK", action="input", payload={"answer": "nope"}
    )
    combine_db = FakeAsyncSession()
    combine_db.get_result = play_session
    combined = await process_external_interaction(
        combine_db,
        play_session.id,
        TypeAdapter(InteractionApiRequest).validate_python(
            {
                "client_event_id": next(EVENT_IDS),
                "client_timestamp": "2026-10-23T09:10:00+09:00",
                "zone_id": "ZONE_SARANG",
                "action": "combine_clues",
                "target_type": "clue",
                "target_id": None,
                "payload": {"clue_ids": ["CLUE_LETTER", "CLUE_CHEST"]},
            }
        ),
    )

    assert wrong.result.result_type == "incorrect"
    assert changes(wrong) == []
    assert play_session.state_json["object_states"] == {}
    assert combined.result.result_type == "combined"
    assert changes(combined) == [{"type": "clue_acquired", "clue_id": "CLUE_TRUTH"}]


# ── 콘텐츠 스키마 ──


def test_runtime_without_inspections_defaults_to_empty() -> None:
    data = deepcopy(RUNTIME_DATA)
    del data["inspections"]

    assert PuzzleRuntimeDefinition.model_validate(data).inspections == []


def test_duplicate_inspect_id_is_rejected() -> None:
    data = deepcopy(RUNTIME_DATA)
    data["inspections"].append(deepcopy(data["inspections"][0]))

    with pytest.raises(ValidationError, match="Duplicate inspect_id"):
        PuzzleRuntimeDefinition.model_validate(data)


@pytest.mark.parametrize(
    "inspection",
    [
        {"inspect_id": "", "on_inspect": effect()},
        {"inspect_id": "INSPECT_X"},
        {
            "inspect_id": "INSPECT_X",
            "on_inspect": effect(
                set_object_states=[object_effect("OBJ_LETTER", visible="yes")]
            ),
        },
    ],
)
def test_invalid_inspection_definition_is_rejected(inspection: dict) -> None:
    data = deepcopy(RUNTIME_DATA)
    data["inspections"] = [inspection]

    with pytest.raises(ValidationError):
        PuzzleRuntimeDefinition.model_validate(data)


@pytest.mark.parametrize(
    "body",
    [
        {**request_body("OBJ_BEDDING"), "target_type": "zone"},
        {**request_body("OBJ_BEDDING"), "target_id": None},
        {**request_body("OBJ_BEDDING"), "target_id": ""},
        {**request_body("OBJ_BEDDING"), "payload": {"answer": "x"}},
    ],
)
def test_inspect_request_requires_object_target(body: dict) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(InteractionApiRequest).validate_python(body)


# ── HTTP ──


def test_http_inspect_flow_and_session_read(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    host = client.post(INTERACTIONS_URL, json=request_body("OBJ_BEDDING"))
    letter = client.post(INTERACTIONS_URL, json=request_body("OBJ_LETTER"))
    again = client.post(INTERACTIONS_URL, json=request_body("OBJ_LETTER"))
    read = client.get(f"/api/v1/play-sessions/{PLAY_SESSION_ID}")

    assert host.status_code == 200
    assert host.json()["result_type"] == "ok"
    assert host.json()["state_changes"] == [revealed("OBJ_LETTER")]
    assert letter.json()["result_type"] == "ok"
    assert letter.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_LETTER"},
        {"type": "flag_updated", "flag": "letter_read", "value": True},
        hidden("OBJ_LETTER"),
    ]
    assert again.status_code == 200
    assert again.json()["result_type"] == "ok"
    assert again.json()["state_changes"] == []
    state = read.json()["data"]["state"]
    assert state["acquired_clue_ids"] == ["CLUE_LETTER"]
    assert state["completed_inspect_ids"] == ["INSPECT_BEDDING", "INSPECT_LETTER"]
    assert state["object_states"] == {"ZONE_SARANG": {"OBJ_LETTER": {"visible": False}}}


@pytest.mark.parametrize(
    ("object_id", "zone_id", "status_code", "detail"),
    [
        ("OBJ_LETTER", "ZONE_SARANG", 409, "Object is not visible."),
        ("OBJ_CHEST", "ZONE_SARANG", 409, "Object is not enabled."),
        ("OBJ_MISSING", "ZONE_SARANG", 404, "Object not found."),
        ("OBJ_BEDDING", "ZONE_MISSING", 404, "Zone not found."),
        ("OBJ_PLAIN", "ZONE_SARANG", 409, "Object interaction is unavailable."),
        (
            "OBJ_LOCK",
            "ZONE_SARANG",
            409,
            "Interaction action does not match the object.",
        ),
    ],
)
def test_http_inspect_errors(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    object_id: str,
    zone_id: str,
    status_code: int,
    detail: str,
) -> None:
    db_session.get_result = make_play_session()

    response = client.post(
        INTERACTIONS_URL, json=request_body(object_id, zone_id=zone_id)
    )

    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert db_session.commit_count == 0


def test_http_inspect_uses_play_session_uuid(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    response = client.post(INTERACTIONS_URL, json=request_body("OBJ_SCREEN"))

    assert response.status_code == 200
    UUID(response.json()["interaction_id"])
