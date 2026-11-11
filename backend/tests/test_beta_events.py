"""베타 분석 기록 받기 · 내보내기(11/11). 실제 MySQL 저장 · 중복 건너뛰기는 tests/test_beta_events_mysql.py 가 본다."""

import json
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.dialects import mysql

from app.api.v1 import beta_events as beta_router
from app.core.config import settings
from app.main import app
from app.models.app_user import AppUser
from app.services.play_principal import PlayPrincipal
from app.services.user_session import current_user
from tests.test_api_error_contract import assert_documented

PATH = "/api/v1/beta-events"
# 실제 Origin 검사를 쓴다(쿠키 주체는 아래 `principal` 로 바꿔 끼운다)
pytestmark = pytest.mark.real_play_auth


def event(**overrides):
    base = {
        "event_id": str(uuid4()),
        "type": "run_state",
        "phase": "dawn",
        "pc": "B-7KQ2XM",
        "run_id": str(uuid4()),
        "run_index": 0,
        "tab_id": str(uuid4()),
        "seq": 3,
        "client_ts": "2026-11-13T05:01:02.345Z",
        "objective_id": "P03",
        "page": "naju",
        "build": "abc1234",
        "data": {"active_ms": 812345, "origin": "live"},
    }
    return {**base, **overrides}


@pytest.fixture
def principal(monkeypatch):
    found = {"value": None}

    async def fake_resolve(db, request):
        return found["value"]

    monkeypatch.setattr(beta_router, "resolve_play_principal", fake_resolve)
    return found


def inserted_rows(db_session):
    (statement,) = db_session.execute_calls
    params = statement.compile().params
    # values([...]) 의 열 값은 `<열>_m<번호>` 로 펼쳐진다
    count = len([key for key in params if key.startswith("event_id")])
    return count, statement


def test_valid_batch_is_saved_with_cookie_owner(client, db_session, principal):
    principal["value"] = PlayPrincipal(kind="user", user_id="user-1")
    response = client.post(
        PATH,
        json={
            "events": [
                event(acct="user-1"),
                event(type="beta_entry", phase=None, acct="user-1"),
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "accepted": 2,
        "duplicates": 0,
        "disabled": False,
        "ignored": 0,
    }
    assert response.headers["Cache-Control"] == "no-store"
    count, statement = inserted_rows(db_session)
    assert count == 2
    sql = str(statement.compile(dialect=mysql.dialect()))
    assert sql.startswith("INSERT IGNORE INTO beta_events")
    params = statement.compile().params
    assert params["app_user_id_m0"] == "user-1"
    assert params["guest_session_id_m0"] is None
    assert params["participant_code_m0"] == "B-7KQ2XM"
    # 시간대가 붙은 값은 UTC(시간대 없음)로 저장한다
    assert params["client_ts_m0"] == datetime(2026, 11, 13, 5, 1, 2, 345000)
    assert db_session.commit_count == 1


def test_text_plain_keepalive_body_is_accepted(client, db_session, principal):
    principal["value"] = PlayPrincipal(
        kind="guest", guest_session_id="guest-1", anonymous_session_id="anon-1"
    )
    body = json.dumps({"events": [event()]})
    response = client.post(
        PATH, content=body, headers={"Content-Type": "text/plain;charset=UTF-8"}
    )
    assert response.status_code == 200, response.text
    params = inserted_rows(db_session)[1].compile().params
    assert params["guest_session_id_m0"] == "guest-1"
    assert params["app_user_id_m0"] is None


def test_no_cookie_with_code_is_still_accepted(client, db_session, principal):
    response = client.post(PATH, json={"events": [event()]})
    assert response.status_code == 200
    params = inserted_rows(db_session)[1].compile().params
    assert params["app_user_id_m0"] is None and params["guest_session_id_m0"] is None
    assert params["participant_code_m0"] == "B-7KQ2XM"


def test_logged_in_without_code_is_saved_by_account(client, db_session, principal):
    """베타 참가자는 모두 회원 — 참여 코드 없이도 로그인한 계정으로 묶어 남긴다(미르 11/11)."""
    principal["value"] = PlayPrincipal(kind="user", user_id="user-7")
    response = client.post(PATH, json={"events": [event(pc=None, acct="user-7")]})
    assert response.status_code == 200
    assert response.json()["accepted"] == 1
    params = inserted_rows(db_session)[1].compile().params
    assert params["app_user_id_m0"] == "user-7"
    assert params["participant_code_m0"] is None


@pytest.mark.parametrize("who", [None, "guest"])
def test_not_logged_in_without_code_is_not_saved(client, db_session, principal, who):
    """로그인하지 않았고 참여 코드도 없으면(일반 방문자 · 게스트) 저장하지 않고 ignored 로 센다."""
    if who == "guest":
        principal["value"] = PlayPrincipal(
            kind="guest", guest_session_id="g-1", anonymous_session_id="a-1"
        )
    response = client.post(PATH, json={"events": [event(pc=None), event(pc=None)]})
    assert response.status_code == 200
    assert response.json() == {
        "accepted": 0,
        "duplicates": 0,
        "disabled": False,
        "ignored": 2,
    }
    assert db_session.execute_calls == []
    assert db_session.commit_count == 0


def test_mixed_batch_keeps_only_coded_events_for_guests(client, db_session, principal):
    response = client.post(PATH, json={"events": [event(), event(pc=None)]})
    assert response.json() == {
        "accepted": 1,
        "duplicates": 0,
        "disabled": False,
        "ignored": 1,
    }
    assert inserted_rows(db_session)[0] == 1


def test_body_user_id_is_ignored(client, db_session, principal):
    response = client.post(PATH, json={"events": [event(app_user_id="someone-else")]})
    assert response.status_code == 200
    params = inserted_rows(db_session)[1].compile().params
    assert params["app_user_id_m0"] is None


def test_duplicates_are_counted_from_rowcount(
    client, db_session, principal, monkeypatch
):
    async def execute(statement):
        db_session.execute_calls.append(statement)
        return SimpleNamespace(rowcount=1)

    monkeypatch.setattr(db_session, "execute", execute)
    same = str(uuid4())
    response = client.post(
        PATH, json={"events": [event(event_id=same), event(event_id=same)]}
    )
    assert response.json() == {
        "accepted": 1,
        "duplicates": 1,
        "disabled": False,
        "ignored": 0,
    }


@pytest.mark.parametrize("origin", [None, "https://evil.example"])
def test_foreign_origin_is_refused(client, db_session, origin):
    del client.headers["Origin"]
    headers = {"Origin": origin} if origin else {}
    response = client.post(PATH, json={"events": [event()]}, headers=headers)
    assert response.status_code == 403
    assert_documented(response, "POST", PATH)
    assert not db_session.execute_calls


@pytest.mark.parametrize(
    "body",
    [
        {"events": []},
        {"events": [event() for _ in range(51)]},
        {"events": [event(type="not_a_type")]},
        {"events": [event(pc="lowercase-bad")]},
        {"events": [event(phase="Has Space")]},
        {"events": [event(event_id="not-a-uuid")]},
        {"events": [event(client_ts="yesterday")]},
        {"events": [event(objective_id="P03; DROP")]},
        {"events": [event(data={"blob": "x" * 2100})]},
        {"events": [event(), event(run_index=-1)]},
        {"nothing": 1},
    ],
)
def test_bad_batches_are_refused_whole(client, db_session, principal, body):
    response = client.post(PATH, json=body)
    assert response.status_code == 422, response.text
    assert_documented(response, "POST", PATH)
    assert all(
        set(item) == {"loc", "msg", "type"} for item in response.json()["detail"]
    )
    assert not db_session.execute_calls


def test_non_json_body_is_422(client, db_session, principal):
    response = client.post(
        PATH, content=b"{not json", headers={"Content-Type": "text/plain"}
    )
    assert response.status_code == 422
    assert_documented(response, "POST", PATH)


def test_oversized_body_is_413(client, db_session, principal):
    body = json.dumps({"events": [event()], "pad": "x" * (65 * 1024)})
    response = client.post(
        PATH, content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert_documented(response, "POST", PATH)
    assert not db_session.execute_calls


def test_disabled_flag_saves_nothing(client, db_session, principal, monkeypatch):
    monkeypatch.setattr(settings, "beta_events_enabled", False)
    response = client.post(PATH, json={"events": [event()]})
    assert response.status_code == 200
    assert response.json() == {
        "accepted": 0,
        "duplicates": 0,
        "disabled": True,
        "ignored": 0,
    }
    assert not db_session.execute_calls


def test_rate_limit_is_per_ip(client, db_session, principal, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_beta_events", 2)
    for _ in range(2):
        assert client.post(PATH, json={"events": [event()]}).status_code == 200
    response = client.post(PATH, json={"events": [event()]})
    assert response.status_code == 429
    assert response.headers["Retry-After"]
    assert_documented(response, "POST", PATH)


# --- 내보내기 ---


def as_user(role: str) -> None:
    user = AppUser(id="admin-1", email="a@example.com", nickname="가나", role=role)
    app.dependency_overrides[current_user] = lambda: user


@pytest.fixture(autouse=True)
def clear_user_override():
    yield
    app.dependency_overrides.pop(current_user, None)


def test_export_requires_login(client):
    response = client.get("/api/v1/admin/beta-events")
    assert response.status_code == 401
    assert_documented(response, "GET", "/api/v1/admin/beta-events")


def test_export_refuses_normal_users(client):
    as_user("user")
    response = client.get("/api/v1/admin/beta-events")
    assert response.status_code == 403
    assert_documented(response, "GET", "/api/v1/admin/beta-events")


def test_export_pages_by_id_and_audits(client, db_session, monkeypatch):
    as_user("admin")
    received = datetime(2026, 11, 13, 5, 0, 0)
    stored = [
        SimpleNamespace(
            id=index,
            event_id=str(uuid4()),
            received_at=received,
            client_ts=received,
            event_type="activity_snapshot",
            phase=None,
            participant_code="B-7KQ2XM",
            run_id=None,
            run_index=None,
            tab_id=None,
            seq=index,
            objective_id=None,
            page="naju",
            build=None,
            app_user_id="user-1",
            guest_session_id=None,
            data={"active_ms": index},
        )
        for index in (11, 12, 13)
    ]

    async def execute(statement):
        db_session.execute_calls.append(statement)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: stored))

    monkeypatch.setattr(db_session, "execute", execute)
    response = client.get("/api/v1/admin/beta-events?after_id=10&limit=2&pc=B-7KQ2XM")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["id"] for row in body["events"]] == [11, 12]
    assert body["next_after_id"] == 12
    assert "email" not in json.dumps(body)
    assert response.headers["Cache-Control"] == "no-store"
    (audit,) = db_session.added
    assert audit.action == "export_beta_events"


def test_export_rejects_bad_query(client):
    as_user("admin")
    response = client.get("/api/v1/admin/beta-events?limit=0")
    assert response.status_code == 422


def test_record_from_another_account_is_not_saved(client, db_session, principal):
    """공용 PC — 앞사람(user-A) 때 만든 기록을 다음 사람(user-B) 쿠키로 보내도 B 에게 붙지 않는다."""
    principal["value"] = PlayPrincipal(kind="user", user_id="user-B")
    response = client.post(
        PATH,
        json={"events": [event(pc=None, acct="user-A"), event(acct="user-A")]},
    )
    assert response.json() == {
        "accepted": 0,
        "duplicates": 0,
        "disabled": False,
        "ignored": 2,
    }
    assert db_session.execute_calls == []


def test_account_record_after_logout_is_not_saved(client, db_session, principal):
    """로그인 때 만든 기록을 로그아웃한 뒤(쿠키 없음) 보내면 저장하지 않는다 — 코드가 있어도."""
    response = client.post(PATH, json={"events": [event(acct="user-1")]})
    assert response.json()["ignored"] == 1
    assert db_session.execute_calls == []


def test_logged_in_cookie_does_not_adopt_anonymous_records(
    client, db_session, principal
):
    """로그인하지 않은 때(acct "") 코드로 만든 기록은 지금 쿠키가 로그인이어도 그 계정에 붙이지 않는다."""
    principal["value"] = PlayPrincipal(kind="user", user_id="user-1")
    response = client.post(PATH, json={"events": [event(acct="")]})
    assert response.json()["accepted"] == 1
    params = inserted_rows(db_session)[1].compile().params
    assert params["app_user_id_m0"] is None
    assert params["participant_code_m0"] == "B-7KQ2XM"
