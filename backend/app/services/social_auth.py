from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.auth import (
    GoogleUserResponse,
    SocialOnboardingRequiredResponse,
    SocialUserResponse,
)
from app.services.local_auth import get_user_by_email, nickname_exists, normalize_email
from app.services.nickname_policy import InvalidNicknameError, validate_nickname
from app.services.social_onboarding import (
    AccountLinkRequiredError,
    get_identity,
    identity_response,
    issue_pending,
)


class SocialAuthInvalidProfileError(Exception):
    pass


async def authenticate_social_user(
    db: AsyncSession,
    profile: GoogleUserResponse,
) -> SocialUserResponse | SocialOnboardingRequiredResponse:
    provider = str(profile.provider).strip().lower()
    subject = str(profile.subject).strip()
    email = normalize_email(profile.email)
    if provider not in {"google", "naver"} or not subject or not email:
        raise SocialAuthInvalidProfileError
    identity = await get_identity(db, provider, subject)
    if identity is not None:
        response = await identity_response(db, identity)
        response.picture = profile.picture
        return response
    if await get_user_by_email(db, email) is not None:
        raise AccountLinkRequiredError
    try:
        suggestion = validate_nickname(profile.name or "")
    except InvalidNicknameError:
        suggestion = ""
    if suggestion and await nickname_exists(db, suggestion):
        suggestion = ""
    return await issue_pending(db, provider, subject, email, suggestion)
