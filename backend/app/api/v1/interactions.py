from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.interaction import InteractionProcessResult
from app.schemas.interaction_api import InteractionApiRequest, InteractionApiResponse
from app.services.case_content import (
    CaseClientContentError,
)
from app.services.external_interaction import (
    UnsupportedInteractionActionError,
    process_external_interaction,
)
from app.services.interaction import (
    ClueNotAcquiredError,
    IdempotencyConflictError,
    PuzzleNotFoundError,
)
from app.services.object_resolver import (
    InteractionTypeMismatchError,
    ObjectInteractionNotFoundError,
    ObjectNotFoundError,
    ZoneNotFoundError,
)
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import PuzzleRuntimeError

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
) -> InteractionApiResponse:
    try:
        result = await process_external_interaction(
            db=db,
            play_session_id=str(play_session_id),
            request=request,
        )
    except PlaySessionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        ) from error
    except PuzzleNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Puzzle not found.",
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
    except CaseClientContentError as error:
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
    }

    return InteractionApiResponse(
        interaction_id=UUID(process_result.interaction_id),
        result_type=result_type_mapping[result.result_type],
        message=result.message,
        attempt_count=result.attempt_count,
        state_changes=result.state_changes,
        ui_actions=result.ui_actions,
    )
