"""조사 표시 문구(inspections[].message) — 테스트용 가상 콘텐츠만 쓴다."""

from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.puzzle_runtime import InspectionDefinition, PuzzleRuntimeDefinition
from app.services.interaction import (
    ObjectNotEnabledError,
    ObjectNotVisibleError,
    RequiredCluesMissingError,
    ZoneNotCurrentError,
)
from tests.conftest import FakeAsyncSession
from tests.test_inspect_interactions import (
    CLIENT_DATA,
    INTERACTIONS_URL,
    RUNTIME_DATA,
    case_directory,  # noqa: F401 - fixture
    changes,
    effect,
    inspect,
    make_play_session,
    make_state,
    request_body,
    revealed,
    write_case,
)

BEDDING_MESSAGE = "이불 밑에서 접힌 종이가 보입니다."
LETTER_MESSAGE = "종이에는 지워진 글씨 자국만 남아 있습니다."
SCREEN_MESSAGE = "병풍 뒤에는 먼지뿐입니다."
CHEST_MESSAGE = "상자 안쪽에 긁힌 자국이 있습니다."
GATED_MESSAGE = "편지와 같은 필체의 메모가 끼워져 있습니다."

MISSING = "Required clues are not acquired."


def message_runtime() -> dict:
    """기존 가상 런타임에 문구를 붙이고, 단서 조건이 있는 조사 하나를 더한다."""

    runtime = deepcopy(RUNTIME_DATA)
    messages = {
        "INSPECT_BEDDING": BEDDING_MESSAGE,
        "INSPECT_LETTER": LETTER_MESSAGE,
        "INSPECT_CHEST": CHEST_MESSAGE,
        "INSPECT_SCREEN": SCREEN_MESSAGE,
        # INSPECT_HALL_LETTER: 문구를 생략한 조사
    }
    for inspection in runtime["inspections"]:
        if inspection["inspect_id"] in messages:
            inspection["message"] = messages[inspection["inspect_id"]]
    runtime["inspections"].append(
        {
            "inspect_id": "INSPECT_MEMO",
            "requires_clue_ids": ["CLUE_LETTER"],
            "on_inspect": effect(grant_clue_ids=["CLUE_MEMO"]),
            "message": GATED_MESSAGE,
        }
    )
    return runtime


def message_client() -> dict:
    client = deepcopy(CLIENT_DATA)
    client["zones"][0]["objects"].append(
        {
            "object_id": "OBJ_MEMO",
            "object_name": "OBJ_MEMO",
            "object_type": "prop",
            "visible": True,
            "enabled": True,
            "interaction": {"type": "inspect", "target_id": "INSPECT_MEMO"},
        }
    )
    return client


@pytest.fixture
def message_case(case_directory: Path) -> Path:  # noqa: F811
    write_case(case_directory, client=message_client(), runtime=message_runtime())
    return case_directory


# ── 스키마 ──


def test_message_is_optional_and_null_is_allowed() -> None:
    base = {"inspect_id": "INSPECT_X", "on_inspect": effect()}

    assert InspectionDefinition.model_validate(base).message is None
    assert (
        InspectionDefinition.model_validate({**base, "message": None}).message is None
    )
    assert (
        InspectionDefinition.model_validate({**base, "message": "문구"}).message
        == "문구"
    )


@pytest.mark.parametrize("message", ["", "   ", "\n\t", 123, ["문구"], {"t": "문구"}])
def test_invalid_message_is_rejected(message: object) -> None:
    with pytest.raises(ValidationError):
        InspectionDefinition.model_validate(
            {"inspect_id": "INSPECT_X", "on_inspect": effect(), "message": message}
        )


def test_inspection_still_forbids_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        InspectionDefinition.model_validate(
            {
                "inspect_id": "INSPECT_X",
                "on_inspect": effect(),
                "message": "문구",
                "messages": ["문구"],
            }
        )


def test_message_is_not_a_clue_reference() -> None:
    # 문구에 단서 ID처럼 보이는 글자가 있어도 단서 참조 검사 대상이 아니다.
    runtime = PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "0.1",
            "case_id": "case_x",
            "puzzles": [],
            "clue_combinations": [],
            "inspections": [
                {
                    "inspect_id": "INSPECT_X",
                    "on_inspect": effect(),
                    "message": "CLUE_UNDEFINED",
                }
            ],
            "clues": [],
        }
    )
    assert runtime.inspections[0].message == "CLUE_UNDEFINED"


# ── 성공 응답 ──


@pytest.mark.anyio
async def test_inspection_with_message_returns_effect_and_message(
    message_case: Path,
) -> None:
    result, db = await inspect(make_play_session(), "OBJ_BEDDING")

    assert result.result.result_type == "inspected"
    assert changes(result) == [revealed("OBJ_LETTER")]
    assert result.result.message == BEDDING_MESSAGE
    assert db.added[0].response_json["message"] == BEDDING_MESSAGE


@pytest.mark.anyio
async def test_inspection_without_message_keeps_null(message_case: Path) -> None:
    play_session = make_play_session(make_state(current_zone_id="ZONE_HALL"))

    result, _ = await inspect(play_session, "OBJ_LETTER", zone_id="ZONE_HALL")

    assert result.result.result_type == "inspected"
    assert changes(result) == [{"type": "clue_acquired", "clue_id": "CLUE_HALL"}]
    assert result.result.message is None


@pytest.mark.anyio
async def test_explicit_null_message_keeps_null(case_directory: Path) -> None:  # noqa: F811
    runtime = deepcopy(RUNTIME_DATA)
    for inspection in runtime["inspections"]:
        inspection["message"] = None
    write_case(case_directory, runtime=runtime)

    result, _ = await inspect(make_play_session(), "OBJ_BEDDING")

    assert changes(result) == [revealed("OBJ_LETTER")]
    assert result.result.message is None


@pytest.mark.anyio
async def test_effect_free_inspection_returns_message(message_case: Path) -> None:
    play_session = make_play_session()

    result, _ = await inspect(play_session, "OBJ_SCREEN")

    assert result.result.result_type == "inspected"
    assert changes(result) == []
    assert result.result.message == SCREEN_MESSAGE
    assert play_session.state_json["completed_inspect_ids"] == ["INSPECT_SCREEN"]


@pytest.mark.anyio
async def test_message_comes_with_full_effect(message_case: Path) -> None:
    play_session = make_play_session(
        make_state(object_states={"ZONE_SARANG": {"OBJ_LETTER": {"visible": True}}})
    )

    result, _ = await inspect(play_session, "OBJ_LETTER")

    assert changes(result) == [
        {"type": "clue_acquired", "clue_id": "CLUE_LETTER"},
        {"type": "flag_updated", "flag": "letter_read", "value": True},
        {"type": "object_hidden", "zone_id": "ZONE_SARANG", "object_id": "OBJ_LETTER"},
    ]
    assert result.result.message == LETTER_MESSAGE


# ── 실패 응답: 문구 · 상태 · 이벤트 모두 그대로 ──


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("state", "object_id", "zone_id", "error"),
    [
        (make_state(current_zone_id="ZONE_HALL"), "OBJ_BEDDING", "ZONE_SARANG", ZoneNotCurrentError),
        (make_state(), "OBJ_MEMO", "ZONE_SARANG", RequiredCluesMissingError),
        (make_state(), "OBJ_LETTER", "ZONE_SARANG", ObjectNotVisibleError),
        (make_state(), "OBJ_CHEST", "ZONE_SARANG", ObjectNotEnabledError),
    ],
)  # fmt: skip
async def test_failed_inspection_changes_nothing(
    message_case: Path,
    state: dict,
    object_id: str,
    zone_id: str,
    error: type[Exception],
) -> None:
    play_session = make_play_session(state)
    before = deepcopy(play_session.state_json)
    db = FakeAsyncSession()

    with pytest.raises(error):
        await inspect(play_session, object_id, zone_id=zone_id, db=db)

    assert play_session.state_json == before
    assert db.added == []
    assert db.commit_count == 0


@pytest.mark.parametrize(
    ("state", "object_id", "zone_id", "body"),
    [
        (make_state(current_zone_id="ZONE_HALL"), "OBJ_BEDDING", "ZONE_SARANG", {"detail": "Zone is not current."}),
        (make_state(), "OBJ_MEMO", "ZONE_SARANG", {"detail": MISSING, "missing_clue_count": 1}),
        (make_state(), "OBJ_LETTER", "ZONE_SARANG", {"detail": "Object is not visible."}),
        (make_state(), "OBJ_CHEST", "ZONE_SARANG", {"detail": "Object is not enabled."}),
    ],
)  # fmt: skip
def test_http_errors_do_not_expose_message(
    client: TestClient,
    db_session: FakeAsyncSession,
    message_case: Path,
    state: dict,
    object_id: str,
    zone_id: str,
    body: dict,
) -> None:
    db_session.get_result = make_play_session(state)

    response = client.post(
        INTERACTIONS_URL, json=request_body(object_id, zone_id=zone_id)
    )

    assert response.status_code == 409
    assert response.json() == body  # message 키도, 문구 본문도 없다
    for text in (BEDDING_MESSAGE, LETTER_MESSAGE, CHEST_MESSAGE, GATED_MESSAGE):
        assert text not in response.text
    assert db_session.added == []
    assert db_session.commit_count == 0


@pytest.mark.anyio
async def test_required_clue_inspection_returns_message_once_satisfied(
    message_case: Path,
) -> None:
    play_session = make_play_session(make_state(acquired_clue_ids=["CLUE_LETTER"]))

    result, _ = await inspect(play_session, "OBJ_MEMO")

    assert changes(result) == [{"type": "clue_acquired", "clue_id": "CLUE_MEMO"}]
    assert result.result.message == GATED_MESSAGE


# ── 재전송 · 재조사 ──


@pytest.mark.anyio
async def test_same_event_replay_returns_identical_message(message_case: Path) -> None:
    play_session = make_play_session()
    event_id = "55555555-5555-4555-8555-555555555555"
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
    assert replayed.result.message == BEDDING_MESSAGE
    assert play_session.state_json == state_after_first
    assert replay_db.added == []
    assert replay_db.commit_count == 0


@pytest.mark.anyio
async def test_replay_keeps_original_message_after_content_change(
    message_case: Path,
) -> None:
    # 저장된 응답을 그대로 돌려준다. 이후 콘텐츠 문구가 바뀌어도 재전송 응답은 원래 문구다.
    play_session = make_play_session()
    event_id = "66666666-6666-4666-8666-666666666666"
    first, first_db = await inspect(
        play_session, "OBJ_SCREEN", client_event_id=event_id
    )
    changed = message_runtime()
    for inspection in changed["inspections"]:
        if inspection["inspect_id"] == "INSPECT_SCREEN":
            inspection["message"] = "바뀐 문구"
    write_case(message_case, client=message_client(), runtime=changed)
    replay_db = FakeAsyncSession()
    replay_db.scalar_result = first_db.added[0]

    replayed, _ = await inspect(
        play_session, "OBJ_SCREEN", client_event_id=event_id, db=replay_db
    )

    assert replayed.result == first.result
    assert replayed.result.message == SCREEN_MESSAGE


@pytest.mark.anyio
async def test_completed_inspection_retry_has_no_message(message_case: Path) -> None:
    play_session = make_play_session()
    await inspect(play_session, "OBJ_SCREEN")
    state_after_first = deepcopy(play_session.state_json)

    again, db = await inspect(play_session, "OBJ_SCREEN")

    assert again.result.result_type == "already_inspected"
    assert changes(again) == []
    assert again.result.message is None
    assert play_session.state_json == state_after_first
    # 기존 규칙대로 새 이벤트는 남긴다(변화 없음 · 문구 없음).
    assert len(db.added) == 1
    assert db.added[0].response_json["message"] is None
    assert db.added[0].response_json["state_changes"] == []


@pytest.mark.anyio
async def test_completed_inspection_retry_on_hidden_object_has_no_message(
    message_case: Path,
) -> None:
    # 조사 뒤 숨겨진 Object를 다시 조사해도 오류 없이 ok · 변화 없음 · 문구 없음.
    play_session = make_play_session(
        make_state(object_states={"ZONE_SARANG": {"OBJ_LETTER": {"visible": True}}})
    )
    await inspect(play_session, "OBJ_LETTER")

    again, _ = await inspect(play_session, "OBJ_LETTER")

    assert again.result.result_type == "already_inspected"
    assert changes(again) == []
    assert again.result.message is None


def test_http_message_flow_keeps_top_level_shape(
    client: TestClient,
    db_session: FakeAsyncSession,
    message_case: Path,
) -> None:
    db_session.get_result = make_play_session()

    first = client.post(INTERACTIONS_URL, json=request_body("OBJ_SCREEN"))
    again = client.post(INTERACTIONS_URL, json=request_body("OBJ_SCREEN"))

    keys = {
        "interaction_id",
        "result_type",
        "message",
        "attempt_count",
        "state_changes",
        "ui_actions",
    }
    assert first.status_code == 200
    assert set(first.json()) == keys
    assert first.json()["result_type"] == "ok"
    assert first.json()["message"] == SCREEN_MESSAGE
    assert first.json()["state_changes"] == []
    assert again.status_code == 200
    assert set(again.json()) == keys
    assert again.json()["result_type"] == "ok"
    assert again.json()["message"] is None
    assert again.json()["state_changes"] == []


def test_http_puzzle_answer_ignores_inspection_message(
    client: TestClient,
    db_session: FakeAsyncSession,
    message_case: Path,
) -> None:
    # 조사 문구를 정답으로 내도 정답 판정에 쓰이지 않는다.
    db_session.get_result = make_play_session()

    response = client.post(
        INTERACTIONS_URL,
        json=request_body(
            "OBJ_LOCK", action="input", payload={"answer": SCREEN_MESSAGE}
        ),
    )

    assert response.status_code == 200
    assert response.json()["result_type"] == "incorrect"
    assert response.json()["message"] is None
