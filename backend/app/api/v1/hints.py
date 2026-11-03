"""정식 Hint API v0.3 (PM v0.4.10 §1 · v0.4.9 · v0.4.8). 해금 · 잔액 차감 · `help_used`는 Hint 서비스 하나가 한다.

- 정식 경로 `POST /api/v1/play-sessions/{play_session_id}/hints`
  - `puzzle_id`(힌트 버튼) 또는 `hint_ref`(NPC 제안 수락) 중 정확히 하나. 둘 다 없거나 둘 다 있으면 422.
- 호환 별칭 `POST /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints`
  - FE가 옮길 때까지만 둔다. 같은 처리 함수 → 같은 Hint 서비스를 부른다(차감 로직 중복 없음).
- 세션이 고정한 콘텐츠 버전의 원문만 쓴다. 버전을 쓸 수 없으면 차감 없이 409 `CASE_VERSION_UNAVAILABLE`.
- 새 단계는 발견한 퍼즐에만 연다(`app.services.hint_access`). 발견하지 않은 퍼즐은 없는 퍼즐과 같은 404.
- 이미 연 단계(재열람)는 잔액 0이어도 무료. 같은 `client_event_id` 재전송은 처음 결과 그대로.
- 레거시 세션(버전 없음)의 케이스 파일이 없으면 차감 없이 404 `Case not found.`, 파일이 깨졌으면
  500 `Case content is unavailable.`(세션 번들 `GET /play-sessions/{id}/bundle`과 같은 매핑).
- 게시 상태(긴급 차단)는 보지 않는다. 차단 중에도 승인 원문을 준다(v0.4.9 §3).
- LLM 표현 생성 · 미니게임 충전은 아직 없다. NPC 턴(`/npc/turns`)에는 차감 경로가 없다.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.api.v1.npc import get_hint_ref_keys
from app.db.session import get_db
from app.schemas.hint import HintApiRequest, HintUnlockProcessResult, HintUnlockRequest
from app.services.case_content import (
    CaseClientContentError,
    CaseClientContentNotFoundError,
)
from app.services.hint import (
    HintAccessDeniedError,
    HintLevelSkippedError,
    HintNotFoundError,
    InvalidHintStateError,
    unlock_hint,
)
from app.services.hint_access import (
    HintAccessRules,
    HintCluesMissingError,
    PuzzleNotDiscoveredError,
    resolve_hint_target,
    server_state_access_policy,
)
from app.services.hint_balance import (
    HINT_BALANCE_EMPTY,
    HintBalanceEmptyError,
    HintEconomyConfig,
    hint_economy_config,
)
from app.services.hint_ref import (
    HintRefFormatError,
    HintRefKeys,
    HintRefKeyUnavailableError,
    HintRefMismatchError,
)
from app.services.interaction import IdempotencyConflictError, PuzzleNotFoundError
from app.services.pinned_content import PinnedContentStore
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import CaseRuntimeNotFoundError, PuzzleRuntimeError
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

PUZZLE_NOT_FOUND = "Puzzle not found."
CASE_NOT_FOUND = "Case not found."
CASE_CONTENT_UNAVAILABLE = "Case content is unavailable."


def get_hint_access_rules() -> HintAccessRules:
    """서버 상태 접근 조건. 선행 단서 적용 여부는 PM 미결정이라 기본은 미적용이다."""

    return HintAccessRules()


def get_hint_economy_config() -> HintEconomyConfig:
    return hint_economy_config()


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"code": code, "message": message}
    )


async def _process_hint_request(
    db: AsyncSession,
    play_session_id: str,
    request: HintApiRequest,
    *,
    content_store: PinnedContentStore,
    hint_ref_keys: HintRefKeys | None,
    rules: HintAccessRules,
    economy: HintEconomyConfig,
) -> HintUnlockProcessResult | JSONResponse:
    try:
        loaders = await resolve_session_hint_loaders(db, play_session_id, content_store)
        if loaders.case_id is None:
            raise PlaySessionNotFoundError()
        puzzle_id = resolve_hint_target(
            puzzle_id=request.puzzle_id,
            hint_ref=request.hint_ref,
            play_session_id=play_session_id,
            content_fingerprint=loaders.content_fingerprint,
            runtime=loaders.runtime_loader(loaders.case_id),
            keys=hint_ref_keys,
        )
        return await unlock_hint(
            db,
            play_session_id,
            puzzle_id,
            request.unlock_request(),
            hint_source=loaders.hint_source,
            access_policy=server_state_access_policy(
                loaders.case_id, loaders.client_content_loader, rules
            ),
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
    except HintRefFormatError as error:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "HINT_REF_INVALID",
            "Hint reference is malformed.",
        ) from error
    except HintRefMismatchError as error:
        # 다른 세션 · 다른 지문 · 위조. 어느 퍼즐인지는 알리지 않는다.
        raise _error(
            status.HTTP_409_CONFLICT,
            "HINT_REF_MISMATCH",
            "Hint reference does not match this play session.",
        ) from error
    except HintRefKeyUnavailableError as error:
        # 검증 키가 없거나 그 key id를 모른다(운영 설정 문제).
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "HINT_REF_UNAVAILABLE",
            "Hint reference cannot be verified.",
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
    except (PuzzleNotFoundError, PuzzleNotDiscoveredError) as error:
        # 발견하지 않은 퍼즐은 없는 퍼즐과 같은 응답이다.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=PUZZLE_NOT_FOUND,
        ) from error
    except HintCluesMissingError as error:
        # Interaction API와 같은 형식. 단서 ID 대신 부족한 개수만 싣는다.
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": "Required clues are not acquired.",
                "missing_clue_count": error.missing_clue_count,
            },
        )
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
    except (CaseClientContentNotFoundError, CaseRuntimeNotFoundError) as error:
        # 레거시 세션이 가리키는 케이스 파일이 없다(고정 세션은 게시 묶음을 쓰므로 해당 없음). 차감하지 않았다.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=CASE_NOT_FOUND,
        ) from error
    except (CaseClientContentError, PuzzleRuntimeError) as error:
        # 케이스 파일을 읽었지만 형식 · 검증 오류다. 파일 경로 · 예외 내용은 싣지 않는다.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=CASE_CONTENT_UNAVAILABLE,
        ) from error
    except InvalidHintStateError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Hint state is invalid.",
        ) from error


@router.post(
    "/{play_session_id}/hints",
    response_model=HintUnlockProcessResult,
    status_code=status.HTTP_200_OK,
    responses=error_responses.HINT,
)
async def request_hint_endpoint(
    play_session_id: UUID,
    request: HintApiRequest,
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
    hint_ref_keys: HintRefKeys | None = Depends(get_hint_ref_keys),
    rules: HintAccessRules = Depends(get_hint_access_rules),
    economy: HintEconomyConfig = Depends(get_hint_economy_config),
):
    return await _process_hint_request(
        db,
        str(play_session_id),
        request,
        content_store=content_store,
        hint_ref_keys=hint_ref_keys,
        rules=rules,
        economy=economy,
    )


@router.post(
    "/{play_session_id}/puzzles/{puzzle_id}/hints",
    response_model=HintUnlockProcessResult,
    status_code=status.HTTP_200_OK,
    deprecated=True,
    responses=error_responses.HINT_ALIAS,
)
async def unlock_hint_alias_endpoint(
    play_session_id: UUID,
    request: HintUnlockRequest,
    puzzle_id: str = Path(min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
    content_store: PinnedContentStore = Depends(get_pinned_content_store),
    rules: HintAccessRules = Depends(get_hint_access_rules),
    economy: HintEconomyConfig = Depends(get_hint_economy_config),
):
    """호환 별칭(PM v0.4.10 §1). 정식 경로와 같은 처리 함수를 부른다. FE 이전 뒤 없앤다."""

    return await _process_hint_request(
        db,
        str(play_session_id),
        HintApiRequest(
            client_event_id=request.client_event_id,
            client_timestamp=request.client_timestamp,
            target_level=request.target_level,
            puzzle_id=puzzle_id,
        ),
        content_store=content_store,
        hint_ref_keys=None,
        rules=rules,
        economy=economy,
    )
