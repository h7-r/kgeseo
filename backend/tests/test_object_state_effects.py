import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.schemas.interaction import (
    CombineCluesInteraction,
    CombineCluesPayload,
    SubmitAnswerInteraction,
    SubmitAnswerPayload,
)
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, RuntimeEffect
from app.services import case_content, puzzle_runtime
from app.services.case_content import load_case_client_content
from app.services.case_content_validation import (
    CaseContentLinkValidationError,
    validate_case_content_links,
)
from app.services.interaction import process_interaction
from app.services.object_state import resolve_effective_object_state
from app.services.puzzle_runtime import load_case_runtime
from tests.conftest import FakeAsyncSession

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
                {
                    "object_id": "OBJ_LOCK",
                    "object_name": "Lock",
                    "object_type": "lock",
                    "visible": True,
                    "enabled": True,
                    "interaction": {"type": "input", "target_id": "PUZZLE_DOOR"},
                },
                {
                    "object_id": "OBJ_DOOR",
                    "object_name": "Door",
                    "object_type": "door",
                    "visible": True,
                    "enabled": False,
                },
                {
                    "object_id": "OBJ_LETTER",
                    "object_name": "Letter",
                    "object_type": "clue",
                    "visible": False,
                    "enabled": True,
                },
                {
                    "object_id": "OBJ_PORTRAIT",
                    "object_name": "Portrait",
                    "object_type": "decoration",
                    "visible": True,
                    "enabled": True,
                },
                {
                    "object_id": "OBJ_BOX",
                    "object_name": "Box",
                    "object_type": "container",
                    "visible": False,
                    "enabled": False,
                },
            ],
            "navigation": [
                {"door_object_id": "OBJ_DOOR", "target_zone_id": "ZONE_HALL"},
            ],
        },
        {
            "zone_id": "ZONE_HALL",
            "zone_name": "Hall",
            "zone_type": "room",
            "description": "Hall",
            "objects": [
                {
                    "object_id": "OBJ_DOOR",
                    "object_name": "Door",
                    "object_type": "door",
                    "visible": True,
                    "enabled": False,
                },
            ],
            "navigation": [],
        },
    ],
}


def object_effect(object_id: str, zone_id: str = "ZONE_SARANG", **values: bool) -> dict:
    return {"zone_id": zone_id, "object_id": object_id, **values}


RUNTIME_DATA = {
    "schema_version": "0.1",
    "case_id": "case_001",
    "puzzles": [
        {
            "puzzle_id": "PUZZLE_DOOR",
            "accepted_answers": ["VALVE"],
            "on_correct": {
                "grant_clue_ids": [],
                "set_flags": {},
                "set_object_states": [object_effect("OBJ_DOOR", enabled=True)],
            },
        },
        {
            "puzzle_id": "PUZZLE_REVEAL",
            "accepted_answers": ["LETTER"],
            "on_correct": {
                "grant_clue_ids": [],
                "set_flags": {},
                "set_object_states": [object_effect("OBJ_LETTER", visible=True)],
            },
        },
        {
            "puzzle_id": "PUZZLE_HIDE",
            "accepted_answers": ["HIDE"],
            "on_correct": {
                "grant_clue_ids": [],
                "set_flags": {},
                "set_object_states": [object_effect("OBJ_PORTRAIT", visible=False)],
            },
        },
        {
            "puzzle_id": "PUZZLE_MULTI",
            "accepted_answers": ["MULTI"],
            "on_correct": {
                "grant_clue_ids": ["CLUE_01"],
                "set_flags": {"study_open": True},
                "set_object_states": [
                    object_effect("OBJ_LETTER", visible=True),
                    object_effect("OBJ_PORTRAIT", visible=False),
                    object_effect("OBJ_BOX", visible=True, enabled=True),
                    object_effect("OBJ_DOOR", enabled=True),
                ],
            },
        },
        {
            "puzzle_id": "PUZZLE_NOOP",
            "accepted_answers": ["NOOP"],
            "on_correct": {
                "grant_clue_ids": [],
                "set_flags": {},
                "set_object_states": [
                    object_effect("OBJ_PORTRAIT", visible=True),
                    object_effect("OBJ_LETTER", enabled=True),
                ],
            },
        },
        {
            "puzzle_id": "PUZZLE_PLAIN",
            "accepted_answers": ["PLAIN"],
            "on_correct": {"grant_clue_ids": ["CLUE_02"], "set_flags": {}},
        },
    ],
    "clue_combinations": [
        {
            "combination_id": "COMBO_LETTER",
            "clue_ids": ["CLUE_01", "CLUE_02"],
            "on_success": {
                "grant_clue_ids": [],
                "set_flags": {},
                "set_object_states": [object_effect("OBJ_LETTER", visible=True)],
            },
        },
    ],
}


def make_content() -> CaseClientContent:
    return CaseClientContent.model_validate(deepcopy(CLIENT_DATA))


def make_runtime(data: dict | None = None) -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition.model_validate(deepcopy(data or RUNTIME_DATA))


def make_state(**overrides: object) -> dict:
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
    play_session_id: str = "play-session-id",
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


def submit(puzzle_id: str, answer: str, client_event_id: str = "event-1"):
    return SubmitAnswerInteraction(
        client_event_id=client_event_id,
        interaction_type="submit_answer",
        target_id=puzzle_id,
        payload=SubmitAnswerPayload(answer=answer),
    )


def combine(client_event_id: str = "event-1") -> CombineCluesInteraction:
    return CombineCluesInteraction(
        client_event_id=client_event_id,
        interaction_type="combine_clues",
        payload=CombineCluesPayload(clue_ids=["CLUE_01", "CLUE_02"]),
    )


async def run(
    play_session: PlaySession,
    interaction,
    *,
    db: FakeAsyncSession | None = None,
    runtime: PuzzleRuntimeDefinition | None = None,
    content: CaseClientContent | None = None,
):
    db = db or FakeAsyncSession()
    db.get_result = play_session
    content_loads: list[str] = []

    def load_content(case_id: str) -> CaseClientContent:
        content_loads.append(case_id)
        return content or make_content()

    result = await process_interaction(
        db,
        play_session.id,
        interaction,
        runtime_loader=lambda case_id: runtime or make_runtime(),
        client_content_loader=load_content,
    )
    return result, db, content_loads


def changes(result) -> list[dict]:
    return [change.model_dump() for change in result.result.state_changes]


# ── 상태 변경 적용 ──


@pytest.mark.anyio
async def test_correct_answer_unlocks_door() -> None:
    play_session = make_play_session()

    result, db, content_loads = await run(play_session, submit("PUZZLE_DOOR", "valve"))

    assert result.result.result_type == "correct"
    assert changes(result) == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_DOOR"},
        {"type": "object_unlocked", "zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR"},
    ]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_DOOR": {"enabled": True}},
    }
    assert play_session.state_json == result.result.state.model_dump()
    assert content_loads == ["case_001"]
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_correct_answer_reveals_hidden_object() -> None:
    play_session = make_play_session()

    result, _, _ = await run(play_session, submit("PUZZLE_REVEAL", "LETTER"))

    assert changes(result)[1:] == [
        {
            "type": "object_revealed",
            "zone_id": "ZONE_SARANG",
            "object_id": "OBJ_LETTER",
        },
    ]
    effective = resolve_effective_object_state(
        make_content(),
        play_session.state_json["object_states"],
        "ZONE_SARANG",
        "OBJ_LETTER",
    )
    assert (effective.visible, effective.enabled) == (True, True)


@pytest.mark.anyio
async def test_correct_answer_hides_visible_object() -> None:
    play_session = make_play_session()

    result, _, _ = await run(play_session, submit("PUZZLE_HIDE", "HIDE"))

    assert changes(result)[1:] == [
        {
            "type": "object_hidden",
            "zone_id": "ZONE_SARANG",
            "object_id": "OBJ_PORTRAIT",
        },
    ]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_PORTRAIT": {"visible": False}},
    }


@pytest.mark.anyio
async def test_one_answer_changes_many_objects_with_existing_effects() -> None:
    play_session = make_play_session()

    result, db, _ = await run(play_session, submit("PUZZLE_MULTI", "MULTI"))

    assert changes(result) == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_MULTI"},
        {"type": "clue_acquired", "clue_id": "CLUE_01"},
        {"type": "flag_updated", "flag": "study_open", "value": True},
        {
            "type": "object_revealed",
            "zone_id": "ZONE_SARANG",
            "object_id": "OBJ_LETTER",
        },
        {
            "type": "object_hidden",
            "zone_id": "ZONE_SARANG",
            "object_id": "OBJ_PORTRAIT",
        },
        {"type": "object_revealed", "zone_id": "ZONE_SARANG", "object_id": "OBJ_BOX"},
        {"type": "object_unlocked", "zone_id": "ZONE_SARANG", "object_id": "OBJ_BOX"},
        {"type": "object_unlocked", "zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR"},
    ]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {
            "OBJ_LETTER": {"visible": True},
            "OBJ_PORTRAIT": {"visible": False},
            "OBJ_BOX": {"visible": True, "enabled": True},
            "OBJ_DOOR": {"enabled": True},
        },
    }
    assert play_session.state_json["acquired_clue_ids"] == ["CLUE_01"]
    assert play_session.state_json["flags"] == {"study_open": True}
    assert db.commit_count == 1
    assert len(db.added) == 1


@pytest.mark.anyio
async def test_effect_matching_current_state_records_nothing() -> None:
    play_session = make_play_session()

    result, _, _ = await run(play_session, submit("PUZZLE_NOOP", "NOOP"))

    assert changes(result) == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_NOOP"},
    ]
    assert play_session.state_json["object_states"] == {}


@pytest.mark.anyio
async def test_effect_already_applied_by_session_override_records_nothing() -> None:
    state = make_state(object_states={"ZONE_SARANG": {"OBJ_LETTER": {"visible": True}}})
    play_session = make_play_session(state)

    result, _, _ = await run(play_session, submit("PUZZLE_REVEAL", "LETTER"))

    assert changes(result) == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_REVEAL"},
    ]
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_LETTER": {"visible": True}},
    }


@pytest.mark.anyio
async def test_repeated_combination_does_not_repeat_object_change() -> None:
    state = make_state(acquired_clue_ids=["CLUE_01", "CLUE_02"])
    play_session = make_play_session(state)

    first, _, _ = await run(play_session, combine("event-1"))
    second, second_db, _ = await run(play_session, combine("event-2"))

    assert changes(first) == [
        {
            "type": "object_revealed",
            "zone_id": "ZONE_SARANG",
            "object_id": "OBJ_LETTER",
        },
    ]
    assert second.result.result_type == "combined"
    assert changes(second) == []
    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_LETTER": {"visible": True}},
    }
    assert second_db.commit_count == 1


@pytest.mark.anyio
async def test_same_client_event_id_replays_stored_response() -> None:
    play_session = make_play_session()
    first, first_db, _ = await run(play_session, submit("PUZZLE_MULTI", "MULTI"))
    stored_event = first_db.added[0]
    assert isinstance(stored_event, InteractionEvent)
    state_after_first = deepcopy(play_session.state_json)

    replay_db = FakeAsyncSession()
    replay_db.scalar_result = stored_event
    replayed, _, content_loads = await run(
        play_session, submit("PUZZLE_MULTI", "MULTI"), db=replay_db
    )

    assert replayed.interaction_id == first.interaction_id
    assert replayed.result == first.result
    assert play_session.state_json == state_after_first
    assert replay_db.added == []
    assert replay_db.commit_count == 0
    assert content_loads == []


@pytest.mark.anyio
async def test_completed_puzzle_does_not_reapply_object_effect() -> None:
    play_session = make_play_session()
    await run(play_session, submit("PUZZLE_DOOR", "VALVE", "event-1"))
    # 다른 세션 변경으로 문 상태가 바뀌었다고 가정해도 완료된 퍼즐은 다시 적용하지 않는다.
    play_session.state_json["object_states"] = {}
    state_before = deepcopy(play_session.state_json)

    result, _, content_loads = await run(
        play_session, submit("PUZZLE_DOOR", "VALVE", "event-2")
    )

    assert result.result.result_type == "already_completed"
    assert changes(result) == []
    assert play_session.state_json == state_before
    assert content_loads == []


@pytest.mark.anyio
async def test_incorrect_answer_changes_no_object_state() -> None:
    play_session = make_play_session()

    result, _, content_loads = await run(play_session, submit("PUZZLE_DOOR", "WRONG"))

    assert result.result.result_type == "incorrect"
    assert changes(result) == []
    assert play_session.state_json["object_states"] == {}
    assert play_session.state_json["attempt_counts"] == {"PUZZLE_DOOR": 1}
    assert content_loads == []


@pytest.mark.anyio
async def test_puzzle_without_object_effect_does_not_load_client_content() -> None:
    play_session = make_play_session()

    result, _, content_loads = await run(play_session, submit("PUZZLE_PLAIN", "PLAIN"))

    assert result.result.result_type == "correct"
    assert content_loads == []
    assert play_session.state_json["object_states"] == {}


@pytest.mark.anyio
async def test_legacy_session_without_object_states_saves_change() -> None:
    state = make_state()
    del state["object_states"]
    play_session = make_play_session(state)

    result, _, _ = await run(play_session, submit("PUZZLE_DOOR", "VALVE"))

    assert play_session.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_DOOR": {"enabled": True}},
    }
    assert result.result.state.object_states == play_session.state_json["object_states"]


@pytest.mark.anyio
async def test_legacy_session_noop_effect_does_not_add_object_states_key() -> None:
    state = make_state()
    del state["object_states"]
    play_session = make_play_session(state)

    await run(play_session, submit("PUZZLE_NOOP", "NOOP"))

    assert "object_states" not in play_session.state_json


@pytest.mark.anyio
async def test_play_sessions_keep_object_states_separate() -> None:
    first = make_play_session(play_session_id="session-1")
    second = make_play_session(play_session_id="session-2")

    await run(first, submit("PUZZLE_DOOR", "VALVE"))
    await run(second, submit("PUZZLE_HIDE", "HIDE"))

    assert first.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_DOOR": {"enabled": True}},
    }
    assert second.state_json["object_states"] == {
        "ZONE_SARANG": {"OBJ_PORTRAIT": {"visible": False}},
    }


@pytest.mark.anyio
async def test_same_object_id_in_other_zone_is_not_affected() -> None:
    play_session = make_play_session()

    await run(play_session, submit("PUZZLE_DOOR", "VALVE"))

    content = make_content()
    states = play_session.state_json["object_states"]
    assert "ZONE_HALL" not in states
    sarang = resolve_effective_object_state(content, states, "ZONE_SARANG", "OBJ_DOOR")
    hall = resolve_effective_object_state(content, states, "ZONE_HALL", "OBJ_DOOR")
    assert sarang.enabled is True
    assert hall.enabled is False


@pytest.mark.anyio
async def test_hall_door_effect_only_changes_hall() -> None:
    data = deepcopy(RUNTIME_DATA)
    data["puzzles"][0]["on_correct"]["set_object_states"] = [
        object_effect("OBJ_DOOR", zone_id="ZONE_HALL", enabled=True),
    ]
    play_session = make_play_session()

    result, _, _ = await run(
        play_session, submit("PUZZLE_DOOR", "VALVE"), runtime=make_runtime(data)
    )

    assert changes(result)[1:] == [
        {"type": "object_unlocked", "zone_id": "ZONE_HALL", "object_id": "OBJ_DOOR"},
    ]
    assert play_session.state_json["object_states"] == {
        "ZONE_HALL": {"OBJ_DOOR": {"enabled": True}},
    }


@pytest.mark.anyio
async def test_invalid_reference_at_runtime_rolls_back_without_change() -> None:
    data = deepcopy(RUNTIME_DATA)
    data["puzzles"][0]["on_correct"]["set_object_states"] = [
        object_effect("OBJ_LETTER", zone_id="ZONE_HALL", visible=True),
    ]
    play_session = make_play_session()
    original = deepcopy(play_session.state_json)
    db = FakeAsyncSession()

    with pytest.raises(CaseContentLinkValidationError):
        await run(
            play_session,
            submit("PUZZLE_DOOR", "VALVE"),
            db=db,
            runtime=make_runtime(data),
        )

    assert play_session.state_json == original
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


# ── 효과 스키마 ──


@pytest.mark.parametrize(
    "entry",
    [
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "enabled": "true"},
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "enabled": 1},
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "visible": 0},
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "visible": None},
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR"},
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "hidden": True},
        {"zone_id": "ZONE_SARANG", "visible": True},
        {"object_id": "OBJ_DOOR", "visible": True},
        {"zone_id": "", "object_id": "OBJ_DOOR", "visible": True},
        {"zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR", "enabled": False},
    ],
)
def test_invalid_object_state_effect_is_rejected(entry: dict) -> None:
    with pytest.raises(ValidationError):
        RuntimeEffect.model_validate(
            {"grant_clue_ids": [], "set_flags": {}, "set_object_states": [entry]}
        )


@pytest.mark.parametrize(
    "entries",
    [
        [
            object_effect("OBJ_DOOR", enabled=True),
            object_effect("OBJ_DOOR", enabled=True),
        ],
        [
            object_effect("OBJ_LETTER", visible=True),
            object_effect("OBJ_LETTER", visible=False),
        ],
    ],
)
def test_duplicate_or_conflicting_targets_are_rejected(entries: list[dict]) -> None:
    with pytest.raises(ValidationError, match="Duplicate set_object_states"):
        RuntimeEffect.model_validate(
            {"grant_clue_ids": [], "set_flags": {}, "set_object_states": entries}
        )


def test_same_object_id_in_different_zones_is_allowed_in_one_effect() -> None:
    effect = RuntimeEffect.model_validate(
        {
            "grant_clue_ids": [],
            "set_flags": {},
            "set_object_states": [
                object_effect("OBJ_DOOR", enabled=True),
                object_effect("OBJ_DOOR", zone_id="ZONE_HALL", enabled=True),
            ],
        }
    )

    assert len(effect.set_object_states) == 2


def test_existing_effect_defaults_to_no_object_states() -> None:
    effect = RuntimeEffect.model_validate({"grant_clue_ids": [], "set_flags": {}})

    assert effect.set_object_states == []


# ── 콘텐츠 참조 검증 ──


def test_valid_object_state_references_pass_link_validation() -> None:
    validate_case_content_links(make_content(), make_runtime())


@pytest.mark.parametrize(
    ("zone_id", "object_id", "match"),
    [
        ("ZONE_MISSING", "OBJ_DOOR", "Puzzle 'PUZZLE_DOOR'.*OBJ_DOOR.*ZONE_MISSING"),
        ("ZONE_SARANG", "OBJ_MISSING", "Puzzle 'PUZZLE_DOOR'.*OBJ_MISSING"),
        ("ZONE_HALL", "OBJ_LETTER", "Puzzle 'PUZZLE_DOOR'.*OBJ_LETTER.*ZONE_HALL"),
    ],
)
def test_missing_puzzle_effect_reference_fails_link_validation(
    zone_id: str,
    object_id: str,
    match: str,
) -> None:
    data = deepcopy(RUNTIME_DATA)
    data["puzzles"][0]["on_correct"]["set_object_states"] = [
        object_effect(object_id, zone_id=zone_id, visible=True),
    ]

    with pytest.raises(CaseContentLinkValidationError, match=match):
        validate_case_content_links(make_content(), make_runtime(data))


def test_missing_combination_effect_reference_fails_link_validation() -> None:
    data = deepcopy(RUNTIME_DATA)
    data["clue_combinations"][0]["on_success"]["set_object_states"] = [
        object_effect("OBJ_MISSING", visible=True),
    ]

    with pytest.raises(CaseContentLinkValidationError, match="COMBO_LETTER"):
        validate_case_content_links(make_content(), make_runtime(data))


def test_case_001_loads_unchanged_without_object_effects() -> None:
    client_content = load_case_client_content("case_001")
    runtime = load_case_runtime("case_001")

    validate_case_content_links(client_content, runtime)

    assert all(puzzle.on_correct.set_object_states == [] for puzzle in runtime.puzzles)


# ── HTTP: 정답 처리 후 PlaySession 조회 ──


@pytest.fixture
def object_case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    (tmp_path / "case_001.client.json").write_text(
        json.dumps(CLIENT_DATA), encoding="utf-8"
    )
    (tmp_path / "case_001.server.json").write_text(
        json.dumps(RUNTIME_DATA), encoding="utf-8"
    )
    return tmp_path


PLAY_SESSION_ID = "22222222-2222-4222-8222-222222222222"


def test_http_correct_answer_unlocks_door_and_session_read_keeps_it(
    client: TestClient,
    db_session: FakeAsyncSession,
    object_case_directory: Path,
) -> None:
    play_session = make_play_session(play_session_id=PLAY_SESSION_ID)
    db_session.get_result = play_session

    response = client.post(
        f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions",
        json={
            "client_event_id": "11111111-1111-4111-8111-111111111111",
            "client_timestamp": "2026-10-23T09:10:00+09:00",
            "zone_id": "ZONE_SARANG",
            "action": "input",
            "target_type": "object",
            "target_id": "OBJ_LOCK",
            "payload": {"answer": "valve"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["result_type"] == "correct"
    assert body["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PUZZLE_DOOR"},
        {"type": "object_unlocked", "zone_id": "ZONE_SARANG", "object_id": "OBJ_DOOR"},
    ]

    read = client.get(f"/api/v1/play-sessions/{PLAY_SESSION_ID}")

    assert read.status_code == 200
    assert read.json()["data"]["state"]["object_states"] == {
        "ZONE_SARANG": {"OBJ_DOOR": {"enabled": True}},
    }


def test_http_invalid_effect_reference_returns_500_without_change(
    client: TestClient,
    db_session: FakeAsyncSession,
    object_case_directory: Path,
) -> None:
    data = deepcopy(RUNTIME_DATA)
    data["puzzles"][0]["on_correct"]["set_object_states"] = [
        object_effect("OBJ_MISSING", visible=True),
    ]
    (object_case_directory / "case_001.server.json").write_text(
        json.dumps(data), encoding="utf-8"
    )
    play_session = make_play_session(play_session_id=PLAY_SESSION_ID)
    original = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(
        f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions",
        json={
            "client_event_id": "11111111-1111-4111-8111-111111111111",
            "client_timestamp": "2026-10-23T09:10:00+09:00",
            "zone_id": "ZONE_SARANG",
            "action": "input",
            "target_type": "object",
            "target_id": "OBJ_LOCK",
            "payload": {"answer": "VALVE"},
        },
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert play_session.state_json == original
    assert db_session.commit_count == 0
