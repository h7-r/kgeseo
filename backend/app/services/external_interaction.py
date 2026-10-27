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
from app.services.interaction import (
    ClientContentLoader,
    RuntimeLoader,
    process_interaction,
)
from app.services.object_resolver import (
    ResolvedObjectInteraction,
    resolve_object_interaction,
)
from app.services.pinned_content import ensure_loaders_match_session
from app.services.play_session import get_play_session
from app.services.puzzle_runtime import load_case_runtime


class UnsupportedInteractionActionError(Exception):
    def __init__(self, action: str) -> None:
        self.action = action
        super().__init__(action)


async def process_external_interaction(
    db: AsyncSession,
    play_session_id: str,
    request: InteractionApiRequest,
    *,
    runtime_loader: RuntimeLoader = load_case_runtime,
    client_content_loader: ClientContentLoader = load_case_client_content,
) -> InteractionProcessResult:
    client_event_id = str(request.client_event_id)

    if isinstance(request, InputInteractionRequest):
        resolved = await _resolve_object_request(
            db, play_session_id, request, client_content_loader
        )
        interaction = SubmitAnswerInteraction(
            client_event_id=client_event_id,
            client_timestamp=request.client_timestamp,
            interaction_type="submit_answer",
            target_id=resolved.target_id,
            zone_id=resolved.zone_id,
            payload=SubmitAnswerPayload(answer=request.payload.answer),
        )
    elif isinstance(request, InspectInteractionRequest):
        resolved = await _resolve_object_request(
            db, play_session_id, request, client_content_loader
        )
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
        runtime_loader=runtime_loader,
        client_content_loader=client_content_loader,
    )


async def _resolve_object_request(
    db: AsyncSession,
    play_session_id: str,
    request: InputInteractionRequest | InspectInteractionRequest,
    client_content_loader: ClientContentLoader,
) -> ResolvedObjectInteraction:
    try:
        play_session = await get_play_session(db, play_session_id)
        # Object 해석도 세션이 고정한 버전의 Client 콘텐츠로 한다.
        ensure_loaders_match_session(play_session, client_content_loader)
        client_content = client_content_loader(play_session.case_id)
        return resolve_object_interaction(
            client_content,
            request.zone_id,
            request.target_id,
            request.action,
        )
    except Exception:
        await db.rollback()
        raise
