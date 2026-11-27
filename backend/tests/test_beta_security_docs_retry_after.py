"""베타 전 보안 PR A — 운영 API 문서 끄기 · 로그인 잠금 429 의 Retry-After.

- 문서 경로(`/docs` · `/redoc` · `/openapi.json`)는 `APP_ENV=production`에서만 404, 개발 · 테스트는 그대로.
- 로그인 잠금 정책(15분 안 이메일당 5회 · IP당 30회 실패)은 그대로이고, 429 에 남은 잠금 초를 `Retry-After`로 싣는다.
"""

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.deployment import api_docs_settings
from app.main import app
from app.services import user_session

DOC_PATHS = ("/docs", "/redoc", "/openapi.json")
MAIN_PATH = Path(__file__).resolve().parents[1] / "app" / "main.py"


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


# 실패 집계 → 잠금 → 남은 초 계산은 실제 MySQL 에서 본다(실패 집계가 한 문장 UPSERT 라 가짜 세션으로는 돌 수 없다).
# 옮긴 시험(단정 그대로): tests/test_login_throttle_concurrency_mysql.py 의
# test_mysql_email_lock_reports_exact_remaining_seconds · test_mysql_ip_lock_applies_to_other_emails_with_its_own_remaining_time ·
# test_mysql_both_locks_report_the_later_release


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
    # 11/18 — message 의 시간은 Retry-After 와 같은 숫자다(437초 → 올림 8분). 고정 「15분」이 아니다
    assert response.json() == {
        "detail": {
            "code": "login_locked",
            "message": "로그인 실패가 많아 잠시 막혔습니다. 8분 뒤 다시 시도해 주세요.",
        }
    }


@pytest.mark.parametrize(
    ("seconds", "phrase"),
    [
        (1, "1초 뒤"),
        (59, "59초 뒤"),
        (60, "1분 뒤"),
        (61, "2분 뒤"),
        (437, "8분 뒤"),
        (900, "15분 뒤"),
    ],
)
def test_wait_phrase_rounds_up_to_minutes_like_the_website(seconds, phrase) -> None:
    assert user_session.wait_phrase(seconds) == phrase


def test_login_429_message_follows_the_remaining_seconds(
    client: TestClient, monkeypatch
) -> None:
    async def remaining(db, request, email):
        return 45

    monkeypatch.setattr("app.api.v1.auth.login_lock_remaining_seconds", remaining)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "sejin@example.com", "password": "WrongPassword123!"},
    )

    assert response.headers["retry-after"] == "45"
    assert response.json()["detail"]["message"].endswith("45초 뒤 다시 시도해 주세요.")


def test_retry_after_is_readable_by_the_website_through_cors() -> None:
    cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert "Retry-After" in cors.kwargs["expose_headers"]
