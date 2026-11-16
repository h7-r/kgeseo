"""관리자 감사 기록 확장(11/16 세진, revision 63566bb6005b) — DB 없이 보는 것.

- IP 는 Uvicorn 이 정한 `request.client.host` 만 쓰고 `X-Forwarded-For` 원문은 믿지 않는다
- User-Agent 정리(제어 문자 · 512자) · 대상 표기 규칙(둘 다 / 둘 다 없음 · 정해 둔 종류)
- 기존 `_audit(db, admin, action, target_user_id)` 호출이 그대로 동작하고 새 열이 채워진다
- `/admin/audit-logs` 응답에 새 필드가 덧붙고(IP 는 앞 두 자리만), 옛 기록은 null
실제 열 추가 · 왕복은 격리 MySQL 이 있어야 본다(이 파일 밖).
"""

import asyncio
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import admin as admin_api
from app.db.session import get_db
from app.main import app
from app.models.account_data import AdminAuditLog
from app.models.app_user import AppUser
from app.services.admin_audit import (
    AUDIT_TARGET_TYPES,
    USER_AGENT_MAX_LENGTH,
    AuditRequestInfo,
    capture_audit_request,
    check_target,
    current_request_info,
    normalize_client_ip,
    normalize_user_agent,
)
from app.services.user_session import current_user
from tests.conftest import FakeAsyncSession

NOTICE_ID = "5f0c3a1e-9b2d-4c7e-8a41-2d6f0b9e7c13"

ADMIN = AppUser(
    id="00000000-0000-4000-8000-000000000001",
    email="admin@example.com",
    nickname="관리",
    role="admin",
    created_at=datetime(2026, 11, 1),
)
MEMBER = AppUser(
    id="00000000-0000-4000-8000-0000000000aa",
    email="member@example.com",
    nickname="회원",
    role="user",
    created_at=datetime(2026, 11, 2),
)


class _Rows:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class RowsSession(FakeAsyncSession):
    """execute 가 정해 둔 행을 돌려주고, get 은 모델별로 고른다."""

    def __init__(
        self, rows: list[Any] | None = None, by_model: dict[type, Any] | None = None
    ) -> None:
        super().__init__()
        self.rows = rows or []
        self.by_model = by_model or {}

    async def execute(self, statement: Any) -> _Rows:
        await super().execute(statement)
        return _Rows(self.rows)

    async def get(self, model: type[Any], entity_id: str, **options: Any) -> Any:
        await super().get(model, entity_id, **options)
        return self.by_model.get(model)


def _client(db: FakeAsyncSession, host: str, headers: dict[str, str]) -> TestClient:
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: ADMIN
    return TestClient(app, client=(host, 50000), headers=headers)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(current_user, None)


def _audit_rows(db: FakeAsyncSession) -> list[AdminAuditLog]:
    return [row for row in db.added if isinstance(row, AdminAuditLog)]


# --- 정리 규칙 ---


@pytest.mark.parametrize(
    ("raw", "stored"),
    [
        ("203.0.113.9", "203.0.113.9"),
        ("2001:DB8::1", "2001:db8::1"),
        (" 198.51.100.7 ", "198.51.100.7"),
        ("testclient", None),
        ("", None),
        (None, None),
        ("203.0.113.9, 10.0.0.1", None),
        ("unknown", None),
    ],
)
def test_client_ip_keeps_only_real_addresses(raw, stored):
    assert normalize_client_ip(raw) == stored


def test_user_agent_is_cleaned_and_capped():
    assert normalize_user_agent(None) is None
    assert normalize_user_agent("   ") is None
    assert (
        normalize_user_agent("Mozilla/5.0\r\nX-Evil: 1\t") == "Mozilla/5.0  X-Evil: 1"
    )
    long = "a" * (USER_AGENT_MAX_LENGTH + 100)
    assert normalize_user_agent(long) == "a" * USER_AGENT_MAX_LENGTH


@pytest.mark.parametrize(
    ("target_type", "target_id"),
    [
        (None, None),
        ("user", MEMBER.id),
        ("inquiry", "c0ffee00-0000-4000-8000-000000000001"),
        ("setting", "maintenance_mode"),
        ("notice", NOTICE_ID),
    ],
)
def test_target_pairs_that_are_allowed(target_type, target_id):
    check_target(target_type, target_id)


def test_target_types_are_exactly_the_agreed_four():
    assert AUDIT_TARGET_TYPES == {"user", "inquiry", "setting", "notice"}


@pytest.mark.parametrize(
    ("target_type", "target_id"),
    [
        ("user", None),
        (None, "x"),
        ("announcement", NOTICE_ID),
        ("content", "case-01"),
        ("user", ""),
        ("setting", "k" * 65),
        # 공지는 UUID 표준 표기(소문자 36자)만
        ("notice", "1"),
        ("notice", NOTICE_ID.upper()),
        ("notice", NOTICE_ID.replace("-", "")),
        ("notice", "{" + NOTICE_ID + "}"),
        ("notice", None),
    ],
)
def test_target_pairs_that_are_programming_errors(target_type, target_id):
    with pytest.raises(ValueError):
        check_target(target_type, target_id)


# --- _audit 쓰기 ---


def test_old_call_shape_still_works_and_fills_request_columns():
    db = FakeAsyncSession()

    class _Req:
        client = type("C", (), {"host": "203.0.113.9"})()
        headers = {"user-agent": "UA/1"}

    async def run():
        await capture_audit_request(_Req())  # type: ignore[arg-type]
        await admin_api._audit(db, ADMIN, "list_users", None)

    asyncio.run(run())
    (row,) = _audit_rows(db)
    assert (row.admin_user_id, row.action, row.target_user_id) == (
        ADMIN.id,
        "list_users",
        None,
    )
    assert (row.client_ip, row.user_agent) == ("203.0.113.9", "UA/1")
    assert (row.target_type, row.target_id) == (None, None)
    assert db.commit_count == 1


def test_without_request_capture_new_columns_stay_null():
    db = FakeAsyncSession()
    asyncio.run(
        admin_api._audit(
            db, ADMIN, "read_user", MEMBER.id, target_type="user", target_id=MEMBER.id
        )
    )
    (row,) = _audit_rows(db)
    assert (row.client_ip, row.user_agent) == (None, None)
    assert (row.target_user_id, row.target_type, row.target_id) == (
        MEMBER.id,
        "user",
        MEMBER.id,
    )


@pytest.mark.parametrize("action", ["create_notice", "update_notice", "delete_notice"])
def test_notice_target_is_recorded_for_notice_changes(action):
    """공지 API 가 `_audit()` 를 그대로 쓸 수 있다 — 회원 개인정보가 아니라 target_user_id 는 None, 대상은 공지 UUID."""

    db = FakeAsyncSession()

    class _Req:
        client = type("C", (), {"host": "198.51.100.40"})()
        headers = {"user-agent": "UA/notice"}

    async def run():
        await capture_audit_request(_Req())  # type: ignore[arg-type]
        await admin_api._audit(
            db, ADMIN, action, None, target_type="notice", target_id=NOTICE_ID
        )

    asyncio.run(run())
    (row,) = _audit_rows(db)
    assert (row.action, row.target_user_id) == (action, None)
    assert (row.target_type, row.target_id) == ("notice", NOTICE_ID)
    assert (row.client_ip, row.user_agent) == ("198.51.100.40", "UA/notice")


def test_notice_target_with_non_uuid_id_is_refused_before_writing():
    db = FakeAsyncSession()
    with pytest.raises(ValueError):
        asyncio.run(
            admin_api._audit(
                db, ADMIN, "update_notice", None, target_type="notice", target_id="7"
            )
        )
    assert db.added == [] and db.commit_count == 0


def test_half_target_is_refused_before_writing():
    db = FakeAsyncSession()
    with pytest.raises(ValueError):
        asyncio.run(
            admin_api._audit(db, ADMIN, "read_inquiry", None, target_type="inquiry")
        )
    assert db.added == [] and db.commit_count == 0


def test_request_info_does_not_leak_between_contexts():
    assert current_request_info() == AuditRequestInfo(client_ip=None, user_agent=None)


def test_every_admin_route_captures_request():
    assert any(
        dep.dependency is capture_audit_request for dep in admin_api.router.dependencies
    )


# --- HTTP 경로 ---


def test_http_audit_uses_server_seen_ip_not_forwarded_header():
    db = RowsSession(rows=[])
    client = _client(
        db,
        "203.0.113.9",
        {
            "User-Agent": "Mozilla/5.0 (test)",
            "X-Forwarded-For": "198.51.100.7",
            "X-Real-IP": "198.51.100.8",
        },
    )
    response = client.get("/api/v1/admin/audit-logs")
    assert response.status_code == 200
    (row,) = _audit_rows(db)
    assert row.action == "list_audit_logs"
    assert row.client_ip == "203.0.113.9"
    assert row.user_agent == "Mozilla/5.0 (test)"


def test_http_audit_logs_response_adds_fields_and_masks_ip():
    new_row = AdminAuditLog(
        id=2,
        admin_user_id=ADMIN.id,
        action="read_user",
        target_user_id=MEMBER.id,
        created_at=datetime(2026, 11, 16, 1, 0),
        client_ip="198.51.100.23",
        user_agent="UA/2",
        target_type="user",
        target_id=MEMBER.id,
    )
    old_row = AdminAuditLog(
        id=1,
        admin_user_id=ADMIN.id,
        action="list_users",
        target_user_id=None,
        created_at=datetime(2026, 11, 15, 1, 0),
    )
    db = RowsSession(rows=[(new_row, "관리", "회원"), (old_row, "관리", None)])
    body = _client(db, "203.0.113.9", {}).get("/api/v1/admin/audit-logs").json()
    first, second = body["logs"]
    # 기존 필드는 그대로
    assert first["admin"] == {"user_id": ADMIN.id, "nickname": "관리"}
    assert first["target"] == {"user_id": MEMBER.id, "nickname": "회원"}
    # 덧붙은 필드 — IP 원문은 응답 어디에도 없다
    assert first["target_type"] == "user" and first["target_id"] == MEMBER.id
    assert first["client_ip_display"] == "198.51.*.*"
    assert first["user_agent"] == "UA/2"
    assert "198.51.100.23" not in str(body) and "client_ip" not in first
    # 확장 전 기록은 null
    assert second["target"] is None
    assert (
        second["target_type"],
        second["target_id"],
        second["client_ip_display"],
        second["user_agent"],
    ) == (
        None,
        None,
        None,
        None,
    )


def test_http_read_user_records_user_target():
    db = RowsSession(rows=[], by_model={AppUser: MEMBER})
    response = _client(db, "2001:db8::5", {"User-Agent": "UA/3"}).get(
        f"/api/v1/admin/users/{MEMBER.id}"
    )
    assert response.status_code == 200
    (row,) = _audit_rows(db)
    assert (row.action, row.target_user_id, row.target_type, row.target_id) == (
        "read_user",
        MEMBER.id,
        "user",
        MEMBER.id,
    )
    assert (row.client_ip, row.user_agent) == ("2001:db8::5", "UA/3")
