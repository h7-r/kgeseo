"""세션 · 게임 저장 · 관리자 API 의 접근 통제. 실제 DB 동작은 tests/test_account_data_mysql.py 가 본다."""

import pytest

from app.main import app
from app.models.app_user import AppUser
from app.services.user_session import SESSION_COOKIE, current_user

SAME_ORIGIN = {"Origin": "http://localhost:5175"}
SAVE = {"revision": 0, "schema_version": 1, "stage": "naju", "state": {"x": 1}}

PROTECTED = [
    ("GET", "/api/v1/me"),
    ("GET", "/api/v1/me/game-save"),
    ("GET", "/api/v1/me/character"),
    ("GET", "/api/v1/me/items"),
    ("GET", "/api/v1/admin/users"),
    ("GET", "/api/v1/admin/users/someone"),
]


def as_user(role: str = "user") -> None:
    user = AppUser(id="user-1", email="a@example.com", nickname="가나", role=role)
    app.dependency_overrides[current_user] = lambda: user


@pytest.fixture(autouse=True)
def clear_user_override():
    yield
    app.dependency_overrides.pop(current_user, None)


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_protected_routes_refuse_without_session(client, method, path):
    assert client.request(method, path).status_code == 401


def test_unknown_session_cookie_is_refused(client, db_session):
    db_session.scalar_result = None
    client.cookies.set(SESSION_COOKIE, "forged")
    assert client.get("/api/v1/me").status_code == 401


@pytest.mark.parametrize("path", ["/api/v1/admin/users", "/api/v1/admin/users/other"])
def test_normal_user_cannot_use_admin_routes(client, path):
    as_user()
    assert client.get(path).status_code == 403


@pytest.mark.parametrize(
    "origin", [None, "https://evil.example", "http://localhost:9999"]
)
def test_save_write_refuses_other_sites(client, origin):
    as_user()
    del client.headers["Origin"]
    headers = {"Origin": origin} if origin else {}
    response = client.put("/api/v1/me/game-save", json=SAVE, headers=headers)
    assert response.status_code == 403


def test_save_write_cannot_choose_another_user(client, db_session):
    as_user()
    body = {**SAVE, "app_user_id": "victim", "user_id": "victim"}
    response = client.put("/api/v1/me/game-save", json=body, headers=SAME_ORIGIN)
    assert response.status_code == 200
    assert db_session.added[0].app_user_id == "user-1"


def test_save_write_refuses_stale_revision(client, db_session):
    as_user()
    response = client.put(
        "/api/v1/me/game-save", json={**SAVE, "revision": 3}, headers=SAME_ORIGIN
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "save_conflict", "revision": 0}


def test_save_write_refuses_oversized_state(client):
    as_user()
    body = {**SAVE, "state": {"x": "a" * (512 * 1024 + 1)}}
    response = client.put("/api/v1/me/game-save", json=body, headers=SAME_ORIGIN)
    assert response.status_code == 413


def test_save_write_refuses_deep_state(client):
    as_user()
    state: dict = {}
    for _ in range(40):
        state = {"x": state}
    response = client.put(
        "/api/v1/me/game-save", json={**SAVE, "state": state}, headers=SAME_ORIGIN
    )
    assert response.status_code == 422


def test_there_is_no_user_route_that_grants_items():
    assert set(app.openapi()["paths"]["/api/v1/me/items"]) == {"get"}


def test_responses_carry_security_headers(client):
    response = client.get("/api/v1/me")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
