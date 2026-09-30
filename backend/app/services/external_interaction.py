from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.interaction import (
    CombineCluesInteraction,
    CombineCluesPayload,
    InteractionProcessResult,
    SubmitAnswerInteraction,
    SubmitAnswerPayload,
)
from app.schemas.interaction_api import (
    CombineCluesInteractionRequest,
    InputInteractionRequest,
    InteractionApiRequest,
)
from app.services.case_content import load_case_client_content
from app.services.interaction import process_interaction
from app.services.object_resolver import resolve_object_interaction
from app.services.play_session import get_play_session


class UnsupportedInteractionActionError(Exception):
    def __init__(self, action: str) -> None:
        self.action = action
        super().__init__(action)


async def process_external_interaction(
    db: AsyncSession,
    play_session_id: str,
    request: InteractionApiRequest,
) -> InteractionProcessResult:
    client_event_id = str(request.client_event_id)

    if isinstance(request, InputInteractionRequest):
        try:
            play_session = await get_play_session(db, play_session_id)
            client_content = load_case_client_content(play_session.case_id)
            resolved = resolve_object_interaction(
                client_content,
                request.zone_id,
                request.target_id,
                request.action,
            )
        except Exception:
            await db.rollback()
            raise

        interaction = SubmitAnswerInteraction(
            client_event_id=client_event_id,
            client_timestamp=request.client_timestamp,
            interaction_type="submit_answer",
            target_id=resolved.target_id,
            payload=SubmitAnswerPayload(answer=request.payload.answer),
        )
    elif isinstance(request, CombineCluesInteractionRequest):
        interaction = CombineCluesInteraction(
            client_event_id=client_event_id,
            client_timestamp=request.client_timestamp,
            interaction_type="combine_clues",
            payload=CombineCluesPayload(clue_ids=request.payload.clue_ids),
        )
    else:
        raise UnsupportedInteractionActionError(request.action)

    return await process_interaction(
        db=db,
        play_session_id=play_session_id,
        interaction=interaction,
    )
