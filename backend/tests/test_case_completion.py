from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.puzzle_runtime import load_case_runtime
from tests.conftest import FakeAsyncSession
from tests.naju_mini_case import (
    INTERACTIONS_URL,
    PLAY_SESSION_ID,
    input_body,
    inspect_body,
    make_play_session,
    prepare_case_directory,
    runtime_data,
    select_body,
    write_case,
)

CASE_COMPLETED = {"type": "case_completed"}
# 마지막 조건(PZ_BIRDS)만 남은 상태
ONE_LEFT = {"completed_puzzle_ids": ["PZ_JARS", "PZ_POSTS", "PZ_OFFERING"]}


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    return prepare_case_directory(tmp_path, monkeypatch)


# ── 콘텐츠 스키마 ──


def test_existing_content_has_no_case_completion() -> None:
    assert load_case_runtime("case_001").case_completion is None


@pytest.mark.parametrize(
    ("case_completion", "message"),
    [
        pytest.param({"requires_puzzle_ids": []}, "at least 1 item", id="empty"),
        pytest.param(
            {"requires_puzzle_ids": ["PZ_NOPE"]},
            "case_completion requires unknown puzzle 'PZ_NOPE'",
            id="unknown",
        ),
        pytest.param(
            {"requires_puzzle_ids": ["PZ_JARS", "PZ_JARS"]},
            "case_completion requires_puzzle_ids has duplicate 'PZ_JARS'",
            id="duplicate",
        ),
        pytest.param(
            {"requires_puzzle_ids": [""]},
            "case_completion requires_puzzle_ids must not contain blank IDs",
            id="blank",
        ),
        pytest.param(
            {"requires_puzzle_ids": ["PZ_JARS"], "extra": True},
            "Extra inputs are not permitted",
            id="extra-field",
        ),
    ],
)
def test_invalid_case_completion_is_rejected(
    case_completion: dict, message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        PuzzleRuntimeDefinition.model_validate(
            runtime_data(case_completion=case_completion)
        )


# ── 판정 ──


def test_completing_last_required_puzzle_records_completed_at(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**ONE_LEFT)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    assert response.status_code == 200
    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_BIRDS"},
        CASE_COMPLETED,
    ]
    assert isinstance(play_session.completed_at, datetime)
    assert play_session.completed_at.tzinfo is None
    assert play_session.updated_at == play_session.completed_at
    event = db_session.added[0]
    assert event.response_json["state_changes"][-1] == CASE_COMPLETED
    assert db_session.commit_count == 1


@pytest.mark.parametrize(
    "request_json",
    [
        pytest.param(select_body("OBJ_BIRDS", "wrong"), id="incorrect"),
        pytest.param(input_body("OBJ_JARS", "do-mi-sol"), id="other-puzzle"),
    ],
)
def test_partial_completion_keeps_completed_at_null(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    request_json: dict,
) -> None:
    play_session = make_play_session(completed_puzzle_ids=["PZ_POSTS", "PZ_OFFERING"])
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=request_json)

    assert response.status_code == 200
    assert CASE_COMPLETED not in response.json()["state_changes"]
    assert play_session.completed_at is None


def test_rejected_interaction_does_not_complete_case(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(completed_puzzle_ids=["PZ_BIRDS"])
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.status_code == 409
    assert play_session.completed_at is None


def test_case_completed_is_emitted_once(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**ONE_LEFT)
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))
    completed_at = play_session.completed_at

    # 완료 후 Interaction은 막지 않는다(차단 정책 미정)
    after = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_NOTE"))
    again = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    assert after.status_code == 200
    assert after.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CL_NOTE"}
    ]
    assert again.json()["result_type"] == "already_completed"
    assert CASE_COMPLETED not in again.json()["state_changes"]
    assert play_session.completed_at == completed_at


def test_completed_session_is_not_completed_again(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    earlier = datetime(2026, 11, 1, 0, 0, 0)
    play_session = make_play_session(completed_at=earlier, **ONE_LEFT)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_BIRDS"}
    ]
    assert play_session.completed_at == earlier


def test_completion_replay_returns_first_response(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**ONE_LEFT)
    db_session.get_result = play_session
    request = select_body("OBJ_BIRDS", "facing")
    first = client.post(INTERACTIONS_URL, json=request)
    completed_at = play_session.completed_at
    db_session.scalar_result = db_session.added[0]

    replay = client.post(INTERACTIONS_URL, json=request)

    assert replay.json() == first.json()
    assert replay.json()["state_changes"][-1] == CASE_COMPLETED
    assert play_session.completed_at == completed_at
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


def test_completion_through_effect_complete_puzzle_ids(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = runtime_data()
    runtime["inspections"][0]["on_inspect"]["complete_puzzle_ids"] = ["PZ_BIRDS"]
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session(**ONE_LEFT)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_NOTE"))

    assert response.json()["state_changes"][-1] == CASE_COMPLETED
    assert play_session.completed_at is not None


def test_session_already_meeting_conditions_completes_on_next_interaction(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    # case_completion이 콘텐츠에 나중에 추가된 세션
    play_session = make_play_session(completed_puzzle_ids=["PZ_OFFERING", "PZ_BIRDS"])
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_NOTE"))

    assert response.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CL_NOTE"},
        CASE_COMPLETED,
    ]
    assert play_session.completed_at is not None


def test_case_without_case_completion_never_completes(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = runtime_data()
    del runtime["case_completion"]
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session(**ONE_LEFT)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_BIRDS"}
    ]
    assert play_session.completed_at is None


def test_play_session_read_returns_completed_at(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**ONE_LEFT)
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))
    completed_at = play_session.completed_at

    response = client.get(f"/api/v1/play-sessions/{PLAY_SESSION_ID}")

    assert response.status_code == 200
    returned = response.json()["data"]["completed_at"]
    assert (
        datetime.fromisoformat(returned.replace("Z", "+00:00")).replace(tzinfo=None)
        == completed_at
    )


def test_openapi_lists_case_completed_state_change(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]

    items = schemas["InteractionApiResponse"]["properties"]["state_changes"]["items"]
    assert items["discriminator"]["mapping"]["case_completed"] == (
        "#/components/schemas/CaseCompletedStateChange"
    )
    assert schemas["CaseCompletedStateChange"]["properties"]["type"] == {
        "const": "case_completed",
        "title": "Type",
        "type": "string",
    }
    assert set(schemas["CaseCompletedStateChange"]["properties"]) == {"type"}


def test_runtime_dump_keeps_case_completion_round_trip() -> None:
    runtime = PuzzleRuntimeDefinition.model_validate(deepcopy(runtime_data()))

    again = PuzzleRuntimeDefinition.model_validate(
        runtime.model_dump(exclude_unset=True)
    )

    assert again.case_completion is not None
    assert again.case_completion.requires_puzzle_ids == ["PZ_OFFERING", "PZ_BIRDS"]
