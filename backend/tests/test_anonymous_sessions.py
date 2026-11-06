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


@pytest.mark.parametrize(
    ("origin", "allowed"),
    [
        ("https://www.k-escape.com", True),
        ("https://play.k-escape.com", True),
        ("https://other.example.invalid", False),
        (None, False),
    ],
)
def test_production_play_origins_are_limited_to_pm_allowlist(
    monkeypatch, origin, allowed
):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(
        settings,
        "cors_origins",
        [
            "https://www.k-escape.com",
            "https://play.k-escape.com",
            "https://other.example.invalid",
        ],
    )
    headers = [(b"origin", origin.encode())] if origin else []
    request = Request({"type": "http", "method": "POST", "headers": headers})
    if allowed:
        require_play_origin(request)
    else:
        with pytest.raises(HTTPException) as error:
            require_play_origin(request)
        assert error.value.status_code == 403


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
