"""쿠키 로그인 세션과 로그인 시도 제한."""

import hashlib
import math
import secrets
from datetime import timedelta
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.account_data import LoginThrottle, UserSession
from app.models.app_user import AppUser
from app.services.local_auth import normalize_email, utc_now

# 운영(https)은 __Host- 쿠키다. Secure · Path=/ · Domain 없음을 브라우저가 강제해 API 주소에만 묶인다.
# 로컬 http 에서는 __Host- 를 쓸 수 없어 이름만 다르다.
SESSION_COOKIE = (
    "__Host-waegok_session" if settings.session_cookie_secure else "waegok_session"
)
SESSION_COOKIE_OPTIONS = {
    "path": "/",
    "httponly": True,
    "samesite": "lax",
    "secure": settings.session_cookie_secure,
}
SESSION_LIFETIME = timedelta(days=14)

THROTTLE_WINDOW = timedelta(minutes=15)
MAX_FAILURES_PER_EMAIL = 5
MAX_FAILURES_PER_IP = 30


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def start_session(db: AsyncSession, response: Response, user_id: str) -> None:
    """세션을 새로 만들어 HttpOnly 쿠키로 내려 준다. 원문 토큰은 DB 에 남지 않는다."""
    token = secrets.token_urlsafe(32)
    now = utc_now()
    db.add(
        UserSession(
            id=str(uuid4()),
            app_user_id=user_id,
            token_hash=_hash(token),
            created_at=now,
            expires_at=now + SESSION_LIFETIME,
        )
    )
    await db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        **SESSION_COOKIE_OPTIONS,
    )


async def end_session(db: AsyncSession, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.execute(
            update(UserSession)
            .where(UserSession.token_hash == _hash(token))
            .values(revoked_at=utc_now())
        )
        await db.commit()
    response.delete_cookie(SESSION_COOKIE, **SESSION_COOKIE_OPTIONS)


async def _find_session_user(db: AsyncSession, token: str) -> AppUser | None:
    statement = (
        select(AppUser)
        .join(UserSession, UserSession.app_user_id == AppUser.id)
        .where(
            UserSession.token_hash == _hash(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > utc_now(),
        )
    )
    return await db.scalar(statement)


# 게스트 세션(app.services.guest_session)이 같은 토큰 규칙을 쓰도록 공개한다.
hash_session_token = _hash


async def session_user_from_request(
    db: AsyncSession, request: Request
) -> AppUser | None:
    """로그인 쿠키가 유효하면 그 사용자. 없거나 만료 · 폐기면 None(오류를 내지 않는다)."""
    token = request.cookies.get(SESSION_COOKIE)
    return await _find_session_user(db, token) if token else None


def require_same_origin(request: Request) -> None:
    """쓰기 요청이 다른 사이트에서 오지 못하게 막는다(CSRF). 쿠키 SameSite 위의 한 겹이다."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if request.headers.get("origin") not in settings.cors_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Origin not allowed.")


async def current_user(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AppUser:
    """쿠키의 세션으로만 사용자를 정한다. 요청에 적힌 사용자 id 는 믿지 않는다."""
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(SESSION_COOKIE)
    user = await _find_session_user(db, token) if token else None
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Login required.",
            headers={"Cache-Control": "no-store"},
        )
    return user


async def current_admin(user: AppUser = Depends(current_user)) -> AppUser:
    if user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Admin only.",
            headers={"Cache-Control": "no-store"},
        )
    return user


def _throttle_keys(request: Request, email: str) -> list[tuple[str, int]]:
    ip = request.client.host if request.client else "unknown"
    return [
        (_hash(f"email:{normalize_email(email)}"), MAX_FAILURES_PER_EMAIL),
        (_hash(f"ip:{ip}"), MAX_FAILURES_PER_IP),
    ]


async def login_lock_remaining_seconds(
    db: AsyncSession, request: Request, email: str
) -> int | None:
    """로그인이 막혀 있으면 풀릴 때까지 남은 초(올림, 1 이상), 아니면 None.

    잠금은 실패 한도에 닿은 순간 `locked_until = 그때 + THROTTLE_WINDOW`로 기록된다(`record_login_failure`).
    이메일 · IP 잠금이 둘 다 걸려 있으면 둘 다 풀려야 로그인할 수 있으므로 더 늦게 풀리는 쪽을 돌려준다.
    """

    now = utc_now()
    remaining: int | None = None
    for key, _ in _throttle_keys(request, email):
        row = await db.get(LoginThrottle, key)
        if (
            isinstance(row, LoginThrottle)
            and row.locked_until
            and row.locked_until > now
        ):
            seconds = max(1, math.ceil((row.locked_until - now).total_seconds()))
            remaining = seconds if remaining is None else max(remaining, seconds)
    return remaining


async def is_login_locked(db: AsyncSession, request: Request, email: str) -> bool:
    return await login_lock_remaining_seconds(db, request, email) is not None


async def record_login_failure(db: AsyncSession, request: Request, email: str) -> None:
    now = utc_now()
    for key, limit in _throttle_keys(request, email):
        row = await db.get(LoginThrottle, key)
        if not isinstance(row, LoginThrottle):
            row = LoginThrottle(key_hash=key, failed_count=0, window_started_at=now)
            db.add(row)
        elif now - row.window_started_at > THROTTLE_WINDOW:
            row.failed_count = 0
            row.window_started_at = now
            row.locked_until = None
        row.failed_count += 1
        if row.failed_count >= limit:
            row.locked_until = now + THROTTLE_WINDOW
    await db.commit()


async def clear_login_failures(db: AsyncSession, request: Request, email: str) -> None:
    """성공하면 그 이메일의 실패만 지운다. IP 집계는 남겨 여러 계정을 돌려 보는 공격을 막는다."""
    key, _ = _throttle_keys(request, email)[0]
    row = await db.get(LoginThrottle, key)
    if isinstance(row, LoginThrottle):
        await db.delete(row)
        await db.commit()
