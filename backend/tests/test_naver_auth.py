import pytest
from fastapi.testclient import TestClient

from app.api.v1 import auth
from app.schemas.auth import GoogleUserResponse
from app.services import naver_auth
from app.services.naver_auth import (
    InvalidNaverProfileError,
    NaverAuthConfigurationError,
    NaverProfileError,
    NaverTokenExchangeError,
)


def test_naver_login_returns_verified_profile(
    client: TestClient,
    monkeypatch,
) -> None:
    def verify(
        code: str,
        state: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
    ) -> GoogleUserResponse:
        assert code == "valid-code"
        assert state == "네이버.state"
        return GoogleUserResponse(
            provider="naver",
            subject="naver-subject",
            email="user@example.com",
            email_verified=None,
            name="Naver User",
            picture="https://example.com/profile.png",
        )

    monkeypatch.setattr(auth, "verify_naver_authorization_code", verify)

    response = client.post(
        "/api/v1/auth/naver",
        json={"code": "valid-code", "state": "네이버.state"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "naver",
        "subject": "naver-subject",
        "email": "user@example.com",
        "email_verified": None,
        "name": "Naver User",
        "picture": "https://example.com/profile.png",
    }
    assert "valid-code" not in response.text


def test_naver_login_reports_missing_server_configuration(
    client: TestClient,
    monkeypatch,
) -> None:
    def reject(*args) -> GoogleUserResponse:
        raise NaverAuthConfigurationError

    monkeypatch.setattr(auth, "verify_naver_authorization_code", reject)

    response = client.post(
        "/api/v1/auth/naver",
        json={"code": "valid-code", "state": "네이버.state"},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Naver authentication is not configured.",
    }


@pytest.mark.parametrize(
    ("exception", "status_code", "detail"),
    [
        (
            NaverTokenExchangeError,
            502,
            "Naver token exchange failed.",
        ),
        (
            NaverProfileError,
            502,
            "Naver profile request failed.",
        ),
        (
            InvalidNaverProfileError,
            401,
            "Invalid Naver profile.",
        ),
    ],
)
def test_naver_login_maps_backend_failures(
    client: TestClient,
    monkeypatch,
    exception,
    status_code: int,
    detail: str,
) -> None:
    def reject(*args) -> GoogleUserResponse:
        raise exception

    monkeypatch.setattr(auth, "verify_naver_authorization_code", reject)

    response = client.post(
        "/api/v1/auth/naver",
        json={"code": "valid-code", "state": "네이버.state"},
    )

    assert response.status_code == status_code
    assert response.json() == {"detail": detail}


def test_naver_login_rejects_missing_or_empty_code(client: TestClient) -> None:
    missing_response = client.post("/api/v1/auth/naver", json={"state": "s"})
    empty_response = client.post(
        "/api/v1/auth/naver",
        json={"code": "", "state": "s"},
    )

    assert missing_response.status_code == 422
    assert empty_response.status_code == 422


def test_naver_profile_normalizer_returns_sanitized_profile() -> None:
    profile = naver_auth.normalize_naver_profile(
        {
            "resultcode": "00",
            "response": {
                "id": "naver-subject",
                "email": "user@example.com",
                "nickname": "Naver User",
                "profile_image": "https://example.com/profile.png",
            },
        },
    )

    assert profile.provider == "naver"
    assert profile.subject == "naver-subject"
    assert profile.email == "user@example.com"
    assert profile.email_verified is None
    assert profile.name == "Naver User"
    assert profile.picture == "https://example.com/profile.png"


@pytest.mark.parametrize(
    "payload",
    [
        {"resultcode": "00", "response": {"email": "user@example.com"}},
        {"resultcode": "00", "response": {"id": "naver-subject"}},
        {"resultcode": "00"},
    ],
)
def test_naver_profile_normalizer_rejects_untrusted_profile(payload) -> None:
    with pytest.raises(InvalidNaverProfileError):
        naver_auth.normalize_naver_profile(payload)


class FakeResponse:
    def __init__(self, *, ok: bool, payload: dict | None = None) -> None:
        self.ok = ok
        self.payload = payload or {}

    def json(self) -> dict:
        return self.payload


def test_naver_verifier_exchanges_code_and_fetches_profile(monkeypatch) -> None:
    def post(url, data, timeout):
        assert url == naver_auth.NAVER_TOKEN_URL
        assert data["code"] == "valid-code"
        assert data["client_secret"] == "client-secret"
        return FakeResponse(
            ok=True,
            payload={"access_token": "access-token", "token_type": "bearer"},
        )

    def get(url, headers, timeout):
        assert url == naver_auth.NAVER_PROFILE_URL
        assert headers == {"Authorization": "Bearer access-token"}
        return FakeResponse(
            ok=True,
            payload={
                "resultcode": "00",
                "response": {
                    "id": "naver-subject",
                    "email": "user@example.com",
                },
            },
        )

    monkeypatch.setattr(naver_auth.requests, "post", post)
    monkeypatch.setattr(naver_auth.requests, "get", get)

    profile = naver_auth.verify_naver_authorization_code(
        "valid-code",
        "네이버.state",
        "client-id",
        "client-secret",
        "http://localhost:5175/로그인/콜백",
    )

    assert profile.subject == "naver-subject"
    assert profile.email == "user@example.com"


def test_naver_verifier_rejects_token_endpoint_failure(monkeypatch) -> None:
    def post(url, data, timeout):
        return FakeResponse(ok=False)

    monkeypatch.setattr(naver_auth.requests, "post", post)

    with pytest.raises(naver_auth.InvalidNaverAuthorizationCodeError):
        naver_auth.exchange_code_for_access_token(
            "bad-code",
            "state",
            "client-id",
            "client-secret",
            "http://localhost:5175/로그인/콜백",
        )


def test_naver_verifier_rejects_profile_endpoint_failure(monkeypatch) -> None:
    def get(url, headers, timeout):
        return FakeResponse(ok=False)

    monkeypatch.setattr(naver_auth.requests, "get", get)

    with pytest.raises(NaverProfileError):
        naver_auth.fetch_naver_profile("access-token")
