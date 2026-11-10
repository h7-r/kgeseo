"""격리 MySQL + 실제 인증 라우터로 로그인 잠금 429 의 `Retry-After`를 검증한다(베타 전 보안 PR A).

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`, 전용 빈 schema,
datadir 대조, 끝나면 테이블을 지운다). 계정 · 비밀번호는 가상 테스트 값이다. 잠금 시계만 고정한다.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import httpx
from sqlalchemy import func, select

from app.db.session import get_db
from app.main import app
from app.models.account_data import LoginThrottle
from app.services import user_session
from app.services.user_session import (
    MAX_FAILURES_PER_EMAIL,
    MAX_FAILURES_PER_IP,
    THROTTLE_WINDOW,
)
from tests.test_npc_turn_idempotency_mysql import mysql_run, pytestmark  # noqa: F401

ORIGIN = "http://localhost:5175"  # 기본 CORS_ORIGINS(개발) 안의 값
PASSWORD = "Synthetic-Only-9!"
WRONG = "Wrong-Password-9!"
NOW = datetime(2026, 11, 10, 3, 0, 0)
WINDOW = int(THROTTLE_WINDOW.total_seconds())
LOCKED = {
    "detail": {
        "code": "login_locked",
        "message": "로그인 실패가 많아 잠시 막혔습니다. 15분 뒤 다시 시도해 주세요.",
    }
}


def run(scenario, monkeypatch):
    clock = {"now": NOW}
    monkeypatch.setattr(user_session, "utc_now", lambda: clock["now"])

    async def wrapped(sessions):
        async def override_get_db():
            async with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"Origin": ORIGIN},
        )
        try:
            await scenario(sessions, client, clock)
        finally:
            await client.aclose()
            app.dependency_overrides.pop(get_db, None)

    mysql_run(wrapped)


async def register(client) -> str:
    email = f"it-lock-{uuid4().hex[:10]}@example.invalid"
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": PASSWORD,
            "nickname": f"가상{uuid4().int % 100000:05d}",
            "consent": {"terms": True, "privacy": True, "age": True},
        },
    )
    assert response.status_code == 201, response.text
    return email


async def login(client, email, password=WRONG) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


def test_mysql_email_lock_returns_retry_after_from_the_stored_lock(monkeypatch):
    async def scenario(sessions, client, clock):
        email = await register(client)
        for _ in range(MAX_FAILURES_PER_EMAIL):
            assert (await login(client, email)).status_code == 401

        locked = await login(
            client, email, PASSWORD
        )  # 맞는 비밀번호도 잠금 중에는 막힌다
        assert locked.status_code == 429
        assert locked.json() == LOCKED
        assert locked.headers["retry-after"] == str(WINDOW)
        assert locked.headers["cache-control"] == "no-store"

        clock["now"] = NOW + timedelta(seconds=600)
        later = await login(client, email, PASSWORD)
        assert (later.status_code, later.headers["retry-after"]) == (
            429,
            str(WINDOW - 600),
        )

        clock["now"] = NOW + THROTTLE_WINDOW
        released = await login(client, email, PASSWORD)
        assert released.status_code == 200
        assert "retry-after" not in released.headers

    run(scenario, monkeypatch)


def test_mysql_ip_lock_blocks_other_emails_and_keeps_its_window(monkeypatch):
    async def scenario(sessions, client, clock):
        email = await register(client)
        for index in range(MAX_FAILURES_PER_IP):
            clock["now"] = NOW + timedelta(seconds=index)
            # 계정마다 1회씩: 이메일 한도(5)에는 닿지 않고 IP 한도(30)에만 닿는다
            response = await login(client, f"spray{index}@example.invalid")
            assert response.status_code == 401
        locked_at = NOW + timedelta(seconds=MAX_FAILURES_PER_IP - 1)

        clock["now"] = locked_at + timedelta(seconds=30)
        blocked = await login(client, email, PASSWORD)
        assert blocked.status_code == 429
        assert blocked.json() == LOCKED
        assert blocked.headers["retry-after"] == str(WINDOW - 30)

        async with sessions() as db:
            rows = await db.scalar(select(func.count()).select_from(LoginThrottle))
        assert (
            rows == MAX_FAILURES_PER_IP + 1
        )  # 이메일 30개 + IP 1개(잠금 판정은 행을 늘리지 않는다)

    run(scenario, monkeypatch)
