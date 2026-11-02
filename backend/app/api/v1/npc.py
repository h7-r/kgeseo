from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.npc_content import GeneralLinePack
from app.schemas.npc_turn import NpcTurnRequest, NpcTurnResponse
from app.services.approval_history import ApprovalSource
from app.services.interaction import IdempotencyConflictError
from app.services.npc import NpcContentUnsafeError
from app.services.npc_turn_service import (
    GENERATION_OFF,
    EventLoader,
    NpcContentUnavailableError,
    NpcGenerationConfig,
    load_session_events,
    process_npc_turn,
)
from app.services.pinned_content import PinnedContentStore
from app.services.play_session import PlaySessionNotFoundError
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    CONTENT_VERSION_ERRORS,
    get_pinned_content_store,
)

router = APIRouter(
    prefix="/play-sessions",
    tags=["NPC"],
)


# --- 의존성 (운영 기본값: 승인 정보 없음 · 일반 팩 없음 · 생성 OFF) ---


def get_npc_approval_source() -> ApprovalSource | None:
    """케이스 콘텐츠 G1~G3 승인 이력. 영속 저장소가 아직 없어 기본은 None(모든 대사 미승인)."""

    return None


def get_general_line_pack() -> tuple[GeneralLinePack | None, ApprovalSource | None]:
    """일반 팩과 그 승인 이력. 게시 절차가 아직 없어 기본은 (None, None)."""

    return None, None


def get_npc_generation() -> NpcGenerationConfig:
    """일반 대화 생성 스위치. 운영에서는 OFF 다(사람 검수 전 활성화 금지)."""

    return GENERATION_OFF


def get_npc_event_loader() -> EventLoader:
    return load_session_events


@router.post(
    "/{play_session_id}/npc/turns",
    response_model=NpcTurnResponse,
    status_code=status.HTTP_200_OK,
)
async def create_npc_turn_endpoint(
    play_session_id: UUID,
    request: NpcTurnRequest,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
    approval_source: ApprovalSource | None = Depends(get_npc_approval_source),
    general_pack: tuple = Depends(get_general_line_pack),
    generation: NpcGenerationConfig = Depends(get_npc_generation),
    event_loader: EventLoader = Depends(get_npc_event_loader),
) -> NpcTurnResponse:
    pack, pack_approval = general_pack
    try:
        return await process_npc_turn(
            db,
            str(play_session_id),
            request,
            store=content_store,
            approval_source=approval_source,
            general_pack=pack,
            general_pack_approval=pack_approval,
            generation=generation,
            event_loader=event_loader,
        )
    except PlaySessionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        ) from error
    except (NpcContentUnavailableError, *CONTENT_VERSION_ERRORS) as error:
        # 고정 콘텐츠 버전이 없거나 쓸 수 없다(최신 버전으로 바꾸지 않는다).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CASE_VERSION_UNAVAILABLE,
        ) from error
    except IdempotencyConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Client event ID conflicts with a previous interaction.",
        ) from error
    except NpcContentUnsafeError as error:
        # 승인 대사에 정답 · 힌트 원문이 섞였다. 콘텐츠를 고쳐야 한다(원문은 알리지 않는다).
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="NPC content is unavailable.",
        ) from error
