"""격리 MySQL + 실제 NPC 라우터로 자동 개입 nudge 선택(PM 11/10 요청)을 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
승인 기록 · 게시 상태 · 콘텐츠는 가상 데이터다. 판정은 운영 `read_case_npc_access`(DB)로 한다.

- 같은 회차(play session)에서 반환한 nudge 는 다시 고르지 않는다(기존 npc_turn 기록 재사용, 새 테이블 없음).
- 후보가 다 쓰이면 reply null(`auto_nudges_exhausted`) — 같은 줄을 반복하지 않는다.
- 같은 client_event_id 재시도는 같은 결과이고 후보를 더 쓰지 않는다.
- 회차마다 이력은 따로다.
- 같은 회차의 동시 auto 턴은 세션 행 잠금으로 직렬화돼 같은 줄을 두 번 내지 않는다.
- 잠금 순서는 승인 · 게시(공유) → 세션이다(플레이어 메시지 턴과 같은 순서).
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from app.api.v1.npc import get_npc_case_access_reader
from app.db.session import get_db
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services.npc_publication import NpcPublicationService
from app.services.pinned_content import PinnedContentStore
from app.services.session_content import get_pinned_content_store
from tests.test_npc_case_access_mysql import approve, paused_reader, publish_state
from tests.test_npc_suggestion_events_mysql import STATE
from tests.test_npc_turn import FP, bundle
from tests.test_npc_turn_idempotency_mysql import mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

STUCK, HELP, WRONG, ARRIVE = (
    "NUDGE_PZ_A_STUCK_1_J",
    "NUDGE_PZ_A_HELP_1_J",
    "NUDGE_PZ_A_WRONG_1_J",
    "NUDGE_PZ_A_ARRIVE_1_J",
)
PUZZLES = [
    {
        "puzzle_id": "PZ_A",
        # 팩 파일 순서는 일부러 선택 순서와 다르게 둔다(ARRIVE 가 맨 앞).
        "nudges": [
            {
                "line_id": line_id,
                "text": f"(가상) {line_id}",
                "reveal_when": {"always": True},
            }
            for line_id in (ARRIVE, HELP, WRONG, STUCK)
        ],
        "hints": [{"level": 1}, {"level": 2}],
    }
]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def seed_session(sessions, *, idle_seconds=300, wrong=0) -> str:
    """마지막 플레이어 이벤트가 idle_seconds 전인 세션(연속 오답 wrong 회)."""

    anonymous_id, session_id = str(uuid4()), str(uuid4())
    now = _now()
    async with sessions() as db, db.begin():
        db.add(AnonymousSession(id=anonymous_id, created_at=now, expires_at=now))
        await db.flush()
        db.add(
            PlaySession(
                id=session_id,
                anonymous_session_id=anonymous_id,
                case_id="case_test",
                state_json=dict(STATE),
                created_at=now,
                updated_at=now,
                completed_at=None,
                content_version=1,
                content_fingerprint=FP,
            )
        )
        await db.flush()
        for index in range(max(wrong, 1)):
            db.add(
                InteractionEvent(
                    id=str(uuid4()),
                    play_session_id=session_id,
                    client_event_id=str(uuid4()),
                    client_timestamp=None,
                    # wrong=0 이면 오답이 아닌 플레이어 행동 1건(무입력 기준점)
                    interaction_type="submit_answer" if wrong else "inspect",
                    target_id="PZ_A" if wrong else "INSPECT_X",
                    payload_json={},
                    result_type="incorrect" if wrong else "ok",
                    response_json={},
                    created_at=now
                    - timedelta(seconds=idle_seconds + max(wrong, 1) - index),
                )
            )
    return session_id


class Http:
    def __init__(self, sessions, reader=None) -> None:
        self.sessions = sessions
        self.store = PinnedContentStore()
        self.store.add(bundle(puzzles=PUZZLES))
        self.reader = reader

    async def __aenter__(self):
        async def override_get_db():
            async with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_pinned_content_store] = lambda: self.store
        if self.reader is not None:
            app.dependency_overrides[get_npc_case_access_reader] = lambda: self.reader
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        return self

    async def __aexit__(self, *exc):
        await self.client.aclose()
        for dependency in (
            get_db,
            get_pinned_content_store,
            get_npc_case_access_reader,
        ):
            app.dependency_overrides.pop(dependency, None)

    async def auto(self, session_id: str, event_id: str | None = None) -> dict:
        response = await self.client.post(
            f"/api/v1/play-sessions/{session_id}/npc/turns",
            json={
                "client_event_id": event_id or str(uuid4()),
                "trigger": "auto",
                "focus_object_id": "OBJ_CABINET",
            },
        )
        assert response.status_code == 200, response.text
        return response.json()


async def records(sessions, session_id: str) -> list[dict]:
    async with sessions() as db:
        rows = (
            await db.execute(
                select(InteractionEvent.response_json)
                .where(
                    InteractionEvent.play_session_id == session_id,
                    InteractionEvent.interaction_type == "npc_turn",
                )
                .order_by(InteractionEvent.created_at)
            )
        ).scalars()
        return list(rows)


def line(body: dict) -> str | None:
    return body["reply"]["line_id"] if body["reply"] else None


async def ready(sessions) -> None:
    await approve(sessions)
    await publish_state(sessions)


def test_mysql_idle_uses_stuck_then_help_then_stops_without_repeating():
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions)
        async with Http(sessions) as http:
            got = [line(await http.auto(session_id)) for _ in range(4)]
        assert got == [STUCK, HELP, None, None]
        stored = await records(sessions, session_id)
        assert [r["line_id"] for r in stored] == got
        assert [r["decision"]["reason"] for r in stored] == ["idle_too_long"] * 4
        assert [r["decision"]["intervention_level"] for r in stored] == [1] * 4
        assert [r["no_reply_reason"] for r in stored[2:]] == [
            "auto_nudges_exhausted"
        ] * 2
        assert all(r["auto_intervened"] is False for r in stored[2:])

    mysql_run(scenario)


def test_mysql_repeated_incorrect_uses_wrong_then_help_never_arrive():
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions, idle_seconds=5, wrong=6)
        async with Http(sessions) as http:
            got = [line(await http.auto(session_id)) for _ in range(3)]
        # 승인 nudge 소진 뒤 연속 오답은 기존 정책대로 2단계(힌트 안내)로 넘어간다 — 가상 콘텐츠에는 서버
        # 힌트가 있으므로 일반 안내 줄이 나올 수 있다. nudge 는 WRONG → HELP 만, ARRIVE 는 없다.
        assert got[:2] == [WRONG, HELP]
        assert ARRIVE not in got and STUCK not in got
        stored = await records(sessions, session_id)
        assert [r["decision"]["reason"] for r in stored] == ["repeated_incorrect"] * 3

    mysql_run(scenario)


async def add_wrong_answers(sessions, session_id: str, count: int = 6) -> None:
    now = _now()
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
                    created_at=now - timedelta(seconds=count - index),
                )
            )


def test_mysql_same_puzzle_lines_are_not_reused_across_reasons():
    # 미르님 11/10: 같은 회차 · 같은 퍼즐에서 반환한 줄은 사유가 바뀌어도 다시 고르지 않는다.
    # (서버 판단은 연속 오답을 무입력보다 먼저 보므로, 실제 흐름에서 생기는 순서는 무입력 → 오답이다.)
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions)
        async with Http(sessions) as http:
            idle = [line(await http.auto(session_id)) for _ in range(2)]
            await add_wrong_answers(sessions, session_id)
            wrong = [line(await http.auto(session_id)) for _ in range(2)]
        assert idle == [STUCK, HELP]
        assert wrong[0] == WRONG
        assert HELP not in wrong and STUCK not in wrong
        stored = await records(sessions, session_id)
        reasons = [r["decision"]["reason"] for r in stored]
        assert reasons == ["idle_too_long"] * 2 + ["repeated_incorrect"] * 2
        nudges = [
            r["line_id"]
            for r in stored
            if r["line_id"] and (r.get("auto_intervene") or {}).get("level") == 1
        ]
        assert len(nudges) == len(set(nudges)) == 3

    mysql_run(scenario)


def test_mysql_retry_with_same_client_event_id_returns_same_line_and_uses_nothing():
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions)
        event_id = str(uuid4())
        async with Http(sessions) as http:
            first = await http.auto(session_id, event_id)
            retry = await http.auto(session_id, event_id)
            following = await http.auto(session_id)
        assert retry == first and line(first) == STUCK
        assert line(following) == HELP  # 재시도가 후보를 더 쓰지 않았다
        assert len(await records(sessions, session_id)) == 2

    mysql_run(scenario)


def test_mysql_each_session_has_its_own_history():
    async def scenario(sessions):
        await ready(sessions)
        first, second = await seed_session(sessions), await seed_session(sessions)
        async with Http(sessions) as http:
            assert line(await http.auto(first)) == STUCK
            assert line(await http.auto(first)) == HELP
            assert line(await http.auto(second)) == STUCK

    mysql_run(scenario)


def test_mysql_concurrent_auto_turns_never_return_the_same_line_twice():
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions)
        async with Http(sessions) as http:
            bodies = await asyncio.gather(*(http.auto(session_id) for _ in range(8)))
        returned = [line(b) for b in bodies if line(b) is not None]
        assert sorted(returned) == sorted([STUCK, HELP])
        stored = await records(sessions, session_id)
        assert len(stored) == 8
        assert sorted(r["line_id"] for r in stored if r["line_id"]) == sorted(
            [STUCK, HELP]
        )

    mysql_run(scenario)


async def session_row_is_free(sessions, session_id: str) -> bool:
    """다른 트랜잭션이 세션 행을 잠그고 있지 않은가(FOR UPDATE NOWAIT)."""

    async with sessions() as db:
        try:
            await db.execute(
                select(PlaySession.id)
                .where(PlaySession.id == session_id)
                .with_for_update(nowait=True)
            )
            return True
        except DBAPIError:
            return False
        finally:
            await db.rollback()


def test_mysql_auto_turn_takes_approval_locks_before_the_session_lock():
    # 잠금 순서: 승인 · 게시(공유) → 세션. 확정 판정(lock=True) 직전에 멈췄을 때 세션 행은 아직 잠기지 않아야
    # 한다 — 세션을 먼저 잠그면 플레이어 메시지 턴(승인 공유 → 세션 FK)과 순서가 엇갈려 교착할 수 있다.
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions)
        reader, entered, proceed = paused_reader(before_read=True)
        async with Http(sessions, reader) as http:
            turn = asyncio.create_task(http.auto(session_id))
            try:
                await asyncio.wait_for(entered.wait(), timeout=30)
                assert await session_row_is_free(sessions, session_id)
            finally:
                proceed.set()
            body = await asyncio.wait_for(turn, timeout=30)
        assert line(body) == STUCK

    mysql_run(scenario)


def test_mysql_block_committed_before_auto_turn_confirms_is_seen():
    # 확정 판정 전에 commit 된 긴급 차단은 auto 턴도 본다(케이스 대사를 내지 않는다). 사용 이력도 쓰지 않는다.
    async def scenario(sessions):
        await ready(sessions)
        session_id = await seed_session(sessions)
        reader, entered, proceed = paused_reader(before_read=True)
        service = NpcPublicationService(sessions)
        async with Http(sessions, reader) as http:
            turn = asyncio.create_task(http.auto(session_id))
            try:
                await asyncio.wait_for(entered.wait(), timeout=30)
                await asyncio.wait_for(
                    service.block("case_test", 1, reason="(가상) 긴급", actor="op"),
                    timeout=30,
                )
            finally:
                proceed.set()
            body = await asyncio.wait_for(turn, timeout=30)
        assert line(body) != STUCK and line(body) != HELP
        assert body["fallback_reason"] == "NPC_CONTENT_WITHDRAWN"
        stored = await records(sessions, session_id)
        assert used_auto_nudges_from(stored) == set()

    mysql_run(scenario)


def used_auto_nudges_from(stored: list[dict]) -> set:
    return {
        r["line_id"]
        for r in stored
        if r.get("trigger") == "auto"
        and r.get("auto_intervened") is True
        and (r.get("auto_intervene") or {}).get("level") == 1
    }
