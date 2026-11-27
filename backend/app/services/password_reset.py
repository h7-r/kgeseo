"""비밀번호 찾기 · 변경(계약 `docs/contracts/password_reset_v0.1.md`, 11/25).

찾기는 세 걸음이다 — ① 이메일로 6자리 코드 ② 코드를 맞히면 재설정 증표 ③ 증표로 새 비밀번호.
- 가입 여부를 드러내지 않는다: ①은 없는 이메일 · 소셜 전용 · 탈퇴 계정에도 같은 답을 한다. 메일은 없는 · 탈퇴 계정엔 안 가고,
  소셜 전용 회원에겐 코드 대신 「구글 · 네이버로 로그인하세요」 안내가 간다(미르 11/26). ②는 틀린 코드 ·
  만료 · 시도 초과 · 코드 없음을 모두 같은 오류로 답한다. 메일은 응답 뒤에 보내 걸린 시간으로도 갈리지 않게 한다(API 의 몫).
- 코드 · 증표 원문은 저장하지 않는다. 코드는 서버 비밀값을 쓴 HMAC-SHA256(행 id 를 섞어 같은 코드라도 행마다 다르다),
  증표는 32바이트 난수라 SHA-256.
- 새 비밀번호가 저장되면 그 회원의 로그인 세션을 모두 끊고, 이메일 로그인 실패 잠금을 푼다.

변경은 로그인한 회원이 지금 비밀번호를 확인한 뒤 바꾼다. 이 브라우저의 세션은 남기고 다른 기기의 세션만 끊는다.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import NoReturn
from uuid import uuid4

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account_data import LoginThrottle, UserSession
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.password_reset import PasswordResetCode, PasswordResetVerifyThrottle
from app.services.local_auth import (
    get_local_identity_by_email,
    hash_password,
    normalize_email,
    utc_now,
    verify_password,
)
from app.services.mailer import Mail
from app.services.registration_input_policy import validate_registration_password
from app.services.user_session import WithdrawnAccountError

CODE_LIFETIME = timedelta(minutes=15)
TOKEN_LIFETIME = timedelta(minutes=10)
# 같은 회원에게 코드를 다시 보내기까지 기다리는 시간, 한 시간 · 하루에 보낼 수 있는 코드 수
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_CODES_PER_HOUR = 5
MAX_CODES_PER_DAY = 10
MAX_FAILED_ATTEMPTS = 5
# 이메일 하나에 하루 동안 틀릴 수 있는 코드 확인 수(가입 여부와 상관없이 센다). 넘으면 맞는 코드도 거절한다 —
# 시간당 코드 5개 × 5번을 날마다 되풀이하는 추측을 막는다(11/25 검토)
MAX_VERIFY_FAILURES_PER_DAY = 20
VERIFY_WINDOW = timedelta(days=1)
# 다 쓴 · 지난 코드 행은 하루가 지나면 지운다(시간당 발송 수를 세는 데만 남겨 둔다)
ROW_RETENTION = timedelta(days=1)

MAIL_SUBJECT = "[왜곡] 비밀번호 재설정 코드"
SOCIAL_MAIL_SUBJECT = "[왜곡] 비밀번호 찾기 안내"
# 로그인 화면 단추에 적힌 이름
SOCIAL_PROVIDER_NAMES = {"google": "Google", "naver": "네이버"}


class InvalidResetCodeError(Exception):
    """코드가 틀렸거나 · 만료됐거나 · 시도가 많았거나 · 받은 코드가 없다(구분하지 않는다)."""


class ResetVerifyLockedError(Exception):
    """이 이메일의 코드 확인 실패가 하루 한도에 닿아 잠겼다. 가입 여부와 상관없이 같으므로 따로 알려도 된다 — 화면은 다음에 할 일을 보인다."""

    def __init__(self, retry_after_sec: int) -> None:
        super().__init__(retry_after_sec)
        self.retry_after_sec = retry_after_sec


class InvalidResetTokenError(Exception):
    """재설정 증표가 없거나 · 만료됐거나 · 이미 썼다."""


class NoLocalPasswordError(Exception):
    """이메일 비밀번호로 가입하지 않은 소셜 전용 회원이다."""


class InvalidCurrentPasswordError(Exception):
    pass


class SamePasswordError(Exception):
    pass


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _code_hash(row_id: str, code: str) -> str:
    # 6자리라 비밀값 없는 해시는 DB 를 읽으면 백만 번 대입으로 풀린다 — 서버 비밀값으로 HMAC(세진 11/27)
    key = settings.password_reset_code_secret.get_secret_value().encode("utf-8")
    return hmac.new(key, f"{row_id}:{code}".encode(), hashlib.sha256).hexdigest()


def _login_throttle_key(email: str) -> str:
    # user_session._throttle_keys 의 이메일 열쇠와 같은 셈이다
    return _sha256(f"email:{normalize_email(email)}")


def verify_throttle_key(email: str) -> str:
    """코드 확인 실패를 세는 열쇠(password_reset_verify_throttles). 이메일 원문은 남기지 않는다."""
    return _sha256(f"password-reset-verify:{normalize_email(email)}")


def _count_verify_failure(
    throttle: PasswordResetVerifyThrottle | None,
    db: AsyncSession,
    email: str,
    now: datetime,
) -> PasswordResetVerifyThrottle:
    """코드 확인 실패 하나. 가입된 이메일이든 아니든 같은 일(행 하나 쓰기 + 커밋)을 해서 걸린 시간으로 갈리지 않게 한다."""
    if not isinstance(throttle, PasswordResetVerifyThrottle):
        throttle = PasswordResetVerifyThrottle(
            key_hash=verify_throttle_key(email), failed_count=0, window_started_at=now
        )
        db.add(throttle)
    elif now - throttle.window_started_at > VERIFY_WINDOW:
        throttle.failed_count = 0
        throttle.window_started_at = now
        throttle.locked_until = None
    throttle.failed_count += 1
    if throttle.failed_count >= MAX_VERIFY_FAILURES_PER_DAY:
        throttle.locked_until = throttle.window_started_at + VERIFY_WINDOW
    return throttle


def _locked_error(
    throttle: PasswordResetVerifyThrottle, now: datetime
) -> ResetVerifyLockedError:
    remaining = (throttle.locked_until or now) - now
    return ResetVerifyLockedError(max(1, int(remaining.total_seconds())))


def _is_locked(throttle: PasswordResetVerifyThrottle | None, now: datetime) -> bool:
    return (
        isinstance(throttle, PasswordResetVerifyThrottle)
        and throttle.locked_until is not None
        and throttle.locked_until > now
    )


async def _fail_verify(
    throttle: PasswordResetVerifyThrottle | None,
    db: AsyncSession,
    email: str,
    now: datetime,
) -> NoReturn:
    """실패를 세고 커밋한 뒤 알맞은 오류를 던진다 — 이번 실패로 잠겼으면 잠금 안내(다음에 할 일)를 바로 보인다(미르 11/27)."""
    throttle = _count_verify_failure(throttle, db, email, now)
    locked = _is_locked(throttle, now)
    error = _locked_error(throttle, now) if locked else None
    await db.commit()
    if error is not None:
        raise error
    raise InvalidResetCodeError


def _mail_text(code: str) -> str:
    minutes = int(CODE_LIFETIME.total_seconds() // 60)
    return (
        "왜곡 비밀번호 재설정 코드입니다.\n\n"
        f"    {code}\n\n"
        f"비밀번호 찾기 화면에 이 코드를 입력해 주세요. 코드는 {minutes}분 동안 쓸 수 있습니다.\n"
        "직접 요청하지 않았다면 이 메일은 무시해 주세요. 비밀번호는 바뀌지 않습니다.\n"
    )


def _social_mail_text(providers: list[str]) -> str:
    names = " · ".join(SOCIAL_PROVIDER_NAMES.get(p, p) for p in providers)
    return (
        "왜곡 비밀번호 찾기를 요청하셨습니다.\n\n"
        f"이 계정은 {names}(으)로 가입해 따로 정한 비밀번호가 없습니다.\n"
        f"로그인 화면에서 「{names}」 단추로 로그인해 주세요.\n\n"
        "직접 요청하지 않았다면 이 메일은 무시해 주세요. 계정에는 아무것도 바뀌지 않습니다.\n"
    )


async def _member_with_local_password(
    db: AsyncSession, email: str
) -> tuple[AppUser, AuthIdentity] | None:
    identity = await get_local_identity_by_email(db, email)
    if identity is None or identity.password_hash is None:
        return None
    user = await db.scalar(
        select(AppUser).where(AppUser.id == identity.app_user_id).with_for_update()
    )
    if user is None or user.deleted_at is not None:
        return None
    return user, identity


async def _social_only_member(
    db: AsyncSession, email: str
) -> tuple[AppUser, list[str]] | None:
    """이 이메일로 가입한 소셜 전용 회원과 그 로그인 수단(google · naver). 비밀번호가 있으면 여기 오지 않는다."""
    user = await db.scalar(
        select(AppUser).where(AppUser.email == normalize_email(email)).with_for_update()
    )
    if user is None or user.deleted_at is not None:
        return None
    providers = (
        await db.scalars(
            select(AuthIdentity.provider)
            .where(
                AuthIdentity.app_user_id == user.id,
                AuthIdentity.provider != "local",
            )
            .order_by(AuthIdentity.provider)
        )
    ).all()
    return (user, list(providers)) if providers else None


async def request_password_reset(db: AsyncSession, email: str) -> Mail | None:
    """코드를 만들고 보낼 메일을 돌려준다. 보내지 않을 때(없는 계정 · 재발송 대기 · 시간당 한도)는 None — 답은 같다.
    소셜 전용 회원에겐 코드 대신 로그인 안내 메일을 돌려준다."""

    found = await _member_with_local_password(db, email)
    social_providers: list[str] = []
    if found is None:
        social = await _social_only_member(db, email)
        if social is None:
            await db.rollback()
            return None
        user, social_providers = social
    else:
        user, _ = found
    now = utc_now()
    await db.execute(
        delete(PasswordResetCode).where(
            PasswordResetCode.app_user_id == user.id,
            PasswordResetCode.created_at < now - ROW_RETENTION,
        )
    )
    # 잠금 읽기로 센다 — 같은 회원의 동시 요청은 회원 행 잠금으로 한 줄로 서지만, 잠그지 않는 읽기는 트랜잭션을 연 때의
    # 스냅숏을 봐서 앞 요청이 막 만든 행을 못 보고 한도를 넘겨 보냈다(11/25 검토)
    recent = (
        await db.scalars(
            select(PasswordResetCode.created_at)
            .where(
                PasswordResetCode.app_user_id == user.id,
                PasswordResetCode.created_at > now - timedelta(days=1),
            )
            .with_for_update()
        )
    ).all()
    last_hour = [created for created in recent if created > now - timedelta(hours=1)]
    if (
        len(recent) >= MAX_CODES_PER_DAY
        or len(last_hour) >= MAX_CODES_PER_HOUR
        or any(created > now - RESEND_COOLDOWN for created in recent)
    ):
        await db.commit()
        return None

    if social_providers:
        # 안내 메일도 코드 메일과 같은 한도로 센다 — 이메일만 알면 남의 메일함에 끝없이 보낼 수 있으므로.
        # 쓸 수 없는 기록 행을 남긴다: 코드는 아무에게도 안 가고 만들자마자 만료다. 확인(②)은 비밀번호 계정만 찾으므로 닿지도 않는다
        row_id = str(uuid4())
        db.add(
            PasswordResetCode(
                id=row_id,
                app_user_id=user.id,
                code_hash=_code_hash(row_id, secrets.token_hex(16)),
                failed_attempts=0,
                created_at=now,
                expires_at=now,
            )
        )
        await db.commit()
        return Mail(
            to=user.email,
            subject=SOCIAL_MAIL_SUBJECT,
            text=_social_mail_text(social_providers),
        )

    # 살아 있는 코드는 하나만 — 앞서 보낸 코드는 바로 못 쓰게 한다. 코드를 맞혀 증표를 받은 행은 그대로 둔다:
    # 이메일만 아는 남이 요청을 보내 본인이 쥔 증표를 죽이지 못하게(11/25 검토). 증표는 10분이면 끝난다
    await db.execute(
        update(PasswordResetCode)
        .where(
            PasswordResetCode.app_user_id == user.id,
            PasswordResetCode.used_at.is_(None),
            PasswordResetCode.token_hash.is_(None),
        )
        .values(expires_at=now)
    )
    code = f"{secrets.randbelow(10**6):06d}"
    row_id = str(uuid4())
    db.add(
        PasswordResetCode(
            id=row_id,
            app_user_id=user.id,
            code_hash=_code_hash(row_id, code),
            failed_attempts=0,
            created_at=now,
            expires_at=now + CODE_LIFETIME,
        )
    )
    await db.commit()
    return Mail(to=user.email, subject=MAIL_SUBJECT, text=_mail_text(code))


async def verify_reset_code(db: AsyncSession, email: str, code: str) -> str:
    """코드를 맞히면 재설정 증표 원문을 돌려준다(한 번만 나간다). 틀리면 그 코드의 실패 횟수를 올린다."""

    now = utc_now()
    key = verify_throttle_key(email)
    # 확인 실패 행을 먼저 만들어 커밋해 둔다(있으면 그대로). 없는 열쇠를 FOR UPDATE 로 읽고 INSERT 하면 같은 이메일의 첫 동시 요청끼리
    # 간격 잠금이 엇갈려 교착(1213 → 500)이 났다(세진 11/27, 4개 동시 8회 중 7회). 있는 행을 잠그면 차례로 줄을 선다
    await db.execute(
        insert(PasswordResetVerifyThrottle)
        .values(key_hash=key, failed_count=0, window_started_at=now)
        .prefix_with("IGNORE", dialect="mysql")
        .prefix_with("OR IGNORE", dialect="sqlite")
    )
    await db.commit()
    # 잠그는 순서: 회원 행 → 확인 실패 행 → 코드 행. 탈퇴(회원 행 → 확인 실패 행 삭제)와 같게 —
    # 엇갈리면 같은 계정에서 둘이 겹칠 때 교착(1213)으로 한쪽이 500 을 받는다(미르 · 세진 11/27 리뷰)
    found = await _member_with_local_password(db, email)
    throttle = await db.get(
        PasswordResetVerifyThrottle, key, with_for_update=True, populate_existing=True
    )
    if _is_locked(throttle, now):
        error = _locked_error(throttle, now)
        await db.rollback()
        raise error
    if found is None:
        await _fail_verify(throttle, db, email, now)
    user, _ = found
    row = await db.scalar(
        select(PasswordResetCode)
        .where(
            PasswordResetCode.app_user_id == user.id,
            PasswordResetCode.used_at.is_(None),
            PasswordResetCode.token_hash.is_(None),
            PasswordResetCode.expires_at > now,
        )
        .order_by(PasswordResetCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if row is None or row.failed_attempts >= MAX_FAILED_ATTEMPTS:
        await _fail_verify(throttle, db, email, now)
    if not hmac.compare_digest(_code_hash(row.id, code), row.code_hash):
        row.failed_attempts += 1
        await _fail_verify(throttle, db, email, now)

    token = secrets.token_urlsafe(32)
    row.token_hash = _sha256(token)
    row.token_expires_at = now + TOKEN_LIFETIME
    await db.commit()
    return token


async def complete_password_reset(
    db: AsyncSession, token: str, new_password: str
) -> None:
    """증표로 새 비밀번호를 저장한다. 그 회원의 세션을 모두 끊고 로그인 실패 잠금을 푼다.

    비밀번호 규칙에 맞지 않으면 `InvalidPasswordError`(registration_input_policy) — 증표는 그대로 남아 다시 쓸 수 있다."""

    token_hash = _sha256(token)
    # 잠그는 순서를 요청 · 확인 · 탈퇴와 같게(회원 행 → 코드 행) — 엇갈리면 교착(1213)으로 한쪽이 500 을 받는다(11/25 검토)
    owner_id = await db.scalar(
        select(PasswordResetCode.app_user_id).where(
            PasswordResetCode.token_hash == token_hash
        )
    )
    if owner_id is None:
        await db.rollback()
        raise InvalidResetTokenError
    user = await db.scalar(
        select(AppUser).where(AppUser.id == owner_id).with_for_update()
    )
    # 회원 행을 쥔 뒤의 시각 — 증표 만료를 잠금을 기다린 뒤 기준으로 본다
    now = utc_now()
    row = await db.scalar(
        select(PasswordResetCode)
        .where(PasswordResetCode.token_hash == token_hash)
        .with_for_update()
    )
    if (
        row is None
        or row.used_at is not None
        or row.token_expires_at is None
        or row.token_expires_at <= now
    ):
        await db.rollback()
        raise InvalidResetTokenError
    identity = await db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.app_user_id == row.app_user_id,
            AuthIdentity.provider == "local",
        )
    )
    if (
        user is None
        or user.deleted_at is not None
        or identity is None
        or identity.password_hash is None
    ):
        await db.rollback()
        raise InvalidResetTokenError
    try:
        validate_registration_password(
            new_password, email=user.email, nickname=user.nickname
        )
    except Exception:
        await db.rollback()
        raise

    identity.password_hash = hash_password(new_password)
    identity.updated_at = now
    row.used_at = now
    await db.execute(
        update(PasswordResetCode)
        .where(
            PasswordResetCode.app_user_id == user.id,
            PasswordResetCode.used_at.is_(None),
        )
        .values(expires_at=now, token_expires_at=now)
    )
    await db.execute(
        update(UserSession)
        .where(UserSession.app_user_id == user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await db.execute(
        delete(LoginThrottle).where(
            LoginThrottle.key_hash == _login_throttle_key(user.email)
        )
    )
    await db.commit()


async def change_password(
    db: AsyncSession,
    user: AppUser,
    current_password: str,
    new_password: str,
    *,
    keep_session_token_hash: str | None,
) -> None:
    """로그인한 회원의 비밀번호 변경. 지금 비밀번호가 맞아야 한다. 이 브라우저의 세션만 남기고 다른 세션은 끊는다."""

    # 회원 행을 먼저 쥔다 — 겹친 로그인(start_session)과 탈퇴가 이 변경과 차례로 처리된다(11/25 검토).
    # 탈퇴가 먼저 끝났으면 수단이 지워졌으니 「소셜 전용」이 아니라 세션 끝으로 답하게 deleted_at 을 본다.
    # populate_existing: current_user 가 올려 둔 같은 ORM 객체를 다시 읽는다 — 없으면 잠근 뒤에도 옛 값(deleted_at)을 본다(미르 11/27 리뷰)
    member = await db.scalar(
        select(AppUser)
        .where(AppUser.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if member is None or member.deleted_at is not None:
        await db.rollback()
        raise WithdrawnAccountError
    # 잠금 읽기 — 일반 SELECT 는 current_user 때 잡힌 스냅숏을 봐서, 그사이 커밋된 재설정(complete) 대신 옛 해시로
    # 확인하고 덮어썼다(미르 11/27 리뷰, 격리 MySQL 재현)
    identity = await db.scalar(
        select(AuthIdentity)
        .where(
            AuthIdentity.app_user_id == user.id,
            AuthIdentity.provider == "local",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    try:
        if identity is None or identity.password_hash is None:
            raise NoLocalPasswordError
        if not verify_password(current_password, identity.password_hash):
            raise InvalidCurrentPasswordError
        if current_password == new_password:
            raise SamePasswordError
        validate_registration_password(
            new_password, email=user.email, nickname=user.nickname
        )
    except Exception:
        # 회원 행 잠금을 바로 놓는다(실패 기록은 API 가 새 트랜잭션으로 남긴다)
        await db.rollback()
        raise

    now = utc_now()
    identity.password_hash = hash_password(new_password)
    identity.updated_at = now
    others = update(UserSession).where(
        UserSession.app_user_id == user.id, UserSession.revoked_at.is_(None)
    )
    if keep_session_token_hash is not None:
        others = others.where(UserSession.token_hash != keep_session_token_hash)
    await db.execute(others.values(revoked_at=now))
    # 비밀번호가 바뀌었으니 진행 중이던 찾기 코드 · 증표도 못 쓰게 한다
    await db.execute(
        update(PasswordResetCode)
        .where(
            PasswordResetCode.app_user_id == user.id,
            PasswordResetCode.used_at.is_(None),
        )
        .values(expires_at=now, token_expires_at=now)
    )
    await db.commit()
