"""격리 MySQL에서 자동 개입 제안 표시 · 미표시 · 거절 기록과 횟수 · 쿨다운(PM v0.4.7)을 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
실제 `process_npc_turn` · `load_session_events`로 판단하고, 이벤트는 실제 테이블에 쓴다.
"""

import asyncio
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.npc_turn import NpcTurnRequest
from app.services.interaction import IdempotencyConflictError
from app.services.npc_suggestion_events import (
    SuggestionEventConflictError,
    SuggestionNotFoundError,
    record_suggestion_event,
)
from app.services.npc_turn_service import process_npc_turn
from app.services.pinned_content import PinnedContentStore
from tests.test_npc_turn import FP, approved, bundle
from tests.test_npc_turn_idempotency_mysql import T0, mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

# 가상 테스트 콘텐츠 · 승인(운영 값이 아니다)
STORE = PinnedContentStore()
STORE.add(bundle())
CASE_APPROVAL = approved(("case_test", 1), FP).source()
STATE = {
    "current_zone_id": "ZONE_A",
    "completed_puzzle_ids": ["PZ_DONE"],
    "completed_inspect_ids": [],
    "acquired_clue_ids": ["CLUE_LETTER"],
    "hint_levels": {},
    "attempt_counts": {},
    "flags": {},
    "object_states": {},
}


async def seed_session(sessions) -> str:
    anonymous_id, session_id = str(uuid4()), str(uuid4())
    async with sessions() as db, db.begin():
        db.add(AnonymousSession(id=anonymous_id, created_at=T0, expires_at=T0))
        await db.flush()
        db.add(
            PlaySession(
                id=session_id,
                anonymous_session_id=anonymous_id,
                case_id="case_test",
                state_json=dict(STATE),
                created_at=T0,
                updated_at=T0,
                completed_at=None,
                content_version=1,
                content_fingerprint=FP,
            )
        )
    return session_id


async def wrong_answers(sessions, session_id: str, count: int = 6) -> None:
    async with sessions() as db, db.begin():
        for index in range(count):
            db.add(
                InteractionEvent(
                    id=str(uuid4()),
                    play_session_id=session_id,
                    client_event_id=str(uuid4()),
                    client_timestamp=None,
                    interaction_type="submit_answer",
                    target_id="PZ_A",
                    payload_json={},
                    result_type="incorrect",
                    response_json={},
                    created_at=T0 - timedelta(seconds=count - index),
                )
            )


async def auto_turn(sessions, session_id: str, at):
    async with sessions() as db:
        response = await process_npc_turn(
            db,
            session_id,
            NpcTurnRequest(
                client_event_id=uuid4(), trigger="auto", focus_object_id="OBJ_CABINET"
            ),
            store=STORE,
            approval_source=CASE_APPROVAL,
            now=at,
        )
    async with sessions() as db:
        record = (
            await db.get(InteractionEvent, str(response.npc_event_id))
        ).response_json
    return response, record


async def report(sessions, session_id, suggestion, kind, at, client_event_id=None):
    async with sessions() as db:
        return await record_suggestion_event(
            db,
            session_id,
            suggestion_id=str(suggestion.npc_event_id),
            kind=kind,
            client_event_id=client_event_id or str(uuid4()),
            now=at,
        )


async def suggestion_rows(sessions, session_id: str) -> int:
    async with sessions() as db:
        return (
            await db.execute(
                select(func.count())
                .select_from(InteractionEvent)
                .where(
                    InteractionEvent.play_session_id == session_id,
                    InteractionEvent.interaction_type.like("npc_suggestion_%"),
                )
            )
        ).scalar_one()


def test_mysql_only_shown_suggestions_count_and_start_the_180s_cooldown():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        await wrong_answers(sessions, session_id)

        first, record = await auto_turn(sessions, session_id, T0 + timedelta(seconds=1))
        assert first.reply.line_id == "NUDGE_A_01"
        assert record["auto_intervene"]["level"] == 1
        # 표시 보고가 없는 제안은 횟수 · 쿨다운을 소모하지 않는다.
        again, _ = await auto_turn(sessions, session_id, T0 + timedelta(seconds=2))
        assert again.reply is not None

        shown_at = T0 + timedelta(seconds=3)
        await report(sessions, session_id, first, "shown", shown_at)
        quiet, record = await auto_turn(
            sessions, session_id, shown_at + timedelta(seconds=179)
        )
        assert quiet.reply is None and record["decision"]["reason"] == "cooldown"

        second_at = shown_at + timedelta(seconds=180)
        second, _ = await auto_turn(sessions, session_id, second_at)
        assert second.reply is not None
        await report(sessions, session_id, second, "shown", second_at)

        # 같은 퍼즐 표시 2회 → 상한(세션당 상한은 없음)
        capped, record = await auto_turn(
            sessions, session_id, second_at + timedelta(seconds=181)
        )
        assert capped.reply is None and record["decision"]["reason"] == "policy_blocked"

    mysql_run(scenario)


def test_mysql_suppressed_is_free_and_decline_starts_600s_cooldown():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        await wrong_answers(sessions, session_id)

        offer, _ = await auto_turn(sessions, session_id, T0 + timedelta(seconds=1))
        await report(
            sessions, session_id, offer, "suppressed", T0 + timedelta(seconds=2)
        )
        retry, _ = await auto_turn(sessions, session_id, T0 + timedelta(seconds=3))
        assert retry.reply is not None  # 미표시는 쿨다운 없음

        await report(sessions, session_id, retry, "shown", T0 + timedelta(seconds=4))
        declined_at = T0 + timedelta(seconds=5)
        await report(sessions, session_id, retry, "declined", declined_at)

        # 표시 쿨다운(180초)이 지나도 거절 쿨다운(600초) 안이면 제안하지 않는다.
        held, record = await auto_turn(
            sessions, session_id, declined_at + timedelta(seconds=300)
        )
        assert held.reply is None
        assert record["decision"]["reason"] == "declined_cooldown"
        resumed, _ = await auto_turn(
            sessions, session_id, declined_at + timedelta(seconds=600)
        )
        assert resumed.reply is not None

    mysql_run(scenario)


def test_mysql_suggestion_reports_are_deduplicated_and_transitions_enforced():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        await wrong_answers(sessions, session_id)
        offer, _ = await auto_turn(sessions, session_id, T0 + timedelta(seconds=1))
        other, _ = await auto_turn(sessions, session_id, T0 + timedelta(seconds=2))

        first = await report(
            sessions,
            session_id,
            offer,
            "shown",
            T0,
            "aaaaaaaa-0000-4000-8000-000000000001",
        )
        # 같은 보고를 다른 client_event_id로 다시 받아도 새 행을 만들지 않는다.
        again = await report(sessions, session_id, offer, "shown", T0)
        same_client = await report(
            sessions,
            session_id,
            offer,
            "shown",
            T0,
            "aaaaaaaa-0000-4000-8000-000000000001",
        )
        assert (first.duplicate, again.duplicate, same_client.duplicate) == (
            False,
            True,
            True,
        )
        assert again.event_id == first.event_id == same_client.event_id
        assert await suggestion_rows(sessions, session_id) == 1

        with pytest.raises(SuggestionEventConflictError):
            await report(
                sessions, session_id, offer, "suppressed", T0
            )  # shown 뒤 미표시
        with pytest.raises(SuggestionEventConflictError):
            await report(sessions, session_id, other, "declined", T0)  # 표시 전 거절
        with pytest.raises(IdempotencyConflictError):
            await report(
                sessions,
                session_id,
                other,
                "shown",
                T0,
                "aaaaaaaa-0000-4000-8000-000000000001",
            )  # 같은 client_event_id로 다른 보고

        # 자동 개입 제안이 아닌 ID · 다른 세션의 제안은 받지 않는다.
        other_session = await seed_session(sessions)
        with pytest.raises(SuggestionNotFoundError):
            await report(sessions, other_session, offer, "shown", T0)

        # 동시에 같은 보고가 여러 번 와도 한 행만 남는다.
        results = await asyncio.gather(
            *(report(sessions, session_id, other, "shown", T0) for _ in range(5))
        )
        assert sum(not r.duplicate for r in results) == 1
        assert await suggestion_rows(sessions, session_id) == 2

    mysql_run(scenario)
