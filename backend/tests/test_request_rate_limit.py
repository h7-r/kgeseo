"""베타 전 보안 PR B — IP 기준 요청 빈도 제한(DB 없이 재현되는 부분).

- 한도 · 재허용 · API 별 · IP 별 독립 · 같은 IP 동시 요청 · 설정 기본값과 거부 · APP_ENV 와 무관.
- IP 판별: 운영과 같은 Uvicorn 프록시 처리(`ProxyHeadersMiddleware`, 기본 신뢰 주소 127.0.0.1)를 앞에 두고
  위조한 `X-Forwarded-For`가 카운터를 바꾸지 못하는지, 신뢰 프록시(Caddy → 127.0.0.1:8000)를 거친 요청은 실제
  클라이언트 주소로 세는지 본다. 실제 Uvicorn 서버(127.0.0.1)를 띄워 같은 동작을 한 번 더 확인한다.
- 실제 DB 를 쓰는 가입 · 게스트 재사용 흐름은 `test_request_rate_limit_mysql.py`.
"""

import asyncio
import socket
import threading
import time

import httpx
import pytest
import uvicorn
from pydantic import ValidationError
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.config import Settings, settings
from app.main import app
from app.services import local_auth, request_rate_limit
from app.services.request_rate_limit import (
    ANONYMOUS_SESSION_CREATE,
    EMAIL_EXISTS,
    NICKNAME_EXISTS,
    RATE_LIMITED_CODE,
    RATE_LIMITED_MESSAGE,
    REGISTER,
    RateLimitRule,
    SlidingWindowLimiter,
    configured_rule,
)

ORIGIN = "http://localhost:5175"  # 기본 CORS_ORIGINS(개발) 안의 값
RATE_LIMITED = {"detail": {"code": "rate_limited", "message": RATE_LIMITED_MESSAGE}}
CADDY = "127.0.0.1"  # 운영 Caddy 가 Uvicorn 에 붙는 주소(127.0.0.1:8000)


# ── 제한기 단위 ──


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_limiter_allows_up_to_the_limit_then_reports_retry_after() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter(clock)
    rule = RateLimitRule("r", limit=3, window_sec=60)
    for _ in range(3):
        assert limiter.try_acquire(rule, "198.51.100.1") == 0
        clock.now += 10
    # 첫 허용(1000)이 창에서 빠지는 1060 까지 남은 30초
    assert limiter.try_acquire(rule, "198.51.100.1") == 30
    clock.now = 1059.5
    assert limiter.try_acquire(rule, "198.51.100.1") == 1  # 0.5초 → 올림 1
    clock.now = 1060.0
    assert limiter.try_acquire(rule, "198.51.100.1") == 0  # 재허용


def test_blocked_requests_are_not_counted() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter(clock)
    rule = RateLimitRule("r", limit=2, window_sec=60)
    assert limiter.try_acquire(rule, "a") == 0
    assert limiter.try_acquire(rule, "a") == 0
    for _ in range(100):  # 막힌 요청을 아무리 보내도 창이 밀리지 않는다
        assert limiter.try_acquire(rule, "a") == 60
    clock.now += 60
    assert limiter.try_acquire(rule, "a") == 0


def test_rules_and_ips_are_counted_independently() -> None:
    limiter = SlidingWindowLimiter(Clock())
    one = RateLimitRule("one", limit=1, window_sec=60)
    two = RateLimitRule("two", limit=1, window_sec=60)
    assert limiter.try_acquire(one, "198.51.100.1") == 0
    assert limiter.try_acquire(one, "198.51.100.1") > 0
    assert limiter.try_acquire(two, "198.51.100.1") == 0  # 다른 규칙
    assert limiter.try_acquire(one, "198.51.100.2") == 0  # 다른 IP


def test_lowering_a_limit_waits_until_the_window_is_under_the_new_limit() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter(clock)
    for second in range(5):
        clock.now = 1000.0 + second
        assert limiter.try_acquire(RateLimitRule("r", 5, 60), "a") == 0
    clock.now = 1010.0
    # 한도를 2로 줄이면 새 요청을 받을 자리가 생길 때 — 1004 하나만 남는 1063 — 까지 기다린다
    assert limiter.try_acquire(RateLimitRule("r", 2, 60), "a") == 53


def test_sweep_drops_idle_keys_only() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter(clock)
    rule = RateLimitRule("r", limit=5, window_sec=60)
    limiter.try_acquire(rule, "idle")
    clock.now += 61
    for index in range(SlidingWindowLimiter.SWEEP_EVERY):
        limiter.try_acquire(rule, f"busy{index % 3}")
    assert ("r", "idle") not in limiter._hits
    assert ("r", "busy0") in limiter._hits


# ── 설정 ──


def _settings(**values) -> Settings:
    base = dict(
        _env_file=None,
        db_host="db.invalid",
        db_user="app",
        db_password="synthetic-only",
        db_name="app",
    )
    return Settings(**(base | values))


def test_defaults_are_the_confirmed_limits_when_env_is_missing(monkeypatch) -> None:
    for key in (
        "RATE_LIMIT_WINDOW_SEC",
        "RATE_LIMIT_EMAIL_EXISTS",
        "RATE_LIMIT_NICKNAME_EXISTS",
        "RATE_LIMIT_REGISTER",
        "RATE_LIMIT_ANONYMOUS_SESSION_CREATE",
    ):
        monkeypatch.delenv(key, raising=False)
    built = _settings()
    assert (
        built.rate_limit_window_sec,
        built.rate_limit_email_exists,
        built.rate_limit_nickname_exists,
        built.rate_limit_register,
        built.rate_limit_anonymous_session_create,
    ) == (60, 30, 30, 30, 60)


@pytest.mark.parametrize(
    ("key", "field"),
    [
        ("RATE_LIMIT_EMAIL_EXISTS", "rate_limit_email_exists"),
        ("RATE_LIMIT_NICKNAME_EXISTS", "rate_limit_nickname_exists"),
        ("RATE_LIMIT_REGISTER", "rate_limit_register"),
        ("RATE_LIMIT_ANONYMOUS_SESSION_CREATE", "rate_limit_anonymous_session_create"),
        ("RATE_LIMIT_WINDOW_SEC", "rate_limit_window_sec"),
    ],
)
def test_env_can_change_each_value(monkeypatch, key, field) -> None:
    monkeypatch.setenv(key, "45")
    assert getattr(_settings(), field) == 45


def test_values_can_also_come_from_the_env_file(tmp_path, monkeypatch) -> None:
    # 운영 `.env`(EnvironmentFile 또는 작업 폴더의 .env)와 같은 형식. 이 파일은 테스트 전용 임시 파일이다.
    monkeypatch.delenv("RATE_LIMIT_REGISTER", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("RATE_LIMIT_REGISTER=100\n", encoding="utf-8")
    assert _settings(_env_file=env_file).rate_limit_register == 100


@pytest.mark.parametrize(
    "key",
    [
        "RATE_LIMIT_EMAIL_EXISTS",
        "RATE_LIMIT_NICKNAME_EXISTS",
        "RATE_LIMIT_REGISTER",
        "RATE_LIMIT_ANONYMOUS_SESSION_CREATE",
        "RATE_LIMIT_WINDOW_SEC",
    ],
)
@pytest.mark.parametrize("value", ["0", "-1", "", "off", "3.5", "1e9x"])
def test_invalid_values_fail_settings_loading(monkeypatch, key, value) -> None:
    # 잘못된 값은 조용히 기본값으로 바꾸거나 제한을 끄지 않는다 — 설정 로딩(=API 시작)이 실패한다
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError) as error:
        _settings()
    assert key.lower() in str(error.value)


def test_window_has_an_upper_bound(monkeypatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_WINDOW_SEC", "3601")
    with pytest.raises(ValidationError):
        _settings()


def test_invalid_value_errors_do_not_echo_the_input(monkeypatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_REGISTER", "secret-looking-typo")
    with pytest.raises(ValidationError) as error:
        _settings()
    assert "secret-looking-typo" not in str(error.value)


def test_running_rules_follow_the_settings() -> None:
    assert configured_rule(EMAIL_EXISTS) == RateLimitRule(EMAIL_EXISTS, 30, 60)
    assert configured_rule(NICKNAME_EXISTS) == RateLimitRule(NICKNAME_EXISTS, 30, 60)
    assert configured_rule(REGISTER) == RateLimitRule(REGISTER, 30, 60)
    assert configured_rule(ANONYMOUS_SESSION_CREATE) == RateLimitRule(
        ANONYMOUS_SESSION_CREATE, 60, 60
    )


# ── HTTP: 한도 · 독립성 · 동시성 · APP_ENV (DB 대신 존재 확인 함수만 바꾼다) ──


@pytest.fixture
def clock(monkeypatch) -> Clock:
    state = Clock()
    monkeypatch.setattr(request_rate_limit, "_limiter", SlidingWindowLimiter(state))
    return state


@pytest.fixture(autouse=True)
def no_db_lookups(monkeypatch) -> None:
    async def never_exists(db, value):
        await asyncio.sleep(0)  # 동시 요청이 서로 끼어들 수 있게 한 번 양보한다
        return False

    monkeypatch.setattr(local_auth, "email_exists", never_exists)
    monkeypatch.setattr(local_auth, "nickname_exists", never_exists)


def _client(asgi=app, client=("203.0.113.10", 50000)) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=asgi, client=client),
        base_url="http://testserver",
        headers={"Origin": ORIGIN},
    )


async def _email(http, **kwargs) -> httpx.Response:
    return await http.post(
        "/api/v1/auth/email-exists", json={"email": "a@example.com"}, **kwargs
    )


async def _nickname(http, **kwargs) -> httpx.Response:
    return await http.post(
        "/api/v1/auth/nickname-exists", json={"nickname": "조사관"}, **kwargs
    )


async def _register_invalid(http) -> httpx.Response:
    # 본문 검증(422)보다 빈도 제한을 먼저 센다 — DB 없이 가입 한도를 재현한다
    return await http.post("/api/v1/auth/register", json={})


def assert_rate_limited(response: httpx.Response, retry_after: int) -> None:
    assert response.status_code == 429
    assert response.json() == RATE_LIMITED
    assert response.json()["detail"]["code"] == RATE_LIMITED_CODE
    assert response.headers["retry-after"] == str(retry_after)
    assert response.headers["cache-control"] == "no-store"
    # 웹사이트가 Retry-After 를 읽을 수 있다(CORS expose)
    assert response.headers["access-control-expose-headers"] == "Retry-After"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("send", "limit", "ok_status"),
    [(_email, 30, 200), (_nickname, 30, 200), (_register_invalid, 30, 422)],
)
async def test_auth_route_limit_then_429_then_allowed_again(
    clock, send, limit, ok_status
) -> None:
    async with _client() as http:
        for _ in range(limit):
            assert (await send(http)).status_code == ok_status
        clock.now += 15
        assert_rate_limited(await send(http), retry_after=45)
        clock.now += 45
        assert (await send(http)).status_code == ok_status


@pytest.mark.anyio
async def test_each_route_has_its_own_counter(clock) -> None:
    async with _client() as http:
        for _ in range(30):
            await _register_invalid(http)
        assert (await _register_invalid(http)).status_code == 429
        # 가입이 막혀도 이메일 · 닉네임 확인과 로그인 · 게스트 발급 경로는 그대로다
        assert (await _email(http)).status_code == 200
        assert (await _nickname(http)).status_code == 200
        for _ in range(29):
            await _email(http)
        assert (await _email(http)).status_code == 429
        assert (await _nickname(http)).status_code == 200


@pytest.mark.anyio
async def test_each_ip_has_its_own_counter(clock) -> None:
    async with (
        _client(client=("203.0.113.10", 1)) as first,
        _client(client=("203.0.113.11", 1)) as second,
    ):
        for _ in range(30):
            await _email(first)
        assert (await _email(first)).status_code == 429
        assert (await _email(second)).status_code == 200


@pytest.mark.anyio
async def test_concurrent_requests_from_one_ip_never_exceed_the_limit(clock) -> None:
    async with _client() as http:
        responses = await asyncio.gather(*(_email(http) for _ in range(75)))
    statuses = [response.status_code for response in responses]
    assert statuses.count(200) == 30
    assert statuses.count(429) == 45


@pytest.mark.anyio
@pytest.mark.parametrize("app_env", ["development", "production", "test"])
async def test_limits_apply_whatever_app_env_is(clock, monkeypatch, app_env) -> None:
    # 지금 운영은 APP_ENV 가 없어 development 로 뜬다 — 그때도 제한은 켜져 있어야 한다
    monkeypatch.setattr(settings, "app_env", app_env)
    async with _client() as http:
        for _ in range(30):
            assert (await _nickname(http)).status_code == 200
        assert (await _nickname(http)).status_code == 429


@pytest.mark.anyio
async def test_register_allows_the_30th_request_and_blocks_the_31st(clock) -> None:
    async with _client() as http:
        statuses = [(await _register_invalid(http)).status_code for _ in range(31)]
    assert statuses[:30] == [422] * 30  # 한도 안(본문 검증 오류는 정상 처리된 요청이다)
    assert statuses[30] == 429


@pytest.mark.anyio
async def test_configured_limits_drive_each_route(clock, monkeypatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_email_exists", 2)
    monkeypatch.setattr(settings, "rate_limit_nickname_exists", 4)
    monkeypatch.setattr(settings, "rate_limit_register", 3)
    monkeypatch.setattr(settings, "rate_limit_window_sec", 10)
    async with _client() as http:
        assert [(await _email(http)).status_code for _ in range(3)] == [200, 200, 429]
        assert [(await _nickname(http)).status_code for _ in range(5)] == [200] * 4 + [
            429
        ]
        assert [(await _register_invalid(http)).status_code for _ in range(4)] == [
            422,
            422,
            422,
            429,
        ]
        assert (await _email(http)).headers["retry-after"] == "10"
        clock.now += 10
        assert (await _email(http)).status_code == 200


@pytest.mark.anyio
async def test_a_raised_limit_keeps_the_counts_already_made(clock, monkeypatch) -> None:
    # 한 프로세스 안에서 값이 바뀌면(테스트에서만 가능 — 운영은 재시작이 필요하다) 이미 센 요청은 그대로 남는다
    monkeypatch.setattr(settings, "rate_limit_email_exists", 2)
    async with _client() as http:
        await _email(http)
        await _email(http)
        assert (await _email(http)).status_code == 429
        monkeypatch.setattr(settings, "rate_limit_email_exists", 3)
        assert (await _email(http)).status_code == 200
        assert (await _email(http)).status_code == 429


@pytest.mark.anyio
async def test_foreign_origin_is_rejected_before_it_is_counted(clock) -> None:
    async with _client() as http:
        for _ in range(40):
            response = await _email(http, headers={"Origin": "https://evil.example"})
            assert response.status_code == 403
        assert (await _email(http)).status_code == 200


# ── IP 판별: 운영과 같은 Uvicorn 프록시 처리를 앞에 둔다 ──


def test_uvicorn_defaults_trust_only_loopback_proxy(monkeypatch) -> None:
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    config = uvicorn.Config(app, lifespan="off")
    assert config.proxy_headers is True
    assert config.forwarded_allow_ips == "127.0.0.1"
    config.load()
    assert isinstance(config.loaded_app, ProxyHeadersMiddleware)


def _behind_uvicorn() -> ProxyHeadersMiddleware:
    return ProxyHeadersMiddleware(app, trusted_hosts="127.0.0.1")


@pytest.mark.anyio
async def test_spoofed_forwarded_for_from_an_untrusted_client_is_ignored(clock) -> None:
    async with _client(_behind_uvicorn(), client=("203.0.113.50", 40000)) as http:
        for index in range(30):
            forged = {"X-Forwarded-For": f"198.51.100.{index}"}
            assert (await _email(http, headers=forged)).status_code == 200
        # 헤더를 바꿔도 연결 주소 203.0.113.50 하나로 센다
        forged = {"X-Forwarded-For": "192.0.2.200"}
        assert (await _email(http, headers=forged)).status_code == 429


@pytest.mark.anyio
async def test_requests_through_the_trusted_proxy_count_the_real_client(clock) -> None:
    async with _client(_behind_uvicorn(), client=(CADDY, 40000)) as caddy:
        for _ in range(30):
            sent = {"X-Forwarded-For": "198.51.100.7"}
            assert (await _email(caddy, headers=sent)).status_code == 200
        assert (
            await _email(caddy, headers={"X-Forwarded-For": "198.51.100.7"})
        ).status_code == 429
        # 같은 Caddy 연결이라도 다른 실제 클라이언트는 따로 센다(Caddy 주소 하나로 묶이지 않는다)
        assert (
            await _email(caddy, headers={"X-Forwarded-For": "198.51.100.8"})
        ).status_code == 200


@pytest.mark.anyio
async def test_a_forged_left_entry_cannot_dodge_the_limit_through_the_proxy(
    clock,
) -> None:
    # Caddy 가 실제 주소를 오른쪽에 붙이는 형태라도 Uvicorn 은 오른쪽부터 첫 신뢰하지 않는 주소를 쓴다
    async with _client(_behind_uvicorn(), client=(CADDY, 40000)) as caddy:
        for index in range(30):
            sent = {"X-Forwarded-For": f"10.0.0.{index}, 198.51.100.9"}
            assert (await _email(caddy, headers=sent)).status_code == 200
        sent = {"X-Forwarded-For": "10.9.9.9, 198.51.100.9"}
        assert (await _email(caddy, headers=sent)).status_code == 429


@pytest.mark.anyio
async def test_proxy_without_forwarded_for_counts_the_proxy_address(clock) -> None:
    # Caddy 가 헤더를 넣지 않으면 모두 127.0.0.1 로 묶인다 — 운영 Caddy 설정 확인 항목(보고서)
    async with _client(_behind_uvicorn(), client=(CADDY, 40000)) as caddy:
        for _ in range(30):
            await _email(caddy)
        assert (await _email(caddy)).status_code == 429


# ── 실제 Uvicorn 서버(기본 설정, 127.0.0.1) ──


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_real_uvicorn_on_loopback_uses_forwarded_for_from_the_local_proxy(
    clock, monkeypatch
) -> None:
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            app, host="127.0.0.1", port=port, lifespan="off", log_level="warning"
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            assert time.monotonic() < deadline, "uvicorn did not start"
            time.sleep(0.02)
        url = f"http://127.0.0.1:{port}/api/v1/auth/email-exists"
        with httpx.Client(headers={"Origin": ORIGIN}) as http:

            def send(forwarded: str | None) -> int:
                headers = {"X-Forwarded-For": forwarded} if forwarded else {}
                return http.post(
                    url, json={"email": "a@example.com"}, headers=headers
                ).status_code

            # 이 테스트 프로세스가 같은 호스트의 Caddy 자리(127.0.0.1 연결)다
            assert [send("198.51.100.21") for _ in range(30)] == [200] * 30
            assert send("198.51.100.21") == 429
            assert send("198.51.100.22") == 200
            assert send(None) == 200  # 헤더가 없으면 127.0.0.1 로 센다(첫 요청)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
