import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services import case_content, puzzle_runtime
from tests.conftest import FakeAsyncSession

PLAY_SESSION_ID = "22222222-2222-4222-8222-222222222222"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"
CLIENT_EVENT_ID = "11111111-1111-4111-8111-111111111111"
CLIENT_TIMESTAMP = "2026-09-09T09:10:00+09:00"


@pytest.fixture
def runtime_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    (tmp_path / "case_001.server.json").write_text(
        json.dumps(
            {
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
                    {
                        "puzzle_id": "puzzle_02",
                        "accepted_answers": ["두번째"],
                        "on_correct": {
                            "grant_clue_ids": [],
                            "set_flags": {},
                        },
                    },
                ],
                "clue_combinations": [
                    {
                        "combination_id": "combination_01",
                        "clue_ids": ["clue_03", "clue_07"],
                        "on_success": {
                            "grant_clue_ids": ["clue_10"],
                            "complete_puzzle_ids": ["puzzle_02"],
                            "set_flags": {"truth_fragment_01": True},
                        },
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def client_content_directory(
    runtime_directory: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", runtime_directory)
    (runtime_directory / "case_001.client.json").write_text(
        json.dumps(
            {
                "case_id": "case_001",
                "entry_zone_id": "ZONE_003",
                "zones": [
                    {
                        "zone_id": "ZONE_003",
                        "zone_name": "First",
                        "zone_type": "room",
                        "description": "First zone",
                        "objects": [
                            {
                                "object_id": "OBJ_LOCK_01",
                                "object_name": "Lock",
                                "object_type": "lock",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "input",
                                    "target_id": "puzzle_01",
                                },
                            },
                            {
                                "object_id": "OBJ_LOCK_02",
                                "object_name": "Second lock",
                                "object_type": "lock",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "input",
                                    "target_id": "puzzle_02",
                                },
                            },
                            {
                                "object_id": "OBJ_BAD_PUZZLE",
                                "object_name": "Bad target",
                                "object_type": "lock",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "input",
                                    "target_id": "missing_puzzle",
                                },
                            },
                            {
                                "object_id": "OBJ_PLAIN",
                                "object_name": "Plain",
                                "object_type": "decoration",
                                "visible": True,
                                "enabled": True,
                            },
                            {
                                "object_id": "OBJ_NAVIGATE",
                                "object_name": "Door",
                                "object_type": "door",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "navigate",
                                    "target_id": "ZONE_004",
                                },
                            },
                        ],
                        "navigation": [],
                    },
                    {
                        "zone_id": "ZONE_004",
                        "zone_name": "Second",
                        "zone_type": "room",
                        "description": "Second zone",
                        "objects": [
                            {
                                "object_id": "OBJ_LOCK_01",
                                "object_name": "Lock",
                                "object_type": "lock",
                                "visible": True,
                                "enabled": True,
                                "interaction": {
                                    "type": "input",
                                    "target_id": "puzzle_01",
                                },
                            }
                        ],
                        "navigation": [],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    return runtime_directory


def make_play_session(*, state: dict | None = None) -> PlaySession:
    now = datetime(2026, 9, 18, 1, 2, 3, 456789)
    return PlaySession(
        id=PLAY_SESSION_ID,
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json=(
            state
            if state is not None
            else {
                "current_zone_id": "ZONE_003",
                "completed_puzzle_ids": [],
                "acquired_clue_ids": [],
                "hint_levels": {"puzzle_01": 0},
                "attempt_counts": {},
                "flags": {"existing_flag": True},
            }
        ),
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


def input_body(
    *,
    answer: str = "아랑사",
    client_event_id: str = CLIENT_EVENT_ID,
    object_id: str = "OBJ_LOCK_01",
) -> dict:
    return {
        "client_event_id": client_event_id,
        "client_timestamp": CLIENT_TIMESTAMP,
        "zone_id": "ZONE_003",
        "action": "input",
        "target_type": "object",
        "target_id": object_id,
        "payload": {"answer": answer},
    }


def combine_clues_body(
    clue_ids: list[str],
    *,
    client_event_id: str = CLIENT_EVENT_ID,
) -> dict:
    return {
        "client_event_id": client_event_id,
        "client_timestamp": CLIENT_TIMESTAMP,
        "zone_id": "ZONE_003",
        "action": "combine_clues",
        "target_type": "clue",
        "target_id": None,
        "payload": {"clue_ids": clue_ids},
    }


def test_input_correct_returns_flat_response_and_records_event(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body(answer=" 아랑 사 "))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "interaction_id",
        "result_type",
        "message",
        "attempt_count",
        "state_changes",
        "ui_actions",
    }
    assert body["result_type"] == "correct"
    assert body["message"] is None
    assert body["attempt_count"] == 1
    assert body["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "puzzle_01"},
        {"type": "clue_acquired", "clue_id": "clue_03"},
        {
            "type": "flag_updated",
            "flag": "archive_unlocked",
            "value": True,
        },
    ]
    assert body["ui_actions"] == []
    assert play_session.state_json["attempt_counts"] == {"puzzle_01": 1}
    assert play_session.state_json["completed_puzzle_ids"] == ["puzzle_01"]

    event = db_session.added[0]
    assert isinstance(event, InteractionEvent)
    assert event.payload_json == {"answer": " 아랑 사 "}
    assert event.interaction_type == "submit_answer"
    assert event.target_id == "puzzle_01"
    assert event.client_event_id == CLIENT_EVENT_ID
    assert event.client_timestamp == datetime(2026, 9, 9, 0, 10)
    assert event.response_json["attempt_count"] == 1
    assert event.response_json["state_changes"] == body["state_changes"]
    assert db_session.commit_count == 1


def test_input_incorrect_increments_attempt_count(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body(answer="wrong"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "incorrect"
    assert response.json()["attempt_count"] == 1
    assert response.json()["state_changes"] == []
    assert play_session.state_json["attempt_counts"] == {"puzzle_01": 1}
    assert play_session.state_json["completed_puzzle_ids"] == []


def test_already_completed_does_not_increment_attempt_count(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
) -> None:
    play_session = make_play_session(
        state={
            "current_zone_id": "ZONE_003",
            "completed_puzzle_ids": ["puzzle_01"],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {"puzzle_01": 2},
            "flags": {},
        }
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body(answer="wrong"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "already_completed"
    assert response.json()["attempt_count"] == 2
    assert response.json()["state_changes"] == []
    assert play_session.state_json["attempt_counts"] == {"puzzle_01": 2}
    assert db_session.commit_count == 1


def test_legacy_completed_state_returns_null_attempt_count(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
) -> None:
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": ["puzzle_01"],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        }
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body())

    assert response.status_code == 200
    assert response.json()["result_type"] == "already_completed"
    assert response.json()["attempt_count"] is None
    assert "attempt_counts" not in play_session.state_json


def test_combine_clues_returns_null_attempt_count(
    client: TestClient,
    db_session: FakeAsyncSession,
    runtime_directory: Path,
) -> None:
    db_session.get_result = make_play_session(
        state={
            "current_zone_id": "ZONE_003",
            "completed_puzzle_ids": [],
            "acquired_clue_ids": ["clue_03", "clue_07"],
            "hint_levels": {},
            "attempt_counts": {"puzzle_01": 2},
            "flags": {},
        }
    )

    response = client.post(
        INTERACTIONS_URL,
        json=combine_clues_body(["clue_07", "clue_03"]),
    )

    assert response.status_code == 200
    assert response.json()["result_type"] == "correct"
    assert response.json()["attempt_count"] is None
    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "puzzle_02"},
        {"type": "clue_acquired", "clue_id": "clue_10"},
        {
            "type": "flag_updated",
            "flag": "truth_fragment_01",
            "value": True,
        },
    ]
    assert db_session.get_result.state_json["attempt_counts"] == {"puzzle_01": 2}


def test_unknown_combination_is_normal_incorrect_result(
    client: TestClient,
    db_session: FakeAsyncSession,
    runtime_directory: Path,
) -> None:
    state = {
        "completed_puzzle_ids": [],
        "acquired_clue_ids": ["clue_01", "clue_02"],
        "hint_levels": {},
        "flags": {},
    }
    db_session.get_result = make_play_session(state=state)

    response = client.post(
        INTERACTIONS_URL,
        json=combine_clues_body(["clue_01", "clue_02"]),
    )

    assert response.status_code == 200
    assert response.json()["result_type"] == "incorrect"
    assert response.json()["attempt_count"] is None
    assert response.json()["state_changes"] == []
    assert db_session.get_result.state_json == state


def test_unacquired_clue_returns_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    runtime_directory: Path,
) -> None:
    db_session.get_result = make_play_session(
        state={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": ["clue_03"],
            "hint_levels": {},
            "flags": {},
        }
    )

    response = client.post(
        INTERACTIONS_URL,
        json=combine_clues_body(["clue_03", "clue_07"]),
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Clue is not acquired."}
    assert db_session.added == []


def test_replay_returns_first_flat_response_without_increment(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    request_body = input_body(answer="wrong")

    first_response = client.post(INTERACTIONS_URL, json=request_body)
    saved_event = db_session.added[0]
    db_session.scalar_result = saved_event
    replay_request = deepcopy(request_body)
    replay_request["zone_id"] = "ZONE_004"
    replay_request["client_timestamp"] = "2026-09-10T12:30:00Z"
    replay_response = client.post(INTERACTIONS_URL, json=replay_request)

    assert first_response.status_code == 200
    assert replay_response.status_code == 200
    assert replay_response.json() == first_response.json()
    assert play_session.state_json["attempt_counts"] == {"puzzle_01": 1}
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


def test_same_event_with_different_payload_returns_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
) -> None:
    db_session.get_result = make_play_session()
    client.post(INTERACTIONS_URL, json=input_body(answer="first"))
    db_session.scalar_result = db_session.added[0]

    response = client.post(INTERACTIONS_URL, json=input_body(answer="different"))

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Client event ID conflicts with a previous interaction."
    }
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


@pytest.mark.parametrize(
    ("body_update", "expected_status", "expected_detail"),
    [
        ({"zone_id": "ZONE_MISSING"}, 404, "Zone not found."),
        ({"target_id": "OBJ_MISSING"}, 404, "Object not found."),
        (
            {"target_id": "OBJ_PLAIN"},
            409,
            "Object interaction is unavailable.",
        ),
        (
            {"target_id": "OBJ_NAVIGATE"},
            409,
            "Interaction action does not match the object.",
        ),
    ],
)
def test_object_resolution_errors_are_mapped(
    client: TestClient,
    db_session: FakeAsyncSession,
    client_content_directory: Path,
    body_update: dict,
    expected_status: int,
    expected_detail: str,
) -> None:
    db_session.get_result = make_play_session()
    body = input_body()
    body.update(body_update)

    response = client.post(INTERACTIONS_URL, json=body)

    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}
    assert db_session.added == []


def test_missing_client_content_returns_safe_500(
    client: TestClient,
    db_session: FakeAsyncSession,
    runtime_directory: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", runtime_directory)
    db_session.get_result = make_play_session()

    response = client.post(INTERACTIONS_URL, json=input_body())

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert str(runtime_directory) not in response.text
    assert db_session.added == []


def test_interaction_returns_404_for_missing_play_session(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    response = client.post(INTERACTIONS_URL, json=input_body())

    assert response.status_code == 404
    assert response.json() == {"detail": "Play session not found."}


@pytest.mark.parametrize(
    ("action", "target_type", "target_id", "payload"),
    [
        ("inspect", "object", "OBJ_NOTE", {}),
        ("navigate", "zone", "ZONE_004", {}),
        ("select", "object", "OBJ_CHOICES", {"choice": "optA"}),
    ],
)
def test_phase_one_unsupported_actions_return_501(
    client: TestClient,
    db_session: FakeAsyncSession,
    action: str,
    target_type: str,
    target_id: str,
    payload: dict,
) -> None:
    response = client.post(
        INTERACTIONS_URL,
        json={
            "client_event_id": CLIENT_EVENT_ID,
            "client_timestamp": CLIENT_TIMESTAMP,
            "zone_id": "ZONE_003",
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "payload": payload,
        },
    )

    assert response.status_code == 501
    assert response.json() == {
        "detail": f"Interaction action '{action}' is not implemented."
    }
    assert db_session.get_calls == []
    assert db_session.added == []


@pytest.mark.parametrize(
    "body",
    [
        {**input_body(), "payload": {}},
        combine_clues_body(["clue_03"]),
        combine_clues_body(["clue_03", "clue_03"]),
        {**input_body(), "client_timestamp": "2026-09-09T00:10:00"},
        {**input_body(), "target_type": "puzzle"},
    ],
)
def test_request_validation_returns_422(
    client: TestClient,
    db_session: FakeAsyncSession,
    body: dict,
) -> None:
    response = client.post(INTERACTIONS_URL, json=body)

    assert response.status_code == 422
    assert db_session.get_calls == []


def test_invalid_play_session_uuid_returns_422(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    response = client.post(
        "/api/v1/play-sessions/not-a-uuid/interactions",
        json=input_body(),
    )

    assert response.status_code == 422
    assert db_session.get_calls == []


def test_openapi_exposes_v032_flat_contract(client: TestClient) -> None:
    openapi = client.get("/openapi.json").json()
    operation = openapi["paths"][
        "/api/v1/play-sessions/{play_session_id}/interactions"
    ]["post"]
    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    response_schema = operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]

    assert request_schema["discriminator"]["propertyName"] == "action"
    assert {item["$ref"] for item in request_schema["oneOf"]} == {
        "#/components/schemas/InspectInteractionRequest",
        "#/components/schemas/NavigateInteractionRequest",
        "#/components/schemas/InputInteractionRequest",
        "#/components/schemas/SelectInteractionRequest",
        "#/components/schemas/CombineCluesInteractionRequest",
    }
    assert response_schema == {"$ref": "#/components/schemas/InteractionApiResponse"}
    response_properties = openapi["components"]["schemas"]["InteractionApiResponse"][
        "properties"
    ]
    assert "success" not in response_properties
    assert "data" not in response_properties
    assert set(response_properties) == {
        "interaction_id",
        "result_type",
        "message",
        "attempt_count",
        "state_changes",
        "ui_actions",
    }
