from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.models.anonymous_session import AnonymousSession
from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.services import play_session as play_session_service
from app.services.case_content import (
    CaseClientContentJSONDecodeError,
    CaseClientContentNotFoundError,
    CaseClientContentValidationError,
    InvalidClientCaseIdError,
)
from tests.conftest import FakeAsyncSession


def make_anonymous_session(*, expires_at: datetime) -> AnonymousSession:
    return AnonymousSession(
        id="anonymous-session-id",
        created_at=expires_at - timedelta(hours=1),
        expires_at=expires_at,
    )


def make_client_content(
    *,
    entry_zone_id: str = "ZONE_002",
) -> CaseClientContent:
    return CaseClientContent.model_validate(
        {
            "case_id": "case-001",
            "entry_zone_id": entry_zone_id,
            "zones": [
                {
                    "zone_id": "ZONE_001",
                    "zone_name": "First",
                    "zone_type": "room",
                    "description": "First zone",
                    "objects": [],
                    "navigation": [],
                },
                {
                    "zone_id": "ZONE_002",
                    "zone_name": "Entry",
                    "zone_type": "room",
                    "description": "Entry zone",
                    "objects": [],
                    "navigation": [],
                },
            ],
        }
    )


def install_client_content_loader(
    monkeypatch: pytest.MonkeyPatch,
    *,
    entry_zone_id: str = "ZONE_002",
) -> None:
    content = make_client_content(entry_zone_id=entry_zone_id)

    def load(case_id: str) -> CaseClientContent:
        assert case_id == content.case_id
        return content

    monkeypatch.setattr(play_session_service, "load_case_client_content", load)


def make_play_session(*, completed_at: datetime | None = None) -> PlaySession:
    created_at = datetime(2026, 9, 18, 1, 2, 3, 456789)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anonymous-session-id",
        case_id="case-001",
        state_json={
            "completed_puzzle_ids": ["puzzle-001"],
            "acquired_clue_ids": ["clue-001"],
            "hint_levels": {"puzzle-001": 1},
            "flags": {"archive_unlocked": True},
        },
        created_at=created_at,
        updated_at=created_at + timedelta(minutes=5),
        completed_at=completed_at,
    )


def test_create_play_session(
    client: TestClient,
    db_session: FakeAsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_client_content_loader(monkeypatch)
    db_session.get_result = make_anonymous_session(
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
    )

    response = client.post(
        "/api/v1/play-sessions",
        json={
            "anonymous_session_id": "anonymous-session-id",
            "case_id": "case-001",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["data"]["case_id"] == "case-001"
    UUID(body["data"]["play_session_id"])
    assert datetime.fromisoformat(body["data"]["created_at"]).tzinfo is not None
    assert body["data"]["state"] == {
        "current_zone_id": "ZONE_002",
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
    }

    assert len(db_session.added) == 1
    saved_session = db_session.added[0]
    assert isinstance(saved_session, PlaySession)
    assert saved_session.id == body["data"]["play_session_id"]
    assert saved_session.anonymous_session_id == "anonymous-session-id"
    assert saved_session.case_id == "case-001"
    assert saved_session.state_json == body["data"]["state"]
    assert saved_session.created_at.tzinfo is None
    assert saved_session.updated_at == saved_session.created_at
    assert saved_session.completed_at is None
    assert db_session.commit_count == 1
    assert db_session.refresh_count == 1
    assert db_session.rollback_count == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"case_id": "case-001"},
        {"anonymous_session_id": "anonymous-session-id"},
    ],
)
def test_create_play_session_requires_all_fields(
    client: TestClient,
    db_session: FakeAsyncSession,
    payload: dict[str, str],
) -> None:
    response = client.post("/api/v1/play-sessions", json=payload)

    assert response.status_code == 422
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_get_play_session(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    db_session.get_result = make_play_session()

    response = client.get("/api/v1/play-sessions/play-session-id")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["play_session_id"] == "play-session-id"
    assert body["data"]["case_id"] == "case-001"
    assert body["data"]["state"] == {
        "current_zone_id": None,
        "completed_puzzle_ids": ["puzzle-001"],
        "acquired_clue_ids": ["clue-001"],
        "hint_levels": {"puzzle-001": 1},
        "attempt_counts": {},
        "flags": {"archive_unlocked": True},
    }

    created_at = datetime.fromisoformat(body["data"]["created_at"])
    updated_at = datetime.fromisoformat(body["data"]["updated_at"])
    assert created_at.utcoffset() == timedelta(0)
    assert updated_at.utcoffset() == timedelta(0)
    assert body["data"]["completed_at"] is None

    assert db_session.get_calls == [(PlaySession, "play-session-id")]
    assert db_session.added == []
    assert db_session.commit_count == 0
    assert db_session.refresh_count == 0
    assert db_session.rollback_count == 0


def test_get_play_session_returns_stored_current_zone(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    play_session = make_play_session()
    play_session.state_json["current_zone_id"] = "ZONE_002"
    db_session.get_result = play_session

    response = client.get("/api/v1/play-sessions/play-session-id")

    assert response.status_code == 200
    assert response.json()["data"]["state"]["current_zone_id"] == "ZONE_002"
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_get_play_session_returns_404_for_unknown_play_session(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    response = client.get("/api/v1/play-sessions/missing-play-session-id")

    assert response.status_code == 404
    assert response.json() == {"detail": "Play session not found."}
    assert db_session.get_calls == [(PlaySession, "missing-play-session-id")]
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_get_completed_play_session_returns_completed_at_as_utc(
    client: TestClient,
    db_session: FakeAsyncSession,
) -> None:
    completed_at = datetime(2026, 9, 18, 2, 3, 4, 567890)
    db_session.get_result = make_play_session(completed_at=completed_at)

    response = client.get("/api/v1/play-sessions/play-session-id")

    assert response.status_code == 200
    returned_completed_at = datetime.fromisoformat(
        response.json()["data"]["completed_at"],
    )
    assert returned_completed_at.replace(tzinfo=None) == completed_at
    assert returned_completed_at.utcoffset() == timedelta(0)
    assert db_session.get_calls == [(PlaySession, "play-session-id")]
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_create_play_session_returns_404_for_unknown_anonymous_session(
    client: TestClient,
    db_session: FakeAsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_loader(case_id: str) -> CaseClientContent:
        raise AssertionError(f"Client Content loaded for {case_id}")

    monkeypatch.setattr(
        play_session_service,
        "load_case_client_content",
        unexpected_loader,
    )
    response = client.post(
        "/api/v1/play-sessions",
        json={
            "anonymous_session_id": "missing-session-id",
            "case_id": "case-001",
        },
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Anonymous session not found."}
    assert db_session.added == []
    assert db_session.commit_count == 0


def test_create_play_session_returns_410_for_expired_anonymous_session(
    client: TestClient,
    db_session: FakeAsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_loader(case_id: str) -> CaseClientContent:
        raise AssertionError(f"Client Content loaded for {case_id}")

    monkeypatch.setattr(
        play_session_service,
        "load_case_client_content",
        unexpected_loader,
    )
    db_session.get_result = make_anonymous_session(
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )

    response = client.post(
        "/api/v1/play-sessions",
        json={
            "anonymous_session_id": "anonymous-session-id",
            "case_id": "case-001",
        },
    )

    assert response.status_code == 410
    assert response.json() == {"detail": "Anonymous session has expired."}
    assert db_session.added == []
    assert db_session.commit_count == 0


@pytest.mark.parametrize(
    ("loader_error", "expected_status", "expected_detail"),
    [
        (InvalidClientCaseIdError("bad case"), 422, "Invalid case ID."),
        (CaseClientContentNotFoundError("missing"), 404, "Case not found."),
        (
            CaseClientContentJSONDecodeError("broken"),
            500,
            "Case content is unavailable.",
        ),
        (
            CaseClientContentValidationError("invalid"),
            500,
            "Case content is unavailable.",
        ),
    ],
)
def test_create_play_session_maps_client_content_errors(
    client: TestClient,
    db_session: FakeAsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    loader_error: Exception,
    expected_status: int,
    expected_detail: str,
) -> None:
    db_session.get_result = make_anonymous_session(
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
    )

    def failing_loader(case_id: str) -> CaseClientContent:
        raise loader_error

    monkeypatch.setattr(
        play_session_service,
        "load_case_client_content",
        failing_loader,
    )

    response = client.post(
        "/api/v1/play-sessions",
        json={
            "anonymous_session_id": "anonymous-session-id",
            "case_id": "case-001",
        },
    )

    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}
    assert str(loader_error) not in response.text
    assert db_session.added == []
    assert db_session.commit_count == 0
    assert db_session.refresh_count == 0
    assert db_session.rollback_count == 1
