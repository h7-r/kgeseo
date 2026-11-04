"""input은 Object visible/enabled를 검사하지 않는다(현행 동작 고정).

select · inspect · navigate와 달리 input은 Object 잠금으로 막지 않는다. 바꾸려면 정책 결정이 먼저이고,
그때 이 테스트의 기대값을 뒤집는다(Client 콘텐츠를 늘 읽게 되므로
test_object_state_effects의 지연 로딩 테스트도 함께 정리해야 한다).
"""

import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.models.play_session import PlaySession
from app.services import case_content, puzzle_runtime
from tests.conftest import FakeAsyncSession

PLAY_SESSION_ID = "22222222-2222-4222-8222-222222222222"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"


def obj(object_id: str, target: str, **state: bool) -> dict:
    return {
        "object_id": object_id,
        "object_name": object_id,
        "object_type": "prop",
        "visible": state.get("visible", True),
        "enabled": state.get("enabled", True),
        "interaction": {"type": "input", "target_id": target},
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
                obj("OBJ_LOCKED", "PZ-LOCKED", enabled=False),
                obj("OBJ_HIDDEN", "PZ-HIDDEN", visible=False),
                obj("OBJ_OPEN", "PZ-OPEN"),
            ],
            "navigation": [],
        }
    ],
}


def puzzle(puzzle_id: str, **effect) -> dict:
    return {
        "puzzle_id": puzzle_id,
        "accepted_answers": ["X"],
        "on_correct": {"grant_clue_ids": [], "set_flags": {}, **effect},
    }


RUNTIME_DATA = {
    "schema_version": "0.2-draft",
    "case_id": "case_001",
    "puzzles": [
        puzzle("PZ-LOCKED"),
        puzzle("PZ-HIDDEN"),
        # 풀면 자기 Object를 숨긴다
        puzzle(
            "PZ-OPEN",
            set_object_states=[
                {"zone_id": "ZONE_R1", "object_id": "OBJ_OPEN", "visible": False}
            ],
        ),
    ],
    "clue_combinations": [],
}


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    (tmp_path / "case_001.client.json").write_text(
        json.dumps(CLIENT_DATA), encoding="utf-8"
    )
    (tmp_path / "case_001.server.json").write_text(
        json.dumps(RUNTIME_DATA), encoding="utf-8"
    )
    return tmp_path


def make_play_session(**state_overrides) -> PlaySession:
    now = datetime(2026, 11, 2, 1, 2, 3)
    return PlaySession(
        id=PLAY_SESSION_ID,
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json={
            "current_zone_id": "ZONE_R1",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
            **state_overrides,
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


EVENT_IDS = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 10_000))


def body(object_id: str) -> dict:
    return {
        "client_event_id": next(EVENT_IDS),
        "client_timestamp": "2026-11-02T09:10:00+09:00",
        "zone_id": "ZONE_R1",
        "action": "input",
        "target_type": "object",
        "target_id": object_id,
        "payload": {"answer": "x"},
    }


@pytest.mark.parametrize(
    ("object_id", "puzzle_id"),
    [
        pytest.param("OBJ_LOCKED", "PZ-LOCKED", id="disabled"),
        pytest.param("OBJ_HIDDEN", "PZ-HIDDEN", id="hidden"),
    ],
)
def test_input_on_locked_object_is_currently_graded(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    object_id: str,
    puzzle_id: str,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body(object_id))

    assert response.status_code == 200
    assert response.json()["result_type"] == "correct"
    assert play_session.state_json["completed_puzzle_ids"] == [puzzle_id]


def test_input_on_session_hidden_object_is_currently_graded(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        object_states={"ZONE_R1": {"OBJ_OPEN": {"visible": False}}}
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body("OBJ_OPEN"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "correct"


def test_input_completed_puzzle_on_hidden_object_returns_already_completed(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    first = client.post(INTERACTIONS_URL, json=body("OBJ_OPEN"))

    again = client.post(INTERACTIONS_URL, json=body("OBJ_OPEN"))

    assert first.json()["state_changes"][-1] == {
        "type": "object_hidden",
        "zone_id": "ZONE_R1",
        "object_id": "OBJ_OPEN",
    }
    assert again.status_code == 200
    assert again.json()["result_type"] == "already_completed"
    assert again.json()["attempt_count"] == 1
