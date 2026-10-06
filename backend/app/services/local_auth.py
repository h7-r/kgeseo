import os
import unicodedata
from datetime import datetime, timezone
from uuid import uuid4

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_user import AppUser
from app.schemas.auth import LocalRegisterRequest

PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 210_000
PASSWORD_HASH_LENGTH = 32
PASSWORD_SALT_LENGTH = 16


class EmailAlreadyRegisteredError(Exception):
    pass


class NicknameAlreadyRegisteredError(Exception):
    pass


class ConsentRequiredError(Exception):
    pass


class InvalidLocalAuthInputError(Exception):
    pass


class InvalidLocalCredentialsError(Exception):
    pass


def normalize_email(email: str) -> str:
    return unicodedata.normalize("NFC", str(email or "")).strip().lower()


def normalize_nickname(nickname: str) -> str:
    return unicodedata.normalize("NFC", str(nickname or "")).strip()


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_password(password: str) -> str:
    salt = os.urandom(PASSWORD_SALT_LENGTH)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=PASSWORD_HASH_LENGTH,
        salt=salt,
        iterations=PASSWORD_HASH_ITERATIONS,
    )
    digest = kdf.derive(password.encode("utf-8"))
    return (
        f"{PASSWORD_HASH_ALGORITHM}${PASSWORD_HASH_ITERATIONS}"
        f"${salt.hex()}${digest.hex()}"
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored_hash.split("$", 3)
        if algorithm != PASSWORD_HASH_ALGORITHM:
            return False
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=PASSWORD_HASH_LENGTH,
            salt=bytes.fromhex(salt_hex),
            iterations=int(iterations),
        )
        kdf.verify(password.encode("utf-8"), bytes.fromhex(digest_hex))
        return True
    except (InvalidKey, ValueError):
        return False


def user_to_payload(user: AppUser) -> dict[str, str | None]:
    return {
        "user_id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "region": user.region,
        "created_at": user.created_at.isoformat(),
        "provider": "local",
    }


async def get_user_by_email(db: AsyncSession, email: str) -> AppUser | None:
    statement = select(AppUser).where(AppUser.email == normalize_email(email))
    return await db.scalar(statement)


async def get_user_by_nickname(db: AsyncSession, nickname: str) -> AppUser | None:
    statement = select(AppUser).where(AppUser.nickname == normalize_nickname(nickname))
    return await db.scalar(statement)


async def email_exists(db: AsyncSession, email: str) -> bool:
    return await get_user_by_email(db, email) is not None


async def nickname_exists(db: AsyncSession, nickname: str) -> bool:
    return await get_user_by_nickname(db, nickname) is not None


async def register_user(db: AsyncSession, request: LocalRegisterRequest) -> AppUser:
    email = normalize_email(request.email)
    nickname = normalize_nickname(request.nickname)
    region = normalize_nickname(request.region or "") or None

    if not email or not nickname:
        raise InvalidLocalAuthInputError
    if not request.consent.terms or not request.consent.privacy or not request.consent.age:
        raise ConsentRequiredError
    if await email_exists(db, email):
        raise EmailAlreadyRegisteredError
    if await nickname_exists(db, nickname):
        raise NicknameAlreadyRegisteredError

    now = utc_now()
    user = AppUser(
        id=str(uuid4()),
        email=email,
        nickname=nickname,
        region=region,
        password_hash=hash_password(request.password),
        terms_version=request.consent.terms_version,
        terms_accepted_at=now,
        privacy_accepted_at=now,
        age_confirmed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user)

    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if await email_exists(db, email):
            raise EmailAlreadyRegisteredError from error
        if await nickname_exists(db, nickname):
            raise NicknameAlreadyRegisteredError from error
        raise

    await db.refresh(user)
    return user


async def login_user(db: AsyncSession, email: str, password: str) -> AppUser:
    user = await get_user_by_email(db, email)
    if user is None or not verify_password(password, user.password_hash):
        raise InvalidLocalCredentialsError
    return user
