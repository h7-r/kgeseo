from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.core.config import settings
from app.db.session import get_db
from app.schemas.auth import (
    EmailExistsRequest,
    GoogleLoginRequest,
    LocalAuthResponse,
    LocalExistsResponse,
    LocalLoginRequest,
    LocalRegisterRequest,
    NaverLoginRequest,
    NicknameExistsRequest,
    SocialOnboardingCompleteRequest,
    SocialOnboardingRequiredResponse,
    SocialUserResponse,
)
from app.services import local_auth
from app.services.google_auth import (
    GoogleAuthConfigurationError,
    InvalidGoogleCredentialError,
    verify_google_credential,
)
from app.services.guest_session import transfer_guest_to_user
from app.services.naver_auth import (
    InvalidNaverAuthorizationCodeError,
    InvalidNaverProfileError,
    NaverAuthConfigurationError,
    NaverProfileError,
    NaverTokenExchangeError,
    verify_naver_authorization_code,
)
from app.services.nickname_policy import InvalidNicknameError, validate_nickname
from app.services.registration_input_policy import (
    InvalidEmailError,
    InvalidPasswordError,
)
from app.services.social_auth import (
    authenticate_social_user,
)
from app.services.social_onboarding import (
    AccountLinkRequiredError,
    OnboardingError,
    SocialAuthConflictError,
    complete_onboarding,
)
from app.services.user_session import (
    clear_login_failures,
    is_login_locked,
    record_login_failure,
    require_same_origin,
    start_session,
)


async def _establish_login(
    db: AsyncSession, http_request: Request, response: Response, user_id: str
) -> None:
    """로그인 성공 공통 처리(11/6 PM): 로그인 세션 쿠키를 주고, 유효한 게스트 쿠키가 있으면 그 진행을 계정으로 옮긴다.

    승계가 실패해도 로그인은 성공으로 두고 게스트 진행은 지우지 않는다(transfer_guest_to_user).
    """
    await start_session(db, response, user_id)
    await transfer_guest_to_user(db, http_request, response, user_id)


router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
    dependencies=[Depends(require_same_origin)],
    responses=error_responses.FOREIGN_ORIGIN,
)


@router.post(
    "/google",
    response_model=SocialUserResponse | SocialOnboardingRequiredResponse,
    responses=error_responses.GOOGLE_LOGIN,
)
async def login_with_google(
    request: GoogleLoginRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> SocialUserResponse | SocialOnboardingRequiredResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        profile = verify_google_credential(
            request.credential,
            settings.google_client_id,
        )
        result = await authenticate_social_user(db, profile)
        await _start_social_session(db, http_request, response, result)
        return result
    except GoogleAuthConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is not configured.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except InvalidGoogleCredentialError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google credential.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except AccountLinkRequiredError as error:
        raise account_link_required_exception() from error
    except SocialAuthConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Social account login could not be completed.",
            headers={"Cache-Control": "no-store"},
        ) from error


@router.post(
    "/naver",
    response_model=SocialUserResponse | SocialOnboardingRequiredResponse,
    responses=error_responses.NAVER_LOGIN,
)
async def login_with_naver(
    request: NaverLoginRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> SocialUserResponse | SocialOnboardingRequiredResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        profile = verify_naver_authorization_code(
            request.code,
            request.state,
            settings.naver_client_id,
            settings.naver_client_secret,
            settings.naver_redirect_uri,
        )
        result = await authenticate_social_user(db, profile)
        await _start_social_session(db, http_request, response, result)
        return result
    except NaverAuthConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Naver authentication is not configured.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except InvalidNaverAuthorizationCodeError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Naver authorization code.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except NaverTokenExchangeError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Naver token exchange failed.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except NaverProfileError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Naver profile request failed.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except InvalidNaverProfileError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Naver profile.",
            headers={"Cache-Control": "no-store"},
        ) from error
    except AccountLinkRequiredError as error:
        raise account_link_required_exception() from error
    except SocialAuthConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Social account login could not be completed.",
            headers={"Cache-Control": "no-store"},
        ) from error


@router.post(
    "/register",
    response_model=LocalAuthResponse,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses.REGISTER,
)
async def register_local_account(
    request: LocalRegisterRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LocalAuthResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        user = await local_auth.register_user(db, request)
    except InvalidEmailError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_email",
                "message": "올바른 이메일 형식이 아닙니다.",
            },
            headers={"Cache-Control": "no-store"},
        ) from error
    except InvalidPasswordError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_password",
                "message": "비밀번호 형식을 확인해 주세요.",
            },
            headers={"Cache-Control": "no-store"},
        ) from error
    except InvalidNicknameError as error:
        raise invalid_nickname_exception() from error
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

    await _establish_login(db, http_request, response, user.id)
    return LocalAuthResponse(user=local_auth.user_to_payload(user))


@router.post(
    "/login", response_model=LocalAuthResponse, responses=error_responses.LOGIN
)
async def login_local_account(
    request: LocalLoginRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LocalAuthResponse:
    response.headers["Cache-Control"] = "no-store"
    if await is_login_locked(db, http_request, request.email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "login_locked",
                "message": "로그인 실패가 많아 잠시 막혔습니다. 15분 뒤 다시 시도해 주세요.",
            },
            headers={"Cache-Control": "no-store"},
        )
    try:
        user = await local_auth.login_user(db, request.email, request.password)
    except local_auth.InvalidLocalCredentialsError as error:
        await record_login_failure(db, http_request, request.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"Cache-Control": "no-store"},
        ) from error

    await clear_login_failures(db, http_request, request.email)
    await _establish_login(db, http_request, response, user.id)
    return LocalAuthResponse(user=local_auth.user_to_payload(user))


@router.post("/email-exists", response_model=LocalExistsResponse)
async def check_email_exists(
    request: EmailExistsRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LocalExistsResponse:
    response.headers["Cache-Control"] = "no-store"
    return LocalExistsResponse(exists=await local_auth.email_exists(db, request.email))


@router.post(
    "/nickname-exists",
    response_model=LocalExistsResponse,
    responses=error_responses.NICKNAME_EXISTS,
)
async def check_nickname_exists(
    request: NicknameExistsRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LocalExistsResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        nickname = validate_nickname(request.nickname)
    except InvalidNicknameError as error:
        raise invalid_nickname_exception() from error
    return LocalExistsResponse(
        exists=await local_auth.nickname_exists(db, nickname),
    )


async def _start_social_session(
    db: AsyncSession,
    http_request: Request,
    response: Response,
    result: SocialUserResponse | SocialOnboardingRequiredResponse,
) -> None:
    # 가입을 마치기 전의 소셜 계정에는 세션을 주지 않는다.
    if isinstance(result, SocialUserResponse):
        await _establish_login(db, http_request, response, result.user.user_id)


def invalid_nickname_exception() -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={"code": "invalid_nickname", "message": "사용할 수 없는 닉네임입니다."},
        headers={"Cache-Control": "no-store"},
    )


def account_link_required_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        headers={"Cache-Control": "no-store"},
        detail={
            "code": "account_link_required",
            "message": (
                "An account with this email already exists. "
                "Sign in with the existing account before linking this provider."
            ),
        },
    )


@router.post(
    "/social-onboarding/complete",
    response_model=SocialUserResponse,
    status_code=201,
    responses=error_responses.SOCIAL_ONBOARDING,
)
async def complete_social_account(
    request: SocialOnboardingCompleteRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> SocialUserResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        result = await complete_onboarding(db, request)
        await _start_social_session(db, http_request, response, result)
        return result
    except AccountLinkRequiredError as error:
        raise account_link_required_exception() from error
    except InvalidNicknameError as error:
        raise invalid_nickname_exception() from error
    except OnboardingError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={
                "code": error.code,
                "message": "Social signup could not be completed.",
            },
            headers={"Cache-Control": "no-store"},
        ) from error
    except SocialAuthConflictError as error:
        raise HTTPException(
            status_code=409,
            detail="Social account login could not be completed.",
            headers={"Cache-Control": "no-store"},
        ) from error
