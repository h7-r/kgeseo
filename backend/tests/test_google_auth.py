import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.api.v1 import auth
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.schemas.auth import GoogleUserResponse
from app.services import google_auth
from app.services.google_auth import (
    GoogleAuthConfigurationError,
    InvalidGoogleCredentialError,
)


def make_user(
    *,
    user_id: str = "11111111-1111-4111-8111-111111111111",
    email: str = "user@example.com",
    nickname: str = "Test User",
) -> AppUser:
    from datetime import datetime

    now = datetime(2026, 10, 6, 12, 0, 0)
    return AppUser(
        id=user_id,
        email=email,
        nickname=nickname,
        region=None,
        terms_version="2026-09",
        terms_accepted_at=now,
        privacy_accepted_at=now,
        age_confirmed_at=now,
        created_at=now,
        updated_at=now,
    )


def make_identity(
    *,
    provider: str = "google",
    subject: str = "google-subject",
    user: AppUser | None = None,
) -> AuthIdentity:
    from datetime import datetime

    now = datetime(2026, 10, 6, 12, 0, 0)
    app_user = user or make_user()
    return AuthIdentity(
        id="22222222-2222-4222-8222-222222222222",
        app_user_id=app_user.id,
        provider=provider,
        provider_subject=subject,
        password_hash=None,
        created_at=now,
        updated_at=now,
    )


def test_google_login_returns_verified_profile(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    user = make_user()
    db_session.scalar_result = make_identity(user=user)
    db_session.get_result = user

    def verify(credential: str, client_id: str) -> GoogleUserResponse:
        assert credential == "valid-id-token"
        return GoogleUserResponse(
            provider="google",
            subject="google-subject",
            email="user@example.com",
            email_verified=True,
            name="Test User",
            picture="https://example.com/profile.png",
        )

    monkeypatch.setattr(auth, "verify_google_credential", verify)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "valid-id-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "google",
        "subject": "google-subject",
        "email": "user@example.com",
        "email_verified": True,
        "name": "Test User",
        "picture": "https://example.com/profile.png",
    }
    assert "valid-id-token" not in response.text
    assert "app_user_id" not in response.text
    assert "password_hash" not in response.text


def test_google_login_creates_user_and_identity_for_new_email(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    db_session.scalar_result = [None, None, None]

    def verify(credential: str, client_id: str) -> GoogleUserResponse:
        return GoogleUserResponse(
            provider="google",
            subject="google-subject",
            email="User@Example.COM",
            email_verified=True,
            name="Test User",
            picture="https://example.com/profile.png",
        )

    monkeypatch.setattr(auth, "verify_google_credential", verify)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "valid-id-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "User@Example.COM"
    assert "app_user_id" not in body
    assert len(db_session.added) == 2
    user = db_session.added[0]
    identity = db_session.added[1]
    assert isinstance(user, AppUser)
    assert isinstance(identity, AuthIdentity)
    assert user.email == "user@example.com"
    assert user.nickname.startswith("user_")
    assert len(user.nickname) == 9
    assert user.terms_version is None
    assert user.terms_accepted_at is None
    assert user.privacy_accepted_at is None
    assert user.age_confirmed_at is None
    assert identity.provider == "google"
    assert identity.provider_subject == "google-subject"
    assert identity.password_hash is None
    assert db_session.commit_count == 1
    assert db_session.refresh_count == 1
    assert "password_hash" not in response.text
    assert "valid-id-token" not in response.text


def test_google_login_requires_account_link_for_existing_email(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    db_session.scalar_result = [None, make_user()]

    def verify(credential: str, client_id: str) -> GoogleUserResponse:
        return GoogleUserResponse(
            provider="google",
            subject="google-subject",
            email="user@example.com",
            email_verified=True,
            name="Test User",
            picture=None,
        )

    monkeypatch.setattr(auth, "verify_google_credential", verify)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "valid-id-token"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_link_required"
    assert db_session.added == []


def test_google_login_recovers_duplicate_provider_subject_race(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    user = make_user()
    identity = make_identity(user=user)
    db_session.scalar_result = [None, None, None, identity]
    db_session.get_result = user
    db_session.commit_error = IntegrityError("insert auth_identities", {}, Exception())

    def verify(credential: str, client_id: str) -> GoogleUserResponse:
        return GoogleUserResponse(
            provider="google",
            subject="google-subject",
            email="user@example.com",
            email_verified=True,
            name="Test User",
            picture=None,
        )

    monkeypatch.setattr(auth, "verify_google_credential", verify)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "valid-id-token"},
    )

    assert response.status_code == 200
    assert "app_user_id" not in response.json()
    assert db_session.rollback_count == 1


def test_google_login_reports_duplicate_email_race_as_account_link_required(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    db_session.scalar_result = [None, None, None, None, make_user()]
    db_session.commit_error = IntegrityError("insert app_users", {}, Exception())

    def verify(credential: str, client_id: str) -> GoogleUserResponse:
        return GoogleUserResponse(
            provider="google",
            subject="google-subject",
            email="user@example.com",
            email_verified=True,
            name="Test User",
            picture=None,
        )

    monkeypatch.setattr(auth, "verify_google_credential", verify)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "valid-id-token"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_link_required"
    assert db_session.rollback_count == 1


def test_google_login_rejects_invalid_credential(
    client: TestClient,
    monkeypatch,
) -> None:
    def reject(credential: str, client_id: str) -> GoogleUserResponse:
        raise InvalidGoogleCredentialError

    monkeypatch.setattr(auth, "verify_google_credential", reject)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "invalid-id-token"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid Google credential."}
    assert "invalid-id-token" not in response.text


def test_google_login_reports_missing_server_configuration(
    client: TestClient,
    monkeypatch,
) -> None:
    def reject(credential: str, client_id: str) -> GoogleUserResponse:
        raise GoogleAuthConfigurationError

    monkeypatch.setattr(auth, "verify_google_credential", reject)

    response = client.post(
        "/api/v1/auth/google",
        json={"credential": "valid-id-token"},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Google authentication is not configured.",
    }


def test_google_login_rejects_missing_or_empty_credential(client: TestClient) -> None:
    missing_response = client.post("/api/v1/auth/google", json={})
    empty_response = client.post(
        "/api/v1/auth/google",
        json={"credential": ""},
    )

    assert missing_response.status_code == 422
    assert empty_response.status_code == 422


def test_google_verifier_returns_sanitized_verified_profile(monkeypatch) -> None:
    def verify_token(credential, request, audience):
        assert credential == "valid-id-token"
        assert audience == "web-client-id"
        return {
            "sub": "google-subject",
            "email": "user@example.com",
            "email_verified": True,
            "name": "Test User",
            "picture": "https://example.com/profile.png",
        }

    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token", verify_token)

    profile = google_auth.verify_google_credential(
        "valid-id-token",
        "web-client-id",
    )

    assert profile.subject == "google-subject"
    assert profile.email_verified is True


@pytest.mark.parametrize(
    "claims_or_error",
    [
        ValueError("wrong audience or expired token"),
        {"email": "user@example.com", "email_verified": True},
        {
            "sub": "google-subject",
            "email": "user@example.com",
            "email_verified": False,
        },
    ],
)
def test_google_verifier_rejects_untrusted_claims(
    monkeypatch,
    claims_or_error,
) -> None:
    def verify_token(credential, request, audience):
        if isinstance(claims_or_error, Exception):
            raise claims_or_error
        return claims_or_error

    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token", verify_token)

    with pytest.raises(google_auth.InvalidGoogleCredentialError):
        google_auth.verify_google_credential("untrusted-token", "web-client-id")
