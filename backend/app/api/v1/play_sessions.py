from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.case_bundle import CaseBundleResponse
from app.schemas.clue import PlaySessionCluesData, PlaySessionCluesResponse
from app.schemas.play_session import (
    PlaySessionCreateRequest,
    PlaySessionCreateResponse,
    PlaySessionData,
    PlaySessionReadData,
    PlaySessionReadResponse,
    PlaySessionState,
)
from app.services.case_bundle import get_case_bundle, get_pinned_case_bundle
from app.services.case_content import (
    CaseClientContentError,
    CaseClientContentNotFoundError,
    InvalidClientCaseIdError,
)
from app.services.case_content_validation import CaseContentLinkValidationError
from app.services.clue_catalog import get_acquired_clues
from app.services.pinned_content import (
    ContentCaseMismatchError,
    PinnedContentStore,
    resolve_session_content,
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
from app.services.puzzle_runtime import (
    CASE_ID_PATTERN,
    CaseRuntimeNotFoundError,
    InvalidCaseIdError,
    PuzzleRuntimeError,
)
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    CONTENT_VERSION_ERRORS,
    get_pinned_content_store,
    resolve_session_loaders,
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
    # 게시 검증을 통과해 등록된 콘텐츠 묶음 저장소(기본은 비어 있다)
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
) -> PlaySessionCreateResponse:
    pinned_content = None
    if request.content_version is not None:
        # (제안) 버전을 지정하면 저장소에 등록된 정확히 그 버전으로만 세션을 고정한다.
        # 파일에서 새로 읽거나 다른 버전으로 바꾸지 않는다.
        if CASE_ID_PATTERN.fullmatch(request.case_id) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Invalid case ID.",
            )
        try:
            pinned_content = content_store.get_version(
                request.case_id, request.content_version
            )
        except CONTENT_VERSION_ERRORS as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=CASE_VERSION_UNAVAILABLE,
            ) from error

    try:
        # 실제 게임 플레이 세션 생성 로직은
        # Service 계층에 맡긴다.
        play_session = await create_play_session(
            db=db,
            anonymous_session_id=request.anonymous_session_id,
            case_id=request.case_id,
            pinned_content=pinned_content,
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

    except CONTENT_VERSION_ERRORS as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CASE_VERSION_UNAVAILABLE,
        ) from error

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


@router.get(
    "/{play_session_id}/clues",
    response_model=PlaySessionCluesResponse,
)
async def get_play_session_clues_endpoint(
    play_session_id: str,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
) -> PlaySessionCluesResponse:
    # 기존 PlaySession 조회와 같은 접근 정책: play_session_id만으로 조회한다(인증 없음).
    try:
        # 단서 표시 정보도 세션이 고정한 버전의 Server Runtime에서 읽는다.
        loaders = await resolve_session_loaders(db, play_session_id, content_store)
        clues = await get_acquired_clues(
            db=db,
            play_session_id=play_session_id,
            runtime_loader=loaders.runtime_loader,
        )
    except CONTENT_VERSION_ERRORS as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CASE_VERSION_UNAVAILABLE,
        ) from error
    except PlaySessionNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        )
    except PuzzleRuntimeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Case content is unavailable.",
        )

    return PlaySessionCluesResponse(
        success=True,
        data=PlaySessionCluesData(play_session_id=play_session_id, clues=clues),
    )


@router.get(
    "/{play_session_id}/bundle",
    response_model=CaseBundleResponse,
)
async def get_play_session_bundle_endpoint(
    play_session_id: str,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
) -> CaseBundleResponse:
    """(제안 · 팀 검토 대기) 이 세션이 쓰는 Client Bundle.

    응답 형식은 `GET /cases/{case_id}/bundle`과 같다. 버전 고정 세션은 고정한 버전의 Client 콘텐츠,
    레거시 세션은 기존 케이스 번들을 돌려준다. 최신 버전으로 바꾸지 않는다.
    """

    try:
        play_session = await get_play_session(db, play_session_id)
        pinned = resolve_session_content(play_session, content_store)
        if pinned is None:
            bundle = get_case_bundle(play_session.case_id)
        else:
            if pinned.pin.case_id != play_session.case_id:
                raise ContentCaseMismatchError(pinned.pin.label())
            bundle = get_pinned_case_bundle(pinned)
    except PlaySessionNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        )
    except CONTENT_VERSION_ERRORS as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CASE_VERSION_UNAVAILABLE,
        ) from error
    except (InvalidClientCaseIdError, InvalidCaseIdError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid case ID.",
        ) from error
    except (CaseClientContentNotFoundError, CaseRuntimeNotFoundError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found.",
        ) from error
    except (
        CaseClientContentError,
        PuzzleRuntimeError,
        CaseContentLinkValidationError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Case content is unavailable.",
        ) from error

    return CaseBundleResponse(success=True, data=bundle)
