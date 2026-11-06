"""Real row locks and atomic effects, only on the explicitly isolated test DB."""

import asyncio
import os
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services.pinned_content import ContentPin, PinnedContent, PinnedContentStore
from tests.client_skill_case import CASE, OTHER_ZONE, body, models, state
from tests.test_hint_balance_mysql import Api, new_anonymous
from tests.test_npc_turn_idempotency_mysql import T0, mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)
FP = "sha256:" + "7" * 64


def store():
    client, server = models()
    result = PinnedContentStore()
    result.add(
        PinnedContent(
            ContentPin(CASE, 1, FP), client=client, server=server, npc=None, idmap=None
        )
    )
    return result


async def seed(sessions):
    anonymous_id = await new_anonymous(sessions)
    session_id = str(uuid4())
    async with sessions() as db, db.begin():
        db.add(
            PlaySession(
                id=session_id,
                anonymous_session_id=anonymous_id,
                case_id=CASE,
                state_json=state(),
                created_at=T0,
                updated_at=T0,
                completed_at=None,
                content_version=1,
                content_fingerprint=FP,
                hint_balance=4,
                help_used=1,
            )
        )
    return session_id


async def snapshot(sessions, session_id):
    async with sessions() as db:
        row = await db.get(PlaySession, session_id)
        events = (
            await db.scalars(
                select(InteractionEvent).where(
                    InteractionEvent.play_session_id == session_id
                )
            )
        ).all()
        return (
            deepcopy(row.state_json),
            row.completed_at,
            row.help_used,
            row.hint_balance,
            [(e.id, e.interaction_type, e.target_id, e.payload_json) for e in events],
        )


async def post(api, session_id, request):
    return await api.client.post(
        f"/api/v1/play-sessions/{session_id}/interactions", json=request
    )


@pytest.mark.parametrize("same_event", [True, False])
def test_mysql_concurrent_completion_and_replay_never_duplicate_effects(same_event):
    async def scenario(sessions):
        session_id = await seed(sessions)
        first = body()
        second = first if same_event else body()
        async with Api(sessions, store()) as api:
            responses = await asyncio.gather(
                post(api, session_id, first), post(api, session_id, second)
            )
            assert all(r.status_code == 200 for r in responses)
            if same_event:
                assert responses[0].json() == responses[1].json()
            else:
                assert {r.json()["result_type"] for r in responses} == {
                    "correct",
                    "already_completed",
                }
            replay = await post(api, session_id, first)
            assert replay.json() == responses[0].json()
        saved, completed_at, help_used, balance, events = await snapshot(
            sessions, session_id
        )
        assert saved["completed_puzzle_ids"] == ["SKILL_A"]
        assert saved["acquired_clue_ids"] == ["CL_TEST"]
        assert saved["acquired_item_ids"] == ["ITEM_TEST"]
        assert saved["attempt_counts"] == {"SKILL_A": 1}
        assert saved["hint_levels"] == {"SKILL_A": 1}
        assert (help_used, balance, completed_at) == (1, 4, None)
        assert len(events) == (1 if same_event else 2)
        assert all(e[1:3] == ("complete", "OBJ_A") for e in events)

    mysql_run(scenario)


def test_mysql_full_body_conflict_and_mixed_steps_keep_puzzle_records():
    async def scenario(sessions):
        session_id = await seed(sessions)
        async with Api(sessions, store()) as api:
            assert (await post(api, session_id, body("OBJ_B"))).status_code == 409
            request = body()
            first = await post(api, session_id, request)
            for patch in (
                {"zone_id": OTHER_ZONE},
                {"target_id": "OBJ_B"},
                {"client_timestamp": "2026-11-04T13:00:00+09:00"},
            ):
                response = await post(api, session_id, {**request, **patch})
                assert response.status_code == 409
                assert "conflicts" in response.json()["detail"]
            second_request = body("OBJ_B")
            second = await post(api, session_id, second_request)
            assert second.status_code == 200
            saved = await snapshot(sessions, session_id)
            assert saved[0]["consumed_item_ids"] == ["ITEM_TEST"]
            assert saved[0]["completed_puzzle_ids"] == ["SKILL_A", "SKILL_B"]
            assert saved[0]["attempt_counts"] == {"SKILL_A": 1, "SKILL_B": 1}
            assert saved[1] is not None
            assert (await post(api, session_id, second_request)).json() == second.json()
            assert (await post(api, session_id, body("OBJ_B"))).json()[
                "state_changes"
            ] == []
            assert (await snapshot(sessions, session_id))[1] == saved[1]
            # Replay remains valid even after moving to another Zone.
            async with sessions() as db, db.begin():
                row = await db.get(PlaySession, session_id)
                row.state_json = {**row.state_json, "current_zone_id": OTHER_ZONE}
            assert (await post(api, session_id, request)).json() == first.json()
        final = await snapshot(sessions, session_id)
        assert final[0]["hint_levels"] == {"SKILL_A": 1}
        assert final[2:4] == (1, 4)

    mysql_run(scenario)


def test_mysql_failed_event_insert_rolls_back_effects_then_retry_succeeds():
    async def scenario(sessions):
        session_id = await seed(sessions)
        before = await snapshot(sessions, session_id)
        engine = sessions.kw["bind"]

        def reject_insert(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("INSERT INTO INTERACTION_EVENTS"):
                raise RuntimeError("synthetic event persistence failure")

        async with Api(sessions, store()) as api:
            request = body()
            event.listen(engine.sync_engine, "before_cursor_execute", reject_insert)
            try:
                with pytest.raises(
                    RuntimeError, match="synthetic event persistence failure"
                ):
                    await post(api, session_id, request)
            finally:
                event.remove(engine.sync_engine, "before_cursor_execute", reject_insert)
            assert await snapshot(sessions, session_id) == before
            assert (await post(api, session_id, request)).status_code == 200
        saved = await snapshot(sessions, session_id)
        assert saved[0]["attempt_counts"] == {"SKILL_A": 1}
        assert len(saved[4]) == 1

    mysql_run(scenario)
