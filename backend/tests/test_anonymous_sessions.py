from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from app.models.anonymous_session import AnonymousSession
from tests.conftest import FakeAsyncSession


def test_create_anonymous_session(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    before_request = datetime.now(timezone.utc)

    response = client.post("/api/v1/anonymous-sessions")

    after_request = datetime.now(timezone.utc)
    assert response.status_code == 201

    body = response.json()
    assert body["success"] is True
    UUID(body["data"]["anonymous_session_id"])

    expires_at = datetime.fromisoformat(body["data"]["expires_at"])
    assert before_request + timedelta(hours=24) <= expires_at
    assert expires_at <= after_request + timedelta(hours=24)

    assert len(db_session.added) == 1
    saved_session = db_session.added[0]
    assert isinstance(saved_session, AnonymousSession)
    assert saved_session.id == body["data"]["anonymous_session_id"]
    assert saved_session.created_at.tzinfo is None
    assert saved_session.expires_at.tzinfo is None
    assert saved_session.expires_at - saved_session.created_at == timedelta(hours=24)
    assert db_session.commit_count == 1
    assert db_session.refresh_count == 1
    assert db_session.rollback_count == 0
