"""격리 MySQL에서 상황 대사 쿨다운 · 횟수의 저장 · 재시작 유지 · 동시 요청을 검증한다(계약 v0.4.16 §8).

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`: 3306이 아닌 전용
포트 · `test_npc_idem_` 접두 빈 DB · 실제 datadir 대조, 끝나면 모든 테이블을 지운다).
실제 `process_npc_turn` · `load_session_events`로 판단하고 이벤트는 실제 테이블에 쓴다. 가상 콘텐츠 · 승인이다.
"""

import asyncio
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.interaction_event import InteractionEvent
from app.schemas.npc_turn import NpcTurnRequest
from app.services.npc_situation import COOLDOWN, GLOBAL_GAP, QUIET_LIMIT
from app.services.npc_turn_service import process_npc_turn
from app.services.pinned_content import PinnedContentStore
from tests.test_npc_situation_turn import general_nudges, situations
from tests.test_npc_suggestion_events_mysql import CASE_APPROVAL, seed_session
from tests.test_npc_turn import bundle
from tests.test_npc_turn_idempotency_mysql import T0, mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)


def new_store() -> PinnedContentStore:
    """서버를 새로 띄운 것처럼 매번 빈 메모리 저장소에 같은 게시 묶음을 넣는다."""

    store = PinnedContentStore()
    store.add(bundle(situations=situations(), general_nudges=general_nudges()))
    return store


async def situation_turn(
    sessions, session_id: str, code: str, at, *, client_event_id=None, store=None
):
    async with sessions() as db:
        response = await process_npc_turn(
            db,
            session_id,
            NpcTurnRequest(
                client_event_id=client_event_id or uuid4(),
                trigger="auto",
                situation={"code": code},
            ),
            store=store or new_store(),
            approval_source=CASE_APPROVAL,
            now=at,
        )
    async with sessions() as db:
        record = (
            await db.get(InteractionEvent, str(response.npc_event_id))
        ).response_json
    return response, record


async def npc_rows(sessions, session_id: str) -> list[InteractionEvent]:
    async with sessions() as db:
        return list(
            (
                await db.execute(
                    select(InteractionEvent).where(
                        InteractionEvent.play_session_id == session_id,
                        InteractionEvent.interaction_type == "npc_turn",
                    )
                )
            ).scalars()
        )


def test_mysql_cooldowns_and_quiet_limit_survive_restart():
    async def scenario(sessions):
        session_id = await seed_session(sessions)

        first, record = await situation_turn(sessions, session_id, "SENT_BACK", T0)
        assert first.reply.line_id == "SIT_SENT_BACK_01"
        assert first.suggest_hint is None
        assert record["situation_replied"] is True
        # 저장 시각 = 판정 시각
        rows = await npc_rows(sessions, session_id)
        assert [row.created_at for row in rows] == [T0]

        # 새 저장소(재시작)여도 DB 이력으로 막는다.
        gap, record = await situation_turn(
            sessions, session_id, "BREATH_LOW", T0 + timedelta(seconds=19)
        )
        assert gap.reply is None and record["situation_reason"] == GLOBAL_GAP
        cool, record = await situation_turn(
            sessions, session_id, "SENT_BACK", T0 + timedelta(seconds=59)
        )
        assert cool.reply is None and record["situation_reason"] == COOLDOWN
        ready, _ = await situation_turn(
            sessions, session_id, "SENT_BACK", T0 + timedelta(seconds=60)
        )
        assert ready.reply is not None

        # QUIET: 180초 간격으로 5회까지, 6번째는 상한
        start = T0 + timedelta(seconds=300)
        lines = []
        for index in range(5):
            quiet, record = await situation_turn(
                sessions, session_id, "QUIET", start + timedelta(seconds=180 * index)
            )
            lines.append(quiet.reply.line_id)
        capped, record = await situation_turn(
            sessions, session_id, "QUIET", start + timedelta(seconds=180 * 6)
        )
        assert capped.reply is None and record["situation_reason"] == QUIET_LIMIT
        assert lines == ["NUDGE_GENERAL_01"] * 5
        assert len(await npc_rows(sessions, session_id)) == 10

    mysql_run(scenario)


def test_mysql_concurrent_new_turns_cannot_bypass_cooldown():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        at = T0 + timedelta(seconds=1)

        results = await asyncio.gather(
            *(situation_turn(sessions, session_id, "SENT_BACK", at) for _ in range(6))
        )

        replied = [response for response, _ in results if response.reply is not None]
        assert len(replied) == 1
        reasons = sorted(
            record["situation_reason"]
            for _, record in results
            if not record["situation_replied"]
        )
        assert reasons == [GLOBAL_GAP] * 5
        assert len(await npc_rows(sessions, session_id)) == 6

    mysql_run(scenario)


def test_mysql_concurrent_quiet_turns_cannot_exceed_the_session_limit():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        for index in range(4):
            quiet, _ = await situation_turn(
                sessions, session_id, "QUIET", T0 + timedelta(seconds=200 * index)
            )
            assert quiet.reply is not None

        later = T0 + timedelta(seconds=5000)
        results = await asyncio.gather(
            *(situation_turn(sessions, session_id, "QUIET", later) for _ in range(5))
        )

        assert sum(1 for response, _ in results if response.reply is not None) == 1
        replied = [
            row
            for row in await npc_rows(sessions, session_id)
            if row.response_json.get("situation_replied")
        ]
        assert len(replied) == 5

    mysql_run(scenario)


def test_mysql_concurrent_same_event_is_stored_once_and_replayed():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        event_id = uuid4()
        at = T0 + timedelta(seconds=1)

        results = await asyncio.gather(
            *(
                situation_turn(
                    sessions, session_id, "NO_PROGRESS", at, client_event_id=event_id
                )
                for _ in range(4)
            )
        )

        responses = [response for response, _ in results]
        assert all(response == responses[0] for response in responses)
        assert responses[0].reply.line_id == "SIT_NO_PROGRESS_01"
        assert len(await npc_rows(sessions, session_id)) == 1

    mysql_run(scenario)
