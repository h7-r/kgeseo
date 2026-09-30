import asyncio
from copy import deepcopy
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.interaction import (
    CombineCluesInteraction,
    CombineCluesPayload,
    InteractionRequest,
    SubmitAnswerInteraction,
    SubmitAnswerPayload,
)
from app.schemas.puzzle_runtime import (
    ClueCombinationDefinition,
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.interaction import (
    ClueNotAcquiredError,
    IdempotencyConflictError,
    PuzzleNotFoundError,
    process_interaction,
)
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import CaseRuntimeNotFoundError
from tests.conftest import FakeAsyncSession


class RaceAsyncSession(FakeAsyncSession):
    async def scalar(self, statement):
        self.scalar_calls.append(statement)
        self.operation_log.append("scalar")
        if len(self.scalar_calls) == 1:
            return None
        assert len(self.scalar_calls) == 2
        assert self.rollback_count == 1
        return self.scalar_result


def make_play_session(*, state: dict | None = None) -> PlaySession:
    now = datetime(2026, 9, 18, 1, 2, 3, 456789)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anonymous-session-id",
        case_id="case_001",
        state_json=(
            state
            if state is not None
            else {
                "current_zone_id": "ZONE_001",
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


def make_runtime(
    *,
    accepted_answers: list[str] | None = None,
    puzzle_complete_ids: list[str] | None = None,
    combination_complete_ids: list[str] | None = None,
) -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id="case_001",
        puzzles=[
            PuzzleDefinition(
                puzzle_id="puzzle_01",
                accepted_answers=accepted_answers or ["아랑사"],
                on_correct=RuntimeEffect(
                    grant_clue_ids=["clue_03"],
                    complete_puzzle_ids=puzzle_complete_ids or [],
                    set_flags={"archive_unlocked": True},
                ),
            ),
        ],
        clue_combinations=[
            ClueCombinationDefinition(
                combination_id="combination_01",
                clue_ids=["clue_03", "clue_07"],
                on_success=RuntimeEffect(
                    grant_clue_ids=["clue_10"],
                    complete_puzzle_ids=combination_complete_ids or [],
                    set_flags={"truth_fragment_01": True},
                ),
            ),
        ],
    )


def runtime_loader(runtime: PuzzleRuntimeDefinition):
    def load(case_id: str) -> PuzzleRuntimeDefinition:
        assert case_id == runtime.case_id
        return runtime

    return load


def submit_answer(
    *,
    answer: str = "아랑사",
    client_event_id: str = "client-event-id",
    target_id: str = "puzzle_01",
) -> SubmitAnswerInteraction:
    return SubmitAnswerInteraction(
        client_event_id=client_event_id,
        interaction_type="submit_answer",
        target_id=target_id,
        payload=SubmitAnswerPayload(answer=answer),
    )


def combine_clues(
    clue_ids: list[str],
    *,
    client_event_id: str = "client-event-id",
) -> CombineCluesInteraction:
    return CombineCluesInteraction(
        client_event_id=client_event_id,
        interaction_type="combine_clues",
        payload=CombineCluesPayload(clue_ids=clue_ids),
    )


def make_winner_event(
    play_session_id: str,
    *,
    answer: str = "아랑사",
    target_id: str = "puzzle_01",
    include_state_changes: bool = True,
) -> InteractionEvent:
    response_json = {
        "success": True,
        "result_type": "correct",
        "state": {
            "completed_puzzle_ids": ["puzzle_01"],
            "acquired_clue_ids": ["clue_03"],
            "hint_levels": {},
            "flags": {"archive_unlocked": True},
        },
    }
    if include_state_changes:
        response_json["state_changes"] = [
            {"type": "puzzle_completed", "target_id": "puzzle_01", "value": True},
        ]

    return InteractionEvent(
        id="winner-interaction-id",
        play_session_id=play_session_id,
        client_event_id="client-event-id",
        interaction_type="submit_answer",
        target_id=target_id,
        payload_json={"answer": answer},
        result_type="correct",
        response_json=response_json,
        created_at=datetime(2026, 9, 18, 2, 3, 4),
    )


@pytest.mark.anyio
async def test_interaction_raises_when_play_session_is_missing() -> None:
    db = FakeAsyncSession()

    with pytest.raises(PlaySessionNotFoundError):
        await process_interaction(
            db,
            "missing-play-session",
            submit_answer(),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert db.scalar_calls == []
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1
    assert db.get_options == [
        {"with_for_update": True, "populate_existing": True},
    ]
    assert db.operation_log == ["get", "rollback"]


@pytest.mark.anyio
@pytest.mark.parametrize("answer", ["아랑사", " 아랑 사 "])
async def test_submit_answer_correct(answer: str) -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(answer=answer),
        runtime_loader=runtime_loader(make_runtime()),
    )

    assert result.result.result_type == "correct"
    assert result.result.state.completed_puzzle_ids == ["puzzle_01"]
    assert result.result.state.acquired_clue_ids == ["clue_03"]
    assert result.result.state.flags == {
        "existing_flag": True,
        "archive_unlocked": True,
    }
    assert result.result.state.hint_levels == {"puzzle_01": 0}
    assert result.result.state.current_zone_id == "ZONE_001"
    assert result.result.attempt_count == 1
    assert result.result.state.attempt_counts == {"puzzle_01": 1}
    assert play_session.state_json["current_zone_id"] == "ZONE_001"
    assert [change.model_dump() for change in result.result.state_changes] == [
        {
            "type": "puzzle_completed",
            "puzzle_id": "puzzle_01",
        },
        {
            "type": "clue_acquired",
            "clue_id": "clue_03",
        },
        {
            "type": "flag_updated",
            "flag": "archive_unlocked",
            "value": True,
        },
    ]
    assert play_session.state_json == result.result.state.model_dump()
    assert play_session.updated_at > datetime(2026, 9, 18, 1, 2, 3, 456789)

    event = db.added[0]
    assert isinstance(event, InteractionEvent)
    assert event.payload_json == {"answer": answer}
    assert event.result_type == "correct"
    assert event.id == result.interaction_id
    assert event.response_json == result.result.model_dump(mode="json")
    assert "state_changes" in event.response_json
    assert event.created_at.tzinfo is None
    assert db.commit_count == 1
    assert db.rollback_count == 0
    assert db.get_options == [
        {"with_for_update": True, "populate_existing": True},
    ]
    assert db.scalar_calls[0]._for_update_arg is not None
    assert db.operation_log == ["get", "scalar", "commit"]


@pytest.mark.anyio
async def test_submit_answer_uses_casefold() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    result = await process_interaction(
        db,
        "play-session-id",
        submit_answer(answer=" Answer "),
        runtime_loader=runtime_loader(make_runtime(accepted_answers=["answer"])),
    )

    assert result.result.result_type == "correct"


@pytest.mark.anyio
async def test_submit_answer_incorrect_records_attempt() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    original_state = deepcopy(play_session.state_json)
    original_updated_at = play_session.updated_at
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(answer="wrong"),
        runtime_loader=runtime_loader(make_runtime()),
    )

    assert result.result.result_type == "incorrect"
    assert result.result.state.attempt_counts == {"puzzle_01": 1}
    assert result.result.attempt_count == 1
    assert result.result.state.current_zone_id == "ZONE_001"
    assert result.result.state_changes == []
    assert play_session.state_json != original_state
    assert play_session.updated_at > original_updated_at
    assert db.added[0].result_type == "incorrect"
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_submit_answer_raises_for_unknown_puzzle() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    with pytest.raises(PuzzleNotFoundError):
        await process_interaction(
            db,
            "play-session-id",
            submit_answer(target_id="missing_puzzle"),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_submit_answer_already_completed_does_not_reapply_effect() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": ["puzzle_01"],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        },
    )
    original_state = deepcopy(play_session.state_json)
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(answer="wrong"),
        runtime_loader=runtime_loader(make_runtime()),
    )

    assert result.result.result_type == "already_completed"
    assert (
        result.result.state.model_dump(
            exclude_none=True,
            exclude_defaults=True,
        )
        == original_state
    )
    assert result.result.state.current_zone_id is None
    assert result.result.state_changes == []
    assert result.result.attempt_count is None
    assert play_session.state_json == original_state
    assert db.added[0].result_type == "already_completed"
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_submit_answer_records_only_actual_changes_in_stable_order() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": ["clue_03"],
            "hint_levels": {},
            "flags": {"archive_unlocked": True},
        },
    )
    db.get_result = play_session
    runtime = make_runtime(
        puzzle_complete_ids=["puzzle_01", "puzzle_02", "puzzle_02"],
    )
    runtime.puzzles[0].on_correct.grant_clue_ids = [
        "clue_03",
        "clue_04",
        "clue_04",
    ]
    runtime.puzzles[0].on_correct.set_flags = {
        "archive_unlocked": True,
        "new_flag": False,
    }

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(),
        runtime_loader=runtime_loader(runtime),
    )

    assert play_session.state_json["completed_puzzle_ids"] == [
        "puzzle_01",
        "puzzle_02",
    ]
    assert play_session.state_json["acquired_clue_ids"] == [
        "clue_03",
        "clue_04",
    ]
    assert [change.model_dump() for change in result.result.state_changes] == [
        {
            "type": "puzzle_completed",
            "puzzle_id": "puzzle_01",
        },
        {
            "type": "puzzle_completed",
            "puzzle_id": "puzzle_02",
        },
        {
            "type": "clue_acquired",
            "clue_id": "clue_04",
        },
        {
            "type": "flag_updated",
            "flag": "new_flag",
            "value": False,
        },
    ]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "clue_ids",
    [
        ["clue_03", "clue_07"],
        ["clue_07", "clue_03"],
    ],
)
async def test_combine_clues_success_is_order_independent(
    clue_ids: list[str],
) -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": ["clue_03", "clue_07"],
            "hint_levels": {"puzzle_01": 2},
            "flags": {"truth_fragment_01": False},
        },
    )
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        combine_clues(clue_ids),
        runtime_loader=runtime_loader(
            make_runtime(combination_complete_ids=["puzzle_02"]),
        ),
    )

    assert result.result.result_type == "combined"
    assert result.result.state.completed_puzzle_ids == ["puzzle_02"]
    assert result.result.state.acquired_clue_ids == [
        "clue_03",
        "clue_07",
        "clue_10",
    ]
    assert result.result.state.flags == {"truth_fragment_01": True}
    assert result.result.state.hint_levels == {"puzzle_01": 2}
    assert [change.model_dump() for change in result.result.state_changes] == [
        {
            "type": "puzzle_completed",
            "puzzle_id": "puzzle_02",
        },
        {
            "type": "clue_acquired",
            "clue_id": "clue_10",
        },
        {
            "type": "flag_updated",
            "flag": "truth_fragment_01",
            "value": True,
        },
    ]
    assert db.added[0].result_type == "combined"
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_combine_clues_incorrect_combination_records_result() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": ["clue_01", "clue_02"],
            "hint_levels": {},
            "flags": {},
        },
    )
    original_state = deepcopy(play_session.state_json)
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        combine_clues(["clue_01", "clue_02"]),
        runtime_loader=runtime_loader(make_runtime()),
    )

    assert result.result.result_type == "incorrect_combination"
    assert (
        result.result.state.model_dump(
            exclude_none=True,
            exclude_defaults=True,
        )
        == original_state
    )
    assert result.result.state.current_zone_id is None
    assert result.result.state_changes == []
    assert play_session.state_json == original_state
    assert db.added[0].result_type == "incorrect_combination"
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_legacy_state_mutation_does_not_invent_current_zone() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        },
    )
    db.get_result = play_session

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(),
        runtime_loader=runtime_loader(make_runtime()),
    )

    assert result.result.result_type == "correct"
    assert result.result.state.current_zone_id is None
    assert "current_zone_id" not in play_session.state_json
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_combine_clues_raises_for_unacquired_clue() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(
        state={
            "completed_puzzle_ids": [],
            "acquired_clue_ids": ["clue_03"],
            "hint_levels": {},
            "flags": {},
        },
    )
    original_state = deepcopy(play_session.state_json)
    db.get_result = play_session

    with pytest.raises(ClueNotAcquiredError):
        await process_interaction(
            db,
            play_session.id,
            combine_clues(["clue_03", "clue_07"]),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert play_session.state_json == original_state
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_idempotent_replay_returns_stored_response_without_writes() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    original_state = deepcopy(play_session.state_json)
    db.get_result = play_session
    db.scalar_result = InteractionEvent(
        id="interaction-event-id",
        play_session_id=play_session.id,
        client_event_id="client-event-id",
        interaction_type="submit_answer",
        target_id="puzzle_01",
        payload_json={"answer": " 아랑 사 "},
        result_type="correct",
        response_json={
            "success": True,
            "result_type": "correct",
            "state": {
                "completed_puzzle_ids": ["puzzle_01"],
                "acquired_clue_ids": ["clue_03"],
                "hint_levels": {},
                "flags": {"archive_unlocked": True},
            },
            "state_changes": [
                {
                    "type": "puzzle_completed",
                    "target_id": "puzzle_01",
                    "value": True,
                },
            ],
        },
        created_at=datetime(2026, 9, 18, 2, 3, 4),
    )

    def unexpected_loader(case_id: str) -> PuzzleRuntimeDefinition:
        raise AssertionError(f"Runtime loader called for {case_id}")

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(answer=" 아랑 사 "),
        runtime_loader=unexpected_loader,
    )

    assert result.interaction_id == "interaction-event-id"
    assert result.result.result_type == "correct"
    assert result.result.state.completed_puzzle_ids == ["puzzle_01"]
    assert [change.model_dump() for change in result.result.state_changes] == [
        {
            "type": "puzzle_completed",
            "puzzle_id": "puzzle_01",
        },
    ]
    assert play_session.state_json == original_state
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1
    assert len(db.scalar_calls) == 1
    assert db.operation_log == ["get", "scalar", "rollback"]

    statement = db.scalar_calls[0]
    assert statement.column_descriptions[0]["entity"] is InteractionEvent
    assert set(statement.compile().params.values()) == {
        play_session.id,
        "client-event-id",
    }


@pytest.mark.anyio
async def test_legacy_replay_defaults_missing_state_changes_to_empty() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    original_state = deepcopy(play_session.state_json)
    db.get_result = play_session
    db.scalar_result = InteractionEvent(
        id="legacy-interaction-event-id",
        play_session_id=play_session.id,
        client_event_id="client-event-id",
        interaction_type="submit_answer",
        target_id="puzzle_01",
        payload_json={"answer": "아랑사"},
        result_type="correct",
        response_json={
            "success": True,
            "result_type": "correct",
            "state": {
                "completed_puzzle_ids": ["puzzle_01"],
                "acquired_clue_ids": ["clue_03"],
                "hint_levels": {},
                "flags": {"archive_unlocked": True},
            },
        },
        created_at=datetime(2026, 9, 18, 2, 3, 4),
    )

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(),
        runtime_loader=runtime_loader(make_runtime()),
    )

    assert result.interaction_id == "legacy-interaction-event-id"
    assert result.result.state_changes == []
    assert play_session.state_json == original_state
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "interaction",
    [
        submit_answer(answer="different answer"),
        submit_answer(target_id="puzzle_02"),
        combine_clues(["clue_03", "clue_07"]),
    ],
)
async def test_idempotency_conflict_rejects_different_request(
    interaction: InteractionRequest,
) -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    original_state = deepcopy(play_session.state_json)
    db.get_result = play_session
    db.scalar_result = InteractionEvent(
        id="interaction-event-id",
        play_session_id=play_session.id,
        client_event_id="client-event-id",
        interaction_type="submit_answer",
        target_id="puzzle_01",
        payload_json={"answer": "first answer"},
        result_type="incorrect",
        response_json={
            "success": True,
            "result_type": "incorrect",
            "state": original_state,
        },
        created_at=datetime(2026, 9, 18, 2, 3, 4),
    )

    with pytest.raises(IdempotencyConflictError):
        await process_interaction(
            db,
            play_session.id,
            interaction,
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert play_session.state_json == original_state
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize("include_state_changes", [True, False])
async def test_integrity_race_replays_winner_response(
    include_state_changes: bool,
) -> None:
    db = RaceAsyncSession()
    play_session = make_play_session()
    db.get_result = play_session
    db.scalar_result = make_winner_event(
        play_session.id,
        include_state_changes=include_state_changes,
    )
    db.commit_error = IntegrityError("INSERT interaction_events", {}, RuntimeError())
    runtime_calls: list[str] = []

    def load_runtime(case_id: str) -> PuzzleRuntimeDefinition:
        runtime_calls.append(case_id)
        return make_runtime()

    result = await process_interaction(
        db,
        play_session.id,
        submit_answer(),
        runtime_loader=load_runtime,
    )

    assert result.interaction_id == "winner-interaction-id"
    assert result.result.result_type == "correct"
    assert result.result.state.completed_puzzle_ids == ["puzzle_01"]
    assert [change.model_dump() for change in result.result.state_changes] == (
        [{"type": "puzzle_completed", "puzzle_id": "puzzle_01"}]
        if include_state_changes
        else []
    )
    assert runtime_calls == [play_session.case_id]
    assert db.commit_count == 1
    assert db.rollback_count == 2
    assert len(db.added) == 1
    assert db.added[0].id != result.interaction_id
    assert len(db.scalar_calls) == 2
    for statement in db.scalar_calls:
        assert statement.column_descriptions[0]["entity"] is InteractionEvent
        assert set(statement.compile().params.values()) == {
            play_session.id,
            "client-event-id",
        }


@pytest.mark.anyio
async def test_integrity_race_with_different_request_conflicts() -> None:
    db = RaceAsyncSession()
    play_session = make_play_session()
    db.get_result = play_session
    db.scalar_result = make_winner_event(
        play_session.id,
        answer="other answer",
        target_id="puzzle_02",
    )
    db.commit_error = IntegrityError("INSERT interaction_events", {}, RuntimeError())

    with pytest.raises(IdempotencyConflictError):
        await process_interaction(
            db,
            play_session.id,
            submit_answer(),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert db.commit_count == 1
    assert db.rollback_count == 2
    assert len(db.scalar_calls) == 2
    assert len(db.added) == 1


@pytest.mark.anyio
async def test_unrelated_integrity_error_is_raised_unchanged() -> None:
    db = RaceAsyncSession()
    play_session = make_play_session()
    db.get_result = play_session
    error = IntegrityError("INSERT interaction_events", {}, RuntimeError())
    db.commit_error = error

    with pytest.raises(IntegrityError) as raised:
        await process_interaction(
            db,
            play_session.id,
            submit_answer(),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert raised.value is error
    assert db.commit_count == 1
    assert db.rollback_count == 2
    assert len(db.scalar_calls) == 2


@pytest.mark.anyio
async def test_runtime_loader_error_is_not_converted_to_game_result() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    def missing_runtime(case_id: str) -> PuzzleRuntimeDefinition:
        raise CaseRuntimeNotFoundError(case_id)

    with pytest.raises(CaseRuntimeNotFoundError):
        await process_interaction(
            db,
            "play-session-id",
            submit_answer(),
            runtime_loader=missing_runtime,
        )

    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_unexpected_interaction_processing_error_rolls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    def fail_processing(*args) -> None:
        raise RuntimeError("processing failed")

    monkeypatch.setattr(
        "app.services.interaction._process_submit_answer",
        fail_processing,
    )

    with pytest.raises(RuntimeError, match="processing failed"):
        await process_interaction(
            db,
            "play-session-id",
            submit_answer(),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_cancelled_interaction_rolls_back() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    def cancel_runtime(case_id: str) -> PuzzleRuntimeDefinition:
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await process_interaction(
            db,
            "play-session-id",
            submit_answer(),
            runtime_loader=cancel_runtime,
        )

    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_commit_error_rolls_back() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    db.commit_error = RuntimeError("commit failed")

    with pytest.raises(RuntimeError, match="commit failed"):
        await process_interaction(
            db,
            "play-session-id",
            submit_answer(),
            runtime_loader=runtime_loader(make_runtime()),
        )

    assert len(db.added) == 1
    assert db.commit_count == 1
    assert db.rollback_count == 1
    assert len(db.scalar_calls) == 1
