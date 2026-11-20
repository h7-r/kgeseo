"""게임 저장 계정 확인(11/20 세진) — `PUT /api/v1/me/game-save` 의 선택 필드 `account_id`. DB 없이.

게임은 쿠키가 다른 계정으로 바뀐 것을 409 가 날 때만 알아챘다 — 두 계정의 revision 이 같으면(둘 다 0 등) 409 가 나지 않아 A 의
진행이 B 계정 저장에 들어갔다. 게임이 처음 불러올 때의 계정 id 를 함께 보내면 서버가 지금 쿠키의 회원과 맞춰 보고 다르면 쓰지 않는다.
이 값은 인증이 아니다 — 쓰는 대상은 늘 쿠키의 회원이고, 값은 거절에만 쓴다. 실제 DB 동작은 `test_game_save_account_guard_mysql.py`.
"""

import pytest

from app.main import app
from app.models.app_user import AppUser
from app.services.user_session import current_user
from tests.test_api_error_contract import assert_documented

URL = "/api/v1/me/game-save"
SAME_ORIGIN = {"Origin": "http://localhost:5175"}
USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def body(**extra):
    return {
        "revision": 0,
        "schema_version": 1,
        "stage": "naju",
        "state": {"x": 1},
        **extra,
    }


@pytest.fixture(autouse=True)
def signed_in_as_b():
    app.dependency_overrides[current_user] = lambda: AppUser(
        id=USER_B, email="b@example.com", nickname="비", role="user"
    )
    yield
    app.dependency_overrides.pop(current_user, None)


def test_other_account_is_refused_before_touching_the_database(client, db_session):
    response = client.put(URL, json=body(account_id=USER_A), headers=SAME_ORIGIN)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_changed"
    assert response.headers["cache-control"] == "no-store"
    # 회원 확인 · 저장 조회 · 쓰기 모두 없음
    assert db_session.scalar_calls == [] and db_session.execute_calls == []
    assert db_session.added == [] and db_session.commit_count == 0
    assert_documented(response, "PUT", URL)


@pytest.mark.parametrize("claimed", [USER_B, USER_B.upper()])
def test_same_account_saves_as_before(client, db_session, claimed):
    response = client.put(URL, json=body(account_id=claimed), headers=SAME_ORIGIN)
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    (save,) = db_session.added
    assert save.app_user_id == USER_B  # 쓰는 대상은 늘 쿠키의 회원


def test_without_account_id_old_clients_save_as_before(client, db_session):
    response = client.put(URL, json=body(), headers=SAME_ORIGIN)
    assert response.status_code == 200
    assert db_session.added[0].app_user_id == USER_B


def test_revision_conflict_is_unchanged_for_the_same_account(client, db_session):
    response = client.put(
        URL, json=body(revision=3, account_id=USER_B), headers=SAME_ORIGIN
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "save_conflict", "revision": 0}


@pytest.mark.parametrize("bad", ["", "x" * 65, 123])
def test_malformed_account_id_is_a_validation_error(client, db_session, bad):
    response = client.put(URL, json=body(account_id=bad), headers=SAME_ORIGIN)
    assert response.status_code == 422
    assert db_session.added == []
