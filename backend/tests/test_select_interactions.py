from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.models.interaction_event import InteractionEvent
from tests.conftest import FakeAsyncSession
from tests.naju_mini_case import (
    CLIENT_DATA,
    CLUES_MISSING,
    INTERACTIONS_URL,
    PUZZLES_MISSING,
    RUNTIME_DATA,
    input_body,
    make_play_session,
    obj,
    prepare_case_directory,
    select_body,
    write_case,
)


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    return prepare_case_directory(tmp_path, monkeypatch)


# PZ_OFFERING의 선행(PZ_JARS → PZ_POSTS)을 마친 상태
READY = {"completed_puzzle_ids": ["PZ_JARS", "PZ_POSTS"]}


def assert_rejected(
    response, db_session: FakeAsyncSession, state_before: dict, play_session
) -> None:
    assert response.status_code == 409
    assert play_session.state_json == state_before
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_select_correct_choice_completes_puzzle_and_records_event(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**READY)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", " Offered "))

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
        {"type": "puzzle_completed", "puzzle_id": "PZ_OFFERING"},
        {"type": "flag_updated", "flag": "offering_done", "value": True},
    ]
    assert play_session.state_json["completed_puzzle_ids"] == [
        "PZ_JARS",
        "PZ_POSTS",
        "PZ_OFFERING",
    ]
    assert play_session.state_json["attempt_counts"] == {"PZ_OFFERING": 1}

    event = db_session.added[0]
    assert isinstance(event, InteractionEvent)
    assert event.interaction_type == "select_choice"
    assert event.target_id == "PZ_OFFERING"
    assert event.payload_json == {"choice": " Offered "}
    assert event.result_type == "correct"
    assert db_session.commit_count == 1


def test_select_incorrect_choice_increments_attempt_count(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**READY)
    db_session.get_result = play_session

    first = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "nope"))
    second = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "still"))

    assert first.json()["result_type"] == "incorrect"
    assert first.json()["state_changes"] == []
    assert second.json()["attempt_count"] == 2
    assert "PZ_OFFERING" not in play_session.state_json["completed_puzzle_ids"]
    assert play_session.state_json["flags"] == {}


def test_select_already_completed_keeps_attempt_count(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**READY)
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    again = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "anything"))

    assert again.status_code == 200
    assert again.json()["result_type"] == "already_completed"
    assert again.json()["attempt_count"] == 1
    assert again.json()["state_changes"] == []


def test_select_replay_returns_first_response(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**READY)
    db_session.get_result = play_session
    request = select_body("OBJ_ALTAR", "offered")
    first = client.post(INTERACTIONS_URL, json=request)
    db_session.scalar_result = db_session.added[0]

    replay = client.post(INTERACTIONS_URL, json=request)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1
    assert play_session.state_json["attempt_counts"] == {"PZ_OFFERING": 1}


def test_select_same_event_with_different_choice_returns_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session(**READY)
    request = select_body("OBJ_ALTAR", "offered")
    client.post(INTERACTIONS_URL, json=request)
    db_session.scalar_result = db_session.added[0]

    response = client.post(
        INTERACTIONS_URL,
        json={**request, "payload": {"choice": "different"}},
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Client event ID conflicts with a previous interaction."
    }
    assert len(db_session.added) == 1


@pytest.mark.parametrize(
    ("object_id", "state", "detail"),
    [
        pytest.param("OBJ_HIDDEN_SELECT", {}, "Object is not visible.", id="hidden"),
        pytest.param("OBJ_LOCKED_SELECT", {}, "Object is not enabled.", id="disabled"),
        pytest.param(
            "OBJ_ALTAR",
            {"object_states": {"ZONE_A": {"OBJ_ALTAR": {"visible": False}}}},
            "Object is not visible.",
            id="hidden-by-session",
        ),
    ],
)
def test_select_on_locked_object_returns_409_without_grading(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    object_id: str,
    state: dict,
    detail: str,
) -> None:
    play_session = make_play_session(**READY, **state)
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body(object_id, "x"))

    assert response.json() == {"detail": detail}
    assert_rejected(response, db_session, state_before, play_session)


def test_select_completed_puzzle_on_hidden_object_returns_already_completed(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_JARS", "PZ_POSTS", "PZ_OFFERING"],
        attempt_counts={"PZ_OFFERING": 2},
        object_states={"ZONE_A": {"OBJ_ALTAR": {"visible": False}}},
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "x"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "already_completed"
    assert response.json()["attempt_count"] == 2


def test_select_missing_required_puzzle_returns_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(completed_puzzle_ids=["PZ_JARS"])
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json() == {"detail": PUZZLES_MISSING, "missing_puzzle_count": 1}
    assert_rejected(response, db_session, state_before, play_session)


def test_select_missing_required_clue_returns_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["puzzles"][2]["requires_clue_ids"] = ["CL_NOTE"]
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session(**READY)
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json() == {"detail": CLUES_MISSING, "missing_clue_count": 1}
    assert_rejected(response, db_session, state_before, play_session)


@pytest.mark.parametrize(
    ("request_json", "status", "detail"),
    [
        pytest.param(
            select_body("OBJ_JARS", "do-mi-sol"),
            409,
            "Interaction action does not match the object.",
            id="select-on-input-object",
        ),
        pytest.param(
            input_body("OBJ_ALTAR", "offered"),
            409,
            "Interaction action does not match the object.",
            id="input-on-select-object",
        ),
        pytest.param(
            select_body("OBJ_MISSING", "x"), 404, "Object not found.", id="missing"
        ),
        pytest.param(
            select_body("OBJ_ALTAR", "offered", zone_id="ZONE_B"),
            404,
            "Object not found.",
            id="object-not-in-zone",
        ),
    ],
)
def test_select_object_resolution_errors(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    request_json: dict,
    status: int,
    detail: str,
) -> None:
    db_session.get_result = make_play_session(**READY)

    response = client.post(INTERACTIONS_URL, json=request_json)

    assert response.status_code == status
    assert response.json() == {"detail": detail}
    assert db_session.added == []


def test_select_from_zone_that_is_not_current_returns_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    client_data = deepcopy(CLIENT_DATA)
    client_data["zones"][1]["objects"] = [obj("OBJ_FAR", "select", "PZ_JARS")]
    write_case(case_directory, client=client_data)
    db_session.get_result = make_play_session()

    response = client.post(
        INTERACTIONS_URL, json=select_body("OBJ_FAR", "x", zone_id="ZONE_B")
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Zone is not current."}
    assert db_session.added == []


@pytest.mark.parametrize(
    ("target_type", "target_id"),
    [
        ("zone", "ZONE_B"),
        ("clue", "CL_NOTE"),
        ("puzzle", "PZ_OFFERING"),
        ("object", None),
    ],
)
def test_unsupported_select_forms_still_return_501(
    client: TestClient,
    db_session: FakeAsyncSession,
    target_type: str,
    target_id: str | None,
) -> None:
    response = client.post(
        INTERACTIONS_URL,
        json={
            **select_body("OBJ_ALTAR", "offered"),
            "target_type": target_type,
            "target_id": target_id,
        },
    )

    assert response.status_code == 501
    assert response.json() == {
        "detail": "Interaction action 'select' is not implemented."
    }
    assert db_session.get_calls == []
    assert db_session.added == []


def test_select_with_broken_content_link_returns_safe_500(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    client_data = deepcopy(CLIENT_DATA)
    client_data["zones"][0]["objects"].append(obj("OBJ_BAD", "select", "PZ_NOPE"))
    write_case(case_directory, client=client_data)
    db_session.get_result = make_play_session(**READY)

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert "PZ_NOPE" not in response.text
    assert db_session.added == []
