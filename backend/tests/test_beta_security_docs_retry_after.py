"""베타 전 보안 PR A — 운영 API 문서 끄기 · 로그인 잠금 429 의 Retry-After.

- 문서 경로(`/docs` · `/redoc` · `/openapi.json`)는 `APP_ENV=production`에서만 404, 개발 · 테스트는 그대로.
- 로그인 잠금 정책(15분 안 이메일당 5회 · IP당 30회 실패)은 그대로이고, 429 에 남은 잠금 초를 `Retry-After`로 싣는다.
"""

import importlib.util
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.deployment import api_docs_settings
from app.main import app
from app.models.account_data import LoginThrottle
from app.services import user_session
from app.services.user_session import (
    MAX_FAILURES_PER_EMAIL,
    MAX_FAILURES_PER_IP,
    THROTTLE_WINDOW,
    login_lock_remaining_seconds,
    record_login_failure,
)

DOC_PATHS = ("/docs", "/redoc", "/openapi.json")
MAIN_PATH = Path(__file__).resolve().parents[1] / "app" / "main.py"
NOW = datetime(2026, 11, 10, 3, 0, 0)


# ── 문서 경로 ──


def test_api_docs_settings_turn_off_only_in_production() -> None:
    assert api_docs_settings("production") == {
        "docs_url": None,
        "redoc_url": None,
        "openapi_url": None,
    }
    for env in ("development", "test"):
        assert api_docs_settings(env) == {
            "docs_url": "/docs",
            "redoc_url": "/redoc",
            "openapi_url": "/openapi.json",
        }


def _main_module_built_with(monkeypatch, app_env: str):
    """`app/main.py`를 별도 모듈 이름으로 한 번 더 실행해 그 환경의 앱을 만든다(`sys.modules["app.main"]`은 그대로)."""

    monkeypatch.setattr(settings, "app_env", app_env)
    spec = importlib.util.spec_from_file_location(f"main_as_{app_env}", MAIN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_production_app_hides_all_api_docs(monkeypatch) -> None:
    production = _main_module_built_with(monkeypatch, "production").app
    client = TestClient(production)
    for path in DOC_PATHS:
        assert client.get(path).status_code == 404, path
    # 문서만 끈다 — API 자체는 그대로
    assert client.get("/api/v1/health").json() == {"status": "ok"}


@pytest.mark.parametrize("app_env", ["development", "test"])
def test_development_and_test_apps_keep_api_docs(monkeypatch, app_env) -> None:
    built = _main_module_built_with(monkeypatch, app_env).app
    client = TestClient(built)
    for path in DOC_PATHS:
        assert client.get(path).status_code == 200, path
    assert "/api/v1/auth/login" in client.get("/openapi.json").json()["paths"]


def test_running_test_app_keeps_api_docs(client: TestClient) -> None:
    # 테스트 실행 중인 실제 앱(APP_ENV=test)은 문서를 연다(OpenAPI 를 읽는 기존 테스트의 전제).
    assert settings.app_env != "production"
    assert (app.docs_url, app.redoc_url, app.openapi_url) == (
        "/docs",
        "/redoc",
        "/openapi.json",
    )
    for path in DOC_PATHS:
        assert client.get(path).status_code == 200, path


# ── 남은 잠금 시간 계산 ──


class ThrottleDb:
    """`LoginThrottle` 행을 키별로 두는 대역(`db.get` · `add` · `commit` · `delete`만)."""

    def __init__(self) -> None:
        self.rows: dict[str, LoginThrottle] = {}

    async def get(self, model, key):
        assert model is LoginThrottle
        return self.rows.get(key)

    def add(self, row) -> None:
        self.rows[row.key_hash] = row

    async def commit(self) -> None:
        pass

    async def delete(self, row) -> None:
        self.rows.pop(row.key_hash, None)


def _request(ip: str = "203.0.113.7"):
    return SimpleNamespace(client=SimpleNamespace(host=ip))


@pytest.fixture
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(user_session, "utc_now", lambda: state["now"])
    return state


async def _fail(db, email, ip, count):
    for _ in range(count):
        await record_login_failure(db, _request(ip), email)


@pytest.mark.anyio
async def test_email_lock_reports_exact_remaining_seconds(clock) -> None:
    db = ThrottleDb()
    await _fail(db, "a@example.com", "203.0.113.7", MAX_FAILURES_PER_EMAIL - 1)
    assert await login_lock_remaining_seconds(db, _request(), "a@example.com") is None

    await _fail(db, "a@example.com", "203.0.113.7", 1)  # 5번째 실패 → 잠금
    window = int(THROTTLE_WINDOW.total_seconds())
    assert await login_lock_remaining_seconds(db, _request(), "a@example.com") == window

    clock["now"] = NOW + timedelta(seconds=600)
    assert await login_lock_remaining_seconds(db, _request(), "a@example.com") == (
        window - 600
    )
    # 0.2초 남음 → 올림해서 1
    clock["now"] = NOW + THROTTLE_WINDOW - timedelta(milliseconds=200)
    assert await login_lock_remaining_seconds(db, _request(), "a@example.com") == 1
    # 잠금이 풀린 순간부터는 None
    clock["now"] = NOW + THROTTLE_WINDOW
    assert await login_lock_remaining_seconds(db, _request(), "a@example.com") is None


@pytest.mark.anyio
async def test_ip_lock_applies_to_other_emails_with_its_own_remaining_time(
    clock,
) -> None:
    db = ThrottleDb()
    for index in range(MAX_FAILURES_PER_IP):
        clock["now"] = NOW + timedelta(seconds=index)
        await _fail(db, f"user{index}@example.com", "198.51.100.9", 1)
    locked_at = NOW + timedelta(seconds=MAX_FAILURES_PER_IP - 1)
    clock["now"] = locked_at + timedelta(seconds=100)
    window = int(THROTTLE_WINDOW.total_seconds())
    # 실패한 적 없는 이메일도 같은 IP 면 막힌다
    assert (
        await login_lock_remaining_seconds(
            db, _request("198.51.100.9"), "new@example.com"
        )
        == window - 100
    )
    # 다른 IP 는 막히지 않는다
    assert (
        await login_lock_remaining_seconds(db, _request("192.0.2.1"), "new@example.com")
        is None
    )


@pytest.mark.anyio
async def test_both_locks_report_the_later_release(clock) -> None:
    db = ThrottleDb()
    ip = "198.51.100.10"
    # IP 잠금을 먼저 걸고(30개 이메일), 나중에 한 이메일 잠금을 건다
    for index in range(MAX_FAILURES_PER_IP):
        await _fail(db, f"spray{index}@example.com", ip, 1)
    clock["now"] = NOW + timedelta(seconds=120)
    await _fail(db, "late@example.com", "192.0.2.50", MAX_FAILURES_PER_EMAIL)
    clock["now"] = NOW + timedelta(seconds=180)
    window = int(THROTTLE_WINDOW.total_seconds())
    # 이메일 잠금(120초에 시작)이 IP 잠금(0초에 시작)보다 늦게 풀린다
    assert (
        await login_lock_remaining_seconds(db, _request(ip), "late@example.com")
        == window - 60
    )


# ── HTTP 429 ──


def test_login_429_carries_retry_after_and_keeps_its_body(
    client: TestClient, monkeypatch
) -> None:
    async def remaining(db, request, email):
        return 437

    monkeypatch.setattr("app.api.v1.auth.login_lock_remaining_seconds", remaining)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "WrongPassword123!"},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "437"
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "detail": {
            "code": "login_locked",
            "message": "로그인 실패가 많아 잠시 막혔습니다. 15분 뒤 다시 시도해 주세요.",
        }
    }


def test_retry_after_is_readable_by_the_website_through_cors() -> None:
    cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert "Retry-After" in cors.kwargs["expose_headers"]
