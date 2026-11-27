"""로그인 실패 집계(`login_throttles`)의 동시성 — 격리 MySQL 에서 실제 잠금 · 트랜잭션으로 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_*`). 데이터는 모두 가상 값이다
(`example.com` 이메일 · 문서용 IP 대역). 경합 시점은 한 세션이 행 잠금(또는 커밋 전 INSERT)을 쥔 채 다른 쪽이
**기다리는지**를 확인해 통제한다 — 여러 번 돌려 우연히 통과하는 것을 근거로 삼지 않는다.

- 동시 실패: 이미 행이 있을 때 · 행이 없을 때(첫 실패) — 실패 수 유실 없음, 중복 키(1062) 없음, 5xx 없음
- 이메일 · IP: 같은 이메일 다른 IP · 다른 이메일 같은 IP
- 경계: 창 정확히 15분 · 15분 + 1µs · 잠금 진행 중 · 잠금 끝난 그 순간 · Retry-After
- 정기 파기 DELETE(조건 재확인)와의 경합: 파기 먼저 · 집계 먼저 · 후보를 고른 뒤 집계 갱신
- 성공 로그인의 실패 기록 삭제와 실패 집계의 경합
"""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import delete, or_, select, text
from sqlalchemy.exc import OperationalError

from app.api.v1 import auth, me
from app.main import app
from app.models.account_data import LoginThrottle
from app.services import mailer, user_session
from app.services.local_auth import normalize_email, utc_now
from app.services.request_rate_limit import (
    SlidingWindowLimiter,
    get_request_rate_limiter,
)
from app.services.user_session import (
    MAX_FAILURES_PER_EMAIL,
    MAX_FAILURES_PER_IP,
    THROTTLE_WINDOW,
    current_user,
    login_lock_remaining_seconds,
    record_login_failure,
)
from tests.test_admin_api_mysql import mysql_run
from tests.test_password_reset_mysql import COMPLETE, REQUEST, VERIFY, code_in

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

ORIGIN = {"Origin": "http://localhost:5173"}
PASSWORD = "Zebra-Moon-2491"
WRONG = "Wrong-Pass-7713"
LOGIN = "/api/v1/auth/login"
NOW = datetime(2026, 12, 1, 3, 0, 0)
US = timedelta(microseconds=1)
WAIT = 0.4  # 잠금을 기다리는지 볼 시간(초) — 기다리지 않으면 수 ms 안에 끝난다


@pytest.fixture(autouse=True)
def real_auth_and_fresh_limits():
    app.dependency_overrides.pop(current_user, None)
    limiter = SlidingWindowLimiter()
    app.dependency_overrides[get_request_rate_limiter] = lambda: limiter
    yield
    app.dependency_overrides.pop(get_request_rate_limiter, None)


def client(ip: str = "198.51.100.10") -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=(ip, 50000)),
        base_url="http://testserver",
        headers=ORIGIN,
    )


def email_key(email: str) -> str:
    return user_session._hash(f"email:{normalize_email(email)}")


def ip_key(ip: str) -> str:
    return user_session._hash(f"ip:{ip}")


def req(ip: str):
    return type("Req", (), {"client": type("C", (), {"host": ip})()})()


async def register(email: str, nickname: str) -> None:
    async with client("192.0.2.200") as http:
        answer = await http.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": PASSWORD,
                "nickname": nickname,
                "consent": {"terms": True, "privacy": True, "age": True},
            },
        )
    assert answer.status_code == 201, answer.text


async def row(sessions, key):
    async with sessions() as db:
        return await db.get(LoginThrottle, key)


async def seed(sessions, key, count, window, locked=None):
    async with sessions() as db:
        await db.execute(delete(LoginThrottle).where(LoginThrottle.key_hash == key))
        db.add(
            LoginThrottle(
                key_hash=key,
                failed_count=count,
                window_started_at=window,
                locked_until=locked,
            )
        )
        await db.commit()


def status_of(answer) -> object:
    if isinstance(answer, BaseException):
        orig = getattr(answer, "orig", None)
        code = orig.args[0] if orig is not None and getattr(orig, "args", None) else ""
        return f"{type(answer).__name__}/{code}"
    return answer.status_code


async def burst(n: int, email: str, ips: list[str]) -> list[object]:
    clients = [client(ips[i % len(ips)]) for i in range(n)]
    try:
        answers = await asyncio.gather(
            *(c.post(LOGIN, json={"email": email, "password": WRONG}) for c in clients),
            return_exceptions=True,
        )
    finally:
        for c in clients:
            await c.aclose()
    return [status_of(a) for a in answers]


# ---------------------------------------------------------------- 동시 실패(실제 로그인 요청)


@pytest.mark.parametrize("n", [4, 10])
@pytest.mark.parametrize("existing", [True, False])
def test_mysql_concurrent_wrong_logins_are_all_counted(n, existing):
    async def scenario(sessions):
        email = f"burst{n}{int(existing)}@example.com"
        ip = f"198.51.100.{20 + n + int(existing)}"
        await register(email, f"동시{n}{int(existing)}")
        base = 0
        if existing:
            base = 1
            now = utc_now()
            await seed(sessions, email_key(email), 1, now)
            await seed(sessions, ip_key(ip), 1, now)

        statuses = await burst(n, email, [ip])

        assert set(statuses) <= {401, 429}, statuses  # 5xx · 예외 없음
        recorded = statuses.count(401)
        email_row = await row(sessions, email_key(email))
        ip_row = await row(sessions, ip_key(ip))
        # 401 로 끝난 요청은 모두 실패로 셌다(유실 없음). 잠금 뒤 들어온 요청은 429 로 세지 않는다
        assert email_row.failed_count == base + recorded, statuses
        assert ip_row.failed_count == base + recorded, statuses
        assert (email_row.locked_until is not None) == (
            base + recorded >= MAX_FAILURES_PER_EMAIL
        )
        # 잠금이 걸렸으면 새로 시작한 요청은 정책대로 429 + Retry-After
        if email_row.locked_until is not None:
            async with client(ip) as http:
                late = await http.post(LOGIN, json={"email": email, "password": WRONG})
            assert late.status_code == 429
            assert (
                1 <= int(late.headers["Retry-After"]) <= THROTTLE_WINDOW.total_seconds()
            )
        if n == 4:
            assert recorded == 4  # 잠금 전에 모두 들어왔다(1+4 = 5 번째에서 잠김)

    mysql_run(scenario)


def test_mysql_same_email_from_many_ips_and_many_emails_from_one_ip():
    async def scenario(sessions):
        email = "multiip@example.com"
        await register(email, "여러주소")
        ips = [f"203.0.113.{i}" for i in range(1, 7)]
        statuses = await burst(6, email, ips)
        assert set(statuses) <= {401, 429}, statuses
        recorded = statuses.count(401)
        assert (await row(sessions, email_key(email))).failed_count == recorded
        for ip, status in zip(ips, statuses):
            ip_row = await row(sessions, ip_key(ip))
            assert (ip_row.failed_count if ip_row else 0) == (1 if status == 401 else 0)

        shared_ip = "203.0.113.99"
        emails = [
            f"spray{i}@example.com" for i in range(8)
        ]  # 가입 안 된 이메일도 실패로 센다
        clients = [client(shared_ip) for _ in emails]
        try:
            answers = await asyncio.gather(
                *(
                    c.post(LOGIN, json={"email": e, "password": WRONG})
                    for c, e in zip(clients, emails)
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()
        statuses = [status_of(a) for a in answers]
        assert set(statuses) == {401}, statuses
        assert (await row(sessions, ip_key(shared_ip))).failed_count == 8
        for e in emails:
            assert (await row(sessions, email_key(e))).failed_count == 1

    mysql_run(scenario)


# ---------------------------------------------------------------- 잠금으로 통제한 경합(서비스 함수)


@pytest.mark.parametrize("existing", [True, False])
def test_mysql_failure_waits_for_a_row_held_by_another_transaction(existing):
    """다른 트랜잭션이 키 행을 쥐고 있으면(기존 행 잠금 · 커밋 전 첫 INSERT) 집계는 기다렸다가 그 위에 더한다."""

    async def scenario(sessions):
        email = f"held{int(existing)}@example.com"
        key, ip = email_key(email), "198.51.100.77"
        now = utc_now()
        if existing:
            await seed(sessions, key, 2, now)
        async with sessions() as holder:
            if existing:
                await holder.execute(
                    select(LoginThrottle)
                    .where(LoginThrottle.key_hash == key)
                    .with_for_update()
                )
                await holder.execute(
                    text(
                        "UPDATE login_throttles SET failed_count = failed_count + 1 WHERE key_hash = :k"
                    ),
                    {"k": key},
                )
            else:
                await holder.execute(
                    text(
                        "INSERT INTO login_throttles (key_hash, failed_count, window_started_at) "
                        "VALUES (:k, 1, :now)"
                    ),
                    {"k": key, "now": now},
                )

            async def other():
                async with sessions() as db:
                    await record_login_failure(db, req(ip), email)

            task = asyncio.create_task(other())
            await asyncio.sleep(WAIT)
            waited = not task.done()
            await holder.commit()
        error = None
        try:
            await task
        except Exception as exc:  # noqa: BLE001
            error = status_of(exc)
        r = await row(sessions, key)
        assert error is None, error
        assert waited, "the second failure did not wait for the held row"
        assert r.failed_count == (4 if existing else 2)

    mysql_run(scenario)


# ---------------------------------------------------------------- 창 · 잠금 경계(시계 고정)


@pytest.fixture
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(user_session, "utc_now", lambda: state["now"])
    return state


@pytest.mark.parametrize(
    ("count", "window_ago", "locked", "expect_count", "expect_locked"),
    [
        # 창이 정확히 15분 전에 시작 — 아직 같은 창(지남 판정은 15분 「초과」)
        (3, THROTTLE_WINDOW, None, 4, None),
        # 15분 + 1µs — 새 창
        (3, THROTTLE_WINDOW + US, None, 1, None),
        # 한도 직전 → 이번 실패로 잠김(잠금 = 지금 + 15분)
        (
            MAX_FAILURES_PER_EMAIL - 1,
            timedelta(minutes=1),
            None,
            MAX_FAILURES_PER_EMAIL,
            "now+window",
        ),
        # 이미 잠겨 있는 동안(겹쳐 들어온 요청) — 잠금 시각을 늘리지 않는다
        (
            MAX_FAILURES_PER_EMAIL,
            timedelta(minutes=2),
            timedelta(minutes=5),
            MAX_FAILURES_PER_EMAIL + 1,
            "keep",
        ),
        # 창은 지났지만 잠금이 아직 진행 중 — 잠금은 그대로 둔다(풀지 않는다)
        (
            MAX_FAILURES_PER_EMAIL,
            THROTTLE_WINDOW + timedelta(minutes=1),
            timedelta(minutes=5),
            1,
            "keep",
        ),
        # 잠금이 끝난 바로 그 순간(locked_until == now)은 풀린 상태 — 창 안이면 이어 세고 다시 잠근다
        (
            MAX_FAILURES_PER_EMAIL,
            timedelta(minutes=14),
            timedelta(0),
            MAX_FAILURES_PER_EMAIL + 1,
            "now+window",
        ),
        # 잠금 끝 · 창도 지남 — 새 창, 잠금 없음
        (MAX_FAILURES_PER_EMAIL, THROTTLE_WINDOW + US, timedelta(0), 1, None),
    ],
)
def test_mysql_window_and_lock_boundaries(
    clock, count, window_ago, locked, expect_count, expect_locked
):
    async def scenario(sessions):
        email = "edge@example.com"
        key = email_key(email)
        locked_until = None if locked is None else NOW + locked
        await seed(sessions, key, count, NOW - window_ago, locked_until)
        async with sessions() as db:
            await record_login_failure(db, req("192.0.2.9"), email)
        r = await row(sessions, key)
        assert r.failed_count == expect_count
        if expect_locked is None:
            assert r.locked_until is None
        elif expect_locked == "keep":
            assert r.locked_until == locked_until
        else:
            assert r.locked_until == NOW + THROTTLE_WINDOW
        expect_window = NOW if expect_count == 1 else NOW - window_ago
        assert r.window_started_at == expect_window

    mysql_run(scenario)


# 아래 셋은 tests/test_beta_security_docs_retry_after.py 의 대역(가짜 세션) 시험을 실제 MySQL 로 옮긴 것이다(단정 그대로).


def test_mysql_email_lock_reports_exact_remaining_seconds(clock):
    async def scenario(sessions):
        email = "a@example.com"
        async with sessions() as db:
            for _ in range(MAX_FAILURES_PER_EMAIL - 1):
                await record_login_failure(db, req("203.0.113.7"), email)
            assert (
                await login_lock_remaining_seconds(db, req("203.0.113.7"), email)
                is None
            )
            await record_login_failure(
                db, req("203.0.113.7"), email
            )  # 5번째 실패 → 잠금
            window = int(THROTTLE_WINDOW.total_seconds())
            assert (
                await login_lock_remaining_seconds(db, req("203.0.113.7"), email)
                == window
            )
            clock["now"] = NOW + timedelta(seconds=600)
            assert (
                await login_lock_remaining_seconds(db, req("203.0.113.7"), email)
                == window - 600
            )
            clock["now"] = NOW + THROTTLE_WINDOW - timedelta(milliseconds=200)
            assert (
                await login_lock_remaining_seconds(db, req("203.0.113.7"), email) == 1
            )
            clock["now"] = NOW + THROTTLE_WINDOW
            assert (
                await login_lock_remaining_seconds(db, req("203.0.113.7"), email)
                is None
            )

    mysql_run(scenario)


def test_mysql_ip_lock_applies_to_other_emails_with_its_own_remaining_time(clock):
    async def scenario(sessions):
        async with sessions() as db:
            for index in range(MAX_FAILURES_PER_IP):
                clock["now"] = NOW + timedelta(seconds=index)
                await record_login_failure(
                    db, req("198.51.100.9"), f"user{index}@example.com"
                )
            locked_at = NOW + timedelta(seconds=MAX_FAILURES_PER_IP - 1)
            clock["now"] = locked_at + timedelta(seconds=100)
            window = int(THROTTLE_WINDOW.total_seconds())
            assert (
                await login_lock_remaining_seconds(
                    db, req("198.51.100.9"), "new@example.com"
                )
                == window - 100
            )
            assert (
                await login_lock_remaining_seconds(
                    db, req("192.0.2.1"), "new@example.com"
                )
                is None
            )

    mysql_run(scenario)


def test_mysql_both_locks_report_the_later_release(clock):
    async def scenario(sessions):
        ip = "198.51.100.10"
        async with sessions() as db:
            for index in range(MAX_FAILURES_PER_IP):
                await record_login_failure(db, req(ip), f"spray{index}@example.com")
            clock["now"] = NOW + timedelta(seconds=120)
            for _ in range(MAX_FAILURES_PER_EMAIL):
                await record_login_failure(db, req("192.0.2.50"), "late@example.com")
            clock["now"] = NOW + timedelta(seconds=180)
            window = int(THROTTLE_WINDOW.total_seconds())
            assert (
                await login_lock_remaining_seconds(db, req(ip), "late@example.com")
                == window - 60
            )

    mysql_run(scenario)


# ---------------------------------------------------------------- 정기 파기 DELETE(조건 재확인)와의 경합


def purge_condition(now):
    # 신규 인증 데이터 파기 설계(STEP 17)의 조건과 같다 — 파기 스크립트는 아직 구현하지 않는다
    return (
        LoginThrottle.window_started_at < now - timedelta(days=1),
        or_(LoginThrottle.locked_until.is_(None), LoginThrottle.locked_until < now),
    )


def test_mysql_purge_first_then_failure_starts_a_fresh_row():
    async def scenario(sessions):
        email = "purgefirst@example.com"
        key = email_key(email)
        now = utc_now()
        await seed(sessions, key, 3, now - timedelta(days=2))
        async with sessions() as purge:
            result = await purge.execute(
                delete(LoginThrottle).where(
                    LoginThrottle.key_hash == key, *purge_condition(now)
                )
            )
            await purge.commit()
        assert result.rowcount == 1
        async with sessions() as db:
            await record_login_failure(db, req("198.51.100.31"), email)
        r = await row(sessions, key)
        assert r.failed_count == 1 and r.window_started_at > now - timedelta(minutes=1)

    mysql_run(scenario)


def test_mysql_purge_between_read_and_write_of_a_failure():
    """집계가 행을 본 직후 파기가 그 행을 지워도(옛 구현은 StaleDataError · 실패 유실) 실패가 남는다."""

    async def scenario(sessions):
        email = "purgerace@example.com"
        key = email_key(email)
        old = utc_now() - timedelta(days=2)
        await seed(sessions, key, 3, old)
        fired = {"done": False}
        real_execute = None

        async def purge_once():
            if not fired["done"]:
                fired["done"] = True
                async with sessions() as purge:
                    now = utc_now()
                    await purge.execute(
                        delete(LoginThrottle).where(
                            LoginThrottle.key_hash == key, *purge_condition(now)
                        )
                    )
                    await purge.commit()

        async with sessions() as db:
            original_get = db.get
            real_execute = db.execute

            async def get_then_purge(model, ident, **kw):
                found = await original_get(model, ident, **kw)
                if model is LoginThrottle and ident == key:
                    await purge_once()
                return found

            async def execute_then_purge(statement, *args, **kw):
                # 새 구현은 읽지 않고 한 문장으로 쓴다 — 그 문장 직전에 파기가 끼어든 경우
                if getattr(statement, "table", None) is LoginThrottle.__table__:
                    await purge_once()
                return await real_execute(statement, *args, **kw)

            db.get = get_then_purge
            db.execute = execute_then_purge
            error = None
            try:
                await record_login_failure(db, req("198.51.100.32"), email)
            except Exception as exc:  # noqa: BLE001
                error = status_of(exc)
        r = await row(sessions, key)
        assert fired["done"]
        assert error is None, error
        assert r is not None and r.failed_count == 1  # 지워진 뒤 새 창 1회로 남는다

    mysql_run(scenario)


def test_mysql_purge_waits_for_an_in_flight_failure_and_keeps_the_refreshed_row():
    async def scenario(sessions):
        email = "authfirst@example.com"
        key = email_key(email)
        now = utc_now()
        await seed(sessions, key, 3, now - timedelta(days=2))
        async with sessions() as auth:
            # 집계 트랜잭션이 먼저 행을 갱신(창 새로 시작)하고 아직 커밋하지 않음
            await auth.execute(
                text(
                    "UPDATE login_throttles SET failed_count = 1, window_started_at = :now, locked_until = NULL "
                    "WHERE key_hash = :k"
                ),
                {"k": key, "now": now},
            )

            async def purge():
                async with sessions() as db:
                    result = await db.execute(
                        delete(LoginThrottle).where(
                            LoginThrottle.key_hash == key, *purge_condition(now)
                        )
                    )
                    await db.commit()
                    return result.rowcount

            task = asyncio.create_task(purge())
            await asyncio.sleep(WAIT)
            waited = not task.done()
            await auth.commit()
        deleted = await task
        assert waited and deleted == 0  # 기다린 뒤 조건을 다시 보고 지우지 않았다
        assert (await row(sessions, key)).failed_count == 1

    mysql_run(scenario)


def test_mysql_candidate_refreshed_before_purge_delete_is_kept_and_active_locks_survive():
    async def scenario(sessions):
        email = "candidate@example.com"
        key = email_key(email)
        locked_email = "stilllocked@example.com"
        locked_key = email_key(locked_email)
        now = utc_now()
        await seed(sessions, key, 3, now - timedelta(days=2))
        # 창은 1일 넘게 지났지만 잠금이 아직 진행 중인 행(보존 대상)
        await seed(
            sessions,
            locked_key,
            30,
            now - timedelta(days=2),
            now + timedelta(minutes=5),
        )
        async with sessions() as purge:
            candidates = list(
                await purge.scalars(
                    select(LoginThrottle.key_hash).where(*purge_condition(now))
                )
            )
        assert key in candidates and locked_key not in candidates
        async with sessions() as db:
            await record_login_failure(
                db, req("198.51.100.33"), email
            )  # 후보를 고른 뒤 갱신
        async with sessions() as purge:
            result = await purge.execute(
                delete(LoginThrottle).where(
                    LoginThrottle.key_hash.in_(candidates + [locked_key]),
                    *purge_condition(now),
                )
            )
            await purge.commit()
        assert result.rowcount == 0
        assert (await row(sessions, key)).failed_count == 1
        assert (await row(sessions, locked_key)).locked_until == now + timedelta(
            minutes=5
        )

    mysql_run(scenario)


# ---------------------------------------------------------------- 성공 로그인의 실패 기록 삭제와 경합


def test_mysql_successful_login_and_failure_race():
    async def scenario(sessions):
        email = "mixed@example.com"
        await register(email, "섞인요청")
        ip = "198.51.100.40"
        await seed(sessions, email_key(email), 3, utc_now())
        async with client(ip) as good, client(ip) as bad:
            answers = await asyncio.gather(
                good.post(LOGIN, json={"email": email, "password": PASSWORD}),
                bad.post(LOGIN, json={"email": email, "password": WRONG}),
                return_exceptions=True,
            )
        statuses = [status_of(a) for a in answers]
        assert statuses == [200, 401], statuses
        r = await row(sessions, email_key(email))
        # 실패가 먼저 커밋되면 성공이 지운다(행 없음), 성공 삭제가 먼저면 실패가 새로 1회
        assert r is None or r.failed_count == 1

    mysql_run(scenario)


# ---------------------------------------------------------------- 탈퇴 비밀번호 실패 · 성공 삭제와 겹친 실패


def test_mysql_withdrawal_and_login_failures_on_the_same_email_are_both_counted():
    """탈퇴 창구의 비밀번호 실패와 로그인 실패는 같은 이메일 집계에 함께 더해진다(유실 · 5xx 없음, 회원은 그대로)."""

    async def scenario(sessions):
        email = "wdmix@example.com"
        await register(email, "탈퇴섞임")
        async with client("198.51.100.50") as member:
            assert (
                await member.post(LOGIN, json={"email": email, "password": PASSWORD})
            ).status_code == 200
            others = [client(f"198.51.100.{51 + i}") for i in range(3)]
            try:
                answers = await asyncio.gather(
                    member.post("/api/v1/me/withdrawal", json={"password": WRONG}),
                    *(
                        o.post(LOGIN, json={"email": email, "password": WRONG})
                        for o in others
                    ),
                    return_exceptions=True,
                )
            finally:
                for o in others:
                    await o.aclose()
            statuses = [status_of(a) for a in answers]
            assert set(statuses) <= {401, 429}, statuses
            assert (
                await member.get("/api/v1/me")
            ).status_code == 200  # 탈퇴되지 않았다
        assert (await row(sessions, email_key(email))).failed_count == statuses.count(
            401
        )

    mysql_run(scenario)


def test_mysql_successful_login_clears_while_several_failures_run():
    async def scenario(sessions):
        email = "clearmany@example.com"
        await register(email, "삭제경합")
        good = client("198.51.100.60")
        bads = [client(f"198.51.100.{61 + i}") for i in range(4)]
        try:
            answers = await asyncio.gather(
                good.post(LOGIN, json={"email": email, "password": PASSWORD}),
                *(
                    b.post(LOGIN, json={"email": email, "password": WRONG})
                    for b in bads
                ),
                return_exceptions=True,
            )
        finally:
            for c in [good, *bads]:
                await c.aclose()
        statuses = [status_of(a) for a in answers]
        assert statuses[0] == 200 and set(statuses[1:]) <= {401}, statuses
        r = await row(sessions, email_key(email))
        # 성공 삭제 뒤에 커밋된 실패만 남는다 — 0~4 회, 잠금 한도(5) 미만
        assert r is None or 1 <= r.failed_count <= 4
        assert r is None or r.locked_until is None

    mysql_run(scenario)


CHANGE = "/api/v1/me/password"
WITHDRAWAL = "/api/v1/me/withdrawal"
NEW_PASSWORD = "Harbor-Lamp-7316"


@asynccontextmanager
async def pause_request(monkeypatch, module, function, request, *, after=False):
    """Hold an already-started API request immediately before the chosen operation."""
    paused, resume = asyncio.Event(), asyncio.Event()
    original = getattr(module, function)

    async def gated(*args, **kwargs):
        if after:
            result = await original(*args, **kwargs)
        paused.set()
        await resume.wait()
        return result if after else await original(*args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(module, function, gated)
        task = asyncio.create_task(request)
        try:
            await asyncio.wait_for(paused.wait(), timeout=10)
            yield task, resume
        finally:
            resume.set()
            if not task.done():
                await asyncio.wait_for(task, timeout=10)


@pytest.mark.parametrize("reset_first", [True, False])
def test_mysql_reset_completion_and_in_flight_login_failure(monkeypatch, reset_first):
    outbox = []
    monkeypatch.setattr(mailer, "outbox", outbox.append)

    async def scenario(sessions):
        email, ip = "reset-race@example.com", "198.51.100.80"
        key = email_key(email)
        await register(email, "MapleFern")
        async with client(ip) as http:
            assert (await http.post(REQUEST, json={"email": email})).status_code == 200
            verified = await http.post(
                VERIFY, json={"email": email, "code": code_in(outbox[0])}
            )
            assert verified.status_code == 200
            payload = {
                "reset_token": verified.json()["reset_token"],
                "new_password": NEW_PASSWORD,
            }
            async with pause_request(
                monkeypatch,
                auth,
                "record_login_failure",
                http.post(LOGIN, json={"email": email, "password": WRONG}),
            ) as (failed, resume):
                now = utc_now()
                locked_until = now + THROTTLE_WINDOW
                await seed(sessions, key, MAX_FAILURES_PER_EMAIL, now, locked_until)
                if not reset_first:
                    resume.set()
                    assert (await failed).status_code == 401
                    locked = await row(sessions, key)
                    assert (locked.failed_count, locked.locked_until) == (
                        MAX_FAILURES_PER_EMAIL + 1,
                        locked_until,
                    )
                assert (await http.post(COMPLETE, json=payload)).status_code == 204
                assert await row(sessions, key) is None
                resume.set()
                assert (await failed).status_code == 401
            final = await row(sessions, key)
            if reset_first:
                assert (final.failed_count, final.locked_until) == (1, None)
            else:
                assert final is None
            assert (await row(sessions, ip_key(ip))).failed_count == 1

    mysql_run(scenario)


def test_mysql_password_change_and_login_failures_share_keys(monkeypatch, clock):
    async def scenario(sessions):
        email, ip = "change-race@example.com", "198.51.100.81"
        key = email_key(email)
        await register(email, "CedarLynx")
        async with client(ip) as member, client(ip) as other:
            assert (
                await member.post(LOGIN, json={"email": email, "password": PASSWORD})
            ).status_code == 200
            await seed(sessions, key, MAX_FAILURES_PER_EMAIL - 2, NOW)
            payload = {"current_password": WRONG, "new_password": NEW_PASSWORD}
            async with pause_request(
                monkeypatch,
                me,
                "record_login_failure",
                member.post(CHANGE, json=payload),
            ) as (failed, resume):
                assert (
                    await other.post(LOGIN, json={"email": email, "password": WRONG})
                ).status_code == 401
                resume.set()
                response = await failed
                assert response.status_code == 401
                assert response.json()["detail"]["code"] == "invalid_password"
            assert (await row(sessions, key)).failed_count == MAX_FAILURES_PER_EMAIL
            assert (await row(sessions, key)).locked_until == NOW + THROTTLE_WINDOW
            assert (await row(sessions, ip_key(ip))).failed_count == 2
            clock["now"] = NOW + timedelta(microseconds=1)
            response = await member.post(CHANGE, json=payload)
            assert response.status_code == 429
            assert response.json()["detail"]["code"] == "login_locked"
            assert response.headers["Retry-After"] == "900"
            assert (await row(sessions, key)).failed_count == MAX_FAILURES_PER_EMAIL

    mysql_run(scenario)


@pytest.mark.parametrize(
    "stage", ["before_member_lock", "before_failure_write", "after_failure_write"]
)
def test_mysql_password_change_failure_and_withdrawal(monkeypatch, stage):
    async def scenario(sessions):
        email, ip = "change-withdraw@example.com", "198.51.100.82"
        await register(email, "RiverFrost")
        async with client(ip) as member, client(ip) as withdrawing:
            for http in (member, withdrawing):
                assert (
                    await http.post(LOGIN, json={"email": email, "password": PASSWORD})
                ).status_code == 200
            if stage == "before_member_lock":
                function = "change_password"
            else:
                function = "record_login_failure"
            payload = {"current_password": WRONG, "new_password": NEW_PASSWORD}
            async with pause_request(
                monkeypatch,
                me,
                function,
                member.post(CHANGE, json=payload),
                after=stage == "after_failure_write",
            ) as (changed, resume):
                assert (
                    await withdrawing.post(WITHDRAWAL, json={"password": PASSWORD})
                ).status_code == 204
                resume.set()
                response = await changed
            assert response.status_code == 401
            if stage == "before_member_lock":
                assert response.json()["detail"] == "Login required."
            else:
                assert response.json()["detail"]["code"] == "invalid_password"
            assert (await member.get("/api/v1/me")).status_code == 401
        remaining = await row(sessions, email_key(email))
        if stage == "before_failure_write":
            # An already validated wrong password is counted after the withdrawal commits.
            assert (remaining.failed_count, remaining.locked_until) == (1, None)
        else:
            assert remaining is None
        ip_row = await row(sessions, ip_key(ip))
        if stage == "before_member_lock":
            assert ip_row is None
        else:
            assert ip_row.failed_count == 1

    mysql_run(scenario)


@pytest.mark.parametrize("success_first", [True, False])
def test_mysql_success_login_and_failure_in_both_commit_orders(
    monkeypatch, success_first
):
    async def scenario(sessions):
        email, ip = "success-order@example.com", "198.51.100.83"
        key = email_key(email)
        await register(email, "AmberPine")
        await seed(sessions, key, 2, utc_now())
        async with client(ip) as good, client(ip) as bad:
            success = good.post(LOGIN, json={"email": email, "password": PASSWORD})
            failure = bad.post(LOGIN, json={"email": email, "password": WRONG})
            first, second = (success, failure) if success_first else (failure, success)
            function = (
                "record_login_failure" if success_first else "clear_login_failures"
            )
            async with pause_request(monkeypatch, auth, function, second) as (
                pending,
                resume,
            ):
                assert (await first).status_code == (200 if success_first else 401)
                resume.set()
                assert (await pending).status_code == (401 if success_first else 200)
        remaining = await row(sessions, key)
        if success_first:
            assert remaining.failed_count == 1
        else:
            assert remaining is None
        assert (await row(sessions, ip_key(ip))).failed_count == 1

    mysql_run(scenario)


def test_mysql_real_lock_timeout_retries_without_double_count(monkeypatch):
    async def scenario(sessions):
        email, ip = "timeout-retry@example.com", "198.51.100.84"
        email_throttle, ip_throttle = email_key(email), ip_key(ip)
        first, second = sorted((email_throttle, ip_throttle))
        await seed(sessions, first, 1, utc_now())
        await seed(sessions, second, 1, utc_now())
        timed_out = asyncio.Event()
        errors = []
        engine = sessions.kw["bind"]
        async with (
            engine.connect() as connection,
            sessions() as holder,
            sessions(bind=connection) as writer,
        ):
            await holder.execute(
                select(LoginThrottle)
                .where(LoginThrottle.key_hash == second)
                .with_for_update()
            )
            await writer.execute(text("SET SESSION innodb_lock_wait_timeout=1"))
            original = writer.execute

            async def observe(*args, **kwargs):
                try:
                    return await original(*args, **kwargs)
                except OperationalError as error:
                    errors.append(error.orig.args[0])
                    timed_out.set()
                    raise

            monkeypatch.setattr(writer, "execute", observe)
            write = asyncio.create_task(record_login_failure(writer, req(ip), email))
            try:
                await asyncio.wait_for(timed_out.wait(), timeout=10)
            finally:
                await holder.rollback()
                await asyncio.wait_for(write, timeout=10)
                await original(text("SET SESSION innodb_lock_wait_timeout=DEFAULT"))
                await writer.rollback()
        assert errors == [1205]
        for key in (email_throttle, ip_throttle):
            assert (await row(sessions, key)).failed_count == 2

    mysql_run(scenario)
