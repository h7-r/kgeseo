import hashlib
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.core.config import settings
from app.models.anonymous_session import AnonymousSession
from app.models.guest_session import GuestSession
from app.services.guest_session import GUEST_COOKIE
from app.services.play_principal import require_play_origin
from app.services.user_session import require_same_origin
from tests.conftest import FakeAsyncSession


def test_create_anonymous_session_issues_guest(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    """쿠키가 없으면 새 익명 세션 + 게스트 세션 + 게스트 쿠키(11/6 PM). 응답 형식은 그대로다."""
    before_request = datetime.now(timezone.utc)

    response = client.post("/api/v1/anonymous-sessions")

    after_request = datetime.now(timezone.utc)
    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"

    body = response.json()
    assert body["success"] is True
    assert set(body["data"]) == {"anonymous_session_id", "expires_at"}
    UUID(body["data"]["anonymous_session_id"])

    # 게스트가 유효한 동안 Play Session 을 만들 수 있게 익명 세션 만료 = 게스트 만료(14일)
    expires_at = datetime.fromisoformat(body["data"]["expires_at"])
    assert before_request + timedelta(days=14) <= expires_at
    assert expires_at <= after_request + timedelta(days=14)

    anonymous, guest = db_session.added
    assert isinstance(anonymous, AnonymousSession)
    assert anonymous.id == body["data"]["anonymous_session_id"]
    assert anonymous.created_at.tzinfo is None
    assert anonymous.expires_at.tzinfo is None
    assert anonymous.expires_at - anonymous.created_at == timedelta(days=14)
    assert isinstance(guest, GuestSession)
    assert guest.anonymous_session_id == anonymous.id
    assert guest.expires_at == anonymous.expires_at
    assert guest.revoked_at is None
    assert db_session.commit_count == 1
    assert db_session.rollback_count == 0

    # 쿠키: HttpOnly · SameSite=Lax · Path=/ · Domain 없음 · 14일. 원문은 쿠키에만, DB 는 해시만.
    header = response.headers["set-cookie"]
    name, token = header.split(";")[0].split("=", 1)
    assert (
        name == GUEST_COOKIE == "waegok_guest"
    )  # 테스트 설정은 SESSION_COOKIE_SECURE=false
    attributes = header.lower()
    assert "httponly" in attributes
    assert "samesite=lax" in attributes
    assert "path=/" in attributes
    assert "domain=" not in attributes
    assert f"max-age={14 * 24 * 3600}" in attributes
    assert guest.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in response.text


WWW = "https://www.k-escape.com"
PLAY = "https://play.k-escape.com"
PREVIEW = "https://preview.k-escape.com"
REJECTED_ORIGINS = [
    None,
    "",
    "null",
    "*",
    "https://other.example.invalid",
    "https://k-escape.com",
    "https://kgeseo-git-main-h7-r.vercel.app",
    "https://preview.k-escape.com.evil.example",
    "https://evil-preview.k-escape.com",
    "https://preview.k-escape.com.vercel.app",
    "http://preview.k-escape.com",
    "http://www.k-escape.com",
    "https://preview.k-escape.com:8443",
    "https://www.k-escape.com:443",
    "https://preview.k-escape.com/",
    "https://PREVIEW.k-escape.com",
    " https://preview.k-escape.com",
    "https://preview.k-escape.com ",
    "https://www.k-escape.com, https://evil.example",
]


def _post(origin: str | None) -> Request:
    headers = [(b"origin", origin.encode())] if origin is not None else []
    return Request({"type": "http", "method": "POST", "headers": headers})


def _allowed(origin: str | None) -> bool:
    try:
        require_play_origin(_post(origin))
    except HTTPException as error:
        assert error.status_code == 403
        assert error.detail == "Origin not allowed."
        return False
    return True


@pytest.mark.parametrize("origin", [WWW, PLAY, PREVIEW])
def test_production_play_origin_allows_exact_configured_origins(monkeypatch, origin):
    """11/8 PM: production 플레이 쓰기 Origin 은 CORS_ORIGINS 와 같은 목록이다(preview 포함)."""
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "cors_origins", [WWW, PLAY, PREVIEW])
    assert _allowed(origin)


@pytest.mark.parametrize("origin", REJECTED_ORIGINS)
def test_production_play_origin_rejects_missing_and_lookalike_origins(
    monkeypatch, origin
):
    """누락 · 유사 호스트 · 프로토콜 · 포트 · 끝 슬래시 · 대소문자 · 부분 문자열은 모두 403."""
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "cors_origins", [WWW, PLAY, PREVIEW])
    assert not _allowed(origin)


def test_production_preview_origin_needs_cors_setting(monkeypatch):
    """preview 는 CORS_ORIGINS 에 있을 때만 허용한다. 기존 www · play 는 그대로다."""
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "cors_origins", [WWW, PLAY])
    assert _allowed(WWW)
    assert _allowed(PLAY)
    assert not _allowed(PREVIEW)


def test_empty_origin_allowlist_allows_nothing(monkeypatch):
    """허용 목록이 비면 모두 거부한다(무조건 허용 없음). production 은 시작 때 빈 목록을 막는다."""
    monkeypatch.setattr(settings, "cors_origins", [])
    for origin in (WWW, PLAY, PREVIEW, None):
        assert not _allowed(origin)


@pytest.mark.parametrize("app_env", ["development", "test", "production"])
@pytest.mark.parametrize("origin", [WWW, PLAY, PREVIEW, *REJECTED_ORIGINS])
def test_play_origin_matches_login_origin_rule(monkeypatch, app_env, origin):
    """플레이 쓰기와 로그인 · 저장 API(require_same_origin)는 모든 환경에서 같은 Origin 을 받는다."""
    monkeypatch.setattr(settings, "app_env", app_env)
    monkeypatch.setattr(settings, "cors_origins", [WWW, PLAY, PREVIEW])
    try:
        require_same_origin(_post(origin))
        login_allowed = True
    except HTTPException:
        login_allowed = False
    assert _allowed(origin) is login_allowed


def test_production_guest_cookie_has_host_prefix_and_required_attributes():
    environment = {
        **os.environ,
        "APP_ENV": "production",
        "SESSION_COOKIE_SECURE": "false",
        "DB_HOST": "db.example.invalid",
        "DB_USER": "synthetic",
        "DB_PASSWORD": "synthetic",
        "DB_NAME": "synthetic",
        "GOOGLE_CLIENT_ID": "synthetic",
        "NAVER_CLIENT_ID": "synthetic",
        "NAVER_CLIENT_SECRET": "synthetic",
        "NAVER_REDIRECT_URI": "https://www.k-escape.com/로그인/콜백",
        "CORS_ORIGINS": '["https://www.k-escape.com", "https://play.k-escape.com"]',
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from fastapi import Response\n"
            "from app.services.guest_session import set_guest_cookie\n"
            "response = Response()\n"
            "set_guest_cookie(response, 'synthetic')\n"
            "print(response.headers['set-cookie'])",
        ],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    cookie = result.stdout.strip().split("; ")
    assert cookie[0] == "__Host-waegok_guest=synthetic"
    assert set(cookie[1:]) == {
        "Secure",
        "HttpOnly",
        "SameSite=lax",
        "Path=/",
        "Max-Age=1209600",
    }
