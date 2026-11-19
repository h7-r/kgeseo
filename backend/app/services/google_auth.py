from typing import Any

from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token

from app.schemas.auth import GoogleUserResponse


class GoogleAuthConfigurationError(Exception):
    pass


class InvalidGoogleCredentialError(Exception):
    pass


def google_auth_configured(google_client_id: str) -> bool:
    """클라이언트 ID 가 실제 값인지 — 빈 값 · 견본 자리표시자는 미설정으로 본다(/site/status 와 같은 판정)."""
    return bool(google_client_id) and google_client_id != "YOUR_GOOGLE_CLIENT_ID"


def verify_google_credential(
    credential: str,
    google_client_id: str,
) -> GoogleUserResponse:
    if not google_auth_configured(google_client_id):
        raise GoogleAuthConfigurationError

    try:
        claims: dict[str, Any] = id_token.verify_oauth2_token(
            credential.strip(),
            Request(),
            audience=google_client_id,
        )
    except (GoogleAuthError, ValueError) as error:
        raise InvalidGoogleCredentialError from error

    subject = claims.get("sub")
    email = claims.get("email")
    email_verified = claims.get("email_verified") is True
    if not subject or not str(email or "").strip() or not email_verified:
        raise InvalidGoogleCredentialError

    return GoogleUserResponse(
        provider="google",
        subject=subject,
        email=email,
        email_verified=True,
        name=claims.get("name"),
        picture=claims.get("picture"),
    )
