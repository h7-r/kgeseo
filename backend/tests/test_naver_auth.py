import pytest
from fastapi.testclient import TestClient

from app.api.v1 import auth
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.schemas.auth import GoogleUserResponse
from app.services import naver_auth
from app.services.naver_auth import (
    InvalidNaverProfileError,
    NaverAuthConfigurationError,
    NaverProfileError,
    NaverTokenExchangeError,
)


def make_user(
    *,
    user_id: str = "11111111-1111-4111-8111-111111111111",
    email: str = "user@example.com",
    nickname: str = "Naver User",
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
    user: AppUser | None = None,
    subject: str = "naver-subject",
) -> AuthIdentity:
    from datetime import datetime

    now = datetime(2026, 10, 6, 12, 0, 0)
    app_user = user or make_user()
    return AuthIdentity(
        id="22222222-2222-4222-8222-222222222222",
        app_user_id=app_user.id,
        provider="naver",
        provider_subject=subject,
        password_hash=None,
        created_at=now,
        updated_at=now,
    )


def test_naver_login_returns_verified_profile(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    user = make_user()
    db_session.scalar_result = make_identity(user=user)
    db_session.get_result = user

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
    assert "app_user_id" not in response.text
    assert "password_hash" not in response.text


def test_naver_login_creates_user_and_identity_for_new_email(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    db_session.scalar_result = [None, None, None]

    def verify(*args) -> GoogleUserResponse:
        return GoogleUserResponse(
            provider="naver",
            subject="naver-subject",
            email="User@Example.COM",
            email_verified=None,
            name="Naver User",
            picture="https://example.com/profile.png",
        )

    monkeypatch.setattr(auth, "verify_naver_authorization_code", verify)

    response = client.post(
        "/api/v1/auth/naver",
        json={"code": "valid-code", "state": "?ㅼ씠踰?state"},
    )

    assert response.status_code == 200
    assert "app_user_id" not in response.json()
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
    assert identity.provider == "naver"
    assert identity.provider_subject == "naver-subject"
    assert identity.password_hash is None
    assert "password_hash" not in response.text
    assert "access-token" not in response.text


def test_naver_login_requires_account_link_for_existing_email(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    db_session.scalar_result = [None, make_user()]

    def verify(*args) -> GoogleUserResponse:
        return GoogleUserResponse(
            provider="naver",
            subject="naver-subject",
            email="user@example.com",
            email_verified=None,
            name="Naver User",
            picture=None,
        )

    monkeypatch.setattr(auth, "verify_naver_authorization_code", verify)

    response = client.post(
        "/api/v1/auth/naver",
        json={"code": "valid-code", "state": "?ㅼ씠踰?state"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_link_required"
    assert db_session.added == []


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
