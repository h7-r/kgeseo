from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.schemas.auth import GoogleUserResponse
from app.services.local_auth import normalize_email, normalize_nickname, utc_now
from app.services.nickname_policy import InvalidNicknameError, validate_nickname

NICKNAME_SUFFIX_LENGTH = 4
MAX_NICKNAME_ATTEMPTS = 20


class AccountLinkRequiredError(Exception):
    pass


class SocialAuthConflictError(Exception):
    pass


class SocialAuthInvalidProfileError(Exception):
    pass


async def authenticate_social_user(
    db: AsyncSession,
    profile: GoogleUserResponse,
    *,
    _nickname_attempt: int = 0,
) -> GoogleUserResponse:
    provider = normalize_provider(profile.provider)
    provider_subject = normalize_provider_subject(profile.subject)
    email = normalize_email(profile.email)
    if not provider_subject or not email:
        raise SocialAuthInvalidProfileError

    identity = await get_identity_by_provider_subject(
        db,
        provider=provider,
        provider_subject=provider_subject,
    )
    if identity is not None:
        user = await db.get(AppUser, identity.app_user_id)
        if user is None:
            raise SocialAuthConflictError
        return profile

    existing_user = await get_user_by_email(db, email)
    if existing_user is not None:
        raise AccountLinkRequiredError

    now = utc_now()
    user = AppUser(
        id=str(uuid4()),
        email=email,
        nickname=await make_unique_nickname(db, profile.name, email),
        region=None,
        terms_version=None,
        terms_accepted_at=None,
        privacy_accepted_at=None,
        age_confirmed_at=None,
        created_at=now,
        updated_at=now,
    )
    identity = AuthIdentity(
        id=str(uuid4()),
        app_user_id=user.id,
        provider=provider,
        provider_subject=provider_subject,
        password_hash=None,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.add(identity)
    attempted_nickname = user.nickname

    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        recovered_identity = await get_identity_by_provider_subject(
            db,
            provider=provider,
            provider_subject=provider_subject,
        )
        if recovered_identity is not None:
            recovered_user = await db.get(AppUser, recovered_identity.app_user_id)
            if recovered_user is None:
                raise SocialAuthConflictError from error
            return profile
        if await get_user_by_email(db, email) is not None:
            raise AccountLinkRequiredError from error
        if await nickname_exists(db, attempted_nickname):
            if _nickname_attempt >= MAX_NICKNAME_ATTEMPTS - 1:
                raise SocialAuthConflictError from error
            return await authenticate_social_user(
                db,
                profile,
                _nickname_attempt=_nickname_attempt + 1,
            )
        raise

    await db.refresh(user)
    return profile


def normalize_provider(provider: str) -> str:
    normalized = str(provider or "").strip().lower()
    if normalized not in {"google", "naver"}:
        raise SocialAuthInvalidProfileError
    return normalized


def normalize_provider_subject(subject: str) -> str:
    return str(subject or "").strip()


async def get_identity_by_provider_subject(
    db: AsyncSession,
    *,
    provider: str,
    provider_subject: str,
) -> AuthIdentity | None:
    statement = select(AuthIdentity).where(
        AuthIdentity.provider == provider,
        AuthIdentity.provider_subject == provider_subject,
    )
    return await db.scalar(statement)


async def get_user_by_email(db: AsyncSession, email: str) -> AppUser | None:
    statement = select(AppUser).where(AppUser.email == normalize_email(email))
    return await db.scalar(statement)


async def nickname_exists(db: AsyncSession, nickname: str) -> bool:
    statement = select(AppUser).where(AppUser.nickname == normalize_nickname(nickname))
    return await db.scalar(statement) is not None


async def make_unique_nickname(
    db: AsyncSession,
    display_name: str | None,
    email: str,
) -> str:
    try:
        base = validate_nickname(display_name or "")
    except InvalidNicknameError:
        base = "user"
        use_fallback = True
    else:
        use_fallback = False
    if not use_fallback and not await nickname_exists(db, base):
        return base

    suffix_space = NICKNAME_SUFFIX_LENGTH + 1
    truncated_base = base[: 12 - suffix_space] or "user"
    for _ in range(MAX_NICKNAME_ATTEMPTS):
        candidate = f"{truncated_base}_{uuid4().hex[:NICKNAME_SUFFIX_LENGTH].upper()}"
        try:
            candidate = validate_nickname(candidate)
        except InvalidNicknameError:
            candidate = validate_nickname(f"user_{uuid4().hex[:4].upper()}")
        if not await nickname_exists(db, candidate):
            return candidate

    raise SocialAuthConflictError
