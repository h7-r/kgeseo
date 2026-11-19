"""회원 최근 로그인 last_login_at(11/16 세진, 미르 승인) — DB 없이 보는 것.

- 정의: 마지막으로 새 로그인 세션을 발급한 시각. 갱신은 start_session 한 곳, 세션 INSERT 와 같은 커밋, 더 최근 값만, updated_at 은 안 바꿈
- 다섯 경로(이메일 가입 · 이메일 로그인 · Google · Naver · 소셜 가입 완료)는 갱신, 실패 · 잠김 · 소셜 가입 미완료 · 쿠키 재접속 · /me ·
  로그아웃은 갱신 안 함
- 원자성: 갱신 · 커밋이 실패하면 되돌리고 쿠키도 내리지 않는다. 게스트 승계 실패는 로그인 · 갱신을 취소하지 않는다
- 관리자 회원 목록 · 관리자 목록 · 회원 상세의 응답
실제 DB 의 백필 · 동시 로그인 · 갱신은 `test_last_login_mysql.py`(격리 MySQL)가 본다.
"""

import asyncio
from datetime import datetime
from typing import Any

import pytest
from fastapi import Response
from sqlalchemy.dialects import mysql

from app.api.v1 import auth
from app.main import app
from app.models.app_user import AppUser
from app.schemas.auth import (
    GoogleUserResponse,
    SocialAccountUser,
    SocialOnboardingRequiredResponse,
    SocialUserResponse,
)
from app.services import local_auth, user_session
from app.services.user_session import current_user
from tests.conftest import FakeAsyncSession

USER_ID = "11111111-1111-4111-8111-111111111111"
NOW = datetime(2026, 11, 16, 3, 0, 0, 123456)


def make_user(**overrides) -> AppUser:
    values = dict(
        id=USER_ID,
        email="member@example.com",
        nickname="회원",
        region=None,
        role="user",
        created_at=datetime(2026, 11, 1),
        updated_at=datetime(2026, 11, 1),
        last_login_at=None,
    )
    values.update(overrides)
    return AppUser(**values)


def _sql(statement) -> str:
    return str(
        statement.compile(
            dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def last_login_updates(db: FakeAsyncSession) -> list[str]:
    return [
        _sql(stmt)
        for stmt in db.execute_calls
        if getattr(stmt, "is_update", False) and stmt.table.name == "app_users"
    ]


def session_rows(db: FakeAsyncSession) -> list[Any]:
    return [row for row in db.added if type(row).__name__ == "UserSession"]


# --- start_session: 같은 커밋 · 더 최근 값만 · updated_at 안 바꿈 ---


def test_start_session_updates_last_login_in_the_same_commit(monkeypatch, db_session):
    monkeypatch.setattr(user_session, "utc_now", lambda: NOW)
    response = Response()
    asyncio.run(user_session.start_session(db_session, response, USER_ID))

    (session,) = session_rows(db_session)
    (sql,) = last_login_updates(db_session)
    assert session.created_at == NOW
    assert db_session.commit_count == 1 and db_session.rollback_count == 0
    assert "set-cookie" in response.headers
    # 세션 시각과 같은 값을, 비었거나 더 이른 경우에만
    assert "SET last_login_at='2026-11-16 03:00:00.123456'" in sql
    assert f"app_users.id = '{USER_ID}'" in sql
    assert (
        "app_users.last_login_at IS NULL OR app_users.last_login_at < '2026-11-16 03:00:00.123456'"
        in sql
    )
    assert "updated_at" not in sql


@pytest.mark.parametrize("failure", ["execute", "commit"])
def test_update_or_commit_failure_rolls_back_and_sets_no_cookie(db_session, failure):
    error = RuntimeError("db down")
    if failure == "execute":
        db_session.execute_error = error
    else:
        db_session.commit_error = error
    response = Response()
    with pytest.raises(RuntimeError):
        asyncio.run(user_session.start_session(db_session, response, USER_ID))
    assert db_session.rollback_count == 1
    assert "set-cookie" not in response.headers
    if failure == "execute":
        assert db_session.commit_count == 0


# --- 다섯 경로는 갱신, 나머지는 갱신 안 함(실제 _establish_login → start_session 을 지난다) ---


@pytest.fixture
def no_guest(monkeypatch):
    calls = []

    async def transfer(db, request, response, user_id):
        calls.append(user_id)
        return None

    monkeypatch.setattr(auth, "transfer_guest_to_user", transfer)
    return calls


def _local_login_ok(monkeypatch, user):
    async def none(*_args, **_kwargs):
        return None

    async def login_user(db, email, password):
        return user

    monkeypatch.setattr(auth, "login_lock_remaining_seconds", none)
    monkeypatch.setattr(auth, "clear_login_failures", none)
    monkeypatch.setattr(local_auth, "login_user", login_user)


def _social_user(provider: str) -> SocialUserResponse:
    return SocialUserResponse(
        user=SocialAccountUser(
            user_id=USER_ID,
            email="member@example.com",
            nickname="회원",
            region=None,
            created_at=datetime(2026, 11, 1).isoformat(),
            provider=provider,
        )
    )


def _pending() -> SocialOnboardingRequiredResponse:
    return SocialOnboardingRequiredResponse(
        onboarding_token="t" * 43, suggested_nickname="회원"
    )


def _google(monkeypatch, result):
    profile = GoogleUserResponse(
        provider="google", subject="g-subject", email="member@example.com"
    )
    monkeypatch.setattr(auth, "verify_google_credential", lambda *a, **k: profile)

    async def authenticate(db, received):
        return result

    monkeypatch.setattr(auth, "authenticate_social_user", authenticate)


def _naver(monkeypatch, result):
    profile = GoogleUserResponse(
        provider="naver", subject="n-subject", email="member@example.com"
    )
    monkeypatch.setattr(
        auth, "verify_naver_authorization_code", lambda *a, **k: profile
    )

    async def authenticate(db, received):
        return result

    monkeypatch.setattr(auth, "authenticate_social_user", authenticate)


def _assert_updated(response, db_session, no_guest):
    assert response.status_code in (200, 201), response.text
    assert len(session_rows(db_session)) == 1
    (sql,) = last_login_updates(db_session)
    assert f"app_users.id = '{USER_ID}'" in sql
    assert "set-cookie" in response.headers
    assert no_guest == [USER_ID]


def _assert_untouched(db_session):
    assert session_rows(db_session) == []
    assert last_login_updates(db_session) == []


def test_email_login_updates(client, db_session, monkeypatch, no_guest):
    _local_login_ok(monkeypatch, make_user())
    response = client.post(
        "/api/v1/auth/login", json={"email": "member@example.com", "password": "pw"}
    )
    _assert_updated(response, db_session, no_guest)


def test_email_register_updates(client, db_session, monkeypatch, no_guest):
    async def register_user(db, request):
        return make_user()

    monkeypatch.setattr(local_auth, "register_user", register_user)
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "member@example.com",
            "password": "pw-long-enough-1",
            "nickname": "회원",
            "consent": {"terms": True, "privacy": True, "age": True},
        },
    )
    _assert_updated(response, db_session, no_guest)


def test_google_login_updates(client, db_session, monkeypatch, no_guest):
    _google(monkeypatch, _social_user("google"))
    response = client.post("/api/v1/auth/google", json={"credential": "c"})
    _assert_updated(response, db_session, no_guest)


def test_naver_login_updates(client, db_session, monkeypatch, no_guest):
    _naver(monkeypatch, _social_user("naver"))
    response = client.post("/api/v1/auth/naver", json={"code": "c", "state": "s"})
    _assert_updated(response, db_session, no_guest)


def test_social_signup_completion_updates(client, db_session, monkeypatch, no_guest):
    async def complete(db, request):
        return _social_user("google")

    monkeypatch.setattr(auth, "complete_onboarding", complete)
    response = client.post(
        "/api/v1/auth/social-onboarding/complete",
        json={
            "onboarding_token": "t" * 43,
            "nickname": "회원",
            "consent": {"terms": True, "privacy": True, "age": True},
        },
    )
    _assert_updated(response, db_session, no_guest)


@pytest.mark.parametrize("provider", ["google", "naver"])
def test_social_signup_not_finished_does_not_update(
    client, db_session, monkeypatch, no_guest, provider
):
    if provider == "google":
        _google(monkeypatch, _pending())
        response = client.post("/api/v1/auth/google", json={"credential": "c"})
    else:
        _naver(monkeypatch, _pending())
        response = client.post("/api/v1/auth/naver", json={"code": "c", "state": "s"})
    assert response.status_code == 200
    assert response.json()["result"] == "onboarding_required"
    _assert_untouched(db_session)
    assert "set-cookie" not in response.headers


def test_failed_login_does_not_update(client, db_session, monkeypatch, no_guest):
    async def none(*_args, **_kwargs):
        return None

    async def bad(db, email, password):
        raise local_auth.InvalidLocalCredentialsError()

    monkeypatch.setattr(auth, "login_lock_remaining_seconds", none)
    monkeypatch.setattr(auth, "record_login_failure", none)
    monkeypatch.setattr(local_auth, "login_user", bad)
    response = client.post(
        "/api/v1/auth/login", json={"email": "member@example.com", "password": "x"}
    )
    assert response.status_code == 401
    _assert_untouched(db_session)
    assert no_guest == []


def test_locked_login_does_not_update(client, db_session, monkeypatch, no_guest):
    async def locked(*_args, **_kwargs):
        return 900

    monkeypatch.setattr(auth, "login_lock_remaining_seconds", locked)
    response = client.post(
        "/api/v1/auth/login", json={"email": "member@example.com", "password": "x"}
    )
    assert response.status_code == 429
    _assert_untouched(db_session)


def test_cookie_reuse_me_and_logout_do_not_update(client, db_session):
    app.dependency_overrides[current_user] = lambda: make_user()
    try:
        me = client.get("/api/v1/me")
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert me.status_code == 200
    # /me 응답에 세션 · 토큰은 없다(기존 5개 + 11/18 created_at · providers, 계약 account_me_v0.1.md §1)
    assert set(me.json()) == {
        "user_id",
        "email",
        "nickname",
        "region",
        "role",
        "created_at",
        "providers",
    }
    client.cookies.set("waegok_session", "token")
    assert client.post("/api/v1/me/logout").status_code == 204
    _assert_untouched(db_session)


def test_guest_transfer_failure_keeps_login_and_update(
    client, db_session, monkeypatch, caplog
):
    """진짜 transfer_guest_to_user — 가짜 DB 에는 따로 열 연결(bind)이 없어 승계가 실패한다(오류는 삼키고 로그를 남긴다)."""

    from app.services.guest_session import GUEST_COOKIE

    _local_login_ok(monkeypatch, make_user())
    client.cookies.set(GUEST_COOKIE, "guest-token")
    with caplog.at_level("ERROR"):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "member@example.com", "password": "pw"},
        )
    assert "guest progress transfer failed" in caplog.text  # 실패 경로를 실제로 지났다
    assert response.status_code == 200
    assert len(last_login_updates(db_session)) == 1
    assert db_session.commit_count == 1 and db_session.rollback_count == 0
    assert "waegok_session=" in response.headers["set-cookie"]


# --- 관리자 응답 ---


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalars(self):
        return self


class AdminSession(FakeAsyncSession):
    """execute 결과를 차례로 돌려준다(목록 · 로그인 수단 · 마지막 세션)."""

    def __init__(self, results):
        super().__init__()
        self.results = list(results)

    async def execute(self, statement):
        await super().execute(statement)
        return _Rows(self.results.pop(0) if self.results else [])


def _admin_client(client, db):
    from app.db.session import get_db

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    app.dependency_overrides[current_user] = lambda: make_user(
        id="00000000-0000-4000-8000-000000000001", role="admin", nickname="운영자"
    )


@pytest.fixture
def cleanup():
    yield
    app.dependency_overrides.pop(current_user, None)


def test_admin_user_list_and_admins_return_real_last_login(client, cleanup):
    member = make_user(last_login_at=NOW)
    never = make_user(id="22222222-2222-4222-8222-222222222222", nickname="새회원")
    session_started = datetime(2026, 11, 15, 1, 0)
    db = AdminSession(
        [
            [(member, None), (never, None)],  # 회원 목록
            [],  # 로그인 수단
            [(member.id, session_started)],  # 마지막 세션
        ]
    )
    _admin_client(client, db)
    body = client.get("/api/v1/admin/users").json()
    by_id = {u["user_id"]: u for u in body["users"]}
    assert by_id[member.id]["last_login_at"] == "2026-11-16T03:00:00.123456"
    assert by_id[member.id]["last_session_started_at"] == "2026-11-15T01:00:00"
    assert by_id[never.id]["last_login_at"] is None

    admin = make_user(
        id="33333333-3333-4333-8333-333333333333", role="admin", last_login_at=NOW
    )
    db2 = AdminSession([[admin], [(admin.id, session_started)]])
    _admin_client(client, db2)
    (row,) = client.get("/api/v1/admin/admins").json()["items"]
    assert row["last_login_at"] == "2026-11-16T03:00:00.123456"
    assert row["last_session_started_at"] == "2026-11-15T01:00:00"


def test_admin_user_detail_adds_four_fields(client, cleanup):
    member = make_user(last_login_at=NOW, region="naju")

    class DetailSession(AdminSession):
        async def get(self, model, entity_id, **options):
            await FakeAsyncSession.get(self, model, entity_id, **options)
            return member if model is AppUser else None

    db = DetailSession(
        [
            [],  # 소지품
            [(member.id, "local"), (member.id, "google")],  # 로그인 수단
            [(member.id, datetime(2026, 11, 15, 1, 0))],  # 마지막 세션
        ]
    )
    _admin_client(client, db)
    response = client.get(f"/api/v1/admin/users/{member.id}")
    assert response.status_code == 200, response.text
    user = response.json()["user"]
    # 기존 필드 그대로 + 네 필드 덧붙임(region · providers · last_login_at · last_session_started_at)
    assert set(user) == {
        "user_id",
        "email",
        "nickname",
        "role",
        "created_at",
        "stage",
        "save_updated_at",
        "region",
        "providers",
        "last_login_at",
        "last_session_started_at",
        # 회원 탈퇴 Phase 1(11/17) — 탈퇴 시각, 회원이면 null
        "deleted_at",
    }
    assert user["deleted_at"] is None
    assert user["region"] == "naju"
    assert user["providers"] == [
        "google",
        "local",
    ]  # 목록과 같은 규칙(중복 제거 · 알파벳순)
    assert user["last_login_at"] == "2026-11-16T03:00:00.123456"
    assert user["last_session_started_at"] == "2026-11-15T01:00:00"


class OrderSession(FakeAsyncSession):
    def __init__(self) -> None:
        super().__init__()
        self.order: list[str] = []

    def add(self, entity):
        self.order.append(f"add:{type(entity).__name__}")
        super().add(entity)

    async def execute(self, statement):
        self.order.append(
            "execute:update" if getattr(statement, "is_update", False) else "execute"
        )
        return await super().execute(statement)

    async def commit(self):
        self.order.append("commit")
        await super().commit()


def test_update_locks_user_row_before_session_insert():
    """동시 로그인 데드락 방지 — 회원 행 UPDATE(배타 잠금)가 세션 INSERT(FK 공유 잠금)보다 먼저다."""

    db = OrderSession()
    asyncio.run(user_session.start_session(db, Response(), USER_ID))
    assert db.order == ["execute:update", "add:UserSession", "commit"]


def test_update_failure_adds_no_session():
    db = FakeAsyncSession()
    db.execute_error = RuntimeError("db down")
    with pytest.raises(RuntimeError):
        asyncio.run(user_session.start_session(db, Response(), USER_ID))
    assert session_rows(db) == [] and db.commit_count == 0 and db.rollback_count == 1
