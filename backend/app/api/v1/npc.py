import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.core.config import settings
from app.db.session import get_db
from app.schemas.npc_content import GeneralLinePack
from app.schemas.npc_turn import NpcTurnRequest, NpcTurnResponse
from app.services.approval_history import ApprovalSource
from app.services.dialogue_pack_policy import (
    DialoguePackPolicy,
    published_cases_policy,
)
from app.services.hint_balance import HintRefKeyConfigError, hint_ref_keys_from_settings
from app.services.hint_ref import HintRefKeys
from app.services.interaction import IdempotencyConflictError
from app.services.npc import NpcContentUnsafeError
from app.services.npc_case_access import CaseAccessReader, read_case_npc_access
from app.services.npc_general_pack import (
    GeneralPackReader,
    configured_general_pack,
    read_general_pack_access,
    read_published_cases,
)
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

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/play-sessions",
    tags=["NPC"],
)


# --- 의존성 (운영 기본값: 승인 정보 없음 · 일반 팩 없음 · 생성 OFF) ---


def get_npc_case_access_reader() -> CaseAccessReader:
    """케이스 대사 승인(`npc_approval_reviews`의 case_content) · 게시 상태 판정. 기록이 없거나 DB를 읽지 못하면
    케이스 대사는 모두 미승인이고, 긴급 차단이면 NPC_CONTENT_WITHDRAWN이다."""

    return read_case_npc_access


def get_general_line_pack() -> tuple[GeneralLinePack | None, ApprovalSource | None]:
    """일반 팩과 (대역용) 고정 승인 출처. 운영은 설정 `NPC_GENERAL_PACK`의 공식 팩 파일과 None이다.

    설정이 비었거나 파일을 읽지 못하면 (None, None)(기본). 운영 승인은 고정 출처가 아니라
    `get_general_pack_access_reader`가 DB에서 매 턴 읽는다.
    """

    return configured_general_pack(settings.npc_general_pack), None


def get_general_pack_access_reader() -> GeneralPackReader:
    """일반 팩 승인(`npc_approval_reviews`의 dialogue_pack) 판정. 기록이 없거나 DB를 읽지 못하면 미승인이다."""

    return read_general_pack_access


async def get_general_pack_policy(
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
) -> DialoguePackPolicy:
    """일반 팩 정책 검사(PM v0.4.14 §A). 요청마다 게시 케이스(DB 게시 상태 + 저장소 게시본)를 읽어 고정한다.

    게시 케이스를 확인할 수 없으면 GEN-LEAK · GEN-CASE가 UNVERIFIED라 일반 팩을 쓰지 않는다(fail closed).
    게시본의 proper_nouns 또는 ng 검수 데이터가 없으면 UNVERIFIED다(`dialogue_pack_policy`).
    """

    return published_cases_policy(await read_published_cases(db, content_store))


def get_npc_generation() -> NpcGenerationConfig:
    """일반 대화 생성 스위치. 운영에서는 OFF 다(사람 검수 전 활성화 금지)."""

    return GENERATION_OFF


def get_npc_event_loader() -> EventLoader:
    return load_session_events


def get_hint_ref_keys() -> HintRefKeys | None:
    """hint_ref 발급 키. 환경 변수 `HINT_REF_CURRENT_KEY_ID` · `HINT_REF_KEYS`(비밀)에서 읽는다.

    둘 다 비어 있으면 None(suggest_hint를 내지 않음, fail closed). 형식이 틀리면 키를 쓰지 않고 None으로
    두되 오류를 남긴다(비밀 값은 남기지 않는다). NPC 턴 자체는 막지 않는다.
    """

    try:
        return hint_ref_keys_from_settings()
    except HintRefKeyConfigError:
        logger.error("hint_ref key configuration is invalid; suggest_hint disabled")
        return None


@router.post(
    "/{play_session_id}/npc/turns",
    response_model=NpcTurnResponse,
    status_code=status.HTTP_200_OK,
    responses=error_responses.NPC_TURN,
)
async def create_npc_turn_endpoint(
    play_session_id: UUID,
    request: NpcTurnRequest,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
    case_access: CaseAccessReader = Depends(get_npc_case_access_reader),
    general_pack: tuple = Depends(get_general_line_pack),
    general_pack_reader: GeneralPackReader = Depends(get_general_pack_access_reader),
    general_pack_policy: DialoguePackPolicy = Depends(get_general_pack_policy),
    generation: NpcGenerationConfig = Depends(get_npc_generation),
    event_loader: EventLoader = Depends(get_npc_event_loader),
    hint_ref_keys: HintRefKeys | None = Depends(get_hint_ref_keys),
) -> NpcTurnResponse:
    pack, pack_approval = general_pack
    try:
        return await process_npc_turn(
            db,
            str(play_session_id),
            request,
            store=content_store,
            case_access=case_access,
            general_pack=pack,
            # 대역이 고정 승인 출처를 넘기면 그것을, 아니면 DB 판정을 쓴다.
            general_pack_approval=pack_approval,
            general_pack_access=None
            if pack_approval is not None
            else general_pack_reader,
            general_pack_policy=general_pack_policy,
            generation=generation,
            event_loader=event_loader,
            hint_ref_keys=hint_ref_keys,
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
