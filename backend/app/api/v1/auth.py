from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.schemas.auth import (
    GoogleLoginRequest,
    GoogleUserResponse,
    LocalAuthResponse,
    LocalExistsResponse,
    LocalLoginRequest,
    LocalRegisterRequest,
    NaverLoginRequest,
)
from app.services import local_auth
from app.services.google_auth import (
    GoogleAuthConfigurationError,
    InvalidGoogleCredentialError,
    verify_google_credential,
)
from app.services.naver_auth import (
    InvalidNaverAuthorizationCodeError,
    InvalidNaverProfileError,
    NaverAuthConfigurationError,
    NaverProfileError,
    NaverTokenExchangeError,
    verify_naver_authorization_code,
)
from app.services.social_auth import (
    AccountLinkRequiredError,
    SocialAuthConflictError,
    authenticate_social_user,
)

router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
)


@router.post("/google", response_model=GoogleUserResponse)
async def login_with_google(
    request: GoogleLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> GoogleUserResponse:
    try:
        profile = verify_google_credential(
            request.credential,
            settings.google_client_id,
        )
        return await authenticate_social_user(db, profile)
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
    except AccountLinkRequiredError as error:
        raise account_link_required_exception() from error
    except SocialAuthConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Social account login could not be completed.",
        ) from error


@router.post("/naver", response_model=GoogleUserResponse)
async def login_with_naver(
    request: NaverLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> GoogleUserResponse:
    try:
        profile = verify_naver_authorization_code(
            request.code,
            request.state,
            settings.naver_client_id,
            settings.naver_client_secret,
            settings.naver_redirect_uri,
        )
        return await authenticate_social_user(db, profile)
    except NaverAuthConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Naver authentication is not configured.",
        ) from error
    except InvalidNaverAuthorizationCodeError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Naver authorization code.",
        ) from error
    except NaverTokenExchangeError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Naver token exchange failed.",
        ) from error
    except NaverProfileError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Naver profile request failed.",
        ) from error
    except InvalidNaverProfileError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Naver profile.",
        ) from error
    except AccountLinkRequiredError as error:
        raise account_link_required_exception() from error
    except SocialAuthConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Social account login could not be completed.",
        ) from error


@router.post(
    "/register",
    response_model=LocalAuthResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_local_account(
    request: LocalRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> LocalAuthResponse:
    try:
        user = await local_auth.register_user(db, request)
    except local_auth.EmailAlreadyRegisteredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered.",
        ) from error
    except local_auth.NicknameAlreadyRegisteredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nickname already registered.",
        ) from error
    except local_auth.ConsentRequiredError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Required consent is missing.",
        ) from error
    except local_auth.InvalidLocalAuthInputError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid local account input.",
        ) from error

    return LocalAuthResponse(user=local_auth.user_to_payload(user))


@router.post("/login", response_model=LocalAuthResponse)
async def login_local_account(
    request: LocalLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> LocalAuthResponse:
    try:
        user = await local_auth.login_user(db, request.email, request.password)
    except local_auth.InvalidLocalCredentialsError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        ) from error

    return LocalAuthResponse(user=local_auth.user_to_payload(user))


@router.get("/email-exists", response_model=LocalExistsResponse)
async def check_email_exists(
    email: str = Query(min_length=1, max_length=254),
    db: AsyncSession = Depends(get_db),
) -> LocalExistsResponse:
    return LocalExistsResponse(exists=await local_auth.email_exists(db, email))


@router.get("/nickname-exists", response_model=LocalExistsResponse)
async def check_nickname_exists(
    nickname: str = Query(min_length=1, max_length=32),
    db: AsyncSession = Depends(get_db),
) -> LocalExistsResponse:
    return LocalExistsResponse(
        exists=await local_auth.nickname_exists(db, nickname),
    )


def account_link_required_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "account_link_required",
            "message": (
                "An account with this email already exists. "
                "Sign in with the existing account before linking this provider."
            ),
        },
    )
