"""명시적으로 격리 확인된 빈 테스트 DB에서만 공식 일반 팩 공급 · DB 승인 판정 · 긴급 중단 뒤 Hint API를 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
팩은 저장소의 공식 파일(`general_default/v1`)을 운영 경로(설정 `NPC_GENERAL_PACK` + `read_general_pack_access`)로 쓴다.
승인 기록은 이 격리 DB에만 넣는 **테스트용 가상 승인**이다(가상 검토자, PM 승인이 아니다. 운영 승인 기록이 아니다).
"""

import asyncio
import os
from uuid import uuid4

import pytest

from app.api.v1.npc import get_general_pack_access_reader, get_general_pack_policy
from app.api.v1.play_sessions import get_new_session_publication_guard
from app.core.config import settings
from app.main import app
from app.schemas.gate_review import GateReviewCreate
from app.services.gate_review import VerifiedAdmin, create_gate_review
from app.services.npc_general_pack import load_general_pack, read_general_pack_access
from app.services.npc_line_supply import select_pause_line
from app.services.npc_publication import NpcPublicationService
from tests.pack_policy_stub import passing_test_policy
from tests.test_content_release_mysql import mysql_run
from tests.test_hint_balance_mysql import (
    CASE,
    HINT_1,
    HINT_2,
    Api,
    new_anonymous,
    pinned,
    snapshot,
    store_with,
)
from tests.test_npc_case_access_mysql import (
    WITHDRAWN,
    Http,
    body,
    event_count,
    new_session,
    publish_state,
)
from tests.test_npc_general_pack import OFFICIAL, OFFICIAL_FINGERPRINT, PM_PAUSE_LINES
from tests.test_npc_generic_pause import pack_approval
from tests.test_npc_turn import FP

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

# 테스트용 가상 검토자(격리 DB 전용). 실제 PM · 실제 관리자 인증이 아니다.
TEST_ADMIN = VerifiedAdmin(reviewer="가상 검토자(테스트)")


@pytest.fixture(autouse=True)
def pack_policy_passes():
    # 이 모듈은 승인 · 철회 · 잠금 판정을 시험한다. 정책 검사는 테스트 전용 통과를 명시적으로 넘긴다
    # (운영 기본값 fail closed는 test_mysql_g3_only_pack_*_policy_undefined가 확인).
    app.dependency_overrides[get_general_pack_policy] = lambda: passing_test_policy
    yield
    app.dependency_overrides.pop(get_general_pack_policy, None)


PACK = load_general_pack(OFFICIAL)


@pytest.fixture(autouse=True)
def official_pack_configured(monkeypatch):
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)


async def pack_review(
    sessions,
    gate,
    *,
    fingerprint=OFFICIAL_FINGERPRINT,
    decision="approved",
    target_type="dialogue_pack",
    **extra,
):
    if decision != "approved":
        extra.setdefault("reason", "(가상) 사유")
    async with sessions() as db:
        return await create_gate_review(
            db,
            GateReviewCreate(
                target_type=target_type,
                target_id=PACK.pack_id,
                content_version=PACK.pack_version,
                gate=gate,
                target_hash=fingerprint,
                decision=decision,
                **extra,
            ),
            admin=TEST_ADMIN,
        )


async def approve_pack(sessions, gates=("G1", "G2", "G3"), **kwargs):
    return {g: await pack_review(sessions, g, **kwargs) for g in gates}


def expected(request: dict) -> dict:
    line = select_pause_line(
        PACK, pack_approval(PACK), request["client_event_id"], passing_test_policy
    )
    return {"source": "approved_line", "text": line.text, "line_id": line.line_id}


async def blocked_session(sessions) -> str:
    session_id = await new_session(sessions)
    await publish_state(sessions)
    await NpcPublicationService(sessions).block(
        "case_test", 1, reason="(가상) 긴급", actor="op"
    )
    return session_id


# ── DB 승인 판정 ──


def test_mysql_db_approved_official_pack_answers_blocked_turns():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        await approve_pack(sessions)
        request = body()
        async with Http(sessions) as http:
            response = await http.turn(session_id, request)
            replay = await http.turn(session_id, request)

        assert response["reply"] == expected(request)
        assert response["reply"]["text"] == PM_PAUSE_LINES[response["reply"]["line_id"]]
        assert (response["fallback_reason"], response["content_mode"]) == (
            WITHDRAWN,
            "generic",
        )
        assert response["suggest_hint"] is None
        assert replay == response
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


def test_mysql_pack_needs_all_three_gates_on_the_exact_fingerprint():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        async with Http(sessions) as http:
            # 기록 없음
            assert (await http.turn(session_id, body()))["reply"] is None
            # G1 · G2만
            await approve_pack(sessions, gates=("G1", "G2"))
            assert (await http.turn(session_id, body()))["reply"] is None
            # G3가 다른 내용(fingerprint)에 대한 승인
            await pack_review(sessions, "G3", fingerprint="sha256:" + "f" * 64)
            assert (await http.turn(session_id, body()))["reply"] is None
            # 정확한 fingerprint의 G3
            await pack_review(sessions, "G3")
            request = body()
            assert (await http.turn(session_id, request))["reply"] == expected(request)

    mysql_run(scenario)


def test_mysql_case_approvals_never_approve_the_pack():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        # 같은 ID · 버전 · fingerprint라도 케이스 승인(case_content)은 팩 승인이 아니다.
        await approve_pack(sessions, target_type="case_content")
        async with Http(sessions) as http:
            response = await http.turn(session_id, body())

        assert response["reply"] is None
        assert response["content_mode"] == "generic"

    mysql_run(scenario)


def test_mysql_withdrawn_pack_approval_hides_the_line_even_on_resend():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        approved = await approve_pack(sessions)
        request = body()
        async with Http(sessions) as http:
            first = await http.turn(session_id, request)
            await pack_review(
                sessions, "G3", decision="hold", supersedes=approved["G3"].review_id
            )
            again = await http.turn(session_id, request)
            fresh = await http.turn(session_id, body())

        assert first["reply"] == expected(request)
        assert again["npc_event_id"] == first["npc_event_id"]
        assert again["reply"] is None  # 이전 승인 문장을 다시 보여 주지 않는다
        assert fresh["reply"] is None
        assert {again["content_mode"], fresh["content_mode"]} == {"generic"}

    mysql_run(scenario)


def test_mysql_without_pack_setting_reply_stays_null(monkeypatch):
    monkeypatch.setattr(settings, "npc_general_pack", "")

    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        await approve_pack(sessions)  # 승인이 있어도 공급 설정이 없으면 쓰지 않는다
        async with Http(sessions) as http:
            response = await http.turn(session_id, body())

        assert (response["reply"], response["fallback_reason"]) == (None, WITHDRAWN)
        assert response["content_mode"] == "generic"

    mysql_run(scenario)


# ── 승인 철회 · NPC 턴 동시성 ──


def paused_pack_reader(*, before_read: bool):
    entered, proceed = asyncio.Event(), asyncio.Event()

    async def reader(db, pack, *, lock):
        if lock and before_read:
            entered.set()
            await proceed.wait()
        access = await read_general_pack_access(db, pack, lock=lock)
        if lock and not before_read:
            entered.set()
            await proceed.wait()
        return access

    return reader, entered, proceed


class PackReader:
    def __init__(self, reader) -> None:
        self.reader = reader

    def __enter__(self):
        app.dependency_overrides[get_general_pack_access_reader] = lambda: self.reader

    def __exit__(self, *exc):
        app.dependency_overrides.pop(get_general_pack_access_reader, None)


def test_mysql_withdrawal_committed_before_confirm_is_seen():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        approved = await approve_pack(sessions)
        reader, entered, proceed = paused_pack_reader(before_read=True)
        request = body()
        with PackReader(reader):
            async with Http(sessions) as http:
                turn = asyncio.create_task(http.turn(session_id, request))
                try:
                    await asyncio.wait_for(entered.wait(), timeout=30)
                    # 계산은 승인 상태로 끝났고, 확정 판정 직전에 철회가 commit된다.
                    await asyncio.wait_for(
                        pack_review(
                            sessions,
                            "G3",
                            decision="hold",
                            supersedes=approved["G3"].review_id,
                        ),
                        timeout=30,
                    )
                finally:
                    proceed.set()
                response = await asyncio.wait_for(turn, timeout=30)
                replay = await http.turn(session_id, request)

        assert response["reply"] is None
        assert replay["reply"] is None
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


def test_mysql_withdrawal_waits_for_a_confirming_turn():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        approved = await approve_pack(sessions)
        reader, entered, proceed = paused_pack_reader(before_read=False)
        request = body()
        with PackReader(reader):
            async with Http(sessions) as http:
                turn = asyncio.create_task(http.turn(session_id, request))
                try:
                    await asyncio.wait_for(entered.wait(), timeout=30)
                    # 확정 중인 턴이 승인 대상 행을 공유 잠금으로 잡고 있다 → 철회는 턴 확정까지 기다린다.
                    withdrawal = asyncio.create_task(
                        pack_review(
                            sessions,
                            "G3",
                            decision="hold",
                            supersedes=approved["G3"].review_id,
                        )
                    )
                    await asyncio.sleep(1.0)
                    waited = not withdrawal.done()
                finally:
                    # 실패해도 멈춘 턴을 풀어 준다(잠금을 쥔 채 남지 않게).
                    proceed.set()
                response = await asyncio.wait_for(turn, timeout=30)
                assert waited, "withdrawal did not wait for the turn"
                await asyncio.wait_for(withdrawal, timeout=30)
            async with Http(sessions) as http:
                replay = await http.turn(session_id, request)

        assert response["reply"] == expected(request)  # 철회 전에 확정된 응답
        assert replay["reply"] is None  # 철회 뒤 재전송은 대사를 다시 보여 주지 않는다
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


# ── 긴급 중단 뒤 Hint API (PM v0.4.6 §3 · v0.4.9 §3) ──


class RealGuardApi(Api):
    """Hint · 세션 생성 · NPC 라우터를 같은 격리 DB로 부른다. 신규 세션 게시 guard는 운영 guard 그대로."""

    async def __aenter__(self):
        await super().__aenter__()
        app.dependency_overrides.pop(get_new_session_publication_guard, None)
        return self

    async def turn(self, session_id: str, request: dict):
        response = await self.client.post(
            f"/api/v1/play-sessions/{session_id}/npc/turns", json=request
        )
        assert response.status_code == 200, response.text
        return response.json()


def test_mysql_hint_api_keeps_working_for_an_existing_session_after_block():
    async def scenario(sessions):
        await publish_state(sessions, fingerprint=FP)
        await approve_pack(sessions)
        store = store_with(pinned())
        async with RealGuardApi(sessions, store) as api:
            # 1. 게시 중에 정상 생성한 고정 세션
            created = await api.start(await new_anonymous(sessions))
            assert created.status_code == 201, created.text
            session_id = created.json()["data"]["play_session_id"]
            first = await api.unlock(session_id, 1)
            assert first.status_code == 200, first.text

            # 2. 긴급 중단
            await NpcPublicationService(sessions).block(
                CASE, 1, reason="(가상) 긴급", actor="op"
            )

            # 3. NPC는 승인 일반 대사(공식 팩)로 답한다
            request = body()
            npc = await api.turn(session_id, request)

            # 4. 같은 세션의 Hint API는 그대로 쓴다(차감 · 멱등 유지)
            event_id = str(uuid4())
            second = await api.unlock(session_id, 2, event_id)
            replay = await api.unlock(session_id, 2, event_id)

            # 5. 새 세션은 만들 수 없다
            refused = await api.start(await new_anonymous(sessions))

        assert npc["reply"] == expected(request)
        assert (npc["fallback_reason"], npc["content_mode"]) == (WITHDRAWN, "generic")
        assert first.json()["hint"] == {"level": 1, "text": HINT_1}
        assert second.status_code == 200, second.text
        assert second.json()["hint"] == {"level": 2, "text": HINT_2}
        assert (
            second.json()["result"]["hint_balance"],
            second.json()["result"]["help_used"],
        ) == (1, 2)
        assert replay.status_code == 200 and replay.json() == second.json()
        assert await snapshot(sessions, session_id) == (
            1,
            2,
            {"PZ_A": 2},
            ["hint_unlocked", "hint_unlocked"],
        )
        assert refused.status_code == 409, refused.text

    mysql_run(scenario)
