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
from app.services.npc_case_access import CaseNpcAccess
from app.services.npc_situation import (
    COOLDOWN,
    GLOBAL_GAP,
    QUIET_LIMIT,
    QUIET_PUZZLE_COOLDOWN,
)
from app.services.npc_suggestion_events import (
    SuggestionNotFoundError,
    record_suggestion_event,
)
from app.services.npc_turn_service import process_npc_turn
from app.services.pinned_content import PinnedContentStore
from tests.pack_policy_stub import passing_test_policy
from tests.test_npc_generic_pause import pack_approval, pause_pack
from tests.test_npc_situation_turn import general_nudges, situations
from tests.test_npc_suggestion_events_mysql import (
    CASE_APPROVAL,
    seed_session,
    suggestion_rows,
    wrong_answers,
)
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


# --- 퍼즐 자동 개입 제안 보고(`record_suggestion_event`)와의 경계 ---


async def puzzle_turn(sessions, session_id: str, at, *, case_access=None, **extra):
    options = (
        {"case_access": case_access}
        if case_access
        else {"approval_source": CASE_APPROVAL}
    )
    async with sessions() as db:
        response = await process_npc_turn(
            db,
            session_id,
            NpcTurnRequest(
                client_event_id=uuid4(), trigger="auto", focus_object_id="OBJ_CABINET"
            ),
            store=new_store(),
            now=at,
            **options,
            **extra,
        )
    async with sessions() as db:
        record = (
            await db.get(InteractionEvent, str(response.npc_event_id))
        ).response_json
    return response, record


async def report(sessions, session_id, event_id, kind, at):
    async with sessions() as db:
        return await record_suggestion_event(
            db,
            session_id,
            suggestion_id=str(event_id),
            kind=kind,
            client_event_id=str(uuid4()),
            now=at,
        )


def test_mysql_only_puzzle_suggestions_are_reportable():
    async def scenario(sessions):
        session_id = await seed_session(sessions)

        situation, record = await situation_turn(sessions, session_id, "BREATH_LOW", T0)
        assert situation.reply is not None and record["auto_intervened"] is False

        pack = pause_pack()

        async def blocked(db, pin, *, lock):
            return CaseNpcAccess(None, withdrawn=True, basis=("blocked",))

        pause, record = await puzzle_turn(
            sessions,
            session_id,
            T0 + timedelta(seconds=30),
            case_access=blocked,
            general_pack=pack,
            general_pack_approval=pack_approval(pack),
            general_pack_policy=passing_test_policy,
        )
        assert pause.reply.line_id.startswith("GENERIC_PAUSE_")
        # 긴급 차단의 「잠시 멈춤」 대사는 퍼즐 제안이 아니다.
        assert record["auto_intervened"] is False

        for event_id in (situation.npc_event_id, pause.npc_event_id, uuid4()):
            for kind in ("shown", "suppressed", "declined"):
                with pytest.raises(SuggestionNotFoundError):
                    await report(
                        sessions, session_id, event_id, kind, T0 + timedelta(seconds=40)
                    )
        assert await suggestion_rows(sessions, session_id) == 0

    mysql_run(scenario)


def test_mysql_puzzle_reports_gate_quiet_but_not_other_situations():
    async def scenario(sessions):
        session_id = await seed_session(sessions)
        await wrong_answers(sessions, session_id)

        offer, record = await puzzle_turn(
            sessions, session_id, T0 + timedelta(seconds=1)
        )
        assert offer.reply.line_id == "NUDGE_A_01" and record["auto_intervened"] is True
        shown_at = T0 + timedelta(seconds=2)
        await report(sessions, session_id, offer.npc_event_id, "shown", shown_at)

        # 표시된 퍼즐 제안 뒤 180초 안에는 잡담하지 않는다(§8-4). 다른 상황 코드는 막지 않는다.
        quiet, record = await situation_turn(
            sessions, session_id, "QUIET", shown_at + timedelta(seconds=10)
        )
        assert quiet.reply is None
        assert record["situation_reason"] == QUIET_PUZZLE_COOLDOWN
        breath, _ = await situation_turn(
            sessions, session_id, "BREATH_LOW", shown_at + timedelta(seconds=11)
        )
        assert breath.reply is not None

        # 상황 대사는 퍼즐 제안 횟수 · 쿨다운을 쓰지 않는다: 180초 뒤 퍼즐 개입은 그대로 나온다.
        again, record = await puzzle_turn(
            sessions, session_id, shown_at + timedelta(seconds=180)
        )
        assert again.reply is not None and record["auto_intervened"] is True
        quiet, _ = await situation_turn(
            sessions, session_id, "QUIET", shown_at + timedelta(seconds=181)
        )
        assert quiet.reply is not None

        # 거절은 600초 동안 잡담을 막는다(재시작해도 DB 기록으로).
        declined_at = shown_at + timedelta(seconds=200)
        await report(sessions, session_id, offer.npc_event_id, "declined", declined_at)
        held, record = await situation_turn(
            sessions, session_id, "QUIET", declined_at + timedelta(seconds=400)
        )
        assert held.reply is None
        assert record["situation_reason"] == QUIET_PUZZLE_COOLDOWN

    mysql_run(scenario)
