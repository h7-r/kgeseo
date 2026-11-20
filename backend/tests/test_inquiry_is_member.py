"""문의 접수 응답 `is_member` 계약(DB 없이) — 실제 저장 경로는 `test_inquiry_is_member_mysql.py`.

- 응답 모델: 기존 `id` · `number` · `created_at` 그대로 + 필수 boolean `is_member`.
- 라우터: 값은 로그인 의존성 결과가 아니라 저장된 행의 `app_user_id` 로 정한다.
"""

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import inquiries as inquiries_api
from app.db.session import get_db
from app.main import app
from app.services.request_rate_limit import (
    SlidingWindowLimiter,
    get_request_rate_limiter,
)
from app.services.user_session import optional_current_user

ORIGIN = {"Origin": "http://localhost:5173"}
BODY = {"category": "tech", "title": "제목", "body": "본문", "email": "a@example.com"}


def test_openapi_response_keeps_old_fields_and_adds_required_boolean():
    schema = app.openapi()
    created = schema["components"]["schemas"]["InquiryCreated"]
    assert list(created["properties"]) == ["id", "number", "created_at", "is_member"]
    assert set(created["required"]) == {"id", "number", "created_at", "is_member"}
    assert created["properties"]["is_member"]["type"] == "boolean"
    response = schema["paths"]["/api/v1/inquiries"]["post"]["responses"]["201"]
    assert response["content"]["application/json"]["schema"]["$ref"].endswith(
        "/InquiryCreated"
    )


@pytest.fixture
def api(monkeypatch):
    """저장 함수를 바꿔 끼워 「로그인 의존성이 준 사용자」와 「저장된 행」을 따로 정한다."""

    stored = {}

    async def fake_create_inquiry(db, **fields):
        stored.update(fields)
        return SimpleNamespace(
            id="00000000-0000-4000-8000-000000000001",
            number="INQ-20261120-00001",
            created_at=datetime(2026, 11, 20, 3, 0, 0),
            app_user_id=stored.get("force_app_user_id", fields["app_user_id"]),
        )

    async def fake_db():
        yield SimpleNamespace(rollback=lambda: None)

    monkeypatch.setattr(inquiries_api, "create_inquiry", fake_create_inquiry)
    monkeypatch.setattr(
        inquiries_api, "ensure_member_for_write", lambda db, user_id: _done()
    )
    limiter = SlidingWindowLimiter()
    app.dependency_overrides[get_db] = fake_db
    app.dependency_overrides[get_request_rate_limiter] = lambda: limiter
    try:
        yield stored
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_request_rate_limiter, None)
        app.dependency_overrides.pop(optional_current_user, None)


async def _done():
    return None


def _post():
    with TestClient(app) as http:
        return http.post("/api/v1/inquiries", json=BODY, headers=ORIGIN)


def test_signed_in_member_gets_true_and_no_account_data(api):
    member = SimpleNamespace(id="member-id-1", email="m@example.com", nickname="회원닉")
    app.dependency_overrides[optional_current_user] = lambda: member
    response = _post()
    assert response.status_code == 201, response.text
    assert response.json() == {
        "id": "00000000-0000-4000-8000-000000000001",
        "number": "INQ-20261120-00001",
        "created_at": "2026-11-20T03:00:00",
        "is_member": True,
    }
    assert api["app_user_id"] == "member-id-1"
    for secret in ("member-id-1", "m@example.com", "회원닉"):
        assert secret not in response.text


def test_guest_gets_false(api):
    app.dependency_overrides[optional_current_user] = lambda: None
    response = _post()
    assert response.status_code == 201
    assert response.json()["is_member"] is False
    assert api["app_user_id"] is None


def test_value_comes_from_the_stored_row_not_the_login_dependency(api):
    # 로그인 의존성은 회원을 줬지만 저장된 행이 비회원이면(예: 저장 경로가 연결을 버림) 응답도 비회원이다
    member = SimpleNamespace(id="member-id-2", email="x@example.com", nickname="닉")
    app.dependency_overrides[optional_current_user] = lambda: member
    api["force_app_user_id"] = None
    response = _post()
    assert response.status_code == 201
    assert response.json()["is_member"] is False
