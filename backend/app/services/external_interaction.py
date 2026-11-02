from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.interaction import (
    CombineCluesInteraction,
    CombineCluesPayload,
    InspectInteraction,
    InspectPayload,
    InteractionProcessResult,
    NavigateInteraction,
    NavigatePayload,
    SubmitAnswerInteraction,
    SubmitAnswerPayload,
)
from app.schemas.interaction_api import (
    CombineCluesInteractionRequest,
    InputInteractionRequest,
    InspectInteractionRequest,
    InteractionApiRequest,
    NavigateInteractionRequest,
)
from app.services.case_content import load_case_client_content
from app.services.interaction import process_interaction
from app.services.object_resolver import (
    ResolvedObjectInteraction,
    resolve_object_interaction,
)
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
        resolved = await _resolve_object_request(db, play_session_id, request)
        interaction = SubmitAnswerInteraction(
            client_event_id=client_event_id,
            client_timestamp=request.client_timestamp,
            interaction_type="submit_answer",
            target_id=resolved.target_id,
            zone_id=resolved.zone_id,
            payload=SubmitAnswerPayload(answer=request.payload.answer),
        )
    elif isinstance(request, InspectInteractionRequest):
        resolved = await _resolve_object_request(db, play_session_id, request)
        interaction = InspectInteraction(
            client_event_id=client_event_id,
            client_timestamp=request.client_timestamp,
            interaction_type="inspect",
            target_id=resolved.target_id,
            zone_id=resolved.zone_id,
            object_id=resolved.object_id,
            payload=InspectPayload(),
        )
    elif isinstance(request, NavigateInteractionRequest):
        # 문과 목적지 판정은 재전송 확인 뒤 세션 잠금 안에서 한다.
        interaction = NavigateInteraction(
            client_event_id=client_event_id,
            client_timestamp=request.client_timestamp,
            interaction_type="navigate",
            target_id=request.target_id,
            zone_id=request.zone_id,
            payload=NavigatePayload(),
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


async def _resolve_object_request(
    db: AsyncSession,
    play_session_id: str,
    request: InputInteractionRequest | InspectInteractionRequest,
) -> ResolvedObjectInteraction:
    try:
        play_session = await get_play_session(db, play_session_id)
        client_content = load_case_client_content(play_session.case_id)
        return resolve_object_interaction(
            client_content,
            request.zone_id,
            request.target_id,
            request.action,
        )
    except Exception:
        await db.rollback()
        raise
