from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.play_session import (
    PlaySessionCreateRequest,
    PlaySessionCreateResponse,
    PlaySessionData,
    PlaySessionReadData,
    PlaySessionReadResponse,
    PlaySessionState,
)
from app.services.play_session import (
    AnonymousSessionExpiredError,
    AnonymousSessionNotFoundError,
    PlaySessionCaseContentUnavailableError,
    PlaySessionCaseNotFoundError,
    PlaySessionInvalidCaseIdError,
    PlaySessionNotFoundError,
    create_play_session,
    get_play_session,
)

# PlaySession 관련 API들을 묶는 Router
#
# main.py에서 /api/v1 prefix를 추가할 예정이므로
# 최종 주소는 /api/v1/play-sessions 가 된다.
router = APIRouter(
    prefix="/play-sessions",
    tags=["Play Sessions"],
)


@router.post(
    "",
    # 새로운 PlaySession 리소스를 생성하므로
    # HTTP 201 Created를 반환한다.
    status_code=status.HTTP_201_CREATED,
    # FastAPI가 최종 응답 구조를 검증한다.
    response_model=PlaySessionCreateResponse,
)
async def create_play_session_endpoint(
    # 클라이언트가 보내는 JSON Request Body
    request: PlaySessionCreateRequest,
    # 이 요청에서 사용할 DB Session을 주입받는다.
    db: AsyncSession = Depends(get_db),
) -> PlaySessionCreateResponse:
    try:
        # 실제 게임 플레이 세션 생성 로직은
        # Service 계층에 맡긴다.
        play_session = await create_play_session(
            db=db,
            anonymous_session_id=request.anonymous_session_id,
            case_id=request.case_id,
        )

    except AnonymousSessionNotFoundError:
        # 전달받은 anonymous_session_id 자체가 존재하지 않는 경우
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Anonymous session not found.",
        )

    except AnonymousSessionExpiredError:
        # 세션은 존재하지만 이미 만료된 경우
        #
        # 410 Gone은 "과거에는 존재했지만
        # 지금은 더 이상 사용할 수 없음"을 의미한다.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Anonymous session has expired.",
        )

    except PlaySessionInvalidCaseIdError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid case ID.",
        )

    except PlaySessionCaseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found.",
        )

    except PlaySessionCaseContentUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Case content is unavailable.",
        )

    # MySQL DATETIME은 timezone 정보를 저장하지 않으므로
    # DB에서 읽어온 created_at에 UTC임을 다시 명시한다.
    created_at_utc = play_session.created_at.replace(tzinfo=timezone.utc)

    # DB에서는 state_json이라는 이름으로 저장하지만,
    # API에서는 state라는 이름으로 노출한다.
    state = PlaySessionState.model_validate(play_session.state_json)

    # 앞에서 정한 API 계약 형태로 응답한다.
    return PlaySessionCreateResponse(
        success=True,
        data=PlaySessionData(
            play_session_id=play_session.id,
            case_id=play_session.case_id,
            created_at=created_at_utc,
            state=state,
        ),
    )


@router.get(
    "/{play_session_id}",
    response_model=PlaySessionReadResponse,
)
async def get_play_session_endpoint(
    play_session_id: str,
    db: AsyncSession = Depends(get_db),
) -> PlaySessionReadResponse:
    try:
        play_session = await get_play_session(
            db=db,
            play_session_id=play_session_id,
        )
    except PlaySessionNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        )

    created_at_utc = play_session.created_at.replace(tzinfo=timezone.utc)
    updated_at_utc = play_session.updated_at.replace(tzinfo=timezone.utc)
    completed_at_utc = (
        play_session.completed_at.replace(tzinfo=timezone.utc)
        if play_session.completed_at is not None
        else None
    )
    state = PlaySessionState.model_validate(play_session.state_json)

    return PlaySessionReadResponse(
        success=True,
        data=PlaySessionReadData(
            play_session_id=play_session.id,
            case_id=play_session.case_id,
            created_at=created_at_utc,
            updated_at=updated_at_utc,
            completed_at=completed_at_utc,
            state=state,
        ),
    )
