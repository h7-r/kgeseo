import asyncio
import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.npc import (
    ApprovedNpcLine,
    NpcHintReshowRequest,
    NpcNudgeRequest,
    NpcRequest,
)
from app.schemas.puzzle_runtime import (
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.hint import HintNotFoundError
from app.services.interaction import IdempotencyConflictError, PuzzleNotFoundError
from app.services.npc import (
    NPC_HINT_RESHOWN_EVENT_TYPE,
    NPC_NUDGE_EVENT_TYPE,
    HintNotUnlockedError,
    NpcContentUnsafeError,
    NpcLineNotFoundError,
    NpcLineScopeError,
    NpcReshowNotAllowedError,
    process_npc_request,
)
from app.services.play_session import PlaySessionNotFoundError
from tests.conftest import ExpiringSession, FakeAsyncSession

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 승인 대사가 아니다.
CASE_ID = "case_test"
NPC_ID = "NPC_TEST"
HINTS = {
    (CASE_ID, "PZ_A", 1): "(가상) A 1단계 원문",
    (CASE_ID, "PZ_A", 2): "(가상) A 2단계 원문 가상정답에이",
    (CASE_ID, "PZ_B", 1): "(가상) B 1단계 원문",
    (CASE_ID, "PZ_B", 2): "(가상) B 2단계 원문 가상정답비",
}
# PM v0.4.3: 공개 조건이 없는 대사는 내보내지 않으므로 늘 공개 조건을 명시한다.
OPEN = {"always": True}
LINES = {
    "NUDGE_GENERAL": ApprovedNpcLine(
        line_id="NUDGE_GENERAL",
        kind="nudge",
        text="(가상) 주변을 더 살펴보자.",
        approved=True,
        reveal_when=OPEN,
    ),
    "NUDGE_PZ_A": ApprovedNpcLine(
        line_id="NUDGE_PZ_A",
        kind="nudge",
        text="(가상) 그 자물쇠 근처가 수상해.",
        approved=True,
        puzzle_id="PZ_A",
        reveal_when=OPEN,
    ),
    "NUDGE_DRAFT": ApprovedNpcLine(
        line_id="NUDGE_DRAFT",
        kind="nudge",
        text="(가상) 검수 전 초안",
        approved=False,
        reveal_when=OPEN,
    ),
    "NUDGE_BLANK": ApprovedNpcLine(
        line_id="NUDGE_BLANK",
        kind="nudge",
        text="   ",
        approved=True,
        reveal_when=OPEN,
    ),
    "NUDGE_LEAK": ApprovedNpcLine(
        line_id="NUDGE_LEAK",
        kind="nudge",
        text="(가상) 답은 가상 정답비 야",
        approved=True,
        reveal_when=OPEN,
    ),
    "NUDGE_HINT_COPY": ApprovedNpcLine(
        line_id="NUDGE_HINT_COPY",
        kind="nudge",
        text="(가상) 참고로 (가상) B 1단계 원문",
        approved=True,
        reveal_when=OPEN,
    ),
    "NUDGE_WRONG_ID": ApprovedNpcLine(
        line_id="NUDGE_OTHER",
        kind="nudge",
        text="(가상) 다른 줄",
        approved=True,
        reveal_when=OPEN,
    ),
    "NUDGE_NO_REVEAL": ApprovedNpcLine(
        line_id="NUDGE_NO_REVEAL", kind="nudge", text="(가상) 조건 없음", approved=True
    ),
    "NUDGE_LOCKED": ApprovedNpcLine(
        line_id="NUDGE_LOCKED",
        kind="nudge",
        text="(가상) 아직 닫힌 대사",
        approved=True,
        reveal_when={"puzzle_completed": "PZ_A"},
    ),
    "NUDGE_BAD_REVEAL": ApprovedNpcLine(
        line_id="NUDGE_BAD_REVEAL",
        kind="nudge",
        text="(가상) 판정할 수 없는 조건",
        approved=True,
        reveal_when={"scene_reached": "SCENE_1"},
    ),
}
ALL_TEXTS = [*HINTS.values(), *(line.text for line in LINES.values())]


def make_runtime() -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=CASE_ID,
        puzzles=[
            PuzzleDefinition(
                puzzle_id=puzzle_id,
                accepted_answers=[answer],
                on_correct=RuntimeEffect(grant_clue_ids=[], set_flags={}),
            )
            for puzzle_id, answer in (("PZ_A", "가상정답에이"), ("PZ_B", "가상정답비"))
        ],
        clue_combinations=[],
    )


def load_runtime(case_id: str) -> PuzzleRuntimeDefinition:
    assert case_id == CASE_ID
    return make_runtime()


class Sources:
    def __init__(self, hints: dict | None = None, lines: dict | None = None) -> None:
        self.hints = HINTS if hints is None else hints
        self.lines = LINES if lines is None else lines
        self.hint_calls: list[tuple[str, str, int]] = []

    def hint(self, case_id: str, puzzle_id: str, level: int) -> str | None:
        self.hint_calls.append((case_id, puzzle_id, level))
        return self.hints.get((case_id, puzzle_id, level))

    def line(self, case_id: str, npc_id: str, line_id: str) -> ApprovedNpcLine | None:
        assert (case_id, npc_id) == (CASE_ID, NPC_ID)
        return self.lines.get(line_id)


def make_play_session(hint_levels: dict | None = None) -> PlaySession:
    now = datetime(2026, 10, 27, 1, 2, 3)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anonymous-session-id",
        case_id=CASE_ID,
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


def nudge(
    line_id: str = "NUDGE_GENERAL", *, puzzle_id: str | None = None, event: str = "e1"
):
    return NpcNudgeRequest(
        client_event_id=event,
        client_timestamp=datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc),
        kind="nudge",
        npc_id=NPC_ID,
        line_id=line_id,
        puzzle_id=puzzle_id,
    )


def reshow(
    puzzle_id: str = "PZ_A",
    level: int = 1,
    *,
    trigger: str | None = None,
    event: str = "e1",
):
    return NpcHintReshowRequest(
        client_event_id=event,
        kind="hint_reshow",
        npc_id=NPC_ID,
        puzzle_id=puzzle_id,
        hint_level=level,
        trigger=trigger,
    )


async def call(db, request, sources: Sources | None = None):
    sources = sources or Sources()
    return await process_npc_request(
        db,
        "play-session-id",
        request,
        line_source=sources.line,
        hint_source=sources.hint,
        runtime_loader=load_runtime,
    )


def session_db(hint_levels: dict | None = None) -> FakeAsyncSession:
    db = FakeAsyncSession()
    db.get_result = make_play_session(hint_levels)
    return db


def assert_no_writes(db: FakeAsyncSession) -> None:
    assert db.added == []
    assert db.commit_count == 0


# --- 요청 모델 ---


@pytest.mark.parametrize(
    "line_id", ["GENERAL", "nudge_general", "NUDGE_", "NUDGE_가", ""]
)
def test_nudge_request_requires_nudge_line_id(line_id: str) -> None:
    with pytest.raises(ValidationError):
        nudge(line_id)


def test_requests_reject_client_supplied_text() -> None:
    adapter = TypeAdapter(NpcRequest)
    base = {"client_event_id": "e", "npc_id": NPC_ID}
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {**base, "kind": "nudge", "line_id": "NUDGE_GENERAL", "text": "임의 문장"}
        )
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                **base,
                "kind": "hint_reshow",
                "puzzle_id": "PZ_A",
                "hint_level": 1,
                "text": "x",
            }
        )
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {**base, "kind": "hint_reshow", "puzzle_id": "PZ_A", "hint_level": 3}
        )


# --- nudge ---


@pytest.mark.anyio
async def test_approved_nudge_is_returned_and_recorded_without_text() -> None:
    db = session_db()
    before = deepcopy(db.get_result.state_json)

    result = await call(db, nudge())

    assert result.line.model_dump() == {
        "line_id": "NUDGE_GENERAL",
        "text": LINES["NUDGE_GENERAL"].text,
    }
    assert result.reshown_hint is None
    assert result.result.result_type == "nudge_given"
    assert result.result.state_changes == []
    [event] = db.added
    assert event.id == result.npc_event_id
    assert event.interaction_type == NPC_NUDGE_EVENT_TYPE
    assert event.target_id == "NUDGE_GENERAL"
    assert event.payload_json == {"npc_id": NPC_ID, "puzzle_id": None}
    assert event.client_timestamp == datetime(2026, 10, 27, 3, 0)
    assert db.get_result.state_json == before
    # 상태를 쓰지 않으므로 행 잠금을 잡지 않는다.
    assert db.get_options == [{}]
    assert db.commit_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "line_id",
    [
        "NUDGE_DRAFT",
        "NUDGE_MISSING",
        "NUDGE_BLANK",
        "NUDGE_WRONG_ID",
        # PM v0.4.3: 공개 조건이 없거나 · 닫혀 있거나 · 판정할 수 없으면 없는 대사와 같다
        "NUDGE_NO_REVEAL",
        "NUDGE_LOCKED",
        "NUDGE_BAD_REVEAL",
    ],
)
async def test_unapproved_missing_or_mismatched_nudge_is_rejected(line_id: str) -> None:
    db = session_db()

    with pytest.raises(NpcLineNotFoundError) as raised:
        await call(db, nudge(line_id))

    assert str(raised.value) == line_id
    assert_no_writes(db)
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_puzzle_scoped_nudge_requires_matching_puzzle() -> None:
    assert (await call(session_db(), nudge("NUDGE_PZ_A", puzzle_id="PZ_A"))).line

    for puzzle_id in (None, "PZ_B"):
        db = session_db()
        with pytest.raises(NpcLineScopeError):
            await call(db, nudge("NUDGE_PZ_A", puzzle_id=puzzle_id))
        assert_no_writes(db)

    db = session_db()
    with pytest.raises(PuzzleNotFoundError):
        await call(db, nudge("NUDGE_GENERAL", puzzle_id="PZ_MISSING"))
    assert_no_writes(db)


@pytest.mark.anyio
@pytest.mark.parametrize("line_id", ["NUDGE_LEAK", "NUDGE_HINT_COPY"])
async def test_nudge_containing_answer_or_hint_text_is_blocked(line_id: str) -> None:
    db = session_db(hint_levels={"PZ_A": 2, "PZ_B": 2})

    with pytest.raises(NpcContentUnsafeError) as raised:
        await call(db, nudge(line_id))

    assert str(raised.value) == "PZ_B"
    assert_no_writes(db)


# --- 힌트 재표시 ---


@pytest.mark.anyio
@pytest.mark.parametrize("level", [1, 2])
async def test_reshows_only_requested_unlocked_level(level: int) -> None:
    db = session_db(hint_levels={"PZ_A": 2})
    before = deepcopy(db.get_result.state_json)

    result = await call(db, reshow("PZ_A", level))

    assert result.line is None
    assert result.reshown_hint.model_dump() == {
        "puzzle_id": "PZ_A",
        "level": level,
        "text": HINTS[(CASE_ID, "PZ_A", level)],
    }
    dumped = json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
    for key, text in HINTS.items():
        if key != (CASE_ID, "PZ_A", level):
            assert text not in dumped
    assert result.result.result_type == "hint_reshown"
    assert result.result.hint_level == level
    [event] = db.added
    assert event.interaction_type == NPC_HINT_RESHOWN_EVENT_TYPE
    assert event.target_id == "PZ_A"
    assert event.payload_json == {
        "npc_id": NPC_ID,
        "hint_level": level,
        "trigger": None,
    }
    assert db.get_result.state_json == before
    assert db.get_result.state_json["hint_levels"] == {"PZ_A": 2}


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("hint_levels", "level"), [({}, 1), ({"PZ_A": 0}, 1), ({"PZ_A": 1}, 2)]
)
async def test_locked_level_is_rejected_without_revealing_level(
    hint_levels: dict, level: int
) -> None:
    db = session_db(hint_levels)
    sources = Sources()

    with pytest.raises(HintNotUnlockedError) as raised:
        await call(db, reshow("PZ_A", level), sources)

    assert str(raised.value) == "PZ_A"
    assert (CASE_ID, "PZ_A", level) not in sources.hint_calls
    assert_no_writes(db)


@pytest.mark.anyio
async def test_other_puzzle_unlock_state_is_not_used() -> None:
    db = session_db(hint_levels={"PZ_B": 2})

    with pytest.raises(HintNotUnlockedError):
        await call(db, reshow("PZ_A", 1))

    assert_no_writes(db)


@pytest.mark.anyio
async def test_unknown_puzzle_and_missing_hint_fail_safely() -> None:
    db = session_db(hint_levels={"PZ_MISSING": 2})
    with pytest.raises(PuzzleNotFoundError):
        await call(db, reshow("PZ_MISSING", 1))
    assert_no_writes(db)

    db = session_db(hint_levels={"PZ_A": 2})
    with pytest.raises(HintNotFoundError):
        await call(db, reshow("PZ_A", 1), Sources(hints={}))
    assert_no_writes(db)


@pytest.mark.anyio
@pytest.mark.parametrize("trigger", [None, "player_command"])
async def test_trigger_is_recorded_but_never_authorizes(trigger: str | None) -> None:
    unlocked = session_db(hint_levels={"PZ_A": 2})
    result = await call(unlocked, reshow("PZ_A", 2, trigger=trigger))
    assert result.reshown_hint.level == 2
    assert unlocked.added[0].payload_json["trigger"] == trigger

    locked = session_db(hint_levels={"PZ_A": 1})
    with pytest.raises(HintNotUnlockedError):
        await call(locked, reshow("PZ_A", 2, trigger=trigger))


@pytest.mark.anyio
@pytest.mark.parametrize("level", [1, 2])
async def test_auto_help_offer_reshow_is_rejected_before_reading_hints(
    level: int,
) -> None:
    db = session_db(hint_levels={"PZ_A": 2})
    before = deepcopy(db.get_result.state_json)
    sources = Sources()

    with pytest.raises(NpcReshowNotAllowedError) as raised:
        await call(db, reshow("PZ_A", level, trigger="auto_help_offer"), sources)

    assert str(raised.value) == "PZ_A"
    assert sources.hint_calls == []
    assert_no_writes(db)
    assert db.get_result.state_json == before


@pytest.mark.anyio
async def test_auto_help_offer_still_gets_nudge() -> None:
    # 자동 도움 제안은 nudge로 돕는다. nudge 요청에는 trigger가 없고 원문도 없다.
    result = await call(
        session_db(hint_levels={"PZ_A": 2}), nudge("NUDGE_PZ_A", puzzle_id="PZ_A")
    )

    assert result.line is not None
    assert result.reshown_hint is None


@pytest.mark.anyio
@pytest.mark.parametrize("trigger", ["admin", "", "AUTO_HELP_OFFER", "player_command"])
async def test_no_trigger_value_bypasses_server_unlock_check(trigger: str) -> None:
    db = session_db(hint_levels={"PZ_A": 1, "PZ_B": 2})

    with pytest.raises(HintNotUnlockedError):
        await call(db, reshow("PZ_A", 2, trigger=trigger))

    assert_no_writes(db)


@pytest.mark.anyio
async def test_reshow_exception_covers_only_own_puzzle_answer() -> None:
    own = session_db(hint_levels={"PZ_A": 2})
    # PZ_A 2단계 원문에 PZ_A 정답이 들어 있어도 재표시한다.
    assert (await call(own, reshow("PZ_A", 2))).reshown_hint

    leaking = Sources(
        hints={**HINTS, (CASE_ID, "PZ_A", 1): "(가상) A 1단계 가상정답비"}
    )
    db = session_db(hint_levels={"PZ_A": 2})
    with pytest.raises(NpcContentUnsafeError) as raised:
        await call(db, reshow("PZ_A", 1), leaking)
    assert str(raised.value) == "PZ_B"
    assert_no_writes(db)


# --- 상태 · 이벤트 보장 ---


@pytest.mark.anyio
@pytest.mark.parametrize(
    "request_factory", [lambda: nudge(), lambda: reshow("PZ_A", 2)]
)
async def test_npc_never_changes_state_or_emits_hint_changes(request_factory) -> None:
    db = session_db(hint_levels={"PZ_A": 2})
    play_session = db.get_result
    before_state = deepcopy(play_session.state_json)
    before_updated = play_session.updated_at

    result = await call(db, request_factory())

    assert play_session.state_json == before_state
    assert play_session.updated_at == before_updated
    [event] = db.added
    assert event.response_json["state_changes"] == []
    assert "hint_level_changed" not in json.dumps(event.response_json)
    assert event.interaction_type != "unlock_hint"
    assert result.result.state_changes == []


@pytest.mark.anyio
async def test_events_and_logs_never_contain_approved_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    db = session_db(hint_levels={"PZ_A": 2})
    with caplog.at_level(logging.DEBUG):
        await call(db, nudge(event="e1"))
        await call(db, nudge("NUDGE_PZ_A", puzzle_id="PZ_A", event="e2"))
        await call(db, reshow("PZ_A", 1, event="e3"))
        await call(db, reshow("PZ_A", 2, event="e4"))

    assert len(db.added) == 4
    stored = json.dumps(
        [[e.payload_json, e.response_json, e.target_id] for e in db.added],
        ensure_ascii=False,
    )
    logged = "\n".join(record.getMessage() for record in caplog.records)
    for text in ALL_TEXTS:
        assert text not in stored
        assert text not in logged


# --- 멱등성 ---


async def first_event(request) -> tuple[Any, InteractionEvent]:
    db = session_db(hint_levels={"PZ_A": 2})
    result = await call(db, request)
    return result, db.added[0]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "request_factory", [lambda: nudge(), lambda: reshow("PZ_A", 2)]
)
async def test_replay_returns_same_result_without_new_event(request_factory) -> None:
    first, stored = await first_event(request_factory())

    db = ExpiringSession()
    db.get_result = make_play_session({"PZ_A": 2})
    db.scalar_result = stored
    replay = await call(db, request_factory())

    assert replay.npc_event_id == first.npc_event_id
    assert replay.result == first.result
    assert replay.line == first.line
    assert replay.reshown_hint == first.reshown_hint
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "different",
    [
        lambda: nudge("NUDGE_PZ_A", puzzle_id="PZ_A"),
        lambda: nudge(puzzle_id="PZ_A"),
        lambda: reshow("PZ_A", 1),
    ],
)
async def test_same_event_id_with_different_request_conflicts(different) -> None:
    _, stored = await first_event(nudge())
    db = session_db(hint_levels={"PZ_A": 2})
    db.scalar_result = stored

    with pytest.raises(IdempotencyConflictError):
        await call(db, different())

    assert_no_writes(db)


@pytest.mark.anyio
async def test_reshow_level_or_trigger_change_conflicts() -> None:
    _, stored = await first_event(reshow("PZ_A", 2))
    for different in (
        reshow("PZ_A", 1),
        reshow("PZ_A", 2, trigger="x"),
        reshow("PZ_B", 2),
    ):
        db = session_db(hint_levels={"PZ_A": 2, "PZ_B": 2})
        db.scalar_result = stored
        with pytest.raises(IdempotencyConflictError):
            await call(db, different)


@pytest.mark.anyio
async def test_hint_unlock_event_id_cannot_be_reused_by_npc() -> None:
    db = session_db(hint_levels={"PZ_A": 1})
    db.scalar_result = InteractionEvent(
        id="hint-event",
        play_session_id="play-session-id",
        client_event_id="e1",
        client_timestamp=None,
        interaction_type="unlock_hint",
        target_id="PZ_A",
        payload_json={"target_level": 1},
        result_type="hint_unlocked",
        response_json={},
        created_at=datetime(2026, 10, 27, 3, 0),
    )

    with pytest.raises(IdempotencyConflictError):
        await call(db, reshow("PZ_A", 1))


class RaceSession(FakeAsyncSession):
    async def scalar(self, statement):
        self.scalar_calls.append(statement)
        return None if len(self.scalar_calls) == 1 else self.scalar_result


@pytest.mark.anyio
async def test_integrity_race_replays_winner() -> None:
    winner, stored = await first_event(nudge())
    db = RaceSession()
    db.get_result = make_play_session()
    db.scalar_result = stored
    db.commit_error = IntegrityError("INSERT interaction_events", {}, RuntimeError())

    result = await call(db, nudge())

    assert result.npc_event_id == winner.npc_event_id
    assert result.line == winner.line
    assert db.rollback_count == 2


@pytest.mark.anyio
async def test_unrelated_integrity_error_is_raised() -> None:
    db = RaceSession()
    db.get_result = make_play_session()
    error = IntegrityError("INSERT interaction_events", {}, RuntimeError())
    db.commit_error = error

    with pytest.raises(IntegrityError) as raised:
        await call(db, nudge())

    assert raised.value is error


@pytest.mark.anyio
async def test_commit_failure_and_cancel_roll_back() -> None:
    db = session_db()
    db.commit_error = RuntimeError("commit failed")
    with pytest.raises(RuntimeError):
        await call(db, nudge())
    assert db.rollback_count == 1

    cancelled = session_db()

    def cancelling_line(case_id, npc_id, line_id):
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await process_npc_request(
            cancelled,
            "play-session-id",
            nudge(),
            line_source=cancelling_line,
            hint_source=Sources().hint,
            runtime_loader=load_runtime,
        )
    assert cancelled.rollback_count == 1
    assert cancelled.commit_count == 0


@pytest.mark.anyio
async def test_missing_play_session() -> None:
    db = FakeAsyncSession()
    with pytest.raises(PlaySessionNotFoundError):
        await call(db, nudge())
    assert db.scalar_calls == []


# --- 동시 요청 ---


class SharedEventStore:
    def __init__(self, hint_levels: dict) -> None:
        self.play_session = make_play_session(hint_levels)
        self.events: list[InteractionEvent] = []


class SharedSession(FakeAsyncSession):
    """세션마다 따로 커밋하고, 고유키(play_session_id, client_event_id)를 흉내 낸다."""

    def __init__(self, store: SharedEventStore) -> None:
        super().__init__()
        self.store = store

    async def get(self, model, entity_id, **options):
        self.get_options.append(options)
        await asyncio.sleep(0)
        return self.store.play_session

    async def scalar(self, statement):
        values = set(statement.compile().params.values())
        await asyncio.sleep(0)
        return next((e for e in self.store.events if e.client_event_id in values), None)

    async def commit(self) -> None:
        self.commit_count += 1
        await asyncio.sleep(0)
        for event in self.added:
            if any(
                e.client_event_id == event.client_event_id for e in self.store.events
            ):
                self.added = []
                raise IntegrityError("INSERT interaction_events", {}, RuntimeError())
        self.store.events.extend(self.added)
        self.added = []

    async def rollback(self) -> None:
        self.rollback_count += 1
        self.added = []


async def call_shared(store: SharedEventStore, request):
    sources = Sources()
    return await process_npc_request(
        SharedSession(store),
        "play-session-id",
        request,
        line_source=sources.line,
        hint_source=sources.hint,
        runtime_loader=load_runtime,
    )


@pytest.mark.anyio
async def test_concurrent_duplicate_requests_record_one_event() -> None:
    store = SharedEventStore({"PZ_A": 2})
    before = deepcopy(store.play_session.state_json)

    results = await asyncio.gather(
        *(call_shared(store, reshow("PZ_A", 2, event="same")) for _ in range(6))
    )

    assert len(store.events) == 1
    assert {r.npc_event_id for r in results} == {store.events[0].id}
    assert {r.reshown_hint.text for r in results} == {HINTS[(CASE_ID, "PZ_A", 2)]}
    assert store.play_session.state_json == before


@pytest.mark.anyio
async def test_concurrent_distinct_requests_record_each_without_state_change() -> None:
    store = SharedEventStore({"PZ_A": 2})
    before = deepcopy(store.play_session.state_json)
    requests = [nudge(event=f"n{i}") for i in range(3)] + [
        reshow("PZ_A", 1 + i % 2, event=f"r{i}") for i in range(3)
    ]

    await asyncio.gather(*(call_shared(store, request) for request in requests))

    assert sorted(e.client_event_id for e in store.events) == sorted(
        r.client_event_id for r in requests
    )
    assert store.play_session.state_json == before
