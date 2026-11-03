from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.puzzle_runtime import load_case_runtime
from tests.conftest import FakeAsyncSession
from tests.naju_mini_case import (
    CLIENT_DATA,
    CLUES_MISSING,
    INTERACTIONS_URL,
    PLAY_SESSION_ID,
    PUZZLES_MISSING,
    effect,
    input_body,
    inspect_body,
    make_play_session,
    obj,
    prepare_case_directory,
    puzzle,
    runtime_data,
    select_body,
    write_case,
)

ITEMS_NOT_HELD = "Required items are not held."
# PZ_OFFERING의 선행 퍼즐(PZ_JARS → PZ_POSTS)을 마친 상태
READY = {"completed_puzzle_ids": ["PZ_JARS", "PZ_POSTS"]}
HOLDING = {**READY, "acquired_item_ids": ["ITEM_RICE", "ITEM_WINE"]}


def item_client_data() -> dict:
    data = deepcopy(CLIENT_DATA)
    data["zones"][0]["objects"] += [
        obj("OBJ_RICE", "inspect", "INSP_RICE"),
        obj("OBJ_WINE", "inspect", "INSP_WINE"),
        obj("OBJ_RICE_AGAIN", "inspect", "INSP_RICE_AGAIN"),
        obj("OBJ_ALTAR_2", "select", "PZ_OFFERING_2"),
        obj("OBJ_SHRINE", "input", "PZ_SHRINE"),
    ]
    return data


def item_runtime_data() -> dict:
    data = runtime_data()
    offering = data["puzzles"][2]
    offering["consumes_item_ids"] = ["ITEM_RICE", "ITEM_WINE"]
    data["puzzles"] += [
        # 같은 아이템을 소비하는 다른 퍼즐(먼저 푼 쪽만 소비한다)
        puzzle("PZ_OFFERING_2", "offered", consumes_item_ids=["ITEM_RICE"]),
        puzzle("PZ_SHRINE", "bow", consumes_item_ids=["ITEM_WINE"]),
    ]
    data["inspections"] += [
        {"inspect_id": "INSP_RICE", "on_inspect": effect(grant_item_ids=["ITEM_RICE"])},
        {"inspect_id": "INSP_WINE", "on_inspect": effect(grant_item_ids=["ITEM_WINE"])},
        {
            "inspect_id": "INSP_RICE_AGAIN",
            "on_inspect": effect(grant_item_ids=["ITEM_RICE"]),
        },
    ]
    return data


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = prepare_case_directory(tmp_path, monkeypatch)
    write_case(directory, runtime=item_runtime_data(), client=item_client_data())
    return directory


def assert_rejected(
    response, db_session: FakeAsyncSession, state_before: dict, play_session
) -> None:
    assert response.status_code == 409
    assert play_session.state_json == state_before
    assert db_session.added == []
    assert db_session.commit_count == 0


# ── 콘텐츠 스키마 ──


def test_existing_content_has_no_items() -> None:
    runtime = load_case_runtime("case_001")

    assert all(p.consumes_item_ids == [] for p in runtime.puzzles)
    assert all(p.on_correct.grant_item_ids == [] for p in runtime.puzzles)
    assert all(i.on_inspect.grant_item_ids == [] for i in runtime.inspections)


def test_item_runtime_is_valid() -> None:
    runtime = PuzzleRuntimeDefinition.model_validate(item_runtime_data())

    assert runtime.puzzles[2].consumes_item_ids == ["ITEM_RICE", "ITEM_WINE"]
    assert runtime.inspections[1].on_inspect.grant_item_ids == ["ITEM_RICE"]


def _with_offering(**values) -> dict:
    data = item_runtime_data()
    data["puzzles"][2].update(values)
    return data


def _with_rice_grant(grant_item_ids: list[str]) -> dict:
    data = item_runtime_data()
    data["inspections"][1]["on_inspect"]["grant_item_ids"] = grant_item_ids
    return data


@pytest.mark.parametrize(
    ("data", "message"),
    [
        pytest.param(
            _with_offering(consumes_item_ids=["ITEM_RICE", "ITEM_RICE"]),
            "Puzzle 'PZ_OFFERING' consumes_item_ids has duplicate 'ITEM_RICE'",
            id="duplicate-consume",
        ),
        pytest.param(
            _with_offering(consumes_item_ids=[" "]),
            "Puzzle 'PZ_OFFERING' consumes_item_ids must not contain blank IDs",
            id="blank-consume",
        ),
        pytest.param(
            _with_offering(consumes_item_ids=["ITEM_GHOST"]),
            "Puzzle 'PZ_OFFERING' consumes item 'ITEM_GHOST' that no effect grants",
            id="never-granted",
        ),
        pytest.param(
            _with_offering(
                consumes_item_ids=["ITEM_RICE"],
                on_correct=effect(grant_item_ids=["ITEM_RICE"]),
            ),
            "Puzzle 'PZ_OFFERING' must not grant an item it consumes",
            id="consume-own-grant",
        ),
        pytest.param(
            _with_rice_grant(["ITEM_RICE", "ITEM_RICE"]),
            "grant_item_ids has duplicate 'ITEM_RICE'",
            id="duplicate-grant",
        ),
        pytest.param(
            _with_rice_grant([""]),
            "grant_item_ids must not contain blank IDs",
            id="blank-grant",
        ),
    ],
)
def test_invalid_item_content_is_rejected(data: dict, message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        PuzzleRuntimeDefinition.model_validate(data)


def test_legacy_state_reads_empty_item_lists() -> None:
    state = PlaySessionState.model_validate(
        {
            "completed_puzzle_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        }
    )

    assert state.acquired_item_ids == []
    assert state.consumed_item_ids == []


# ── 획득 ──


def test_inspect_grants_item_without_touching_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_RICE"))

    assert response.status_code == 200
    assert response.json()["state_changes"] == [
        {"type": "item_acquired", "item_id": "ITEM_RICE"}
    ]
    assert play_session.state_json["acquired_item_ids"] == ["ITEM_RICE"]
    assert play_session.state_json["acquired_clue_ids"] == []
    assert "consumed_item_ids" not in play_session.state_json


# ── 소비 ──


def test_correct_answer_consumes_held_items(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**HOLDING)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "correct"
    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_OFFERING"},
        {"type": "item_consumed", "item_id": "ITEM_RICE"},
        {"type": "item_consumed", "item_id": "ITEM_WINE"},
        {"type": "flag_updated", "flag": "offering_done", "value": True},
    ]
    state = play_session.state_json
    # 획득 기록은 그대로 두고 소비 기록을 따로 쌓는다.
    assert state["acquired_item_ids"] == ["ITEM_RICE", "ITEM_WINE"]
    assert state["consumed_item_ids"] == ["ITEM_RICE", "ITEM_WINE"]
    assert "PZ_OFFERING" in state["completed_puzzle_ids"]
    # 퍼즐 완료 · 소비 · 이벤트가 한 번의 커밋으로 저장된다.
    assert db_session.commit_count == 1
    event = db_session.added[0]
    assert event.response_json["state"]["consumed_item_ids"] == [
        "ITEM_RICE",
        "ITEM_WINE",
    ]


def test_input_puzzle_consumes_items_too(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(acquired_item_ids=["ITEM_WINE"])
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_SHRINE", "bow"))

    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_SHRINE"},
        {"type": "item_consumed", "item_id": "ITEM_WINE"},
    ]
    assert play_session.state_json["consumed_item_ids"] == ["ITEM_WINE"]


@pytest.mark.parametrize(
    ("state", "missing"),
    [
        pytest.param({}, 2, id="none-acquired"),
        pytest.param({"acquired_item_ids": ["ITEM_RICE"]}, 1, id="one-acquired"),
        pytest.param(
            {
                "acquired_item_ids": ["ITEM_RICE", "ITEM_WINE"],
                "consumed_item_ids": ["ITEM_RICE"],
            },
            1,
            id="one-consumed",
        ),
    ],
)
def test_items_not_held_returns_409_without_grading(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    state: dict,
    missing: int,
) -> None:
    play_session = make_play_session(**READY, **state)
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json() == {"detail": ITEMS_NOT_HELD, "missing_item_count": missing}
    assert "ITEM_" not in response.text
    assert_rejected(response, db_session, state_before, play_session)


def test_item_consumed_by_another_puzzle_cannot_be_used_again(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**HOLDING)
    db_session.get_result = play_session
    first = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR_2", "offered"))
    state_before = deepcopy(play_session.state_json)
    db_session.added.clear()
    db_session.commit_count = 0

    second = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert first.json()["result_type"] == "correct"
    assert second.json() == {"detail": ITEMS_NOT_HELD, "missing_item_count": 1}
    assert_rejected(second, db_session, state_before, play_session)
    assert play_session.state_json["consumed_item_ids"] == ["ITEM_RICE"]


def test_incorrect_answer_does_not_consume(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**HOLDING)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "nope"))

    assert response.json()["result_type"] == "incorrect"
    assert response.json()["state_changes"] == []
    assert response.json()["attempt_count"] == 1
    assert "consumed_item_ids" not in play_session.state_json


def test_completed_puzzle_returns_already_completed_after_consumption(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**HOLDING)
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    again = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert again.status_code == 200
    assert again.json()["result_type"] == "already_completed"
    assert again.json()["state_changes"] == []
    assert play_session.state_json["consumed_item_ids"] == ["ITEM_RICE", "ITEM_WINE"]


def test_consumed_item_is_not_granted_again(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        acquired_item_ids=["ITEM_RICE"], consumed_item_ids=["ITEM_RICE"]
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_RICE_AGAIN"))

    assert response.json()["result_type"] == "ok"
    assert response.json()["state_changes"] == []
    assert play_session.state_json["acquired_item_ids"] == ["ITEM_RICE"]
    assert play_session.state_json["consumed_item_ids"] == ["ITEM_RICE"]


def test_replay_returns_first_response_without_second_consumption(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**HOLDING)
    db_session.get_result = play_session
    request = select_body("OBJ_ALTAR", "offered")
    first = client.post(INTERACTIONS_URL, json=request)
    db_session.scalar_result = db_session.added[0]

    replay = client.post(INTERACTIONS_URL, json=request)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert play_session.state_json["consumed_item_ids"] == ["ITEM_RICE", "ITEM_WINE"]
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


def test_required_puzzles_are_checked_before_items(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    db_session.get_result = make_play_session(completed_puzzle_ids=["PZ_JARS"])

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json() == {"detail": PUZZLES_MISSING, "missing_puzzle_count": 1}


def test_required_clues_are_checked_before_items(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = item_runtime_data()
    runtime["puzzles"][2]["requires_clue_ids"] = ["CL_NOTE"]
    write_case(case_directory, runtime=runtime, client=item_client_data())
    db_session.get_result = make_play_session(**READY)

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json() == {"detail": CLUES_MISSING, "missing_clue_count": 1}


def test_consuming_last_puzzle_completes_case_in_same_commit(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = item_runtime_data()
    runtime["puzzles"][3]["consumes_item_ids"] = ["ITEM_WINE"]
    write_case(case_directory, runtime=runtime, client=item_client_data())
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_JARS", "PZ_POSTS", "PZ_OFFERING"],
        acquired_item_ids=["ITEM_WINE"],
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_BIRDS"},
        {"type": "item_consumed", "item_id": "ITEM_WINE"},
        {"type": "case_completed"},
    ]
    assert play_session.completed_at is not None
    assert db_session.commit_count == 1


# ── 조회 · 계약 ──


def test_play_session_read_returns_item_lists(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**HOLDING)
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    response = client.get(f"/api/v1/play-sessions/{PLAY_SESSION_ID}")

    state = response.json()["data"]["state"]
    assert state["acquired_item_ids"] == ["ITEM_RICE", "ITEM_WINE"]
    assert state["consumed_item_ids"] == ["ITEM_RICE", "ITEM_WINE"]
    assert state["acquired_clue_ids"] == []


def test_openapi_lists_item_state_changes(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]

    items = schemas["InteractionApiResponse"]["properties"]["state_changes"]["items"]
    mapping = items["discriminator"]["mapping"]
    assert mapping["item_acquired"] == "#/components/schemas/ItemAcquiredStateChange"
    assert mapping["item_consumed"] == "#/components/schemas/ItemConsumedStateChange"
    for name in ("ItemAcquiredStateChange", "ItemConsumedStateChange"):
        assert set(schemas[name]["properties"]) == {"type", "item_id"}
