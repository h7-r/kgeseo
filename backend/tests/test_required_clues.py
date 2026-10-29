import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services import case_content, puzzle_runtime
from app.services.puzzle_runtime import CaseRuntimeValidationError, load_case_runtime
from tests.conftest import FakeAsyncSession

PLAY_SESSION_ID = "22222222-2222-4222-8222-222222222222"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"
MISSING = "Required clues are not acquired."


def obj(object_id: str, kind: str, target: str, **state: bool) -> dict:
    return {
        "object_id": object_id,
        "object_name": object_id,
        "object_type": "prop",
        "visible": state.get("visible", True),
        "enabled": state.get("enabled", True),
        "interaction": {"type": kind, "target_id": target},
    }


CLIENT_DATA = {
    "case_id": "case_001",
    "entry_zone_id": "ZONE_R1",
    "zones": [
        {
            "zone_id": "ZONE_R1",
            "zone_name": "Room",
            "zone_type": "room",
            "description": "Room",
            "objects": [
                obj("OBJ_NOTE_A", "inspect", "INSP_NOTE_A"),
                obj("OBJ_NOTE_B", "inspect", "INSP_NOTE_B"),
                obj("OBJ_SEAL", "inspect", "INSP_SEAL"),
                obj("OBJ_HIDDEN", "inspect", "INSP_HIDDEN", visible=False),
                obj("OBJ_LOCK", "input", "PZ-LOCK"),
                obj("OBJ_FREE_LOCK", "input", "PZ-FREE"),
                {
                    "object_id": "OBJ_DOOR",
                    "object_name": "Door",
                    "object_type": "door",
                    "visible": True,
                    "enabled": False,
                },
            ],
            "navigation": [],
        }
    ],
}


def effect(**values) -> dict:
    return {"grant_clue_ids": [], "set_flags": {}, **values}


RUNTIME_DATA = {
    "schema_version": "0.2-draft",
    "case_id": "case_001",
    "puzzles": [
        {
            "puzzle_id": "PZ-LOCK",
            "accepted_answers": ["ANSWER_LOCK"],
            "requires_clue_ids": ["CL-A", "CL-B"],
            "on_correct": effect(
                grant_clue_ids=["CL-R"],
                set_flags={"case_cleared": True},
                set_object_states=[
                    {"zone_id": "ZONE_R1", "object_id": "OBJ_DOOR", "enabled": True}
                ],
            ),
        },
        {
            "puzzle_id": "PZ-FREE",
            "accepted_answers": ["FREE"],
            "on_correct": effect(),
        },
    ],
    "clue_combinations": [],
    "inspections": [
        {"inspect_id": "INSP_NOTE_A", "on_inspect": effect(grant_clue_ids=["CL-A"])},
        {"inspect_id": "INSP_NOTE_B", "on_inspect": effect(grant_clue_ids=["CL-B"])},
        {
            "inspect_id": "INSP_SEAL",
            "requires_clue_ids": ["CL-A", "CL-B"],
            "on_inspect": effect(complete_puzzle_ids=["PZ-SEAL"]),
        },
        {
            "inspect_id": "INSP_HIDDEN",
            "requires_clue_ids": ["CL-A"],
            "on_inspect": effect(),
        },
    ],
    "clues": [
        {"clue_id": "CL-A", "title": "A"},
        {"clue_id": "CL-B", "title": "B"},
        {"clue_id": "CL-R", "title": "R"},
    ],
}


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    write_case(tmp_path)
    return tmp_path


def write_case(directory: Path, runtime: dict | None = None) -> None:
    (directory / "case_001.client.json").write_text(
        json.dumps(CLIENT_DATA), encoding="utf-8"
    )
    (directory / "case_001.server.json").write_text(
        json.dumps(runtime or RUNTIME_DATA), encoding="utf-8"
    )


def make_play_session(**state_overrides) -> PlaySession:
    state = {
        "current_zone_id": "ZONE_R1",
        "completed_puzzle_ids": [],
        "completed_inspect_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
        "object_states": {},
        **state_overrides,
    }
    now = datetime(2026, 10, 23, 1, 2, 3)
    return PlaySession(
        id=PLAY_SESSION_ID,
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json=state,
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


EVENT_IDS = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 10_000))


def body(
    object_id: str,
    *,
    answer: str | None = None,
    client_event_id: str | None = None,
) -> dict:
    return {
        "client_event_id": client_event_id or next(EVENT_IDS),
        "client_timestamp": "2026-10-23T09:10:00+09:00",
        "zone_id": "ZONE_R1",
        "action": "inspect" if answer is None else "input",
        "target_type": "object",
        "target_id": object_id,
        "payload": {} if answer is None else {"answer": answer},
    }


def assert_rejected_without_side_effects(
    response,
    db_session: FakeAsyncSession,
    play_session: PlaySession,
    state_before: dict,
    missing: int,
) -> None:
    assert response.status_code == 409
    assert response.json() == {"detail": MISSING, "missing_clue_count": missing}
    for clue_id in ("CL-A", "CL-B", "CL-R"):
        assert clue_id not in response.text
    assert play_session.state_json == state_before
    assert db_session.added == []
    assert db_session.commit_count == 0
    assert db_session.rollback_count == 1


# ── 퍼즐 input ──


@pytest.mark.parametrize(
    ("acquired", "missing"),
    [pytest.param([], 2, id="none"), pytest.param(["CL-B"], 1, id="partial")],
)
def test_puzzle_rejects_correct_answer_until_clues_acquired(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    acquired: list[str],
    missing: int,
) -> None:
    play_session = make_play_session(acquired_clue_ids=list(acquired))
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(
        INTERACTIONS_URL, json=body("OBJ_LOCK", answer="ANSWER_LOCK")
    )

    assert_rejected_without_side_effects(
        response, db_session, play_session, state_before, missing
    )
    assert "PZ-LOCK" not in play_session.state_json["attempt_counts"]
    assert "case_cleared" not in play_session.state_json["flags"]


def test_puzzle_wrong_answer_is_also_rejected_before_grading(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body("OBJ_LOCK", answer="WRONG"))

    # 정답·오답이 같은 409라서 응답으로 정답 여부를 알 수 없다.
    assert_rejected_without_side_effects(
        response, db_session, play_session, state_before, 2
    )


def test_puzzle_runs_normally_after_all_clues_acquired(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=body("OBJ_NOTE_A"))
    client.post(INTERACTIONS_URL, json=body("OBJ_NOTE_B"))

    wrong = client.post(INTERACTIONS_URL, json=body("OBJ_LOCK", answer="WRONG"))
    right = client.post(INTERACTIONS_URL, json=body("OBJ_LOCK", answer="answer_lock"))

    assert wrong.json()["result_type"] == "incorrect"
    assert wrong.json()["attempt_count"] == 1
    assert right.json()["result_type"] == "correct"
    assert right.json()["attempt_count"] == 2
    assert right.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ-LOCK"},
        {"type": "clue_acquired", "clue_id": "CL-R"},
        {"type": "flag_updated", "flag": "case_cleared", "value": True},
        {"type": "object_unlocked", "zone_id": "ZONE_R1", "object_id": "OBJ_DOOR"},
    ]


def test_completed_puzzle_keeps_already_completed_without_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session(
        completed_puzzle_ids=["PZ-LOCK"], attempt_counts={"PZ-LOCK": 3}
    )

    response = client.post(
        INTERACTIONS_URL, json=body("OBJ_LOCK", answer="ANSWER_LOCK")
    )

    assert response.status_code == 200
    assert response.json()["result_type"] == "already_completed"
    assert response.json()["attempt_count"] == 3


def test_puzzle_without_requirements_is_unchanged(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    response = client.post(INTERACTIONS_URL, json=body("OBJ_FREE_LOCK", answer="FREE"))

    assert response.json()["result_type"] == "correct"


# ── 조사 inspect ──


@pytest.mark.parametrize(
    ("acquired", "missing"),
    [pytest.param([], 2, id="none"), pytest.param(["CL-A"], 1, id="partial")],
)
def test_inspection_rejected_until_clues_acquired(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    acquired: list[str],
    missing: int,
) -> None:
    play_session = make_play_session(acquired_clue_ids=list(acquired))
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body("OBJ_SEAL"))

    assert_rejected_without_side_effects(
        response, db_session, play_session, state_before, missing
    )
    assert "PZ-SEAL" not in play_session.state_json["completed_puzzle_ids"]
    assert "INSP_SEAL" not in play_session.state_json["completed_inspect_ids"]


def test_inspection_runs_after_all_clues_acquired(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=body("OBJ_NOTE_A"))
    client.post(INTERACTIONS_URL, json=body("OBJ_NOTE_B"))

    response = client.post(INTERACTIONS_URL, json=body("OBJ_SEAL"))

    assert response.json()["result_type"] == "ok"
    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ-SEAL"}
    ]
    assert play_session.state_json["completed_inspect_ids"][-1] == "INSP_SEAL"


def test_hidden_object_check_comes_before_requirements(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    response = client.post(INTERACTIONS_URL, json=body("OBJ_HIDDEN"))

    assert response.status_code == 409
    assert response.json() == {"detail": "Object is not visible."}


def test_completed_inspection_keeps_ok_without_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session(completed_inspect_ids=["INSP_SEAL"])

    response = client.post(INTERACTIONS_URL, json=body("OBJ_SEAL"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "ok"
    assert response.json()["state_changes"] == []


# ── 멱등성 ──


def test_successful_event_replays_after_requirements(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(acquired_clue_ids=["CL-A", "CL-B"])
    db_session.get_result = play_session
    request = body("OBJ_LOCK", answer="ANSWER_LOCK")
    first = client.post(INTERACTIONS_URL, json=request)
    stored_event = db_session.added[0]
    assert isinstance(stored_event, InteractionEvent)
    state_after = deepcopy(play_session.state_json)

    db_session.scalar_result = stored_event
    replay = client.post(INTERACTIONS_URL, json=request)

    assert replay.json() == first.json()
    assert play_session.state_json == state_after


def test_rejected_event_id_can_be_retried_after_acquiring_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    event_id = "44444444-4444-4444-8444-444444444444"
    request = body("OBJ_SEAL", client_event_id=event_id)

    rejected = client.post(INTERACTIONS_URL, json=request)
    client.post(INTERACTIONS_URL, json=body("OBJ_NOTE_A"))
    client.post(INTERACTIONS_URL, json=body("OBJ_NOTE_B"))
    retried = client.post(INTERACTIONS_URL, json=request)

    assert rejected.status_code == 409
    assert retried.status_code == 200
    assert retried.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ-SEAL"}
    ]


# ── 스키마 ──


def write_and_load(directory: Path, runtime: dict):
    write_case(directory, runtime)
    return load_case_runtime("case_001")


def test_missing_or_empty_requirements_mean_no_requirements(
    case_directory: Path,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["puzzles"][1]["requires_clue_ids"] = []

    loaded = write_and_load(case_directory, runtime)

    assert loaded.puzzles[1].requires_clue_ids == []
    assert loaded.inspections[0].requires_clue_ids == []
    assert loaded.puzzles[0].requires_clue_ids == ["CL-A", "CL-B"]


@pytest.mark.parametrize(
    ("value", "message"),
    [
        pytest.param([""], "must not contain blank IDs", id="empty"),
        pytest.param(["  "], "must not contain blank IDs", id="blank"),
        pytest.param(["CL-A", "CL-A"], "has duplicate 'CL-A'", id="duplicate"),
        pytest.param(
            ["CL-NOPE"],
            "Puzzle 'PZ-LOCK' requires_clue_ids references clue 'CL-NOPE'",
            id="undefined",
        ),
        pytest.param([7], "string", id="non_string"),
        pytest.param("CL-A", "list", id="not_a_list"),
    ],
)
def test_invalid_puzzle_requirements_are_rejected(
    case_directory: Path,
    value: object,
    message: str,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["puzzles"][0]["requires_clue_ids"] = value

    with pytest.raises(CaseRuntimeValidationError) as error:
        write_and_load(case_directory, runtime)

    assert message in str(error.value.__cause__)


@pytest.mark.parametrize(
    ("value", "message"),
    [
        pytest.param(
            ["CL-B", "CL-B"], "Inspection 'INSP_SEAL' requires_clue_ids has duplicate"
        ),
        pytest.param(
            ["CL-NOPE"], "Inspection 'INSP_SEAL' requires_clue_ids references clue"
        ),
    ],
)
def test_invalid_inspection_requirements_are_rejected(
    case_directory: Path,
    value: list,
    message: str,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["inspections"][2]["requires_clue_ids"] = value

    with pytest.raises(CaseRuntimeValidationError) as error:
        write_and_load(case_directory, runtime)

    assert message in str(error.value.__cause__)


def test_requirements_without_clue_definitions_keep_id_only_content(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    del runtime["clues"]
    write_case(case_directory, runtime)
    db_session.get_result = make_play_session(acquired_clue_ids=["CL-A"])

    response = client.post(INTERACTIONS_URL, json=body("OBJ_SEAL"))

    assert response.status_code == 409
    assert response.json() == {"detail": MISSING, "missing_clue_count": 1}
