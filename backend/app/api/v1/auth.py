from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.schemas.auth import GoogleLoginRequest, GoogleUserResponse
from app.services.google_auth import (
    GoogleAuthConfigurationError,
    InvalidGoogleCredentialError,
    verify_google_credential,
)

router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
)


@router.post("/google", response_model=GoogleUserResponse)
def login_with_google(request: GoogleLoginRequest) -> GoogleUserResponse:
    try:
        return verify_google_credential(
            request.credential,
            settings.google_client_id,
        )
    except GoogleAuthConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is not configured.",
        ) from error
    except InvalidGoogleCredentialError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google credential.",
        ) from error
