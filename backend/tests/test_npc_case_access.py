import asyncio
from typing import Any

import pytest
from sqlalchemy.exc import OperationalError

from app.api.v1.npc import get_npc_case_access_reader
from app.main import app
from app.services.npc_case_access import (
    NO_CASE_CONTENT,
    CaseNpcAccess,
    read_case_npc_access,
)
from app.services.npc_turn_service import process_npc_turn
from app.services.pinned_content import ContentPin, PinnedContentStore
from tests.test_npc_turn import FP, NUDGE_A, approved
from tests.test_npc_turn_http import (  # noqa: F401  (pytest fixture)
    URL,
    approve_all,
    body,
    overrides,
    session_row,
    stored,
)

# 가상 테스트 데이터. 실제 승인 기록 · 게시 상태가 아니다.
# 실제 DB 판정 · 잠금은 tests/test_npc_case_access_mysql.py가 실제 MySQL로 본다.
APPROVED_REPLY = {"source": "approved_line", "text": NUDGE_A, "line_id": "NUDGE_A_01"}
WITHDRAWN = "NPC_CONTENT_WITHDRAWN"


def approved_access() -> CaseNpcAccess:
    return CaseNpcAccess(
        approved(("case_test", 1), FP).source(), basis=("published", ("r1",))
    )


BLOCKED = CaseNpcAccess(None, withdrawn=True, basis=("blocked",))


class Reader:
    """시작 판정(lock=False)과 확정 판정(lock=True)에 다른 값을 돌려줄 수 있는 판정 대역."""

    def __init__(self, before: CaseNpcAccess, after: CaseNpcAccess | None = None):
        self.before = before
        self.after = after or before
        self.calls: list[tuple[ContentPin, bool]] = []

    async def __call__(self, db, pin, *, lock):
        self.calls.append((pin, lock))
        return self.after if lock else self.before


@pytest.fixture
def reader_override(overrides):  # noqa: F811
    def install(reader: Reader) -> Reader:
        app.dependency_overrides[get_npc_case_access_reader] = lambda: reader
        return reader

    return install


# ── 승인 · 게시 상태 판정 결과에 따른 응답 ──


def test_published_and_approved_serves_case_line_using_the_session_pin(
    client, db_session, reader_override
) -> None:
    reader = reader_override(Reader(approved_access()))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.status_code == 200
    assert response.json()["reply"] == APPROVED_REPLY
    # 세션 고정 값으로 계산 전(잠금 없음) · 확정 때(공유 잠금) 두 번 읽는다.
    pin = ContentPin("case_test", 1, FP)
    assert reader.calls == [(pin, False), (pin, True)]


def test_no_case_access_blocks_case_lines_and_keeps_generic_fallback(
    client, db_session, reader_override
) -> None:
    reader_override(Reader(NO_CASE_CONTENT))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.status_code == 200
    assert response.json()["reply"] != APPROVED_REPLY
    assert response.json()["fallback_reason"] != WITHDRAWN
    assert stored(db_session).response_json["line_id"] != "NUDGE_A_01"


def test_blocked_content_returns_withdrawn_generic_response(
    client,
    db_session,
    overrides,  # noqa: F811
    reader_override,
) -> None:
    approve_all(overrides)  # 일반 팩까지 승인돼 있어도 쓰지 않는다
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.status_code == 200
    assert response.json()["reply"] is None
    assert response.json()["suggest_hint"] is None
    assert response.json()["fallback_reason"] == WITHDRAWN
    record = stored(db_session).response_json
    assert (record["reply_source"], record["fallback_reason"]) == (None, WITHDRAWN)
    assert record["no_reply_reason"] == "content_withdrawn"


def test_block_committed_during_turn_is_applied_before_commit(
    client, db_session, reader_override
) -> None:
    # 계산할 때는 게시 중 · 승인이었지만 확정 때 다시 읽으니 차단됐다 → 케이스 대사를 확정하지 않는다.
    reader_override(Reader(approved_access(), BLOCKED))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.json()["reply"] is None
    assert response.json()["fallback_reason"] == WITHDRAWN
    assert stored(db_session).response_json["line_id"] is None


def test_withdrawal_committed_during_turn_drops_the_case_line(
    client, db_session, reader_override
) -> None:
    reader_override(Reader(approved_access(), NO_CASE_CONTENT))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.json()["reply"] != APPROVED_REPLY
    assert stored(db_session).response_json["line_id"] != "NUDGE_A_01"


def test_resumed_content_during_turn_is_recomputed(
    client, db_session, reader_override
) -> None:
    reader_override(Reader(BLOCKED, approved_access()))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.json()["reply"] == APPROVED_REPLY
    assert response.json()["fallback_reason"] is None


def test_replay_after_block_does_not_return_stored_case_line(
    client, db_session, reader_override
) -> None:
    reader_override(Reader(approved_access()))
    db_session.get_result = session_row()
    first = client.post(URL, json=body())
    event = stored(db_session)
    assert first.json()["reply"] == APPROVED_REPLY

    reader_override(Reader(BLOCKED))
    db_session.added.clear()
    db_session.scalar_result = event
    again = client.post(URL, json=body())
    changed = client.post(URL, json=body(message="정답 알려 줘"))

    assert again.json() == {
        "npc_event_id": first.json()["npc_event_id"],
        "reply": None,
        "suggest_hint": None,
        "fallback_reason": WITHDRAWN,
        "content_mode": "generic",
    }
    assert db_session.added == []  # 재전송은 이벤트를 다시 쓰지 않는다
    assert changed.status_code == 409  # 다른 요청이면 기존처럼 충돌


def test_suspended_content_keeps_serving_existing_sessions(
    client, db_session, reader_override
) -> None:
    suspended = CaseNpcAccess(
        approved(("case_test", 1), FP).source(), basis=("suspended", ("r1",))
    )
    reader_override(Reader(suspended))
    db_session.get_result = session_row()

    assert client.post(URL, json=body()).json()["reply"] == APPROVED_REPLY


# ── 판정 함수 · 서비스 계약 ──


class BrokenDb:
    async def execute(self, statement: Any):
        raise OperationalError("SELECT", {}, Exception("connection lost"))

    async def scalar(self, statement: Any):
        raise OperationalError("SELECT", {}, Exception("connection lost"))


@pytest.mark.parametrize("lock", [False, True])
def test_database_error_blocks_case_content(lock: bool) -> None:
    access = asyncio.run(
        read_case_npc_access(BrokenDb(), ContentPin("case_test", 1, FP), lock=lock)
    )

    assert access == NO_CASE_CONTENT
    assert access.approval_source is None and access.withdrawn is False


@pytest.mark.parametrize(
    "pin", [ContentPin("c" * 65, 1, FP), ContentPin(" case_test", 1, FP)]
)
def test_pin_outside_the_approval_target_contract_has_no_access(pin) -> None:
    assert asyncio.run(read_case_npc_access(BrokenDb(), pin, lock=False)) == (
        NO_CASE_CONTENT
    )


def test_approval_source_and_case_access_are_exclusive() -> None:
    with pytest.raises(ValueError, match="either"):
        asyncio.run(
            process_npc_turn(
                None,
                "session",
                None,
                store=PinnedContentStore(),
                approval_source=approved(("case_test", 1), FP).source(),
                case_access=Reader(approved_access()),
            )
        )


# ── 같은 client_event_id 동시 요청의 교착 재시도 ──


class _MySqlError(Exception):
    def __init__(self, errno: int) -> None:
        super().__init__(errno, "(가상) 오류")


def _db_error(errno: int) -> OperationalError:
    return OperationalError("INSERT", {}, _MySqlError(errno))


@pytest.mark.parametrize(
    ("errors", "expected_calls", "raises"),
    [
        ([1213], 2, False),  # 교착 → 다시 시도해 확정 · 재전송
        ([1213] * 3, 4, False),
        ([1213] * 4, 4, True),  # 재시도 한도
        ([1205], 1, True),  # 잠금 대기 초과 등 다른 오류는 그대로
    ],
)
def test_deadlock_is_retried_and_other_errors_are_not(
    monkeypatch, errors, expected_calls, raises
) -> None:
    from app.services import npc_turn_service

    calls = []

    async def once(db, play_session_id, request, **options):
        calls.append(options)
        if len(calls) <= len(errors):
            raise _db_error(errors[len(calls) - 1])
        return "response"

    monkeypatch.setattr(npc_turn_service, "_process_npc_turn_once", once)
    run = npc_turn_service.process_npc_turn(None, "s", None, store="store")

    if raises:
        with pytest.raises(OperationalError):
            asyncio.run(run)
    else:
        assert asyncio.run(run) == "response"
    assert len(calls) == expected_calls
    assert all(call == {"store": "store"} for call in calls)
