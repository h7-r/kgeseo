"""로그인 실패 기록 쓰기(`user_session._write_throttle_rows`)의 되돌림 · 다시 하기 — 가짜 세션으로 본다.

실제 잠금 · 동시성은 tests/test_login_throttle_concurrency_mysql.py 가 격리 MySQL 로 본다. 여기서는 MySQL 이 교착(1213) ·
잠금 대기 초과(1205)로 트랜잭션을 되돌렸을 때 처음부터 다시 하는지, 다른 오류는 숨기지 않는지, 문장 순서만 본다.
"""

from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import OperationalError

from app.services import user_session

NOW = datetime(2026, 12, 1, 3, 0, 0)


def mysql_error(code: int) -> OperationalError:
    return OperationalError("(simulated)", None, Exception(code, "simulated"))


class FakeSession:
    def __init__(self, failures: list[int]):
        self.failures = list(failures)  # 커밋 때 차례로 낼 MySQL 오류 번호
        self.executed: list[object] = []
        self.commits = 0
        self.rollbacks = 0
        self.new, self.dirty, self.deleted = set(), set(), set()
        self.identity_map = {}

    async def execute(self, statement):
        self.executed.append(statement)

    async def commit(self):
        if self.failures:
            raise mysql_error(self.failures.pop(0))
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def request(ip="198.51.100.5"):
    return SimpleNamespace(client=SimpleNamespace(host=ip))


@pytest.fixture
def clock(monkeypatch):
    ticks = iter([NOW.replace(second=s) for s in range(60)])
    seen: list[datetime] = []

    def now():
        value = next(ticks)
        seen.append(value)
        return value

    monkeypatch.setattr(user_session, "utc_now", now)
    return seen


@pytest.mark.anyio
@pytest.mark.parametrize("code", [1213, 1205])
async def test_transient_mysql_errors_are_retried_from_scratch(clock, code):
    db = FakeSession([code])
    await user_session.record_login_failure(db, request(), "a@example.com")
    assert (db.rollbacks, db.commits) == (1, 1)
    assert len(db.executed) == 4  # 이메일 · IP 두 문장을 두 번(처음부터 다시)
    assert len(clock) == 2  # 다시 할 때 새 시각으로 문장을 만든다


@pytest.mark.anyio
async def test_retries_are_limited_and_the_last_error_is_raised(clock):
    db = FakeSession([1213] * user_session.FAILURE_WRITE_ATTEMPTS)
    with pytest.raises(OperationalError):
        await user_session.record_login_failure(db, request(), "a@example.com")
    assert db.rollbacks == user_session.FAILURE_WRITE_ATTEMPTS and db.commits == 0


@pytest.mark.anyio
async def test_other_database_errors_are_not_hidden_or_retried(clock):
    db = FakeSession([2013])  # 연결 끊김 등 — 다시 하지 않고 그대로 올린다
    with pytest.raises(OperationalError):
        await user_session.record_login_failure(db, request(), "a@example.com")
    assert (db.rollbacks, db.commits, len(db.executed)) == (1, 0, 2)


@pytest.mark.anyio
async def test_refuses_to_commit_someone_elses_pending_changes(clock):
    db = FakeSession([])
    db.dirty = {object()}
    with pytest.raises(RuntimeError):
        await user_session.record_login_failure(db, request(), "a@example.com")
    assert db.executed == [] and db.commits == 0


@pytest.mark.anyio
async def test_keys_are_written_in_hash_order_in_one_transaction(clock):
    db = FakeSession([])
    await user_session.record_login_failure(db, request("203.0.113.9"), "b@example.com")
    written = [
        statement.compile(dialect=mysql.dialect()).params["key_hash"]
        for statement in db.executed
    ]
    assert written == sorted(written) and len(written) == 2 and db.commits == 1


def test_upsert_assigns_lock_then_count_then_window():
    """MySQL 은 UPDATE 절을 왼쪽부터 대입한다 — 잠금 · 횟수 식이 바뀌기 전 값을 보도록 이 순서여야 한다."""
    sql = str(
        user_session._failure_upsert("k" * 64, 5, NOW).compile(dialect=mysql.dialect())
    )
    update = sql.split("ON DUPLICATE KEY UPDATE", 1)[1]
    positions = [
        update.index(f"{column} = ")
        for column in ("locked_until", "failed_count", "window_started_at")
    ]
    assert positions == sorted(positions)
    assert (
        "login_throttles.window_started_at < " in update
    )  # 창 지남 = 15분 「초과」(엄격한 비교)
