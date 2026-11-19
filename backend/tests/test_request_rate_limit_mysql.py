"""격리 MySQL + 실제 라우터로 IP 기준 요청 빈도 제한(베타 전 보안 PR B)을 확인한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`, 전용 빈 schema,
datadir 대조, 끝나면 테이블을 지운다). 계정 · 비밀번호는 가상 테스트 값이다. 제한기 시계만 고정한다.

- 가입: 실제로 계정 30개를 만든 뒤 31번째는 429, 창이 지나면 다시 201. 로그인 · 확인 API 는 영향 없음.
- 게스트: 쿠키 없는 새 발급 60회 뒤 429. 유효한 게스트 쿠키의 재사용은 한도가 찬 뒤에도 201 이고 행을 만들지 않는다.
"""

from uuid import uuid4

import httpx
from sqlalchemy import func, select

from app.db.session import get_db
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.guest_session import GuestSession
from app.services import request_rate_limit
from app.services.guest_session import GUEST_COOKIE
from app.services.request_rate_limit import RATE_LIMITED_MESSAGE, SlidingWindowLimiter
from tests.test_npc_turn_idempotency_mysql import mysql_run, pytestmark  # noqa: F401

ORIGIN = "http://localhost:5175"  # 기본 CORS_ORIGINS(개발) 안의 값
PASSWORD = "Synthetic-Only-9!"
RATE_LIMITED = {"detail": {"code": "rate_limited", "message": RATE_LIMITED_MESSAGE}}


def run(scenario, monkeypatch, client_ip="203.0.113.77"):
    clock = {"now": 5000.0}
    monkeypatch.setattr(
        request_rate_limit, "_limiter", SlidingWindowLimiter(lambda: clock["now"])
    )

    async def wrapped(sessions):
        async def override_get_db():
            async with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db

        def client():
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app, client=(client_ip, 40000)),
                base_url="http://testserver",
                headers={"Origin": ORIGIN},
            )

        try:
            await scenario(sessions, client, clock)
        finally:
            app.dependency_overrides.pop(get_db, None)

    mysql_run(wrapped)


def _account() -> dict:
    return {
        "email": f"it-rl-{uuid4().hex[:10]}@example.invalid",
        "password": PASSWORD,
        "nickname": f"가상{uuid4().int % 100000:05d}",
        "consent": {"terms": True, "privacy": True, "age": True},
    }


def assert_rate_limited(response: httpx.Response, retry_after: int) -> None:
    assert response.status_code == 429, response.text
    assert response.json() == RATE_LIMITED
    assert response.headers["retry-after"] == str(retry_after)
    assert response.headers["cache-control"] == "no-store"


def test_mysql_register_limit_keeps_login_and_checks_working(monkeypatch):
    async def scenario(sessions, client, clock):
        made = []
        async with client() as http:
            for _ in range(30):
                account = _account()
                response = await http.post("/api/v1/auth/register", json=account)
                assert response.status_code == 201, response.text
                made.append(account)
                http.cookies.clear()
            clock["now"] += 20
            blocked = await http.post("/api/v1/auth/register", json=_account())
            assert_rate_limited(blocked, 40)

            # 가입만 막힌다 — 로그인 · 중복 확인은 그대로
            login = await http.post(
                "/api/v1/auth/login",
                json={"email": made[0]["email"], "password": PASSWORD},
            )
            assert login.status_code == 200, login.text
            exists = await http.post(
                "/api/v1/auth/email-exists", json={"email": made[1]["email"]}
            )
            assert exists.json() == {"exists": True}
            taken = await http.post(
                "/api/v1/auth/nickname-exists", json={"nickname": made[2]["nickname"]}
            )
            assert taken.json() == {"exists": True}

            clock["now"] += 40
            http.cookies.clear()
            again = await http.post("/api/v1/auth/register", json=_account())
            assert again.status_code == 201, again.text

    run(scenario, monkeypatch)


def test_mysql_existence_checks_limit_on_real_lookups(monkeypatch):
    async def scenario(sessions, client, clock):
        async with client() as http:
            for index in range(30):
                response = await http.post(
                    "/api/v1/auth/email-exists",
                    json={"email": f"nobody{index}@example.invalid"},
                )
                assert response.json() == {"exists": False}
            assert_rate_limited(
                await http.post(
                    "/api/v1/auth/email-exists", json={"email": "x@example.invalid"}
                ),
                60,
            )
            for index in range(30):
                response = await http.post(
                    "/api/v1/auth/nickname-exists",
                    json={"nickname": f"없는이름{index}"},
                )
                assert response.status_code == 200, response.text
            assert_rate_limited(
                await http.post(
                    "/api/v1/auth/nickname-exists", json={"nickname": "없는이름"}
                ),
                60,
            )

    run(scenario, monkeypatch)


async def _count(sessions, model) -> int:
    async with sessions() as db:
        return await db.scalar(select(func.count()).select_from(model))


def test_mysql_guest_reuse_is_never_limited_but_new_guests_are(monkeypatch):
    async def scenario(sessions, client, clock):
        async with client() as keeper:
            first = await keeper.post("/api/v1/anonymous-sessions")
            assert first.status_code == 201
            kept_id = first.json()["data"]["anonymous_session_id"]
            assert keeper.cookies.get(GUEST_COOKIE)

            async with client() as fresh:
                for _ in range(59):  # 위의 1회 + 59회 = 60회
                    response = await fresh.post("/api/v1/anonymous-sessions")
                    assert response.status_code == 201
                    fresh.cookies.clear()  # 매번 쿠키 없는 새 방문자
                clock["now"] += 5
                assert_rate_limited(await fresh.post("/api/v1/anonymous-sessions"), 55)
                assert GUEST_COOKIE not in fresh.cookies

            guests = await _count(sessions, GuestSession)
            anonymous = await _count(sessions, AnonymousSession)
            assert guests == anonymous == 60

            # 같은 IP 에서 한도가 찬 뒤에도 유효한 게스트는 자기 세션을 계속 돌려받는다
            for _ in range(100):
                reused = await keeper.post("/api/v1/anonymous-sessions")
                assert reused.status_code == 201
                assert reused.json()["data"]["anonymous_session_id"] == kept_id
            assert await _count(sessions, GuestSession) == 60

            # 다음 Play Session 생성(게임 API)도 그대로다
            created = await keeper.post(
                "/api/v1/play-sessions",
                json={"anonymous_session_id": kept_id, "case_id": "case_001"},
            )
            assert created.status_code == 201, created.text

            # 쓸 수 없는 게스트 쿠키(위조)는 새 발급이라 한도에 걸린다
            async with client() as forged:
                forged.cookies.set(GUEST_COOKIE, "not-a-real-token")
                assert (
                    await forged.post("/api/v1/anonymous-sessions")
                ).status_code == 429

            clock["now"] += 55
            async with client() as later:
                assert (
                    await later.post("/api/v1/anonymous-sessions")
                ).status_code == 201

    run(scenario, monkeypatch)
