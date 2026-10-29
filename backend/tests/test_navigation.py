import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.schemas.interaction import (
    CombineCluesInteraction,
    CombineCluesPayload,
    InspectInteraction,
    InspectPayload,
    NavigateInteraction,
    NavigatePayload,
    SubmitAnswerInteraction,
    SubmitAnswerPayload,
)
from app.services import case_content, puzzle_runtime
from app.services.interaction import (
    CurrentZoneUnknownError,
    NavigationUnavailableError,
    ObjectNotEnabledError,
    ObjectNotVisibleError,
    ZoneNotCurrentError,
    process_interaction,
)
from app.services.object_resolver import ZoneNotFoundError
from tests.conftest import FakeAsyncSession

PLAY_SESSION_ID = "44444444-4444-4444-8444-444444444444"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"
SESSION_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}"
CLIENT_TIMESTAMP = "2026-10-23T09:10:00+09:00"


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


def door(object_id: str, target_zone_id: str, **state: bool) -> dict:
    return obj(object_id, type="navigate", target_id=target_zone_id, **state)


def zone(zone_id: str, objects: list[dict], navigation: list[tuple[str, str]]):
    return {
        "zone_id": zone_id,
        "zone_name": zone_id,
        "zone_type": "room",
        "description": zone_id,
        "objects": objects,
        "navigation": [
            {"door_object_id": door_id, "target_zone_id": target}
            for door_id, target in navigation
        ],
    }


# 가상의 4개 Zone. A→B 문은 잠김(퍼즐로 해금), A→C 문은 숨김, D는 A에서 연결 없음.
CLIENT_DATA = {
    "case_id": "case_001",
    "entry_zone_id": "ZONE_A",
    "zones": [
        zone(
            "ZONE_A",
            [
                obj("OBJ_LOCK_A", type="input", target_id="PUZZLE_A"),
                obj("OBJ_NOTE_A", type="inspect", target_id="INSPECT_A"),
                door("OBJ_DOOR_AB", "ZONE_B", enabled=False),
                door("OBJ_DOOR_AC", "ZONE_C", visible=False),
            ],
            [("OBJ_DOOR_AB", "ZONE_B"), ("OBJ_DOOR_AC", "ZONE_C")],
        ),
        zone(
            "ZONE_B",
            [
                obj("OBJ_LOCK_B", type="input", target_id="PUZZLE_B"),
                obj("OBJ_NOTE_B", type="inspect", target_id="INSPECT_B"),
                door("OBJ_DOOR_BA", "ZONE_A"),
                door("OBJ_DOOR_BD", "ZONE_D"),
            ],
            [("OBJ_DOOR_BA", "ZONE_A"), ("OBJ_DOOR_BD", "ZONE_D")],
        ),
        zone("ZONE_C", [door("OBJ_DOOR_CA", "ZONE_A")], [("OBJ_DOOR_CA", "ZONE_A")]),
        zone("ZONE_D", [], []),
    ],
}


def effect(**values) -> dict:
    return {"grant_clue_ids": [], "set_flags": {}, **values}


RUNTIME_DATA = {
    "schema_version": "0.1",
    "case_id": "case_001",
    "puzzles": [
        {
            "puzzle_id": "PUZZLE_A",
            "accepted_answers": ["OPEN"],
            "on_correct": effect(
                set_object_states=[
                    {"zone_id": "ZONE_A", "object_id": "OBJ_DOOR_AB", "enabled": True}
                ],
            ),
        },
        {
            "puzzle_id": "PUZZLE_B",
            "accepted_answers": ["BEE"],
            "on_correct": effect(grant_clue_ids=["CLUE_PUZZLE_B"]),
        },
    ],
    "clue_combinations": [
        {
            "combination_id": "COMBO_AB",
            "clue_ids": ["CLUE_A", "CLUE_B"],
            "on_success": effect(grant_clue_ids=["CLUE_AB"]),
        },
    ],
    "inspections": [
        {"inspect_id": "INSPECT_A", "on_inspect": effect(grant_clue_ids=["CLUE_A"])},
        {"inspect_id": "INSPECT_B", "on_inspect": effect(grant_clue_ids=["CLUE_B"])},
    ],
}

SINGLE_ZONE_CLIENT_DATA = {
    "case_id": "case_001",
    "entry_zone_id": "ZONE_A",
    "zones": [
        zone(
            "ZONE_A",
            [
                obj("OBJ_LOCK_A", type="input", target_id="PUZZLE_A"),
                obj("OBJ_NOTE_A", type="inspect", target_id="INSPECT_A"),
            ],
            [],
        ),
    ],
}

SINGLE_ZONE_RUNTIME_DATA = {
    **RUNTIME_DATA,
    "puzzles": [
        {
            "puzzle_id": "PUZZLE_A",
            "accepted_answers": ["OPEN"],
            "on_correct": effect(grant_clue_ids=["CLUE_PUZZLE_A"]),
        },
        RUNTIME_DATA["puzzles"][1],
    ],
}


def write_case(directory: Path, client: dict, runtime: dict) -> None:
    (directory / "case_001.client.json").write_text(json.dumps(client), "utf-8")
    (directory / "case_001.server.json").write_text(json.dumps(runtime), "utf-8")


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    write_case(tmp_path, CLIENT_DATA, RUNTIME_DATA)
    return tmp_path


@pytest.fixture
def single_zone_case(case_directory: Path) -> Path:
    write_case(case_directory, SINGLE_ZONE_CLIENT_DATA, SINGLE_ZONE_RUNTIME_DATA)
    return case_directory


def make_state(**overrides) -> dict:
    return {
        "current_zone_id": "ZONE_A",
        "completed_puzzle_ids": [],
        "completed_inspect_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
        "object_states": {},
        **overrides,
    }


def legacy_state(**overrides) -> dict:
    state = make_state(**overrides)
    del state["current_zone_id"]
    return state


def make_play_session(state: dict | None = None) -> PlaySession:
    now = datetime(2026, 10, 23, 1, 2, 3)
    return PlaySession(
        id=PLAY_SESSION_ID,
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json=state if state is not None else make_state(),
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


EVENT_IDS = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 10_000))


def navigate_body(
    target_zone_id: str,
    *,
    zone_id: str = "ZONE_A",
    client_event_id: str | None = None,
) -> dict:
    return {
        "client_event_id": client_event_id or next(EVENT_IDS),
        "client_timestamp": CLIENT_TIMESTAMP,
        "zone_id": zone_id,
        "action": "navigate",
        "target_type": "zone",
        "target_id": target_zone_id,
        "payload": {},
    }


def object_body(
    object_id: str,
    *,
    zone_id: str,
    action: str,
    payload: dict | None = None,
    client_event_id: str | None = None,
) -> dict:
    return {
        "client_event_id": client_event_id or next(EVENT_IDS),
        "client_timestamp": CLIENT_TIMESTAMP,
        "zone_id": zone_id,
        "action": action,
        "target_type": "object",
        "target_id": object_id,
        "payload": payload if payload is not None else {},
    }


def input_body(object_id: str, answer: str, *, zone_id: str, **options) -> dict:
    return object_body(
        object_id,
        zone_id=zone_id,
        action="input",
        payload={"answer": answer},
        **options,
    )


def inspect_body(object_id: str, *, zone_id: str, **options) -> dict:
    return object_body(object_id, zone_id=zone_id, action="inspect", **options)


def combine_body(clue_ids: list[str], *, zone_id: str) -> dict:
    return {
        "client_event_id": next(EVENT_IDS),
        "client_timestamp": CLIENT_TIMESTAMP,
        "zone_id": zone_id,
        "action": "combine_clues",
        "target_type": "clue",
        "target_id": None,
        "payload": {"clue_ids": clue_ids},
    }


def assert_rejected_without_changes(
    response,
    db_session: FakeAsyncSession,
    play_session: PlaySession,
    state_before: dict,
    *,
    status_code: int,
    detail: str,
) -> None:
    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert play_session.state_json == state_before
    assert db_session.added == []
    assert db_session.commit_count == 0


# ── navigate 성공 ──


def test_navigate_through_open_door_moves_and_session_read_shows_it(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        make_state(object_states={"ZONE_A": {"OBJ_DOOR_AB": {"enabled": True}}})
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=navigate_body("ZONE_B"))
    read = client.get(SESSION_URL)

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
    assert body["result_type"] == "ok"
    assert body["message"] is None
    assert body["attempt_count"] is None
    assert body["ui_actions"] == []
    assert body["state_changes"] == [
        {"type": "current_zone_changed", "zone_id": "ZONE_B"}
    ]
    assert play_session.state_json["current_zone_id"] == "ZONE_B"
    assert read.json()["data"]["state"]["current_zone_id"] == "ZONE_B"
    event = db_session.added[0]
    assert event.interaction_type == "navigate"
    assert event.target_id == "ZONE_B"
    assert event.payload_json == {}
    assert event.result_type == "navigated"
    assert db_session.commit_count == 1


def test_locked_door_opens_after_puzzle_and_then_navigates(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    state_before = deepcopy(play_session.state_json)

    locked = client.post(INTERACTIONS_URL, json=navigate_body("ZONE_B"))

    assert_rejected_without_changes(
        locked,
        db_session,
        play_session,
        state_before,
        status_code=409,
        detail="Object is not enabled.",
    )

    solved = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_LOCK_A", "OPEN", zone_id="ZONE_A")
    )
    moved = client.post(INTERACTIONS_URL, json=navigate_body("ZONE_B"))
    back = client.post(INTERACTIONS_URL, json=navigate_body("ZONE_A", zone_id="ZONE_B"))

    assert solved.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_A"},
        {"type": "object_unlocked", "zone_id": "ZONE_A", "object_id": "OBJ_DOOR_AB"},
    ]
    assert moved.status_code == 200
    assert moved.json()["state_changes"] == [
        {"type": "current_zone_changed", "zone_id": "ZONE_B"}
    ]
    assert back.status_code == 200
    assert play_session.state_json["current_zone_id"] == "ZONE_A"


# ── navigate 실패: 상태·이벤트·커밋 불변 ──


@pytest.mark.parametrize(
    ("state", "body", "status_code", "detail"),
    [
        # 숨긴 문
        (make_state(), navigate_body("ZONE_C"), 409, "Object is not visible."),
        # 연결되지 않은 Zone
        (make_state(), navigate_body("ZONE_D"), 409, "Navigation is unavailable."),
        # 현재 Zone으로의 이동
        (make_state(), navigate_body("ZONE_A"), 409, "Navigation is unavailable."),
        # 요청 zone_id 위조: 서버 위치는 A인데 B의 열린 문을 쓰려 함
        (
            make_state(),
            navigate_body("ZONE_D", zone_id="ZONE_B"),
            409,
            "Zone is not current.",
        ),
        # 없는 출발 Zone / 목적지 Zone
        (
            make_state(),
            navigate_body("ZONE_B", zone_id="ZONE_X"),
            404,
            "Zone not found.",
        ),
        (make_state(), navigate_body("ZONE_X"), 404, "Zone not found."),
        # 다중 Zone 콘텐츠의 과거 세션 / 콘텐츠에서 사라진 저장 위치
        (legacy_state(), navigate_body("ZONE_B"), 409, "Current zone is unknown."),
        (
            make_state(current_zone_id="ZONE_REMOVED"),
            navigate_body("ZONE_B"),
            409,
            "Current zone is unknown.",
        ),
    ],
    ids=[
        "hidden-door",
        "unconnected-zone",
        "same-zone",
        "forged-zone-id",
        "missing-origin-zone",
        "missing-target-zone",
        "legacy-multi-zone",
        "removed-current-zone",
    ],
)
def test_navigate_rejections_change_nothing(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    state: dict,
    body: dict,
    status_code: int,
    detail: str,
) -> None:
    play_session = make_play_session(deepcopy(state))
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body)

    assert_rejected_without_changes(
        response,
        db_session,
        play_session,
        state,
        status_code=status_code,
        detail=detail,
    )
    assert db_session.rollback_count >= 1


@pytest.mark.parametrize(
    "body",
    [
        {**navigate_body("ZONE_B"), "target_type": "object"},
        {**navigate_body("ZONE_B"), "target_id": None},
        {**navigate_body("ZONE_B"), "target_id": ""},
        {**navigate_body("ZONE_B"), "payload": {"door_object_id": "OBJ_DOOR_AB"}},
        {**navigate_body("ZONE_B"), "zone_id": ""},
    ],
)
def test_navigate_request_validation_returns_422(
    client: TestClient,
    db_session: FakeAsyncSession,
    body: dict,
) -> None:
    response = client.post(INTERACTIONS_URL, json=body)

    assert response.status_code == 422
    assert db_session.get_calls == []


# ── Zone 접근 제한 ──


@pytest.mark.parametrize(
    "body",
    [
        input_body("OBJ_LOCK_B", "BEE", zone_id="ZONE_B"),
        inspect_body("OBJ_NOTE_B", zone_id="ZONE_B"),
    ],
    ids=["input", "inspect"],
)
def test_input_and_inspect_outside_current_zone_return_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    body: dict,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    state_before = deepcopy(play_session.state_json)

    response = client.post(INTERACTIONS_URL, json=body)

    assert_rejected_without_changes(
        response,
        db_session,
        play_session,
        state_before,
        status_code=409,
        detail="Zone is not current.",
    )


@pytest.mark.parametrize(
    ("state", "body"),
    [
        (
            make_state(
                completed_puzzle_ids=["PUZZLE_B"],
                attempt_counts={"PUZZLE_B": 1},
            ),
            input_body("OBJ_LOCK_B", "BEE", zone_id="ZONE_B"),
        ),
        (
            make_state(completed_inspect_ids=["INSPECT_B"]),
            inspect_body("OBJ_NOTE_B", zone_id="ZONE_B"),
        ),
    ],
    ids=["completed-puzzle", "completed-inspection"],
)
def test_completed_targets_in_other_zone_also_return_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    state: dict,
    body: dict,
) -> None:
    play_session = make_play_session(deepcopy(state))
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body)

    assert_rejected_without_changes(
        response,
        db_session,
        play_session,
        state,
        status_code=409,
        detail="Zone is not current.",
    )


def test_input_and_inspect_work_after_moving_to_their_zone(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(make_state(current_zone_id="ZONE_B"))
    db_session.get_result = play_session

    solved = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_LOCK_B", "BEE", zone_id="ZONE_B")
    )
    inspected = client.post(
        INTERACTIONS_URL, json=inspect_body("OBJ_NOTE_B", zone_id="ZONE_B")
    )

    assert solved.json()["result_type"] == "correct"
    assert inspected.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_B"}
    ]


def test_combine_clues_and_clue_list_ignore_current_zone(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        make_state(current_zone_id="ZONE_D", acquired_clue_ids=["CLUE_A", "CLUE_B"])
    )
    db_session.get_result = play_session

    combined = client.post(
        INTERACTIONS_URL, json=combine_body(["CLUE_A", "CLUE_B"], zone_id="ZONE_A")
    )
    clues = client.get(f"{SESSION_URL}/clues")

    assert combined.status_code == 200
    assert combined.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_AB"}
    ]
    assert clues.status_code == 200
    assert play_session.state_json["current_zone_id"] == "ZONE_D"


@pytest.mark.anyio
async def test_internal_requests_require_zone_id() -> None:
    with pytest.raises(ValidationError):
        SubmitAnswerInteraction(
            client_event_id="event",
            interaction_type="submit_answer",
            target_id="PUZZLE_A",
            payload=SubmitAnswerPayload(answer="OPEN"),
        )
    with pytest.raises(ValidationError):
        InspectInteraction(
            client_event_id="event",
            interaction_type="inspect",
            target_id="INSPECT_A",
            zone_id="",
            object_id="OBJ_NOTE_A",
            payload=InspectPayload(),
        )
    with pytest.raises(ValidationError):
        NavigateInteraction(
            client_event_id="event",
            interaction_type="navigate",
            target_id="ZONE_B",
            payload=NavigatePayload(),
        )


@pytest.mark.anyio
async def test_service_checks_zone_for_every_located_interaction(
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    requests = [
        SubmitAnswerInteraction(
            client_event_id="event-input",
            interaction_type="submit_answer",
            target_id="PUZZLE_B",
            zone_id="ZONE_B",
            payload=SubmitAnswerPayload(answer="BEE"),
        ),
        InspectInteraction(
            client_event_id="event-inspect",
            interaction_type="inspect",
            target_id="INSPECT_B",
            zone_id="ZONE_B",
            object_id="OBJ_NOTE_B",
            payload=InspectPayload(),
        ),
        NavigateInteraction(
            client_event_id="event-navigate",
            interaction_type="navigate",
            target_id="ZONE_D",
            zone_id="ZONE_B",
            payload=NavigatePayload(),
        ),
    ]

    for request in requests:
        db = FakeAsyncSession()
        db.get_result = play_session
        with pytest.raises(ZoneNotCurrentError):
            await process_interaction(db, play_session.id, request)
        assert db.added == []
        assert db.commit_count == 0

    assert play_session.state_json == make_state()


# ── 멱등성 ──


def test_navigate_replay_returns_first_response_without_moving_again(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        make_state(object_states={"ZONE_A": {"OBJ_DOOR_AB": {"enabled": True}}})
    )
    db_session.get_result = play_session
    body = navigate_body("ZONE_B")

    first = client.post(INTERACTIONS_URL, json=body)
    db_session.scalar_result = db_session.added[0]
    state_after_first = deepcopy(play_session.state_json)
    # 이미 ZONE_B로 이동했으므로 Zone 검사를 먼저 하면 409가 된다.
    replay = client.post(INTERACTIONS_URL, json=body)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert play_session.state_json == state_after_first
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


def test_navigate_same_event_with_other_target_conflicts(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        make_state(object_states={"ZONE_A": {"OBJ_DOOR_AB": {"enabled": True}}})
    )
    db_session.get_result = play_session
    body = navigate_body("ZONE_B")

    client.post(INTERACTIONS_URL, json=body)
    db_session.scalar_result = db_session.added[0]
    state_after_first = deepcopy(play_session.state_json)
    conflict = client.post(
        INTERACTIONS_URL,
        json={**body, "target_id": "ZONE_C"},
    )

    assert conflict.status_code == 409
    assert conflict.json() == {
        "detail": "Client event ID conflicts with a previous interaction."
    }
    assert play_session.state_json == state_after_first
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


def test_input_replay_after_moving_returns_first_response(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    body = input_body("OBJ_LOCK_A", "OPEN", zone_id="ZONE_A")

    first = client.post(INTERACTIONS_URL, json=body)
    event = db_session.added[0]
    client.post(INTERACTIONS_URL, json=navigate_body("ZONE_B"))
    assert play_session.state_json["current_zone_id"] == "ZONE_B"
    db_session.scalar_result = event
    replay = client.post(INTERACTIONS_URL, json=body)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert len(db_session.added) == 2


def test_rejected_navigate_event_id_can_be_retried_after_unlock(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    body = navigate_body("ZONE_B")

    rejected = client.post(INTERACTIONS_URL, json=body)
    client.post(
        INTERACTIONS_URL, json=input_body("OBJ_LOCK_A", "OPEN", zone_id="ZONE_A")
    )
    retried = client.post(INTERACTIONS_URL, json=body)

    assert rejected.status_code == 409
    assert retried.status_code == 200
    assert play_session.state_json["current_zone_id"] == "ZONE_B"


# ── 과거 세션(current_zone_id 없음) ──


def test_legacy_single_zone_session_restores_entry_zone(
    client: TestClient,
    db_session: FakeAsyncSession,
    single_zone_case: Path,
) -> None:
    play_session = make_play_session(legacy_state())
    db_session.get_result = play_session

    before = client.get(SESSION_URL)
    inspected = client.post(
        INTERACTIONS_URL, json=inspect_body("OBJ_NOTE_A", zone_id="ZONE_A")
    )
    after = client.get(SESSION_URL)

    assert before.json()["data"]["state"]["current_zone_id"] is None
    assert inspected.status_code == 200
    assert inspected.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_A"}
    ]
    assert play_session.state_json["current_zone_id"] == "ZONE_A"
    assert after.json()["data"]["state"]["current_zone_id"] == "ZONE_A"


def test_legacy_single_zone_session_restores_on_no_change_result(
    client: TestClient,
    db_session: FakeAsyncSession,
    single_zone_case: Path,
) -> None:
    play_session = make_play_session(
        legacy_state(completed_puzzle_ids=["PUZZLE_A"], attempt_counts={"PUZZLE_A": 1})
    )
    db_session.get_result = play_session

    response = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_LOCK_A", "OPEN", zone_id="ZONE_A")
    )

    assert response.json()["result_type"] == "already_completed"
    assert response.json()["state_changes"] == []
    assert play_session.state_json["current_zone_id"] == "ZONE_A"


@pytest.mark.parametrize(
    "body",
    [
        input_body("OBJ_LOCK_A", "OPEN", zone_id="ZONE_A"),
        inspect_body("OBJ_NOTE_A", zone_id="ZONE_A"),
    ],
    ids=["input", "inspect"],
)
def test_legacy_multi_zone_session_is_rejected_without_changes(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    body: dict,
) -> None:
    state = legacy_state()
    play_session = make_play_session(deepcopy(state))
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=body)
    read = client.get(SESSION_URL)

    assert_rejected_without_changes(
        response,
        db_session,
        play_session,
        state,
        status_code=409,
        detail="Current zone is unknown.",
    )
    assert read.json()["data"]["state"]["current_zone_id"] is None


def test_legacy_multi_zone_session_can_still_combine_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        legacy_state(acquired_clue_ids=["CLUE_A", "CLUE_B"])
    )
    db_session.get_result = play_session

    response = client.post(
        INTERACTIONS_URL, json=combine_body(["CLUE_A", "CLUE_B"], zone_id="ZONE_A")
    )

    assert response.status_code == 200
    assert "current_zone_id" not in play_session.state_json


@pytest.mark.anyio
async def test_service_errors_for_unknown_and_missing_zones(
    case_directory: Path,
) -> None:
    cases = [
        (legacy_state(), "ZONE_A", "ZONE_B", CurrentZoneUnknownError),
        (make_state(), "ZONE_A", "ZONE_D", NavigationUnavailableError),
        (make_state(), "ZONE_A", "ZONE_C", ObjectNotVisibleError),
        (make_state(), "ZONE_A", "ZONE_B", ObjectNotEnabledError),
        (make_state(), "ZONE_A", "ZONE_MISSING", ZoneNotFoundError),
    ]
    for state, zone_id, target_id, error in cases:
        play_session = make_play_session(deepcopy(state))
        db = FakeAsyncSession()
        db.get_result = play_session
        with pytest.raises(error):
            await process_interaction(
                db,
                play_session.id,
                NavigateInteraction(
                    client_event_id="event",
                    interaction_type="navigate",
                    target_id=target_id,
                    zone_id=zone_id,
                    payload=NavigatePayload(),
                ),
            )
        assert play_session.state_json == state
        assert db.added == []
        assert db.commit_count == 0


@pytest.mark.anyio
async def test_combine_service_does_not_need_zone(case_directory: Path) -> None:
    play_session = make_play_session(
        legacy_state(acquired_clue_ids=["CLUE_A", "CLUE_B"])
    )
    db = FakeAsyncSession()
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        CombineCluesInteraction(
            client_event_id="event",
            interaction_type="combine_clues",
            payload=CombineCluesPayload(clue_ids=["CLUE_A", "CLUE_B"]),
        ),
    )

    assert result.result.result_type == "combined"


# ── 콘텐츠 문 연결 규칙(N3~N7) ──


def mutate(change) -> dict:
    data = deepcopy(CLIENT_DATA)
    change(data["zones"][0])
    return data


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (
            mutate(
                lambda z: z["navigation"].append(
                    {"door_object_id": "OBJ_NOTE_A", "target_zone_id": "ZONE_A"}
                )
            ),
            "must not be its own zone",
        ),
        (
            mutate(
                lambda z: (
                    z["objects"].append(door("OBJ_DOOR_AB2", "ZONE_B")),
                    z["navigation"].append(
                        {"door_object_id": "OBJ_DOOR_AB2", "target_zone_id": "ZONE_B"}
                    ),
                )
            ),
            "target_zone_id must be unique",
        ),
        (
            mutate(
                lambda z: z["navigation"].append(
                    {"door_object_id": "OBJ_DOOR_AB", "target_zone_id": "ZONE_D"}
                )
            ),
            "door_object_id must be unique",
        ),
        (
            mutate(lambda z: z["objects"][2].pop("interaction")),
            "must declare a matching navigate interaction",
        ),
        (
            mutate(lambda z: z["objects"][2]["interaction"].update(target_id="ZONE_D")),
            "must declare a matching navigate interaction",
        ),
        (
            mutate(lambda z: z["objects"][2]["interaction"].update(type="inspect")),
            "must declare a matching navigate interaction",
        ),
        (
            mutate(lambda z: z["objects"].append(door("OBJ_LOOSE_DOOR", "ZONE_D"))),
            "must be registered in navigation",
        ),
    ],
    ids=[
        "N3-self-target",
        "N4-duplicate-target",
        "N5-duplicate-door",
        "N6-missing-interaction",
        "N6-target-mismatch",
        "N6-type-mismatch",
        "N7-unregistered-navigate-object",
    ],
)
def test_invalid_door_connections_are_rejected(data: dict, message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        CaseClientContent.model_validate(data)


def test_valid_door_connections_are_accepted() -> None:
    content = CaseClientContent.model_validate(CLIENT_DATA)

    assert [len(zone.navigation) for zone in content.zones] == [2, 2, 1, 0]


def test_invalid_door_connection_makes_navigation_unavailable_safely(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    write_case(
        case_directory,
        mutate(lambda z: z["objects"][2].pop("interaction")),
        RUNTIME_DATA,
    )
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=navigate_body("ZONE_B"))

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert db_session.added == []
