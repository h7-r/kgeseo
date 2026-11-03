"""명시적으로 격리 확인된 빈 테스트 DB에서만 긴급 중단 대체 대사(PM v0.4.12)를 HTTP로 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
일반 팩은 테스트 전용 가상 팩이며 의존성 대역으로만 공급한다(실제 PM 문장 · 운영 승인 기록이 아니다).
"""

import asyncio
import json
import os

import pytest

from app.api.v1.npc import get_general_line_pack
from app.main import app
from app.services.npc_line_supply import PAUSE_LINE_PREFIX, select_pause_line
from app.services.npc_publication import NpcPublicationService
from tests.test_content_release_mysql import mysql_run
from tests.test_npc_case_access_mysql import (
    APPROVED_REPLY,
    WITHDRAWN,
    Http,
    approve,
    body,
    event_count,
    new_session,
    paused_reader,
    publish_state,
)
from tests.test_npc_generic_pause import pack_approval, pause_pack
from tests.test_npc_turn import NUDGE_A

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

PACK = pause_pack()


def expected(request: dict):
    return select_pause_line(PACK, pack_approval(PACK), request["client_event_id"])


class PausePack:
    def __enter__(self):
        app.dependency_overrides[get_general_line_pack] = lambda: (
            PACK,
            pack_approval(PACK),
        )

    def __exit__(self, *exc):
        app.dependency_overrides.pop(get_general_line_pack, None)


def test_mysql_block_during_turn_answers_with_pause_line():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        reader, entered, proceed = paused_reader(before_read=True)
        service = NpcPublicationService(sessions)
        request = body()
        with PausePack():
            async with Http(sessions, reader) as http:
                turn = asyncio.create_task(http.turn(session_id, request))
                try:
                    await asyncio.wait_for(entered.wait(), timeout=30)
                    await asyncio.wait_for(
                        service.block("case_test", 1, reason="(가상) 긴급", actor="op"),
                        timeout=30,
                    )
                finally:
                    proceed.set()
                response = await asyncio.wait_for(turn, timeout=30)
                replay = await http.turn(session_id, request)

        line = expected(request)
        assert response["reply"] == {
            "source": "approved_line",
            "text": line.text,
            "line_id": line.line_id,
        }
        assert response["fallback_reason"] == WITHDRAWN
        assert replay == response

    mysql_run(scenario)


def test_mysql_resend_after_block_never_shows_the_case_line():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        request = body()
        with PausePack():
            async with Http(sessions) as http:
                before = await http.turn(session_id, request)
                await NpcPublicationService(sessions).block(
                    "case_test", 1, reason="(가상) 긴급", actor="op"
                )
                again = await http.turn(session_id, request)

        assert before["reply"] == APPROVED_REPLY
        assert again["reply"]["line_id"] == expected(request).line_id
        assert again["reply"]["line_id"].startswith(PAUSE_LINE_PREFIX)
        assert NUDGE_A not in json.dumps(again, ensure_ascii=False)
        assert again["fallback_reason"] == WITHDRAWN
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


def test_mysql_duplicate_requests_while_blocked_record_one_event():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        await NpcPublicationService(sessions).block(
            "case_test", 1, reason="(가상) 긴급", actor="op"
        )
        request = body()
        with PausePack():
            async with Http(sessions) as http:
                responses = await asyncio.gather(
                    *(http.turn(session_id, request) for _ in range(4))
                )

        assert all(r == responses[0] for r in responses)
        assert responses[0]["reply"]["line_id"] == expected(request).line_id
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


def test_mysql_blocked_without_pack_keeps_null_reply():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        await NpcPublicationService(sessions).block(
            "case_test", 1, reason="(가상) 긴급", actor="op"
        )
        async with Http(sessions) as http:  # 운영 기본값: 일반 팩 공급 없음
            response = await http.turn(session_id, body())

        assert (response["reply"], response["fallback_reason"]) == (None, WITHDRAWN)

    mysql_run(scenario)
