"""게스트 세션과 게스트 쿠키(11/6 PM 확정).

- 쿠키: 운영 `__Host-waegok_guest`(Secure · HttpOnly · SameSite=Lax · Path=/ · Domain 없음), 로컬 http 는
  `waegok_guest`. 속성 · 수명(14일) · 갱신 규칙(갱신 없음, 만료 뒤 새로 발급)은 로그인 세션과 같다.
- 토큰 원문은 쿠키에만 있다. DB 에는 `hash_session_token` 해시만, 로그에도 남기지 않는다.
- 게스트 1명 = 익명 세션 1개. 가짜 AppUser 를 만들지 않는다.
- 로그인 순간 유효한 게스트가 있으면 그 게스트의 Play Session 을 계정으로 옮기고 게스트를 폐기한다.
"""

import logging
import secrets
from uuid import uuid4

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.anonymous_session import AnonymousSession
from app.models.guest_session import GuestSession, GuestSessionTransfer
from app.models.play_session import PlaySession
from app.services.local_auth import utc_now
from app.services.user_session import (
    SESSION_COOKIE_OPTIONS,
    SESSION_LIFETIME,
    hash_session_token,
)

logger = logging.getLogger(__name__)

GUEST_COOKIE_SECURE = settings.app_env == "production" or settings.session_cookie_secure
GUEST_COOKIE = "__Host-waegok_guest" if GUEST_COOKIE_SECURE else "waegok_guest"
GUEST_COOKIE_OPTIONS = {**SESSION_COOKIE_OPTIONS, "secure": GUEST_COOKIE_SECURE}
GUEST_LIFETIME = SESSION_LIFETIME


async def find_guest_session(
    db: AsyncSession, token: str | None, *, for_update: bool = False
) -> GuestSession | None:
    """유효한(만료 · 폐기 아님) 게스트 세션. 없으면 None."""
    if not token:
        return None
    statement = select(GuestSession).where(
        GuestSession.token_hash == hash_session_token(token),
        GuestSession.revoked_at.is_(None),
        GuestSession.expires_at > utc_now(),
    )
    if for_update:
        statement = statement.with_for_update()
    guest = await db.scalar(statement)
    # A locking lookup can wait long enough for the token to expire.
    if guest is None or guest.expires_at <= utc_now():
        return None
    return guest


async def guest_from_request(db: AsyncSession, request: Request) -> GuestSession | None:
    return await find_guest_session(db, request.cookies.get(GUEST_COOKIE))


def set_guest_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        GUEST_COOKIE,
        token,
        max_age=int(GUEST_LIFETIME.total_seconds()),
        **GUEST_COOKIE_OPTIONS,
    )


def clear_guest_cookie(response: Response) -> None:
    response.delete_cookie(GUEST_COOKIE, **GUEST_COOKIE_OPTIONS)


async def issue_guest(db: AsyncSession, response: Response) -> AnonymousSession:
    """새 익명 세션과 게스트 세션을 만들고 게스트 쿠키를 내려 준다.

    익명 세션의 만료는 게스트 만료와 같게 둔다 — 게스트가 유효한 동안 Play Session 을 새로 만들 수 있어야 한다.
    """
    now = utc_now()
    expires_at = now + GUEST_LIFETIME
    token = secrets.token_urlsafe(32)
    anonymous = AnonymousSession(id=str(uuid4()), created_at=now, expires_at=expires_at)
    db.add(anonymous)
    # 게스트가 익명 세션을 FK 로 가리킨다 — 같은 commit 에서 SQLAlchemy 가 익명 세션을 먼저 INSERT 한다.
    db.add(
        GuestSession(
            id=str(uuid4()),
            anonymous_session_id=anonymous.id,
            token_hash=hash_session_token(token),
            created_at=now,
            expires_at=expires_at,
        )
    )
    await db.commit()
    await db.refresh(anonymous)
    set_guest_cookie(response, token)
    return anonymous


async def transfer_guest_to_user(
    db: AsyncSession, request: Request, response: Response, user_id: str
) -> int | None:
    """로그인 성공 직후. 유효한 게스트 쿠키가 있을 때만 그 게스트의 Play Session 을 계정으로 옮긴다.

    - 게스트 행을 잠그고(FOR UPDATE) 옮김 · 폐기 · 기록을 한 트랜잭션에 넣는다. 동시 로그인 · 반복 콜백은
      둘째부터 폐기된 게스트를 보고 아무것도 하지 않는다(기록 표의 guest_session_id 유일 제약이 한 겹 더).
    - 옮긴 Play Session 수를 돌려준다. 옮길 게스트가 없으면 None.
    - 실패하면 되돌리고 게스트 · 쿠키를 그대로 둔다(진행은 지우지 않는다 — 다음 로그인 때 다시 옮긴다).
      로그인 자체는 실패시키지 않는다.
    - 로그인 요청의 DB 세션과 **따로 연 세션 · 트랜잭션**에서 한다. 같은 세션에서 rollback 하면 로그인 응답을
      만들 사용자 객체까지 만료돼 응답이 깨진다.
    """
    token = request.cookies.get(GUEST_COOKIE)
    if not token:
        return None
    try:
        async with AsyncSession(db.bind, expire_on_commit=False) as tx:
            count = await _transfer(tx, token, user_id)
    except Exception:
        logger.error("guest progress transfer failed; guest session kept")
        return None
    # 옮겼거나(숫자), 쓸 수 없는 게스트 쿠키(만료 · 폐기 · 이미 옮김)였다(None) — 어느 쪽이든 쿠키는 지운다.
    clear_guest_cookie(response)
    return count


async def _transfer(tx: AsyncSession, token: str, user_id: str) -> int | None:
    async with tx.begin():
        guest = await find_guest_session(tx, token, for_update=True)
        if guest is None:
            return None
        now = utc_now()
        moved = await tx.execute(
            update(PlaySession)
            .where(
                PlaySession.owner_anonymous_session_id == guest.anonymous_session_id,
                PlaySession.owner_user_id.is_(None),
            )
            .values(
                owner_user_id=user_id, owner_anonymous_session_id=None, updated_at=now
            )
        )
        count = int(moved.rowcount or 0)
        guest.revoked_at = now
        tx.add(
            GuestSessionTransfer(
                id=str(uuid4()),
                guest_session_id=guest.id,
                anonymous_session_id=guest.anonymous_session_id,
                app_user_id=user_id,
                play_session_count=count,
                transferred_at=now,
            )
        )
    return count
