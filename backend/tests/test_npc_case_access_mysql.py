"""명시적으로 격리 확인된 빈 테스트 DB에서만 NPC 케이스 대사 승인 · 게시 상태 판정을 HTTP로 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
전체 migration 체인을 적용하고, 끝나면 그 전용 schema의 테이블을 모두 지운다.
승인 기록 · 게시 상태 · 콘텐츠는 가상 데이터다(실제 승인자 · 실제 PM 콘텐츠가 아니다).
"""

import asyncio
from datetime import datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app.api.v1.npc import get_npc_case_access_reader
from app.db.session import get_db
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.repositories.npc_publication import NpcPublicationRepository
from app.schemas.gate_review import GateReviewCreate
from app.services.gate_review import VerifiedAdmin, create_gate_review
from app.services.npc_case_access import read_case_npc_access
from app.services.npc_publication import NpcPublicationService
from app.services.pinned_content import PinnedContentStore
from app.services.session_content import get_pinned_content_store
from tests.test_content_release_mysql import mysql_run
from tests.test_npc_turn import FP, NUDGE_A, bundle
from tests.test_npc_turn_http import session_row

pytestmark = pytest.mark.skipif(
    __import__("os").environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

ADMIN = VerifiedAdmin(reviewer="가상 운영자")
NOW = datetime(2026, 11, 3, 1, 0, 0)
APPROVED_REPLY = {"source": "approved_line", "text": NUDGE_A, "line_id": "NUDGE_A_01"}
WITHDRAWN = "NPC_CONTENT_WITHDRAWN"


def body(event_id: str | None = None) -> dict:
    return {
        "client_event_id": event_id or str(uuid4()),
        "client_timestamp": "2026-11-03T12:00:00+09:00",
        "trigger": "player_message",
        "message": "소화전 어떻게 열어?",
    }


async def review(sessions, gate, fingerprint=FP, decision="approved", **extra):
    if decision != "approved":
        extra.setdefault("reason", "(가상) 사유")
    async with sessions() as db:
        return await create_gate_review(
            db,
            GateReviewCreate(
                target_type="case_content",
                target_id="case_test",
                content_version=1,
                gate=gate,
                target_hash=fingerprint,
                decision=decision,
                **extra,
            ),
            admin=ADMIN,
        )


async def approve(sessions, fingerprint=FP):
    return {g: await review(sessions, g, fingerprint) for g in ("G1", "G2", "G3")}


async def publish_state(sessions, status="published", fingerprint=FP):
    # 게시 판정은 test_content_release_mysql이 본다. 여기서는 판정 대상인 게시 상태 행만 만든다.
    async with sessions() as db, db.begin():
        repository = NpcPublicationRepository(db)
        await repository.register_version("case_test", 1, fingerprint, now=NOW)
        await repository.insert_state("case_test", 1, status=status, now=NOW)


async def new_session(sessions) -> str:
    anonymous_id = str(uuid4())
    row = session_row()
    row.id = str(uuid4())
    row.anonymous_session_id = anonymous_id
    async with sessions() as db, db.begin():
        db.add(AnonymousSession(id=anonymous_id, created_at=NOW, expires_at=NOW))
        await db.flush()
        db.add(row)
    return row.id


class Http:
    """실제 라우터 · 의존성으로 요청한다(DB는 격리 MySQL, 판정은 운영 `read_case_npc_access`)."""

    def __init__(self, sessions, reader=None) -> None:
        self.sessions = sessions
        self.store = PinnedContentStore()
        self.store.add(bundle())
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

    async def turn(self, session_id: str, request: dict):
        response = await self.client.post(
            f"/api/v1/play-sessions/{session_id}/npc/turns", json=request
        )
        assert response.status_code == 200, response.text
        return response.json()


async def event_count(sessions, session_id: str) -> int:
    async with sessions() as db:
        return await db.scalar(
            select(func.count())
            .select_from(InteractionEvent)
            .where(InteractionEvent.play_session_id == session_id)
        )


def paused_reader(*, before_read: bool):
    """확정 판정(lock=True) 앞 또는 뒤에서 멈추는 운영 판정 래퍼."""

    entered, proceed = asyncio.Event(), asyncio.Event()

    async def reader(db, pin, *, lock):
        if lock and before_read:
            entered.set()
            await proceed.wait()
        access = await read_case_npc_access(db, pin, lock=lock)
        if lock and not before_read:
            entered.set()
            await proceed.wait()
        return access

    return reader, entered, proceed


# ── 승인 · 게시 상태 판정 ──


def test_mysql_case_line_needs_publication_and_exact_approvals():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        async with Http(sessions) as http:
            # 게시 기록 없음 → 승인이 있어도 케이스 대사 없음
            await approve(sessions)
            assert (await http.turn(session_id, body()))["reply"] != APPROVED_REPLY
            await publish_state(sessions)
            assert (await http.turn(session_id, body()))["reply"] == APPROVED_REPLY

    mysql_run(scenario)


def test_mysql_other_fingerprint_or_withdrawn_approval_blocks_case_line():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        async with Http(sessions) as http:
            await approve(sessions, "sha256:" + "f" * 64)  # 다른 내용의 승인
            assert (await http.turn(session_id, body()))["reply"] != APPROVED_REPLY
            approved = await approve(sessions)
            assert (await http.turn(session_id, body()))["reply"] == APPROVED_REPLY
            await review(
                sessions,
                "G2",
                decision="rejected",
                supersedes=approved["G2"].review_id,
            )
            assert (await http.turn(session_id, body()))["reply"] != APPROVED_REPLY

    mysql_run(scenario)


def test_mysql_published_fingerprint_must_match_the_session_pin():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions, fingerprint="sha256:" + "f" * 64)
        await approve(sessions)
        async with Http(sessions) as http:
            response = await http.turn(session_id, body())

        assert response["reply"] != APPROVED_REPLY
        assert response["fallback_reason"] != WITHDRAWN

    mysql_run(scenario)


def test_mysql_suspension_keeps_lines_and_block_withdraws_them():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        service = NpcPublicationService(sessions)
        async with Http(sessions) as http:
            first_request = body()
            first = await http.turn(session_id, first_request)
            assert first["reply"] == APPROVED_REPLY

            await service.suspend("case_test", 1, reason="(가상) 점검", actor="op")
            assert (await http.turn(session_id, body()))["reply"] == APPROVED_REPLY

            await service.block("case_test", 1, reason="(가상) 긴급", actor="op")
            blocked = await http.turn(session_id, body())
            replay = await http.turn(session_id, first_request)

        assert (blocked["reply"], blocked["suggest_hint"]) == (None, None)
        assert blocked["fallback_reason"] == WITHDRAWN
        # 차단 전에 확정한 응답도 재전송 때 케이스 대사를 돌려주지 않는다.
        assert replay == {
            "npc_event_id": first["npc_event_id"],
            "reply": None,
            "suggest_hint": None,
            "fallback_reason": WITHDRAWN,
            "content_mode": "generic",
        }
        assert await event_count(sessions, session_id) == 3

    mysql_run(scenario)


# ── 동시성 ──


def test_mysql_block_committed_during_turn_is_seen_before_commit():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        reader, entered, proceed = paused_reader(before_read=True)
        service = NpcPublicationService(sessions)
        async with Http(sessions, reader) as http:
            turn = asyncio.create_task(http.turn(session_id, body()))
            try:
                await asyncio.wait_for(entered.wait(), timeout=30)
                # 계산은 끝났고 확정 판정 전이다. NPC 턴은 잠금을 잡고 있지 않아 차단이 바로 commit된다.
                await asyncio.wait_for(
                    service.block("case_test", 1, reason="(가상) 긴급", actor="op"),
                    timeout=30,
                )
            finally:
                proceed.set()
            response = await asyncio.wait_for(turn, timeout=30)

        assert response["reply"] is None
        assert response["fallback_reason"] == WITHDRAWN

    mysql_run(scenario)


def test_mysql_block_and_withdrawal_wait_for_turn_commit():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        approved = await approve(sessions)
        reader, entered, proceed = paused_reader(before_read=False)
        service = NpcPublicationService(sessions)
        async with Http(sessions, reader) as http:
            turn_request = body()
            turn = asyncio.create_task(http.turn(session_id, turn_request))
            try:
                await asyncio.wait_for(entered.wait(), timeout=30)
                # 확정 판정이 공유 잠금을 잡았다. 차단 · 철회는 그 턴이 commit될 때까지 기다린다.
                block = asyncio.create_task(
                    service.block("case_test", 1, reason="(가상) 긴급", actor="op")
                )
                withdrawal = asyncio.create_task(
                    review(
                        sessions,
                        "G2",
                        decision="rejected",
                        supersedes=approved["G2"].review_id,
                    )
                )
                await asyncio.sleep(1.0)
                assert not block.done(), "block did not wait for the turn"
                assert not withdrawal.done(), "withdrawal did not wait for the turn"
            finally:
                proceed.set()
            response = await asyncio.wait_for(turn, timeout=30)
            await asyncio.wait_for(asyncio.gather(block, withdrawal), timeout=30)
            # 확정된 응답은 차단 전에 확정됐다. 그 뒤 재전송은 차단을 본다.
            replay = await http.turn(session_id, turn_request)

        assert response["reply"] == APPROVED_REPLY
        assert replay["fallback_reason"] == WITHDRAWN

    mysql_run(scenario)


def test_mysql_duplicate_requests_record_one_event():
    async def scenario(sessions):
        session_id = await new_session(sessions)
        await publish_state(sessions)
        await approve(sessions)
        request = body()
        async with Http(sessions) as http:
            responses = await asyncio.gather(
                *(http.turn(session_id, request) for _ in range(4))
            )

        assert all(r == responses[0] for r in responses)
        assert responses[0]["reply"] == APPROVED_REPLY
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)
