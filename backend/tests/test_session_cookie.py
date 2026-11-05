"""세션 쿠키 속성과 다른 사이트 요청 차단."""

import asyncio

import pytest
from fastapi import Response

from app.services import user_session


@pytest.fixture
def production_cookie(monkeypatch):
    monkeypatch.setattr(user_session, "SESSION_COOKIE", "__Host-waegok_session")
    monkeypatch.setitem(user_session.SESSION_COOKIE_OPTIONS, "secure", True)


def test_production_cookie_is_bound_to_the_api_host(production_cookie, db_session):
    response = Response()
    asyncio.run(user_session.start_session(db_session, response, "user-1"))
    cookie = response.headers["set-cookie"]

    assert cookie.startswith("__Host-waegok_session=")
    assert "Secure" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/;" in cookie or cookie.endswith("Path=/")
    assert "Domain" not in cookie
    assert "Max-Age=1209600" in cookie


def test_logout_clears_the_same_cookie(production_cookie, client):
    client.cookies.set("__Host-waegok_session", "token")
    response = client.post("/api/v1/me/logout")

    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("__Host-waegok_session=")
    assert "Max-Age=0" in cookie
    assert "Secure" in cookie
    assert "Path=/" in cookie


@pytest.mark.parametrize(
    "path",
    ["/api/v1/auth/login", "/api/v1/auth/google", "/api/v1/me/logout"],
)
@pytest.mark.parametrize("origin", [None, "https://evil.example"])
def test_state_changes_refuse_other_sites(client, path, origin):
    del client.headers["Origin"]
    headers = {"Origin": origin} if origin else {}
    assert client.post(path, json={}, headers=headers).status_code == 403


def test_cors_allows_credentials_only_for_listed_sites(client):
    allowed = client.options(
        "/api/v1/me/game-save",
        headers={
            "Origin": "http://localhost:5175",
            "Access-Control-Request-Method": "PUT",
        },
    )
    refused = client.options(
        "/api/v1/me/game-save",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "PUT",
        },
    )

    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5175"
    assert "access-control-allow-origin" not in refused.headers
