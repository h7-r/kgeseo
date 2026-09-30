from datetime import timezone

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.anonymous_session import (
    AnonymousSessionCreateResponse,
    AnonymousSessionData,
)
from app.services.anonymous_session import create_anonymous_session

# 익명 세션 관련 API들을 묶는 Router
router = APIRouter(
    prefix="/anonymous-sessions",
    tags=["Anonymous Sessions"],
)


@router.post(
    "",
    # 새 리소스를 생성했으므로 201 Created 사용
    status_code=status.HTTP_201_CREATED,
    # 응답 JSON 구조를 FastAPI가 검증하도록 지정
    response_model=AnonymousSessionCreateResponse,
)
async def create_anonymous_session_endpoint(
    # 요청마다 사용할 DB 세션을 주입받는다.
    db: AsyncSession = Depends(get_db),
) -> AnonymousSessionCreateResponse:

    # 실제 생성 로직은 Service 계층에 맡긴다.
    anonymous_session = await create_anonymous_session(db)

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
