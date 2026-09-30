from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from tests.conftest import FakeAsyncSession


def test_health(client: TestClient, db_session: FakeAsyncSession) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert db_session.execute_calls == []


def test_readiness_succeeds_when_database_query_succeeds(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    assert [str(statement) for statement in db_session.execute_calls] == [
        "SELECT 1",
    ]
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_readiness_returns_503_without_exposing_database_error(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    db_session.execute_error = SQLAlchemyError("private database connection detail")

    response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Database is not ready."}
    assert "private database connection detail" not in response.text
    assert len(db_session.execute_calls) == 1
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_liveness_is_unaffected_by_database_failure(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    db_session.execute_error = SQLAlchemyError("database unavailable")

    readiness_response = client.get("/api/v1/health/ready")
    liveness_response = client.get("/api/v1/health")

    assert readiness_response.status_code == 503
    assert liveness_response.status_code == 200
    assert liveness_response.json() == {"status": "ok"}
    assert len(db_session.execute_calls) == 1
