import pytest
from fastapi.testclient import TestClient

from app.api.v1 import auth
from app.schemas.auth import GoogleUserResponse
from app.services import google_auth
from app.services.google_auth import (
    GoogleAuthConfigurationError,
    InvalidGoogleCredentialError,
)


def test_google_login_returns_verified_profile(
    client: TestClient,
    monkeypatch,
) -> None:
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
