import asyncio
import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.hint import HintUnlockRequest
from app.schemas.interaction import SubmitAnswerInteraction, SubmitAnswerPayload
from app.schemas.puzzle_runtime import (
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.hint import (
    HINT_INTERACTION_TYPE,
    HintAccessDeniedError,
    HintLevelSkippedError,
    HintNotFoundError,
    InvalidHintStateError,
    get_puzzle_hint_state,
    unlock_hint,
)
from app.services.interaction import (
    IdempotencyConflictError,
    PuzzleNotFoundError,
    process_interaction,
)
from app.services.play_session import PlaySessionNotFoundError
from tests.conftest import ExpiringSession, FakeAsyncSession

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
PUZZLE_ID = "PZ_TEST_01"
HINT_TEXTS = {
    ("case_test", PUZZLE_ID, 1): "(가상) 1단계 힌트 원문",
    ("case_test", PUZZLE_ID, 2): "(가상) 2단계 정답 원문",
}


def make_runtime() -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id="case_test",
        puzzles=[
            PuzzleDefinition(
                puzzle_id=PUZZLE_ID,
                accepted_answers=["가상정답"],
                on_correct=RuntimeEffect(grant_clue_ids=[], set_flags={}),
            ),
            PuzzleDefinition(
                puzzle_id="PZ_TEST_NO_HINT",
                accepted_answers=["가상정답"],
                on_correct=RuntimeEffect(grant_clue_ids=[], set_flags={}),
            ),
        ],
        clue_combinations=[],
    )


def load_runtime(case_id: str) -> PuzzleRuntimeDefinition:
    assert case_id == "case_test"
    return make_runtime()


class RecordingHintSource:
    def __init__(self, texts: dict[tuple[str, str, int], str] | None = None) -> None:
        self.texts = HINT_TEXTS if texts is None else texts
        self.calls: list[tuple[str, str, int]] = []

    def __call__(self, case_id: str, puzzle_id: str, level: int) -> str | None:
        self.calls.append((case_id, puzzle_id, level))
        return self.texts.get((case_id, puzzle_id, level))


class RecordingPolicy:
    def __init__(self, *, deny: bool = False) -> None:
        self.deny = deny
        self.calls: list[tuple[str, int]] = []

    def __call__(self, state: dict, puzzle: PuzzleDefinition, level: int) -> None:
        self.calls.append((puzzle.puzzle_id, level))
        if self.deny:
            raise HintAccessDeniedError(puzzle.puzzle_id)


def make_play_session(*, hint_levels: dict | None = None) -> PlaySession:
    now = datetime(2026, 10, 27, 1, 2, 3)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anonymous-session-id",
        case_id="case_test",
        state_json={
            "current_zone_id": "ZONE_TEST",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {} if hint_levels is None else hint_levels,
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


def hint_request(
    level: int, client_event_id: str = "hint-event-1"
) -> HintUnlockRequest:
    return HintUnlockRequest(
        client_event_id=client_event_id,
        client_timestamp=datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc),
        target_level=level,
    )


async def call_unlock(
    db: FakeAsyncSession,
    level: int,
    *,
    puzzle_id: str = PUZZLE_ID,
    client_event_id: str = "hint-event-1",
    source: RecordingHintSource | None = None,
    policy: RecordingPolicy | None = None,
):
    return await unlock_hint(
        db,
        "play-session-id",
        puzzle_id,
        hint_request(level, client_event_id),
        hint_source=source or RecordingHintSource(),
        access_policy=policy or RecordingPolicy(),
        runtime_loader=load_runtime,
    )


def stored_event(db: FakeAsyncSession) -> InteractionEvent:
    assert len(db.added) == 1
    return db.added[0]


def make_hint_event(response_json: dict, *, target_level: int = 1) -> InteractionEvent:
    return InteractionEvent(
        id="winner-event-id",
        play_session_id="play-session-id",
        client_event_id="hint-event-1",
        client_timestamp=None,
        interaction_type=HINT_INTERACTION_TYPE,
        target_id=PUZZLE_ID,
        payload_json={"target_level": target_level},
        result_type=response_json["result_type"],
        response_json=response_json,
        created_at=datetime(2026, 10, 27, 3, 0),
    )


# --- 순차 해금 ---


@pytest.mark.anyio
async def test_unlocks_level_one_then_two_in_order() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    db.get_result = play_session

    first = await call_unlock(db, 1)

    assert first.result.result_type == "hint_unlocked"
    assert first.result.hint_level == 1
    assert [c.model_dump() for c in first.result.state_changes] == [
        {"type": "hint_level_changed", "puzzle_id": PUZZLE_ID, "hint_level": 1}
    ]
    assert first.hint.model_dump() == {
        "level": 1,
        "text": HINT_TEXTS[("case_test", PUZZLE_ID, 1)],
    }
    assert play_session.state_json["hint_levels"] == {PUZZLE_ID: 1}
    assert play_session.updated_at != datetime(2026, 10, 27, 1, 2, 3)
    event = stored_event(db)
    assert event.id == first.interaction_id
    assert event.interaction_type == HINT_INTERACTION_TYPE
    assert event.target_id == PUZZLE_ID
    assert event.payload_json == {"target_level": 1}
    assert event.result_type == "hint_unlocked"
    assert event.client_timestamp == datetime(2026, 10, 27, 3, 0)
    assert db.get_options == [{"with_for_update": True, "populate_existing": True}]
    assert db.commit_count == 1
    assert db.rollback_count == 0

    db.added.clear()
    second = await call_unlock(db, 2, client_event_id="hint-event-2")

    assert second.result.result_type == "hint_unlocked"
    assert second.result.hint_level == 2
    assert [c.model_dump() for c in second.result.state_changes] == [
        {"type": "hint_level_changed", "puzzle_id": PUZZLE_ID, "hint_level": 2}
    ]
    assert second.hint.level == 2
    assert play_session.state_json["hint_levels"] == {PUZZLE_ID: 2}
    assert db.commit_count == 2


@pytest.mark.anyio
async def test_unlock_keeps_other_puzzle_levels_and_legacy_state_without_key() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(hint_levels={"PZ_OTHER": 2})
    db.get_result = play_session

    await call_unlock(db, 1)

    assert play_session.state_json["hint_levels"] == {"PZ_OTHER": 2, PUZZLE_ID: 1}


@pytest.mark.anyio
async def test_skipping_to_level_two_is_rejected_without_writes() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session()
    db.get_result = play_session
    policy = RecordingPolicy()

    with pytest.raises(HintLevelSkippedError):
        await call_unlock(db, 2, policy=policy)

    assert play_session.state_json["hint_levels"] == {}
    assert policy.calls == []
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


# --- 이미 해금한 단계 ---


@pytest.mark.anyio
@pytest.mark.parametrize(("current", "requested"), [(1, 1), (2, 1), (2, 2)])
async def test_already_unlocked_level_records_event_without_state_change(
    current: int, requested: int
) -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(hint_levels={PUZZLE_ID: current})
    before_updated_at = play_session.updated_at
    db.get_result = play_session
    policy = RecordingPolicy()

    result = await call_unlock(db, requested, policy=policy)

    assert result.result.result_type == "already_unlocked"
    assert result.result.hint_level == current
    assert result.result.state_changes == []
    assert result.hint.level == requested
    assert result.hint.text == HINT_TEXTS[("case_test", PUZZLE_ID, requested)]
    assert play_session.state_json["hint_levels"] == {PUZZLE_ID: current}
    assert play_session.updated_at == before_updated_at
    assert policy.calls == []
    assert stored_event(db).result_type == "already_unlocked"
    assert db.commit_count == 1


# --- 접근 조건 훅 ---


@pytest.mark.anyio
async def test_access_policy_is_called_only_for_new_unlock_and_can_deny() -> None:
    db = FakeAsyncSession()
    play_session = make_play_session(hint_levels={PUZZLE_ID: 1})
    db.get_result = play_session
    policy = RecordingPolicy(deny=True)

    with pytest.raises(HintAccessDeniedError):
        await call_unlock(db, 2, policy=policy)

    assert policy.calls == [(PUZZLE_ID, 2)]
    assert play_session.state_json["hint_levels"] == {PUZZLE_ID: 1}
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


# --- 잘못된 퍼즐 · 단계 · 상태 ---


@pytest.mark.anyio
async def test_unknown_puzzle_is_not_found() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    with pytest.raises(PuzzleNotFoundError):
        await call_unlock(db, 1, puzzle_id="PZ_MISSING")

    assert db.added == []
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_undefined_hint_level_is_not_found_and_error_has_no_text() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    with pytest.raises(HintNotFoundError) as raised:
        await call_unlock(db, 1, puzzle_id="PZ_TEST_NO_HINT")

    assert str(raised.value) == "PZ_TEST_NO_HINT:1"
    assert db.added == []
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_blank_hint_text_is_treated_as_undefined() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    source = RecordingHintSource({("case_test", PUZZLE_ID, 1): "   "})

    with pytest.raises(HintNotFoundError):
        await call_unlock(db, 1, source=source)


@pytest.mark.anyio
async def test_missing_play_session_raises_before_reading_events() -> None:
    db = FakeAsyncSession()

    with pytest.raises(PlaySessionNotFoundError):
        await call_unlock(db, 1)

    assert db.scalar_calls == []
    assert db.rollback_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize("stored", [-1, 3, "1", True, None])
async def test_invalid_stored_hint_level_is_rejected(stored: Any) -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session(hint_levels={PUZZLE_ID: stored})

    with pytest.raises(InvalidHintStateError):
        await call_unlock(db, 1)

    assert db.added == []
    assert db.rollback_count == 1


@pytest.mark.parametrize("level", [0, 3, -1, "1", None])
def test_request_rejects_levels_outside_one_and_two(level: Any) -> None:
    with pytest.raises(ValidationError):
        HintUnlockRequest(client_event_id="e", target_level=level)


# --- 멱등성 ---


@pytest.mark.anyio
async def test_replay_returns_stored_result_without_writes() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    first = await call_unlock(db, 1)
    stored = stored_event(db)

    replay_db = FakeAsyncSession()
    replay_db.get_result = make_play_session(hint_levels={PUZZLE_ID: 2})
    replay_db.scalar_result = stored
    runtime_calls: list[str] = []

    def counting_runtime(case_id: str) -> PuzzleRuntimeDefinition:
        runtime_calls.append(case_id)
        return make_runtime()

    replay = await unlock_hint(
        replay_db,
        "play-session-id",
        PUZZLE_ID,
        hint_request(1),
        hint_source=RecordingHintSource(),
        access_policy=RecordingPolicy(),
        runtime_loader=counting_runtime,
    )

    assert replay.interaction_id == first.interaction_id
    assert replay.result == first.result
    assert replay.hint == first.hint
    assert runtime_calls == []
    assert replay_db.added == []
    assert replay_db.commit_count == 0
    assert replay_db.rollback_count == 1


@pytest.mark.anyio
async def test_replay_reads_no_orm_attributes_after_rollback() -> None:
    """실제 SQLAlchemy는 rollback 때 객체를 만료시킨다. 재전송 경로가 그 뒤에 속성을 읽으면 안 된다."""
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    first = await call_unlock(db, 1)

    replay_db = ExpiringSession()
    replay_db.get_result = make_play_session(hint_levels={PUZZLE_ID: 1})
    replay_db.scalar_result = stored_event(db)

    replay = await call_unlock(replay_db, 1)

    assert replay.interaction_id == first.interaction_id
    assert replay.hint == first.hint
    assert replay_db.rollback_count == 1


@pytest.mark.anyio
async def test_integrity_race_reads_no_orm_attributes_after_rollback() -> None:
    winner_db = FakeAsyncSession()
    winner_db.get_result = make_play_session()
    winner = await call_unlock(winner_db, 1)

    class ExpiringRace(ExpiringSession):
        async def scalar(self, statement):
            self.scalar_calls.append(statement)
            if len(self.scalar_calls) == 1:
                return None
            return await ExpiringSession.scalar(self, statement)

    db = ExpiringRace()
    db.get_result = make_play_session()
    db.scalar_result = stored_event(winner_db)
    db.commit_error = IntegrityError("INSERT interaction_events", {}, RuntimeError())

    result = await call_unlock(db, 1)

    assert result.interaction_id == winner.interaction_id


@pytest.mark.anyio
async def test_same_event_id_with_different_level_conflicts() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    await call_unlock(db, 1)

    conflict_db = FakeAsyncSession()
    conflict_db.get_result = make_play_session(hint_levels={PUZZLE_ID: 1})
    conflict_db.scalar_result = stored_event(db)

    with pytest.raises(IdempotencyConflictError):
        await call_unlock(conflict_db, 2)

    assert conflict_db.added == []
    assert conflict_db.commit_count == 0
    assert conflict_db.rollback_count == 1


@pytest.mark.anyio
async def test_same_event_id_with_different_puzzle_conflicts() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    await call_unlock(db, 1)

    conflict_db = FakeAsyncSession()
    conflict_db.get_result = make_play_session()
    conflict_db.scalar_result = stored_event(db)

    with pytest.raises(IdempotencyConflictError):
        await call_unlock(conflict_db, 1, puzzle_id="PZ_TEST_NO_HINT")


@pytest.mark.anyio
async def test_interaction_event_id_cannot_be_reused_for_hint_and_back() -> None:
    interaction_event = InteractionEvent(
        id="interaction-id",
        play_session_id="play-session-id",
        client_event_id="hint-event-1",
        client_timestamp=None,
        interaction_type="submit_answer",
        target_id=PUZZLE_ID,
        payload_json={"target_level": 1},
        result_type="incorrect",
        response_json={},
        created_at=datetime(2026, 10, 27, 3, 0),
    )
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    db.scalar_result = interaction_event

    with pytest.raises(IdempotencyConflictError):
        await call_unlock(db, 1)

    hint_db = FakeAsyncSession()
    hint_db.get_result = make_play_session()
    await call_unlock(hint_db, 1)
    interaction_db = FakeAsyncSession()
    interaction_db.get_result = make_play_session()
    interaction_db.scalar_result = stored_event(hint_db)

    with pytest.raises(IdempotencyConflictError):
        await process_interaction(
            interaction_db,
            "play-session-id",
            SubmitAnswerInteraction(
                client_event_id="hint-event-1",
                interaction_type="submit_answer",
                target_id=PUZZLE_ID,
                zone_id="ZONE_TEST",
                payload=SubmitAnswerPayload(answer="x"),
            ),
            runtime_loader=load_runtime,
        )


class RaceAsyncSession(FakeAsyncSession):
    """첫 이벤트 조회는 비어 있고, 커밋 경합 뒤 다시 조회하면 승자 이벤트가 보인다."""

    async def scalar(self, statement: Any) -> Any:
        self.scalar_calls.append(statement)
        self.operation_log.append("scalar")
        if len(self.scalar_calls) == 1:
            return None
        return self.scalar_result


@pytest.mark.anyio
async def test_integrity_race_replays_winner() -> None:
    winner_db = FakeAsyncSession()
    winner_db.get_result = make_play_session()
    winner = await call_unlock(winner_db, 1)
    winner_event = stored_event(winner_db)

    db = RaceAsyncSession()
    db.get_result = make_play_session()
    db.scalar_result = winner_event
    db.commit_error = IntegrityError("INSERT interaction_events", {}, RuntimeError())

    result = await call_unlock(db, 1)

    assert result.interaction_id == winner.interaction_id
    assert result.result == winner.result
    assert db.commit_count == 1
    assert db.rollback_count == 2


@pytest.mark.anyio
async def test_unrelated_integrity_error_is_raised() -> None:
    db = RaceAsyncSession()
    db.get_result = make_play_session()
    db.scalar_result = None
    error = IntegrityError("INSERT interaction_events", {}, RuntimeError())
    db.commit_error = error

    with pytest.raises(IntegrityError) as raised:
        await call_unlock(db, 1)

    assert raised.value is error
    assert db.rollback_count == 2


# --- 저장 실패 · 취소 시 롤백 ---


@pytest.mark.anyio
async def test_commit_failure_rolls_back_and_raises() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    db.commit_error = RuntimeError("commit failed")

    with pytest.raises(RuntimeError, match="commit failed"):
        await call_unlock(db, 1)

    assert db.commit_count == 1
    assert db.rollback_count == 1
    assert db.operation_log == ["get", "scalar", "commit", "rollback"]


@pytest.mark.anyio
async def test_cancelled_unlock_rolls_back() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    def cancelling_source(case_id: str, puzzle_id: str, level: int) -> str:
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await unlock_hint(
            db,
            "play-session-id",
            PUZZLE_ID,
            hint_request(1),
            hint_source=cancelling_source,
            access_policy=RecordingPolicy(),
            runtime_loader=load_runtime,
        )

    assert db.commit_count == 0
    assert db.rollback_count == 1


# --- 원문 미노출 ---


def all_hint_texts() -> list[str]:
    return list(HINT_TEXTS.values())


@pytest.mark.anyio
async def test_event_record_never_contains_hint_text() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    await call_unlock(db, 1)
    await call_unlock(db, 2, client_event_id="hint-event-2")
    await call_unlock(db, 1, client_event_id="hint-event-3")

    assert len(db.added) == 3
    for event in db.added:
        serialized = json.dumps(
            [event.payload_json, event.response_json, event.target_id],
            ensure_ascii=False,
        )
        for text in all_hint_texts():
            assert text not in serialized
        assert "text" not in json.dumps(event.response_json)


@pytest.mark.anyio
async def test_level_one_unlock_does_not_return_or_read_level_two_text() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    source = RecordingHintSource()

    result = await call_unlock(db, 1, source=source)

    dumped = json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
    assert HINT_TEXTS[("case_test", PUZZLE_ID, 2)] not in dumped
    assert source.calls == [("case_test", PUZZLE_ID, 1)]


@pytest.mark.anyio
async def test_rejected_unlocks_do_not_return_text() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    with pytest.raises(HintLevelSkippedError) as raised:
        await call_unlock(db, 2)

    for text in all_hint_texts():
        assert text not in str(raised.value)


# --- 조회 ---


@pytest.mark.anyio
@pytest.mark.parametrize("current", [0, 1, 2])
async def test_hint_state_returns_only_unlocked_texts_without_writes(
    current: int,
) -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session(
        hint_levels={PUZZLE_ID: current} if current else {}
    )
    source = RecordingHintSource()

    state = await get_puzzle_hint_state(
        db,
        "play-session-id",
        PUZZLE_ID,
        hint_source=source,
        runtime_loader=load_runtime,
    )

    assert state.hint_level == current
    assert [hint.level for hint in state.unlocked] == list(range(1, current + 1))
    assert source.calls == [("case_test", PUZZLE_ID, n) for n in range(1, current + 1)]
    assert db.get_options == [{}]
    assert db.added == []
    assert db.commit_count == 0


@pytest.mark.anyio
async def test_hint_state_errors() -> None:
    db = FakeAsyncSession()
    with pytest.raises(PlaySessionNotFoundError):
        await get_puzzle_hint_state(
            db,
            "x",
            PUZZLE_ID,
            hint_source=RecordingHintSource(),
            runtime_loader=load_runtime,
        )

    db.get_result = make_play_session()
    with pytest.raises(PuzzleNotFoundError):
        await get_puzzle_hint_state(
            db,
            "play-session-id",
            "PZ_MISSING",
            hint_source=RecordingHintSource(),
            runtime_loader=load_runtime,
        )


# --- 동시 요청 ---


class RowLockStore:
    """PlaySession 행 하나와 이벤트 표를 가진 가짜 DB.

    실제 DB처럼 세션마다 행을 따로 읽고 커밋할 때 써 넣는다. with_for_update 조회는
    커밋/롤백까지 행 잠금을 잡는다. 잠금이 없으면 두 세션이 같은 옛 상태로 계산할 수 있다.
    """

    def __init__(self, play_session: PlaySession) -> None:
        self.play_session = play_session
        self.lock = asyncio.Lock()
        self.events: list[InteractionEvent] = []


class RowLockSession(FakeAsyncSession):
    def __init__(self, store: RowLockStore) -> None:
        super().__init__()
        self.store = store
        self.holding = False
        self.row: PlaySession | None = None

    async def get(self, model, entity_id, **options):
        self.get_options.append(options)
        if options.get("with_for_update"):
            await self.store.lock.acquire()
            self.holding = True
        source = self.store.play_session
        self.row = PlaySession(
            id=source.id,
            anonymous_session_id=source.anonymous_session_id,
            case_id=source.case_id,
            state_json=deepcopy(source.state_json),
            created_at=source.created_at,
            updated_at=source.updated_at,
            completed_at=source.completed_at,
        )
        # 읽은 뒤 다른 작업이 끼어들 틈을 준다.
        await asyncio.sleep(0)
        return self.row

    async def scalar(self, statement):
        values = set(statement.compile().params.values())
        return next(
            (e for e in self.store.events if e.client_event_id in values),
            None,
        )

    def _release(self) -> None:
        if self.holding:
            self.holding = False
            self.store.lock.release()

    async def commit(self) -> None:
        self.commit_count += 1
        await asyncio.sleep(0)
        for event in self.added:
            if any(
                e.client_event_id == event.client_event_id for e in self.store.events
            ):
                raise IntegrityError("INSERT interaction_events", {}, RuntimeError())
        if self.row is not None:
            self.store.play_session.state_json = deepcopy(self.row.state_json)
            self.store.play_session.updated_at = self.row.updated_at
        self.store.events.extend(self.added)
        self.added = []
        self._release()

    async def rollback(self) -> None:
        self.rollback_count += 1
        self.added = []
        self._release()


async def unlock_with_store(store: RowLockStore, level: int, event_id: str):
    return await unlock_hint(
        RowLockSession(store),
        "play-session-id",
        PUZZLE_ID,
        hint_request(level, event_id),
        hint_source=RecordingHintSource(),
        access_policy=RecordingPolicy(),
        runtime_loader=load_runtime,
    )


@pytest.mark.anyio
async def test_concurrent_level_one_requests_unlock_once() -> None:
    store = RowLockStore(make_play_session())

    results = await asyncio.gather(
        *(unlock_with_store(store, 1, f"event-{n}") for n in range(10))
    )

    result_types = sorted(r.result.result_type for r in results)
    assert result_types == ["already_unlocked"] * 9 + ["hint_unlocked"]
    assert store.play_session.state_json["hint_levels"] == {PUZZLE_ID: 1}
    assert len(store.events) == 10
    changes = [e for e in store.events if e.response_json["state_changes"]]
    assert len(changes) == 1


@pytest.mark.anyio
async def test_concurrent_mixed_levels_keep_state_consistent_with_events() -> None:
    store = RowLockStore(make_play_session())
    requests = [(2, "a"), (1, "b"), (2, "c"), (1, "d"), (2, "e")]

    outcomes = await asyncio.gather(
        *(unlock_with_store(store, level, event_id) for level, event_id in requests),
        return_exceptions=True,
    )

    for outcome in outcomes:
        assert not isinstance(outcome, Exception) or isinstance(
            outcome, HintLevelSkippedError
        )
    unlocked = [
        e.response_json["state_changes"][0]["hint_level"]
        for e in store.events
        if e.response_json["state_changes"]
    ]
    # 커밋 순서대로 1, 2만 한 번씩, 순서를 건너뛰지 않는다.
    assert unlocked == list(range(1, len(unlocked) + 1))
    assert store.play_session.state_json["hint_levels"].get(PUZZLE_ID, 0) == len(
        unlocked
    )
    assert not store.lock.locked()


@pytest.mark.anyio
async def test_concurrent_duplicate_event_id_records_one_event() -> None:
    store = RowLockStore(make_play_session())

    results = await asyncio.gather(
        *(unlock_with_store(store, 1, "same-event") for _ in range(5))
    )

    assert len(store.events) == 1
    assert {r.interaction_id for r in results} == {store.events[0].id}
    assert {r.result.result_type for r in results} == {"hint_unlocked"}
    assert store.play_session.state_json["hint_levels"] == {PUZZLE_ID: 1}
