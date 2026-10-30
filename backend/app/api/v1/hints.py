"""정식 Hint API v0.2 (PM v0.4.8 §4 · §5 · v0.4.9 §1 · §3 · §7). 힌트 잔액 · 원자적 차감만.

`POST /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints`

- 세션이 고정한 콘텐츠 버전의 server.json 원문만 쓴다. 버전을 쓸 수 없으면 차감 없이 409 `CASE_VERSION_UNAVAILABLE`.
- 새 단계: 단계 +1 · 잔액 −1 · `help_used` +1을 한 commit에 저장한다. 잔액 0이면 409 `HINT_BALANCE_EMPTY`.
- 이미 연 단계(재열람): 무료. 같은 `client_event_id` 재전송: 처음 결과 그대로.
- 게시 상태(긴급 차단)는 보지 않는다. 차단 중에도 승인 원문을 준다(v0.4.9 §3).
- LLM 표현 생성 · `hint_ref` 요청 · 미니게임 충전은 아직 없다.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.hint import HintUnlockProcessResult, HintUnlockRequest
from app.schemas.puzzle_runtime import PuzzleDefinition
from app.services.hint import (
    HintAccessDeniedError,
    HintAccessPolicy,
    HintLevelSkippedError,
    HintNotFoundError,
    InvalidHintStateError,
    unlock_hint,
)
from app.services.hint_balance import (
    HINT_BALANCE_EMPTY,
    HintBalanceEmptyError,
    HintEconomyConfig,
    hint_economy_config,
)
from app.services.interaction import IdempotencyConflictError, PuzzleNotFoundError
from app.services.pinned_content import PinnedContentStore
from app.services.play_session import PlaySessionNotFoundError
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    CONTENT_VERSION_ERRORS,
    get_pinned_content_store,
    resolve_session_hint_loaders,
)

router = APIRouter(
    prefix="/play-sessions",
    tags=["Hints"],
)


def allow_hint_access(
    state: dict[str, Any], puzzle: PuzzleDefinition, level: int
) -> None:
    """Zone · 완료 퍼즐 · 선행 단서 조건은 PM 미결정이다(hint_api_v0.1 §3). 지금은 제한하지 않는다."""


def get_hint_access_policy() -> HintAccessPolicy:
    return allow_hint_access


def get_hint_economy_config() -> HintEconomyConfig:
    return hint_economy_config()


@router.post(
    "/{play_session_id}/puzzles/{puzzle_id}/hints",
    response_model=HintUnlockProcessResult,
    status_code=status.HTTP_200_OK,
)
async def unlock_hint_endpoint(
    play_session_id: UUID,
    puzzle_id: str,
    request: HintUnlockRequest,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
    access_policy: HintAccessPolicy = Depends(get_hint_access_policy),
    economy: HintEconomyConfig = Depends(get_hint_economy_config),
) -> HintUnlockProcessResult:
    try:
        loaders = await resolve_session_hint_loaders(
            db, str(play_session_id), content_store
        )
        return await unlock_hint(
            db,
            str(play_session_id),
            puzzle_id,
            request,
            hint_source=loaders.hint_source,
            access_policy=access_policy,
            runtime_loader=loaders.runtime_loader,
            economy=economy,
        )
    except HintBalanceEmptyError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": HINT_BALANCE_EMPTY,
                "message": "Hint balance is empty.",
                "minigames_left": error.allowance.minigames_left,
                "special_minigame_available": error.allowance.special_minigame_available,
            },
        ) from error
    except PlaySessionNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Play session not found.",
        ) from error
    except CONTENT_VERSION_ERRORS as error:
        # 고정 콘텐츠 버전이 없거나 쓸 수 없다(최신 버전으로 바꾸지 않는다). 차감하지 않았다.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CASE_VERSION_UNAVAILABLE,
        ) from error
    except PuzzleNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Puzzle not found.",
        ) from error
    except HintNotFoundError as error:
        # 오류에는 퍼즐 · 단계 · 원문을 싣지 않는다.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hint not found.",
        ) from error
    except HintLevelSkippedError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Previous hint level is not unlocked.",
        ) from error
    except HintAccessDeniedError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Hint is not available yet.",
        ) from error
    except IdempotencyConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Client event ID conflicts with a previous interaction.",
        ) from error
    except InvalidHintStateError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Hint state is invalid.",
        ) from error
