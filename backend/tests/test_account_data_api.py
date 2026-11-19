"""세션 · 게임 저장 · 관리자 API 의 접근 통제. 실제 DB 동작은 tests/test_account_data_mysql.py 가 본다."""

from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.models.account_data import GamePlaySave
from app.models.app_user import AppUser
from app.services.user_session import SESSION_COOKIE, current_user
from tests.conftest import expires_on_rollback

SAME_ORIGIN = {"Origin": "http://localhost:5175"}
SAVE = {"revision": 0, "schema_version": 1, "stage": "naju", "state": {"x": 1}}
JOINED = datetime(2026, 11, 18, 5, 16, 35, 520051)

PROTECTED = [
    ("GET", "/api/v1/me"),
    ("GET", "/api/v1/me/game-save"),
    ("GET", "/api/v1/me/character"),
    ("GET", "/api/v1/me/items"),
    ("GET", "/api/v1/admin/users"),
    ("GET", "/api/v1/admin/users/someone"),
]


def as_user(role: str = "user", db_session=None) -> None:
    """db_session 을 주면 실제 SQLAlchemy 처럼 rollback 뒤 회원 행 속성 접근이 실패한다."""
    user = AppUser(
        id="user-1",
        email="a@example.com",
        nickname="가나",
        role=role,
        created_at=JOINED,
    )
    member = user if db_session is None else expires_on_rollback(user, db_session)
    app.dependency_overrides[current_user] = lambda: member


def unique_violation() -> IntegrityError:
    """동시 첫 저장에서 (app_user_id, slot) UNIQUE 가 막은 것처럼."""
    return IntegrityError(
        "INSERT game_play_saves", {}, Exception("1062 Duplicate entry")
    )


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


def test_me_carries_joined_at_as_utc_and_providers_in_link_order(client, db_session):
    """새 탭 복원이 가입일 · 가입 방식을 다시 그릴 수 있어야 한다(점검 M5). 시각은 Z 로 끝나고 수단은 연결 순 · 중복 없음."""
    as_user()
    db_session.scalars_result = ["local", "google", "local"]
    body = client.get("/api/v1/me").json()
    assert body["created_at"] == "2026-11-18T05:16:35.520051Z"
    assert body["providers"] == ["local", "google"]
    assert set(body) == {
        "user_id",
        "email",
        "nickname",
        "region",
        "role",
        "created_at",
        "providers",
    }


def test_me_social_only_member_has_no_local_provider(client, db_session):
    as_user()
    db_session.scalars_result = ["naver"]
    assert client.get("/api/v1/me").json()["providers"] == ["naver"]


def test_first_save_race_reports_the_revision_that_won(client, db_session):
    """저장본 없이 두 창이 동시에 첫 저장 → UNIQUE 충돌 쪽은 0 이 아니라 먼저 들어간 번호를 받아야 재시도가 한 번에 된다(점검 L22)."""
    as_user(db_session=db_session)
    winner = GamePlaySave(revision=1)
    # scalar 차례: ① 회원 행 잠금 확인 ② 쓰기 전 조회(없음) ③ 충돌 뒤 재조회(상대가 넣은 revision 1)
    db_session.scalar_result = [None, None, winner]
    db_session.commit_error = unique_violation()
    response = client.put("/api/v1/me/game-save", json=SAVE, headers=SAME_ORIGIN)
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "save_conflict", "revision": 1}
    assert db_session.rollback_count == 1


def test_first_save_race_without_a_row_left_says_zero(client, db_session):
    """충돌했는데 재조회에도 행이 없으면(상대가 바로 지웠음) 0 — 첫 저장으로 다시 하면 된다."""
    as_user(db_session=db_session)
    db_session.scalar_result = [None, None, None]
    db_session.commit_error = unique_violation()
    response = client.put("/api/v1/me/game-save", json=SAVE, headers=SAME_ORIGIN)
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "save_conflict", "revision": 0}
    assert db_session.rollback_count == 1


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
