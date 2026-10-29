from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.interaction import InteractionProcessResult
from app.schemas.interaction_api import InteractionApiRequest, InteractionApiResponse
from app.services.case_content import (
    CaseClientContentError,
)
from app.services.case_content_validation import CaseContentLinkValidationError
from app.services.external_interaction import (
    UnsupportedInteractionActionError,
    is_supported_action,
    process_external_interaction,
)
from app.services.interaction import (
    ClueNotAcquiredError,
    CurrentZoneUnknownError,
    IdempotencyConflictError,
    InspectionNotFoundError,
    NavigationUnavailableError,
    ObjectNotEnabledError,
    ObjectNotVisibleError,
    PuzzleNotFoundError,
    RequiredCluesMissingError,
    ZoneNotCurrentError,
)
from app.services.object_resolver import (
    InteractionTypeMismatchError,
    ObjectInteractionNotFoundError,
    ObjectNotFoundError,
    ZoneNotFoundError,
)
from app.services.pinned_content import PinnedContentStore
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import PuzzleRuntimeError
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    CONTENT_VERSION_ERRORS,
    DEFAULT_LOADERS,
    get_pinned_content_store,
    resolve_session_loaders,
)

router = APIRouter(
    prefix="/play-sessions",
    tags=["Interactions"],
)


@router.post(
    "/{play_session_id}/interactions",
    response_model=InteractionApiResponse,
    status_code=status.HTTP_200_OK,
)
async def create_interaction_endpoint(
    play_session_id: UUID,
    request: InteractionApiRequest,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
) -> InteractionApiResponse | JSONResponse:
    try:
        # 레거시 세션은 기본 로더, 버전 고정 세션은 그 버전 묶음의 로더(최신으로 바꾸지 않는다).
        # 처리하지 않는 action은 기존처럼 DB에 닿지 않고 501이 되도록 세션을 읽지 않는다.
        loaders = (
            await resolve_session_loaders(db, str(play_session_id), content_store)
            if is_supported_action(request)
            else DEFAULT_LOADERS
        )
        result = await process_external_interaction(
            db=db,
            play_session_id=str(play_session_id),
            request=request,
            runtime_loader=loaders.runtime_loader,
            client_content_loader=loaders.client_content_loader,
        )
    except RequiredCluesMissingError as error:
        # 기존 {"detail": "<문자열>"} 구조를 유지하고 부족한 단서 개수만 덧붙인다.
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": "Required clues are not acquired.",
                "missing_clue_count": error.missing_clue_count,
            },
        )
    except PlaySessionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        ) from error
    except CONTENT_VERSION_ERRORS as error:
        # 세션이 고정한 콘텐츠 버전을 쓸 수 없다(없음 · fingerprint 불일치 · 칼럼 불완전 · 로더 불일치).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CASE_VERSION_UNAVAILABLE,
        ) from error
    except PuzzleNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Puzzle not found.",
        ) from error
    except InspectionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inspection not found.",
        ) from error
    except ZoneNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Zone not found.",
        ) from error
    except ObjectNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object not found.",
        ) from error
    except ClueNotAcquiredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Clue is not acquired.",
        ) from error
    except ObjectInteractionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Object interaction is unavailable.",
        ) from error
    except InteractionTypeMismatchError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Interaction action does not match the object.",
        ) from error
    except CurrentZoneUnknownError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Current zone is unknown.",
        ) from error
    except ZoneNotCurrentError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zone is not current.",
        ) from error
    except NavigationUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Navigation is unavailable.",
        ) from error
    except ObjectNotVisibleError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Object is not visible.",
        ) from error
    except ObjectNotEnabledError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Object is not enabled.",
        ) from error
    except IdempotencyConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Client event ID conflicts with a previous interaction.",
        ) from error
    except UnsupportedInteractionActionError as error:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Interaction action '{error.action}' is not implemented.",
        ) from error
    except (CaseClientContentError, CaseContentLinkValidationError) as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Case content is unavailable.",
        ) from error
    except PuzzleRuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Puzzle runtime is unavailable.",
        ) from error

    return _to_external_response(result)


def _to_external_response(
    process_result: InteractionProcessResult,
) -> InteractionApiResponse:
    result = process_result.result
    result_type_mapping = {
        "correct": "correct",
        "incorrect": "incorrect",
        "combined": "correct",
        "incorrect_combination": "incorrect",
        "already_completed": "already_completed",
        "inspected": "ok",
        "already_inspected": "ok",
        "navigated": "ok",
    }

    return InteractionApiResponse(
        interaction_id=UUID(process_result.interaction_id),
        result_type=result_type_mapping[result.result_type],
        message=result.message,
        attempt_count=result.attempt_count,
        state_changes=result.state_changes,
        ui_actions=result.ui_actions,
    )
