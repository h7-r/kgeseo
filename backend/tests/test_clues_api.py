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
OTHER_PLAY_SESSION_ID = "33333333-3333-4333-8333-333333333333"
CLUES_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/clues"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"


def obj(object_id: str, inspect_id: str, *, visible: bool = True) -> dict:
    return {
        "object_id": object_id,
        "object_name": object_id,
        "object_type": "prop",
        "visible": visible,
        "enabled": True,
        "interaction": {"type": "inspect", "target_id": inspect_id},
    }


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
                obj("OBJ_LETTER", "INSPECT_LETTER"),
                obj("OBJ_DIARY", "INSPECT_DIARY"),
                obj("OBJ_LOCK", "INSPECT_LOCK"),
            ],
            "navigation": [],
        }
    ],
}


def effect(**values) -> dict:
    return {"grant_clue_ids": [], "set_flags": {}, **values}


RUNTIME_DATA = {
    "schema_version": "0.1",
    "case_id": "case_001",
    "puzzles": [
        {
            "puzzle_id": "PUZZLE_SECRET",
            "accepted_answers": ["ANSWER_VALVE"],
            "on_correct": effect(
                grant_clue_ids=["CLUE_SECRET"], set_flags={"hidden_flag": True}
            ),
        }
    ],
    "clue_combinations": [],
    "inspections": [
        {
            "inspect_id": "INSPECT_LETTER",
            "on_inspect": effect(grant_clue_ids=["CLUE_LETTER"]),
        },
        {
            "inspect_id": "INSPECT_DIARY",
            "on_inspect": effect(grant_clue_ids=["CLUE_DIARY"]),
        },
        {"inspect_id": "INSPECT_LOCK", "on_inspect": effect()},
    ],
    "clues": [
        {
            "clue_id": "CLUE_LETTER",
            "title": "낡은 서신",
            "summary": "서신의 핵심 요약",
            "body": "서신에 적힌 전체 내용",
        },
        {"clue_id": "CLUE_DIARY", "title": "젖은 일기"},
        {
            "clue_id": "CLUE_SECRET",
            "title": "SECRET_TITLE",
            "summary": "SECRET_SUMMARY",
            "body": "SECRET_BODY",
        },
    ],
}

LETTER = {
    "clue_id": "CLUE_LETTER",
    "title": "낡은 서신",
    "summary": "서신의 핵심 요약",
    "body": "서신에 적힌 전체 내용",
}
DIARY = {"clue_id": "CLUE_DIARY", "title": "젖은 일기", "summary": None, "body": None}


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    write_case(tmp_path)
    return tmp_path


def write_case(directory: Path, *, runtime: dict | None = None) -> None:
    (directory / "case_001.client.json").write_text(
        json.dumps(CLIENT_DATA), encoding="utf-8"
    )
    (directory / "case_001.server.json").write_text(
        json.dumps(runtime or RUNTIME_DATA, ensure_ascii=False), encoding="utf-8"
    )


def make_play_session(
    *,
    acquired: list[str] | None = None,
    play_session_id: str = PLAY_SESSION_ID,
    case_id: str = "case_001",
) -> PlaySession:
    now = datetime(2026, 10, 23, 1, 2, 3)
    return PlaySession(
        id=play_session_id,
        anonymous_session_id="anonymous-session-id",
        case_id=case_id,
        state_json={
            "current_zone_id": "ZONE_SARANG",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": list(acquired or []),
            "hint_levels": {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


EVENT_IDS = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 10_000))


def inspect_body(object_id: str, *, client_event_id: str | None = None) -> dict:
    return {
        "client_event_id": client_event_id or next(EVENT_IDS),
        "client_timestamp": "2026-10-23T09:10:00+09:00",
        "zone_id": "ZONE_SARANG",
        "action": "inspect",
        "target_type": "object",
        "target_id": object_id,
        "payload": {},
    }


def get_clues(client: TestClient, url: str = CLUES_URL) -> list[dict]:
    response = client.get(url)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    return body["data"]["clues"]


def test_new_session_has_no_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    response = client.get(CLUES_URL)

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {"play_session_id": PLAY_SESSION_ID, "clues": []},
    }


def test_acquired_clue_returns_title_summary_and_body(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    acquired = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_LETTER"))

    assert acquired.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_LETTER"}
    ]
    assert get_clues(client) == [LETTER]


def test_reloading_returns_same_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()
    client.post(INTERACTIONS_URL, json=inspect_body("OBJ_LETTER"))

    first = get_clues(client)
    second = get_clues(client)

    assert first == second == [LETTER]


def test_clues_keep_acquisition_order(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()

    client.post(INTERACTIONS_URL, json=inspect_body("OBJ_DIARY"))
    client.post(INTERACTIONS_URL, json=inspect_body("OBJ_LETTER"))

    assert get_clues(client) == [DIARY, LETTER]


def test_play_sessions_do_not_share_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    first = make_play_session()
    second = make_play_session(play_session_id=OTHER_PLAY_SESSION_ID)
    db_session.get_result = first
    client.post(INTERACTIONS_URL, json=inspect_body("OBJ_LETTER"))

    db_session.get_result = second
    other = get_clues(client, f"/api/v1/play-sessions/{OTHER_PLAY_SESSION_ID}/clues")

    assert other == []
    db_session.get_result = first
    assert get_clues(client) == [LETTER]


def test_replayed_event_does_not_duplicate_clue(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session()
    body = inspect_body("OBJ_LETTER")
    first = client.post(INTERACTIONS_URL, json=body)
    stored_event = db_session.added[0]
    assert isinstance(stored_event, InteractionEvent)

    db_session.scalar_result = stored_event
    replay = client.post(INTERACTIONS_URL, json=body)

    assert replay.json() == first.json()
    assert get_clues(client) == [LETTER]


def test_unacquired_and_server_only_data_are_not_exposed(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session(acquired=["CLUE_LETTER"])

    response = client.get(CLUES_URL)

    assert response.json()["data"]["clues"] == [LETTER]
    for secret in (
        "CLUE_SECRET",
        "SECRET_TITLE",
        "SECRET_SUMMARY",
        "SECRET_BODY",
        "CLUE_DIARY",
        "젖은 일기",
        "ANSWER_VALVE",
        "hidden_flag",
        "PUZZLE_SECRET",
        "accepted_answers",
        "grant_clue_ids",
    ):
        assert secret not in response.text


def test_bundle_does_not_contain_clue_definitions(
    client: TestClient,
    case_directory: Path,
) -> None:
    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 200
    for clue in RUNTIME_DATA["clues"]:
        for value in clue.values():
            assert value not in response.text


def test_content_without_clue_definitions_returns_null_display_fields(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    del runtime["clues"]
    write_case(case_directory, runtime=runtime)
    db_session.get_result = make_play_session()

    client.post(INTERACTIONS_URL, json=inspect_body("OBJ_LETTER"))

    assert get_clues(client) == [
        {"clue_id": "CLUE_LETTER", "title": None, "summary": None, "body": None}
    ]


def test_acquired_clue_missing_from_current_definitions_is_not_invented(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session(acquired=["CLUE_REMOVED", "CLUE_DIARY"])

    assert get_clues(client) == [
        {"clue_id": "CLUE_REMOVED", "title": None, "summary": None, "body": None},
        DIARY,
    ]


def test_reading_clues_does_not_change_database(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(acquired=["CLUE_LETTER"])
    original = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    get_clues(client)

    assert play_session.state_json == original
    assert db_session.added == []
    assert db_session.commit_count == 0
    assert db_session.rollback_count == 0
    assert db_session.refresh_count == 0


def test_unknown_play_session_returns_404(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    response = client.get(CLUES_URL)

    assert response.status_code == 404
    assert response.json() == {"detail": "Play session not found."}


def test_invalid_server_content_returns_safe_500(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = deepcopy(RUNTIME_DATA)
    runtime["clues"][0]["carrier_kind"] = "letter"
    write_case(case_directory, runtime=runtime)
    db_session.get_result = make_play_session(acquired=["CLUE_LETTER"])

    response = client.get(CLUES_URL)

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert "carrier_kind" not in response.text
    assert "낡은 서신" not in response.text


def test_case_001_has_no_clue_definitions(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    # 실제 case_001 콘텐츠(단서 정의 없음)를 읽는다.
    db_session.get_result = make_play_session()
    assert get_clues(client) == []

    db_session.get_result = make_play_session(acquired=["CLUE_ANY"])
    assert get_clues(client) == [
        {"clue_id": "CLUE_ANY", "title": None, "summary": None, "body": None}
    ]
