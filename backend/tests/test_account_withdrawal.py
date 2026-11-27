"""회원 탈퇴 Phase 1(11/17) — DB 없이 보는 것: 경로 권한 · 오류 계약 · 쿠키 · 비밀번호 비노출 · 탈퇴 값 형식 · 로그인/쓰기 경합 막기.

실제 삭제 · 비식별화 · 보존 · 통계 · 동시성은 격리 MySQL(`tests/test_account_withdrawal_mysql.py`)이 본다.
"""

import asyncio
import re
from datetime import datetime

import pytest
from fastapi import Response
from sqlalchemy.dialects import mysql

from app.api.v1 import auth, me
from app.main import app
from app.models.app_user import AppUser
from app.models.guest_session import GuestSession
from app.services import account_withdrawal, user_session
from app.services.account_withdrawal import (
    WithdrawalRefused,
    withdrawn_email,
    withdrawn_nickname,
)
from app.services.guest_session import GUEST_COOKIE
from app.services.nickname_policy import InvalidNicknameError, validate_nickname
from app.services.user_session import (
    SESSION_COOKIE,
    WithdrawnAccountError,
    current_user,
    optional_current_user,
)
from tests.test_api_error_contract import assert_documented

PATH = "/api/v1/me/withdrawal"
SAME_ORIGIN = {"Origin": "http://localhost:5175"}
SECRET = "Correct-Horse-91"
GUEST_TOKEN = "guest-cookie-token"


def member(role: str = "user") -> AppUser:
    return AppUser(
        id="00000000-0000-4000-8000-0000000000aa",
        email="member@example.com",
        nickname="회원",
        role=role,
    )


@pytest.fixture(autouse=True)
def clear_user_override():
    yield
    app.dependency_overrides.pop(current_user, None)


@pytest.fixture
def signed_in():
    user = member()
    app.dependency_overrides[current_user] = lambda: user
    return user


@pytest.fixture
def unlocked(monkeypatch):
    async def none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(me, "login_lock_remaining_seconds", none)


def _sql(statement) -> str:
    return str(
        statement.compile(
            dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


# --- 경로 권한 ---


def test_without_session_is_401(client):
    response = client.post(PATH, json={"password": SECRET}, headers=SAME_ORIGIN)
    assert response.status_code == 401
    assert response.json() == {"detail": "Login required."}
    assert_documented(response, "POST", PATH)


@pytest.mark.parametrize("origin", [None, "https://evil.example"])
def test_foreign_origin_is_403_before_anything(client, signed_in, origin, monkeypatch):
    called = []
    monkeypatch.setattr(me, "withdraw_member", lambda *a: called.append(a))
    del client.headers["Origin"]
    headers = {"Origin": origin} if origin else {}
    response = client.post(PATH, json={"password": SECRET}, headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Origin not allowed."}
    assert called == []


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"password": "x" * 129}, "invalid_password"),
        ({"password": ""}, "invalid_password"),
        ({"password": SECRET, "user_id": "victim"}, "invalid_input"),
    ],
)
def test_format_errors_never_echo_the_password(client, signed_in, body, code):
    response = client.post(PATH, json=body, headers=SAME_ORIGIN)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert "x" * 20 not in response.text and SECRET not in response.text
    assert_documented(response, "POST", PATH)


# --- 결과 → 응답(서비스는 MySQL 시험이 본다) ---


def _refuse(code):
    async def withdraw(db, user_id, password, guest_token=None):
        raise WithdrawalRefused(code)

    return withdraw


def _expired_cookies(response) -> dict[str, str]:
    """응답이 만료시킨 쿠키 이름 → Set-Cookie 줄."""

    cookies = {}
    for line in response.headers.get_list("set-cookie"):
        name = line.split("=", 1)[0]
        assert "Max-Age=0" in line, line
        cookies[name] = line
    return cookies


@pytest.mark.parametrize("guest_cookie", [GUEST_TOKEN, None])
def test_success_is_204_and_expires_login_and_guest_cookies(
    client, signed_in, unlocked, monkeypatch, guest_cookie
):
    calls = []

    async def withdraw(db, user_id, password, guest_token=None):
        calls.append((user_id, password, guest_token))

    monkeypatch.setattr(me, "withdraw_member", withdraw)
    if guest_cookie:
        client.cookies.set(GUEST_COOKIE, guest_cookie)
    response = client.post(PATH, json={"password": SECRET}, headers=SAME_ORIGIN)
    assert response.status_code == 204 and response.content == b""
    # 요청의 게스트 쿠키 원문을 서비스로 넘겨 같은 트랜잭션에서 폐기하게 한다(없으면 None — 탈퇴는 그대로 된다)
    assert calls == [(signed_in.id, SECRET, guest_cookie)]
    cookies = _expired_cookies(response)
    assert set(cookies) == {SESSION_COOKIE, GUEST_COOKIE}
    for line in cookies.values():
        assert "HttpOnly" in line and "Path=/" in line and "SameSite=lax" in line
        assert "Domain" not in line
    assert response.headers["cache-control"] == "no-store"


def test_wrong_password_counts_a_failure_and_keeps_the_cookie(
    client, signed_in, unlocked, monkeypatch
):
    failures = []

    async def record(db, request, email):
        failures.append(email)

    monkeypatch.setattr(me, "withdraw_member", _refuse("invalid_password"))
    monkeypatch.setattr(me, "record_login_failure", record)
    client.cookies.set(GUEST_COOKIE, GUEST_TOKEN)
    response = client.post(PATH, json={"password": "wrong-pass"}, headers=SAME_ORIGIN)
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_password"
    assert failures == [signed_in.email]
    assert "set-cookie" not in response.headers
    assert_documented(response, "POST", PATH)


@pytest.mark.parametrize("code", ["admin_cannot_withdraw", "reauth_required"])
def test_admin_and_social_only_are_403_without_counting(
    client, signed_in, unlocked, monkeypatch, code
):
    failures = []

    async def record(*args):
        failures.append(args)

    monkeypatch.setattr(me, "withdraw_member", _refuse(code))
    monkeypatch.setattr(me, "record_login_failure", record)
    client.cookies.set(GUEST_COOKIE, GUEST_TOKEN)
    response = client.post(PATH, json={}, headers=SAME_ORIGIN)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == code
    assert failures == [] and "set-cookie" not in response.headers
    assert_documented(response, "POST", PATH)


def test_already_withdrawn_by_a_parallel_request_is_401(
    client, signed_in, unlocked, monkeypatch
):
    monkeypatch.setattr(me, "withdraw_member", _refuse("already_withdrawn"))
    client.cookies.set(GUEST_COOKIE, GUEST_TOKEN)
    response = client.post(PATH, json={"password": SECRET}, headers=SAME_ORIGIN)
    assert response.status_code == 401
    assert response.json() == {"detail": "Login required."}
    assert "set-cookie" not in response.headers


def test_locked_password_attempts_are_429_and_skip_withdrawal(
    client, signed_in, monkeypatch
):
    called = []

    async def locked(*_args):
        return 120

    monkeypatch.setattr(me, "login_lock_remaining_seconds", locked)
    monkeypatch.setattr(me, "withdraw_member", lambda *a: called.append(a))
    response = client.post(PATH, json={"password": SECRET}, headers=SAME_ORIGIN)
    assert response.status_code == 429
    assert response.headers["retry-after"] == "120"
    assert response.json()["detail"]["code"] == "login_locked"
    # 11/18 — message 의 시간은 Retry-After 와 같은 숫자(120초 → 2분)
    assert response.json()["detail"]["message"].endswith("2분 뒤 다시 시도해 주세요.")
    assert called == []
    assert_documented(response, "POST", PATH)


def test_unexpected_failure_leaves_the_cookie(signed_in, unlocked, monkeypatch, client):
    async def boom(db, user_id, password, guest_token=None):
        raise RuntimeError("db down")

    monkeypatch.setattr(me, "withdraw_member", boom)
    with pytest.raises(RuntimeError):
        client.post(PATH, json={"password": SECRET}, headers=SAME_ORIGIN)


# --- 서비스: 관리자 · 이미 탈퇴는 아무것도 바꾸지 않고 되돌린다 ---


@pytest.mark.parametrize(
    ("user", "code"),
    [
        (member("admin"), "admin_cannot_withdraw"),
        (None, "already_withdrawn"),
    ],
)
def test_service_refuses_before_touching_data(db_session, user, code):
    if user is None:
        user = member()
        user.deleted_at = datetime(2026, 11, 17)
    db_session.scalar_result = user
    with pytest.raises(WithdrawalRefused) as refused:
        asyncio.run(account_withdrawal.withdraw_member(db_session, user.id, SECRET))
    assert refused.value.code == code
    assert db_session.rollback_count == 1 and db_session.commit_count == 0
    assert db_session.execute_calls == []
    # 회원 행을 배타 잠금으로 읽었다
    (locked,) = db_session.scalar_calls
    assert "FOR UPDATE" in _sql(locked)


def _guest(expires_at: datetime) -> GuestSession:
    return GuestSession(
        id="00000000-0000-4000-8000-0000000000bb",
        anonymous_session_id="00000000-0000-4000-8000-0000000000cc",
        token_hash=user_session.hash_session_token(GUEST_TOKEN),
        created_at=datetime(2026, 11, 1),
        expires_at=expires_at,
    )


@pytest.mark.parametrize("found", [True, False])
@pytest.mark.parametrize(
    ("role", "code"),
    [("admin", "admin_cannot_withdraw"), ("user", "already_withdrawn")],
)
def test_service_refusal_with_a_guest_cookie_changes_no_guest(
    db_session, found, role, code
):
    """요청 쿠키의 게스트를 잠금으로 찾은 뒤(유효 · 무효 어느 쪽이든) 거절되면 게스트도 바꾸지 않고 되돌린다."""

    user = member(role)
    if code == "already_withdrawn":
        user.deleted_at = datetime(2026, 11, 17)
    guest = _guest(datetime(2099, 1, 1)) if found else None
    db_session.scalar_result = [guest, user]
    with pytest.raises(WithdrawalRefused) as refused:
        asyncio.run(
            account_withdrawal.withdraw_member(
                db_session, user.id, SECRET, guest_token=GUEST_TOKEN
            )
        )
    assert refused.value.code == code
    assert db_session.rollback_count == 1 and db_session.commit_count == 0
    assert db_session.execute_calls == []
    assert guest is None or guest.revoked_at is None
    # 게스트 조회: 그 쿠키 토큰의 해시 하나만 · 폐기 · 만료 아님 · 배타 잠금 — 다른 게스트는 보지 않는다
    lookup, locked_user = (_sql(statement) for statement in db_session.scalar_calls)
    assert user_session.hash_session_token(GUEST_TOKEN) in lookup
    assert GUEST_TOKEN not in lookup
    assert "guest_sessions.revoked_at IS NULL" in lookup
    assert "guest_sessions.expires_at >" in lookup
    assert lookup.rstrip().endswith("FOR UPDATE")
    assert "app_users" in locked_user and "FOR UPDATE" in locked_user


def test_service_without_a_guest_cookie_does_not_look_up_guests(db_session):
    db_session.scalar_result = [member("admin")]
    with pytest.raises(WithdrawalRefused):
        asyncio.run(account_withdrawal.withdraw_member(db_session, member().id, SECRET))
    (only,) = db_session.scalar_calls
    assert "guest_sessions" not in _sql(only)


# --- 탈퇴 표시 값 ---


def test_withdrawn_values_are_random_and_cannot_be_registered():
    emails = {withdrawn_email() for _ in range(50)}
    nicknames = {withdrawn_nickname() for _ in range(50)}
    assert len(emails) == 50 and len(nicknames) == 50
    for email in emails:
        assert re.fullmatch(r"deleted\+[0-9a-f]{32}@withdrawn\.invalid", email)
        assert len(email) <= 254
    for nickname in nicknames:
        assert re.fullmatch(r"탈퇴#[0-9a-f]{16}", nickname) and len(nickname) <= 32
        with pytest.raises(InvalidNicknameError):
            validate_nickname(nickname)


# --- 로그인 · 쓰기 경합: 탈퇴한 계정에 세션 · 데이터를 다시 만들지 않는다 ---


def test_session_lookup_ignores_withdrawn_accounts(db_session):
    asyncio.run(user_session._find_session_user(db_session, "token"))
    (statement,) = db_session.scalar_calls
    assert "app_users.deleted_at IS NULL" in _sql(statement)


def test_start_session_refuses_a_withdrawn_account(db_session):
    db_session.scalar_result = False  # 잠금 읽기: deleted_at IS NULL → 거짓(탈퇴)
    response = Response()
    with pytest.raises(WithdrawnAccountError):
        asyncio.run(user_session.start_session(db_session, response, member().id))
    assert db_session.rollback_count == 1 and db_session.commit_count == 0
    assert [
        row for row in db_session.added if type(row).__name__ == "UserSession"
    ] == []
    assert "set-cookie" not in response.headers
    (check,) = db_session.scalar_calls
    sql = _sql(check)
    assert "deleted_at IS NULL" in sql and sql.rstrip().endswith("FOR UPDATE")


def test_start_session_still_works_for_members(db_session):
    db_session.scalar_result = True
    response = Response()
    asyncio.run(user_session.start_session(db_session, response, member().id))
    assert db_session.commit_count == 1 and "set-cookie" in response.headers


def test_email_login_raced_by_withdrawal_answers_like_a_wrong_password(
    client, monkeypatch
):
    async def none(*_args, **_kwargs):
        return None

    async def login_user(db, email, password):
        return member()

    # 이메일 로그인은 verified_password_hash 도 넘긴다(11/25 비밀번호 찾기 · 변경과 겹친 로그인 막기)
    async def withdrawn(*_args, **_kwargs):
        raise WithdrawnAccountError

    monkeypatch.setattr(auth, "login_lock_remaining_seconds", none)
    monkeypatch.setattr(auth, "clear_login_failures", none)
    monkeypatch.setattr(auth.local_auth, "login_user", login_user)
    monkeypatch.setattr(auth, "start_session", withdrawn)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "member@example.com", "password": SECRET},
        headers=SAME_ORIGIN,
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password."}
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/v1/me/game-save",
            {"revision": 0, "schema_version": 1, "stage": "naju", "state": {"x": 1}},
        ),
        ("/api/v1/me/character", {"display_name": "조사관", "appearance": {}}),
    ],
)
def test_save_and_character_writes_stop_for_a_withdrawn_account(
    client, db_session, signed_in, path, body
):
    db_session.scalar_result = [False]
    response = client.put(path, json=body, headers=SAME_ORIGIN)
    assert response.status_code == 401
    assert response.json() == {"detail": "Login required."}
    assert db_session.added == [] and db_session.commit_count == 0
    (check,) = db_session.scalar_calls
    assert "LOCK IN SHARE MODE" in _sql(check) or "FOR SHARE" in _sql(check)


def test_logged_in_inquiry_stops_for_a_withdrawn_account(client, db_session, signed_in):
    app.dependency_overrides[optional_current_user] = lambda: signed_in
    db_session.scalar_result = [False]
    response = client.post(
        "/api/v1/inquiries",
        json={
            "category": "account",
            "title": "제목",
            "body": "본문",
            "email": "member@example.com",
        },
        headers=SAME_ORIGIN,
    )
    app.dependency_overrides.pop(optional_current_user, None)
    assert response.status_code == 401, response.text
    assert db_session.added == []
    assert_documented(response, "POST", "/api/v1/inquiries")


# --- 설문 참가 번호(클라이언트 shortKey 와 같은 값) ---

from datetime import date  # noqa: E402
from pathlib import Path  # noqa: E402

from app.services.withdrawn_survey import SurveyCode, participant_key  # noqa: E402
from scripts import withdrawn_survey_codes as survey_cli  # noqa: E402

# src/beta/betaLog.ts `shortKey` 를 node 로 돌려 얻은 값(11/17) — 바뀌면 클라이언트와 어긋난 것이다
CLIENT_VECTORS = {
    "00000000-0000-4000-8000-000000000001": "CF703DA2",
    "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b": "01D47C17",
    "": "811C9DC5",
    "ffffffff-ffff-4fff-bfff-ffffffffffff": "13EC198B",
    "가나다": "A8366FB3",
    # 서로 다른 계정이 같은 번호 — 짧은 지문이라 겹칠 수 있다
    "f110cb7a-82d1-4330-998a-9bda31ee3ccd": "B080C459",
    "18965dcc-d6c6-440c-9a3d-539143b70ca6": "B080C459",
}


@pytest.mark.parametrize(("account_id", "expected"), CLIENT_VECTORS.items())
def test_participant_key_matches_the_client(account_id, expected):
    assert participant_key(account_id) == expected


def test_client_short_key_is_still_the_same_algorithm():
    """클라이언트 계산이 바뀌면 이 스크립트도 같이 고쳐야 한다 — 소스의 상수 · 형식을 고정한다."""

    source = (
        Path(__file__).resolve().parents[2] / "src" / "beta" / "betaLog.ts"
    ).read_text(encoding="utf-8")
    body = source[source.index("export function shortKey") :]
    body = body[: body.index("\n}\n")]
    for part in (
        "0x811c9dc5",
        "hash ^= text.charCodeAt(i)",
        "Math.imul(hash, 0x01000193) >>> 0",
        'hash.toString(16).padStart(8, "0").toUpperCase()',
    ):
        assert part in body, part
    assert "participantKey: (): string | null => (account ? shortKey(account)" in source


def test_since_defaults_to_two_weeks_and_rejects_bad_dates():
    today = date(2026, 11, 17)
    assert survey_cli.parse_since(None, today) == date(2026, 11, 3)
    assert survey_cli.parse_since("2026-11-01", today) == date(2026, 11, 1)
    assert survey_cli.parse_since("2026-11-17", today) == today
    for bad in ("2026-11-18", "11/01", "2026-13-01", ""):
        with pytest.raises(survey_cli.UsageError):
            survey_cli.parse_since(bad, today)


def test_output_has_only_time_kind_code_and_overlap():
    rows = [
        SurveyCode(datetime(2026, 11, 16, 15, 30), "account", "CF703DA2", 0),
        SurveyCode(datetime(2026, 11, 16, 15, 30), "code", "ABCD-EFGH", 0),
        SurveyCode(datetime(2026, 11, 17, 1, 0), "account", "B080C459", 1),
    ]
    lines = survey_cli.format_rows(date(2026, 11, 1), rows, "waegok")
    assert lines[0] == (
        "[READ-ONLY] db=waegok since=2026-11-01 00:00 KST withdrawn=2 rows=3"
    )
    # UTC 15:30 → KST 다음 날 00:30
    assert lines[2].startswith("2026-11-17 00:30  account  CF703DA2")
    assert "ABCD-EFGH" in lines[3]
    assert "다른 계정 1개와 같은 번호 — 확인 필요" in lines[4]
    assert not any("@" in line for line in lines)
    assert survey_cli.format_rows(date(2026, 11, 1), [], "waegok") == [
        "[READ-ONLY] db=waegok since=2026-11-01 00:00 KST withdrawn=0 rows=0"
    ]


def test_bad_since_never_touches_the_database(monkeypatch, capsys):
    async def boom(*_args):
        raise AssertionError("DB 에 접속하면 안 된다")

    monkeypatch.setattr(survey_cli, "run", boom)
    assert survey_cli.main(["--since", "2099-01-01"]) == survey_cli.EXIT_USAGE
    assert "[USAGE]" in capsys.readouterr().out


# --- 관리자 회원 상세 deleted_at ---


def test_admin_user_detail_schema_adds_deleted_at_only():
    from app.schemas.account_data import AdminUserDetailUser

    fields = set(AdminUserDetailUser.model_fields)
    assert {"region", "providers", "last_login_at", "last_session_started_at"} <= fields
    assert "deleted_at" in fields
    assert AdminUserDetailUser.model_fields["deleted_at"].default is None
