import hashlib
import re
import secrets
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.terms import CURRENT_TERMS_VERSION
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.schemas.auth import (
    SocialOnboardingCompleteRequest,
    SocialOnboardingRequiredResponse,
    SocialUserResponse,
)
from app.services.local_auth import get_user_by_email, nickname_exists, utc_now
from app.services.nickname_policy import validate_nickname

ONBOARDING_TTL_SECONDS = 600
PENDING_RETENTION = timedelta(days=1)


class OnboardingError(Exception):
    def __init__(self, code: str, status_code: int):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


class AccountLinkRequiredError(Exception):
    pass


class SocialAuthConflictError(Exception):
    pass


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_response(user: AppUser, provider: str) -> SocialUserResponse:
    return SocialUserResponse(
        provider=provider, email=user.email, nickname=user.nickname
    )


async def get_identity(
    db: AsyncSession, provider: str, subject: str
) -> AuthIdentity | None:
    return await db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.provider_subject == subject,
        )
    )


async def identity_response(
    db: AsyncSession, identity: AuthIdentity
) -> SocialUserResponse:
    user = await db.get(AppUser, identity.app_user_id)
    if user is None:
        raise SocialAuthConflictError
    return user_response(user, identity.provider)


async def issue_pending(
    db: AsyncSession,
    provider: str,
    subject: str,
    email: str,
    suggested_nickname: str,
) -> SocialOnboardingRequiredResponse:
    now = utc_now()
    cutoff = now - PENDING_RETENTION
    # Keep recent consumed rows so token reuse gets a stable error.
    await db.execute(
        delete(SocialOnboardingPending).where(
            or_(
                SocialOnboardingPending.expires_at < cutoff,
                SocialOnboardingPending.consumed_at < cutoff,
            )
        )
    )
    token = secrets.token_urlsafe(32)
    db.add(
        SocialOnboardingPending(
            id=str(uuid4()),
            token_hash=token_digest(token),
            provider=provider,
            provider_subject=subject,
            email=email,
            created_at=now,
            expires_at=now + timedelta(seconds=ONBOARDING_TTL_SECONDS),
            consumed_at=None,
        )
    )
    await db.commit()
    return SocialOnboardingRequiredResponse(
        onboarding_token=token,
        suggested_nickname=suggested_nickname,
        expires_in=ONBOARDING_TTL_SECONDS,
        terms_version=CURRENT_TERMS_VERSION,
    )


async def locked_pending(db: AsyncSession, token: str) -> SocialOnboardingPending:
    if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None:
        raise OnboardingError("invalid_onboarding_token", 401)
    pending = await db.scalar(
        select(SocialOnboardingPending)
        .where(
            SocialOnboardingPending.token_hash == token_digest(token),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if pending is None or pending.expires_at <= utc_now():
        raise OnboardingError("invalid_onboarding_token", 401)
    if pending.consumed_at is not None:
        raise OnboardingError("onboarding_token_used", 409)
    return pending


async def consume_existing(
    db: AsyncSession,
    pending: SocialOnboardingPending,
    identity: AuthIdentity,
) -> SocialUserResponse:
    response = await identity_response(db, identity)
    pending.consumed_at = utc_now()
    await db.commit()
    return response


async def complete_onboarding(
    db: AsyncSession,
    request: SocialOnboardingCompleteRequest,
) -> SocialUserResponse:
    try:
        pending = await locked_pending(db, request.onboarding_token)
        if request.terms_version != CURRENT_TERMS_VERSION:
            raise OnboardingError("terms_version_mismatch", 409)
        if not (
            request.consent.terms and request.consent.privacy and request.consent.age
        ):
            raise OnboardingError("consent_required", 422)
        nickname = validate_nickname(request.nickname)
        duplicate_nickname = await nickname_exists(db, nickname)
        identity = await get_identity(db, pending.provider, pending.provider_subject)
        if identity is not None:
            return await consume_existing(db, pending, identity)
        if await get_user_by_email(db, pending.email) is not None:
            raise AccountLinkRequiredError
        if duplicate_nickname:
            raise OnboardingError("nickname_unavailable", 409)
        now = utc_now()
        user = AppUser(
            id=str(uuid4()),
            email=pending.email,
            nickname=nickname,
            region=None,
            terms_version=CURRENT_TERMS_VERSION,
            terms_accepted_at=now,
            privacy_accepted_at=now,
            age_confirmed_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        db.add(
            AuthIdentity(
                id=str(uuid4()),
                app_user_id=user.id,
                provider=pending.provider,
                provider_subject=pending.provider_subject,
                password_hash=None,
                created_at=now,
                updated_at=now,
            )
        )
        response = user_response(user, pending.provider)
        pending.consumed_at = now
        try:
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            # A new transaction sees the winner, and re-locks the proof before consuming it.
            pending = await locked_pending(db, request.onboarding_token)
            identity = await get_identity(
                db, pending.provider, pending.provider_subject
            )
            if identity is not None:
                return await consume_existing(db, pending, identity)
            if await get_user_by_email(db, pending.email) is not None:
                raise AccountLinkRequiredError from error
            if await nickname_exists(db, nickname):
                raise OnboardingError("nickname_unavailable", 409) from error
            raise
        return response
    except Exception:
        await db.rollback()
        raise
