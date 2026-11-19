from datetime import timezone

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.db.session import get_db
from app.models.anonymous_session import AnonymousSession
from app.schemas.anonymous_session import (
    AnonymousSessionCreateResponse,
    AnonymousSessionData,
)
from app.services.guest_session import guest_from_request, issue_guest
from app.services.play_principal import require_play_origin
from app.services.request_rate_limit import (
    ANONYMOUS_SESSION_CREATE,
    SlidingWindowLimiter,
    enforce_rate_limit,
    get_request_rate_limiter,
)

# 익명 세션 관련 API들을 묶는 Router
router = APIRouter(
    prefix="/anonymous-sessions",
    tags=["Anonymous Sessions"],
)


@router.post(
    "",
    # 응답 계약 호환을 위해 재사용(유효한 게스트)도 201 로 둔다.
    status_code=status.HTTP_201_CREATED,
    # 응답 JSON 구조를 FastAPI가 검증하도록 지정
    response_model=AnonymousSessionCreateResponse,
    responses=error_responses.ANONYMOUS_SESSION_CREATE,
    dependencies=[Depends(require_play_origin)],
)
async def create_anonymous_session_endpoint(
    request: Request,
    response: Response,
    # 요청마다 사용할 DB 세션을 주입받는다.
    db: AsyncSession = Depends(get_db),
    limiter: SlidingWindowLimiter = Depends(get_request_rate_limiter),
) -> AnonymousSessionCreateResponse:
    """게스트 발급 창구(11/6 PM).

    - 유효한 게스트 쿠키: 그 게스트의 익명 세션을 그대로 돌려준다(새로 만들지 않는다).
    - 유효한 게스트 쿠키 없음: 새 익명 세션 + 게스트 세션 + 게스트 쿠키.
    - 로그인 쿠키가 함께 있어도 플레이 소유자는 로그인 계정이다.
    - 요청 빈도 제한(PR B)은 **새로 만들 때만** 센다. 유효한 게스트의 재사용 조회는 세지도 막지도 않는다.
    """
    response.headers["Cache-Control"] = "no-store"
    guest = await guest_from_request(db, request)
    anonymous_session = (
        await db.get(AnonymousSession, guest.anonymous_session_id)
        if guest is not None
        else None
    )
    if anonymous_session is None:
        enforce_rate_limit(limiter, ANONYMOUS_SESSION_CREATE, request)
        anonymous_session = await issue_guest(db, response)

    # DB에는 UTC 기준이지만 timezone 정보 없이 저장되어 있으므로
    # API 응답에서는 UTC임을 다시 명시한다.
    expires_at_utc = anonymous_session.expires_at.replace(tzinfo=timezone.utc)

    # API 계약에 맞는 형태로 응답한다.
    return AnonymousSessionCreateResponse(
        success=True,
        data=AnonymousSessionData(
            anonymous_session_id=anonymous_session.id,
            expires_at=expires_at_utc,
        ),
    )
