import logging

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Request,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

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
    PasswordResetAccepted,
    PasswordResetCompleteRequest,
    PasswordResetRequest,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
    SocialOnboardingCompleteRequest,
    SocialOnboardingRequiredResponse,
    SocialUserResponse,
)
from app.services import local_auth, password_reset
from app.services.google_auth import (
    GoogleAuthConfigurationError,
    InvalidGoogleCredentialError,
    verify_google_credential,
)
from app.services.guest_session import transfer_guest_to_user
from app.services.mailer import (
    MailSendError,
    MailUnavailableError,
    mail_available,
    send_mail,
)
from app.services.naver_auth import (
    InvalidNaverAuthorizationCodeError,
    InvalidNaverProfileError,
    NaverAuthConfigurationError,
    NaverEmailRequiredError,
    NaverProfileError,
    NaverTokenExchangeError,
    verify_naver_authorization_code,
)
from app.services.nickname_policy import InvalidNicknameError, validate_nickname
from app.services.registration_input_policy import (
    InvalidEmailError,
    InvalidPasswordError,
    InvalidRegionError,
    validate_registration_email,
)
from app.services.request_rate_limit import (
    EMAIL_EXISTS,
    LOGIN,
    NICKNAME_EXISTS,
    PASSWORD_RESET_COMPLETE,
    PASSWORD_RESET_REQUEST,
    PASSWORD_RESET_VERIFY,
    REGISTER,
    SOCIAL_GOOGLE,
    SOCIAL_NAVER,
    SOCIAL_ONBOARDING_COMPLETE,
    limit_by_ip,
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
    PasswordChangedDuringLoginError,
    WithdrawnAccountError,
    clear_login_failures,
    login_lock_remaining_seconds,
    record_login_failure,
    require_same_origin,
    start_session,
    wait_phrase,
)


def _social_login_refused() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Social account login could not be completed.",
        headers={"Cache-Control": "no-store"},
    )


async def _establish_login(
    db: AsyncSession,
    http_request: Request,
    response: Response,
    user_id: str,
    refused: HTTPException | None = None,
    verified_password_hash: str | None = None,
) -> None:
    """로그인 성공 공통 처리(11/6 PM): 로그인 세션 쿠키를 주고, 유효한 게스트 쿠키가 있으면 그 진행을 계정으로 옮긴다.

    승계가 실패해도 로그인은 성공으로 두고 게스트 진행은 지우지 않는다(transfer_guest_to_user).
    인증을 마친 바로 그 사이에 계정이 탈퇴했으면(11/17) 세션을 주지 않고 `refused` 로 답한다 — 그 경로가 이미 쓰는 오류라 탈퇴 여부를
    따로 드러내지 않는다(이메일 로그인 = 401 `Invalid email or password.`, 그 밖 = 409 문장).
    """
    try:
        await start_session(
            db, response, user_id, verified_password_hash=verified_password_hash
        )
    except (WithdrawnAccountError, PasswordChangedDuringLoginError) as error:
        raise (refused or _social_login_refused()) from error
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
    # IP 당 요청 빈도(11/18). 가입과 같은 자리 — Origin 검사 다음, 본문 검증보다 먼저
    dependencies=[Depends(limit_by_ip(SOCIAL_GOOGLE))],
)
async def login_with_google(
    request: GoogleLoginRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> SocialUserResponse | SocialOnboardingRequiredResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        # 구글 인증서 조회는 동기 HTTP 라 스레드 풀에서 돌린다 — 이벤트 루프가 다른 요청을 계속 받는다(11/18)
        profile = await run_in_threadpool(
            verify_google_credential,
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
    dependencies=[Depends(limit_by_ip(SOCIAL_NAVER))],
)
async def login_with_naver(
    request: NaverLoginRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> SocialUserResponse | SocialOnboardingRequiredResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        # 네이버 토큰 교환 · 프로필 조회(동기 requests, 최대 10초)를 스레드 풀로 — 이벤트 루프를 막지 않는다(11/18)
        profile = await run_in_threadpool(
            verify_naver_authorization_code,
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
    except NaverEmailRequiredError as error:
        # 프로필은 정상인데 이메일만 없다 — 화면이 「네이버에서 이메일 제공에 동의」로 안내할 수 있게 code 로 가른다(11/18)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "email_required",
                "message": "네이버 계정에서 이메일을 받지 못했습니다. 이메일 제공에 동의한 뒤 다시 시도해 주세요.",
            },
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
    # IP 당 요청 빈도(PR B). 라우터의 Origin 검사 다음, 본문 검증 · DB 보다 먼저 센다.
    dependencies=[Depends(limit_by_ip(REGISTER))],
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
    except InvalidRegionError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_region",
                "message": "목록에 있는 지역을 골라 주세요.",
            },
            headers={"Cache-Control": "no-store"},
        ) from error
    # 중복은 code 로 가른다(11/18). message 는 옛 화면이 비교하던 문장 그대로 둔다.
    except local_auth.EmailAlreadyRegisteredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "email_taken", "message": "Email already registered."},
            headers={"Cache-Control": "no-store"},
        ) from error
    except local_auth.NicknameAlreadyRegisteredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "nickname_taken",
                "message": "Nickname already registered.",
            },
            headers={"Cache-Control": "no-store"},
        ) from error
    except local_auth.TermsVersionMismatchError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "terms_version_mismatch",
                "message": "약관이 바뀌었습니다. 새 약관을 확인하고 다시 동의해 주세요.",
            },
            headers={"Cache-Control": "no-store"},
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
    "/login",
    response_model=LocalAuthResponse,
    responses=error_responses.LOGIN,
    # IP 당 요청 빈도(11/18). 이메일 · IP 실패 잠금과 별개로, 잠금 확인 · DB 조회보다 먼저 센다
    dependencies=[Depends(limit_by_ip(LOGIN))],
)
async def login_local_account(
    request: LocalLoginRequest,
    http_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LocalAuthResponse:
    response.headers["Cache-Control"] = "no-store"
    retry_after = await login_lock_remaining_seconds(db, http_request, request.email)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "login_locked",
                # 남은 시간은 Retry-After 와 같은 숫자로 말한다 — 고정 「15분」은 잠금 중반부터 틀렸다(11/18)
                "message": f"로그인 실패가 많아 잠시 막혔습니다. {wait_phrase(retry_after)} 다시 시도해 주세요.",
            },
            # 잠금이 풀릴 때까지 남은 초(DB 잠금 기록 기준). CORS expose_headers 로 웹사이트가 읽는다.
            headers={"Cache-Control": "no-store", "Retry-After": str(retry_after)},
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

    # 방금 확인한 해시 — 실패 기록 정리(커밋)보다 먼저, 같은 스냅숏에서 읽는다. 세션을 만들기 전에 비밀번호가 바뀌었으면
    # (찾기 완료 · 변경과 겹친 로그인) start_session 이 거절한다(11/25)
    verified_password_hash = await local_auth.local_password_hash(db, user.id)
    await clear_login_failures(db, http_request, request.email)
    await _establish_login(
        db,
        http_request,
        response,
        user.id,
        refused=HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"Cache-Control": "no-store"},
        ),
        verified_password_hash=verified_password_hash,
    )
    return LocalAuthResponse(user=local_auth.user_to_payload(user))


@router.post(
    "/email-exists",
    response_model=LocalExistsResponse,
    responses=error_responses.EMAIL_EXISTS,
    dependencies=[Depends(limit_by_ip(EMAIL_EXISTS))],
)
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
    dependencies=[Depends(limit_by_ip(NICKNAME_EXISTS))],
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
    dependencies=[Depends(limit_by_ip(SOCIAL_ONBOARDING_COMPLETE))],
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


# --- 비밀번호 찾기(계약 password_reset_v0.1, 11/25) ---

logger = logging.getLogger("app.auth")


async def _issue_reset_code(app: FastAPI, email: str) -> None:
    """응답을 보낸 뒤에 코드를 만들고 메일을 보낸다(백그라운드 작업).

    가입된 이메일만 DB 쓰기 · 메일이 있으므로, 이 일을 응답 안에서 하면 걸린 시간으로 가입 여부가 갈린다(11/25 검토).
    요청의 DB 세션은 응답과 함께 닫히므로 새 세션을 연다 — 테스트가 `get_db` 를 바꿔 끼웠으면 그것을 따른다.
    """
    sessions = app.dependency_overrides.get(get_db, get_db)()
    try:
        db = await anext(sessions)
        mail = await password_reset.request_password_reset(db, email)
    except Exception as error:  # noqa: BLE001 — 응답은 이미 나갔다. 원인 종류만 남긴다(이메일은 남기지 않는다)
        logger.error("password reset code was not issued: %s", type(error).__name__)
        return
    finally:
        await sessions.aclose()
    if mail is None:
        return
    try:
        await send_mail(mail)
    except (MailSendError, MailUnavailableError):
        logger.error("password reset mail was not sent")


def _no_store_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/password-reset/request",
    response_model=PasswordResetAccepted,
    responses=error_responses.PASSWORD_RESET_REQUEST,
    dependencies=[Depends(limit_by_ip(PASSWORD_RESET_REQUEST))],
)
async def request_password_reset(
    request: PasswordResetRequest,
    http_request: Request,
    background: BackgroundTasks,
    response: Response,
) -> PasswordResetAccepted:
    """① 가입된 이메일이면 6자리 코드를 메일로 보낸다(15분). 없는 이메일 · 소셜 전용 · 탈퇴 계정도 같은 답이다.

    같은 회원에게는 60초에 한 번 · 한 시간 5번 · 하루 10번까지만 보낸다(넘어도 같은 답, 메일만 안 간다).
    새 코드를 보내면 앞의 코드는 못 쓴다. 계정 조회 · 코드 저장 · 메일은 모두 응답 뒤에 한다(같은 시간에 답하게).
    """
    response.headers["Cache-Control"] = "no-store"
    # 시험 발송 기간(MAIL_TEST_RECIPIENTS)이면 목록 밖 이메일도 여기서 503 — 계정을 찾기 전이라 가입 여부와 상관없다
    if not mail_available(request.email):
        raise _no_store_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "mail_unavailable",
            "지금은 메일을 보낼 수 없습니다. 고객센터로 문의해 주세요.",
        )
    try:
        validate_registration_email(request.email)
    except InvalidEmailError as error:
        raise _no_store_error(
            422, "invalid_email", "올바른 이메일 형식이 아닙니다."
        ) from error
    background.add_task(_issue_reset_code, http_request.app, request.email)
    return PasswordResetAccepted()


@router.post(
    "/password-reset/verify",
    response_model=PasswordResetVerifyResponse,
    responses=error_responses.PASSWORD_RESET_VERIFY,
    dependencies=[Depends(limit_by_ip(PASSWORD_RESET_VERIFY))],
)
async def verify_password_reset_code(
    request: PasswordResetVerifyRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> PasswordResetVerifyResponse:
    """② 코드가 맞으면 새 비밀번호를 저장할 증표(10분, 한 번)를 준다. 틀린 코드 · 만료 · 시도 초과 · 없는 계정은 같은 401 이다."""
    response.headers["Cache-Control"] = "no-store"
    try:
        token = await password_reset.verify_reset_code(db, request.email, request.code)
    except password_reset.InvalidResetCodeError as error:
        raise _no_store_error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_reset_code",
            "코드가 맞지 않거나 만료되었습니다. 새 코드를 받아 다시 시도해 주세요.",
        ) from error
    return PasswordResetVerifyResponse(reset_token=token)


@router.post(
    "/password-reset/complete",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses.PASSWORD_RESET_COMPLETE,
    dependencies=[Depends(limit_by_ip(PASSWORD_RESET_COMPLETE))],
)
async def complete_password_reset(
    request: PasswordResetCompleteRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> None:
    """③ 증표로 새 비밀번호를 저장한다. 그 회원의 모든 기기에서 로그아웃되고, 로그인 실패 잠금이 풀린다. 로그인은 따로 한다."""
    response.headers["Cache-Control"] = "no-store"
    try:
        await password_reset.complete_password_reset(
            db, request.reset_token, request.new_password
        )
    except password_reset.InvalidResetTokenError as error:
        raise _no_store_error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_reset_token",
            "재설정 시간이 지났습니다. 코드를 다시 받아 주세요.",
        ) from error
    except InvalidPasswordError as error:
        raise _no_store_error(
            422, "invalid_password", "비밀번호 형식을 확인해 주세요."
        ) from error
