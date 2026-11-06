"""플레이 API 의 인증 주체 · Play Session 소유권 · Origin(11/6 PM 확정).

- 주체는 쿠키로만 정한다. 유효한 로그인 쿠키가 먼저, 없으면 유효한 게스트 쿠키. 둘 다 없으면 401.
  요청 본문의 익명 세션 UUID 는 권한 증명이 아니다.
- 로그인 사용자와 게스트는 다른 주체다. 로그인 사용자는 owner_user_id, 게스트는 owner_anonymous_session_id 로
  Play Session 을 가진다. 소유자 없는(레거시) 행 · 남의 행 · 없는 행은 모두 같은 404 다.
- 쓰기 요청은 기존 `require_same_origin` 과 같은 Origin 검사를 거친다(`require_play_origin`).
- 로그인 전용 `current_user` 는 그대로 둔다 — 게스트는 /me 같은 계정 API 를 쓸 수 없다.
"""

from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.play_session import PlaySession
from app.services.guest_session import guest_from_request
from app.services.user_session import require_same_origin, session_user_from_request

PLAY_SESSION_NOT_FOUND = "Play session not found."
PLAY_LOGIN_REQUIRED = "Play session cookie required."
PRODUCTION_PLAY_ORIGINS = frozenset(
    {"https://www.k-escape.com", "https://play.k-escape.com"}
)


@dataclass(frozen=True)
class PlayPrincipal:
    kind: Literal["user", "guest"]
    user_id: str | None = None
    guest_session_id: str | None = None
    # 게스트의 익명 세션(게스트 1명 = 익명 세션 1개). 로그인 사용자는 None.
    anonymous_session_id: str | None = None


@dataclass(frozen=True)
class PlaySessionOwner:
    """새 Play Session 에 기록할 소유자와, 호환용 anonymous_session_id 로 쓸 값."""

    user_id: str | None
    anonymous_session_id: str | None


async def resolve_play_principal(
    db: AsyncSession, request: Request
) -> PlayPrincipal | None:
    user = await session_user_from_request(db, request)
    if user is not None:
        return PlayPrincipal(kind="user", user_id=user.id)
    guest = await guest_from_request(db, request)
    if guest is not None:
        return PlayPrincipal(
            kind="guest",
            guest_session_id=guest.id,
            anonymous_session_id=guest.anonymous_session_id,
        )
    return None


async def current_play_principal(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> PlayPrincipal:
    response.headers["Cache-Control"] = "no-store"
    principal = await resolve_play_principal(db, request)
    if principal is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=PLAY_LOGIN_REQUIRED,
            headers={"Cache-Control": "no-store"},
        )
    return principal


def owns(
    principal: PlayPrincipal,
    owner_user_id: str | None,
    owner_anonymous_session_id: str | None,
) -> bool:
    """소유자 열 두 개로 판정한다. 둘 다 NULL(레거시)이면 누구의 것도 아니다."""
    if principal.kind == "user":
        return principal.user_id is not None and owner_user_id == principal.user_id
    return (
        owner_user_id is None
        and principal.anonymous_session_id is not None
        and owner_anonymous_session_id == principal.anonymous_session_id
    )


async def require_play_session_owner(
    play_session_id: str,
    principal: PlayPrincipal = Depends(current_play_principal),
    db: AsyncSession = Depends(get_db),
) -> PlayPrincipal:
    """경로의 Play Session 이 이 주체의 것인지 확인한다. 아니면(없음 포함) 같은 404.

    라우트 입구에서 확인하므로 같은 client_event_id 의 저장 결과 재생(Interaction · Hint · NPC)도 이 검사를 지난다.
    """
    row = await db.execute(
        select(PlaySession.owner_user_id, PlaySession.owner_anonymous_session_id).where(
            PlaySession.id == play_session_id
        )
    )
    found = row.first()
    if found is None or not owns(principal, found[0], found[1]):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=PLAY_SESSION_NOT_FOUND,
            headers={"Cache-Control": "no-store"},
        )
    return principal


def require_play_origin(request: Request) -> None:
    """플레이 상태를 바꾸는 요청의 Origin 검사 — 로그인 · 저장 API 와 같은 규칙(정확한 CORS_ORIGINS 일치)."""
    require_same_origin(request)
    if (
        settings.app_env == "production"
        and request.headers.get("origin") not in PRODUCTION_PLAY_ORIGINS
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Origin not allowed.")


def owner_for_new_play_session(
    principal: PlayPrincipal, requested_anonymous_session_id: str
) -> PlaySessionOwner:
    """새 Play Session 의 소유자.

    - 게스트: 자기 익명 세션만 쓸 수 있다. 본문의 anonymous_session_id 가 다르면 없는 익명 세션처럼 404 로
      알린다(FE 동행 세션은 이 404 를 받으면 익명 세션부터 다시 받는다).
    - 로그인 사용자: 소유자는 계정이다. 본문의 anonymous_session_id 는 호환용 FK 값으로만 쓴다(권한 아님).
    """
    if principal.kind == "guest":
        if requested_anonymous_session_id != principal.anonymous_session_id:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Anonymous session not found."
            )
        return PlaySessionOwner(
            user_id=None, anonymous_session_id=principal.anonymous_session_id
        )
    return PlaySessionOwner(user_id=principal.user_id, anonymous_session_id=None)
