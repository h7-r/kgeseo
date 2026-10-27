"""정식 Hint API 공통 서비스 (팀 검토 대기, 라우터 미등록).

힌트 단계(PlaySession `hint_levels`)를 바꾸는 곳은 이 서비스뿐이다. 다음은 PM 결정 전이라
서비스가 정하지 않고 호출하는 쪽이 넘긴다.

- 힌트 원문 위치: `hint_source` (콘텐츠 필드 위치 미정)
- 새 단계 해금의 접근 조건(Zone · 완료한 퍼즐 · 선행 단서): `access_policy`

힌트 원문은 이벤트에 저장하지 않는다. 응답할 때마다 `hint_source`에서 읽는다.
"""

import asyncio
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.hint import (
    MAX_HINT_LEVEL,
    HintText,
    HintUnlockProcessResult,
    HintUnlockRequest,
    HintUnlockResult,
    HintUnlockResultType,
    PuzzleHintState,
)
from app.schemas.interaction import HintLevelChangedStateChange
from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleDefinition, PuzzleRuntimeDefinition
from app.services.interaction import (
    IdempotencyConflictError,
    PuzzleNotFoundError,
    _find_interaction_event,
    _get_play_session_for_update,
    _is_same_request,
    _to_db_datetime,
)
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import load_case_runtime

RuntimeLoader = Callable[[str], PuzzleRuntimeDefinition]
# (case_id, puzzle_id, level) -> 원문. 정의가 없으면 None.
HintSource = Callable[[str, str, int], str | None]
# 새 단계를 해금하기 직전에 호출한다. 허용하지 않으면 HintAccessDeniedError를 던진다.
HintAccessPolicy = Callable[[dict[str, Any], PuzzleDefinition, int], None]

# interaction_events.interaction_type. Interaction API의 action과 겹치지 않는다.
HINT_INTERACTION_TYPE = "unlock_hint"


class HintServiceError(Exception):
    pass


class HintNotFoundError(HintServiceError):
    """요청한 단계의 힌트가 정의되어 있지 않다."""


class HintLevelSkippedError(HintServiceError):
    """이전 단계를 열지 않고 다음 단계를 요청했다."""


class HintAccessDeniedError(HintServiceError):
    """접근 조건(access_policy)이 새 단계 해금을 허용하지 않았다."""


class InvalidHintStateError(HintServiceError):
    """저장된 hint_levels 값이 0~MAX_HINT_LEVEL 정수가 아니다."""


async def unlock_hint(
    db: AsyncSession,
    play_session_id: str,
    puzzle_id: str,
    request: HintUnlockRequest,
    *,
    hint_source: HintSource,
    access_policy: HintAccessPolicy,
    runtime_loader: RuntimeLoader = load_case_runtime,
) -> HintUnlockProcessResult:
    payload_json = {"target_level": request.target_level}
    try:
        play_session = await _get_play_session_for_update(db, play_session_id)
        if play_session is None:
            raise PlaySessionNotFoundError()

        existing_event = await _find_interaction_event(
            db, play_session_id, request.client_event_id
        )
        if existing_event is not None:
            result = _replay_existing_event(
                existing_event, puzzle_id=puzzle_id, payload_json=payload_json
            )
            await db.rollback()
            return _with_text(
                existing_event.id,
                result,
                request.target_level,
                _require_hint_text(
                    hint_source, play_session.case_id, puzzle_id, request.target_level
                ),
            )

        runtime = runtime_loader(play_session.case_id)
        puzzle = _find_puzzle(runtime, puzzle_id)
        text = _require_hint_text(
            hint_source, play_session.case_id, puzzle_id, request.target_level
        )
        current_state = deepcopy(play_session.state_json)
        current_level = _current_hint_level(current_state, puzzle_id)

        result_type: HintUnlockResultType
        if request.target_level <= current_level:
            # 이미 연 단계는 다시 해금하지 않는다. 사용 횟수에 넣지 않도록 변화도 없다.
            result_type = "already_unlocked"
            result_state = current_state
            state_changes: list[HintLevelChangedStateChange] = []
        else:
            if request.target_level != current_level + 1:
                raise HintLevelSkippedError(puzzle_id)
            access_policy(current_state, puzzle, request.target_level)
            result_type = "hint_unlocked"
            result_state = deepcopy(current_state)
            result_state.setdefault("hint_levels", {})[puzzle_id] = request.target_level
            state_changes = [
                HintLevelChangedStateChange(
                    type="hint_level_changed",
                    puzzle_id=puzzle_id,
                    hint_level=request.target_level,
                ),
            ]

        result = HintUnlockResult(
            result_type=result_type,
            puzzle_id=puzzle_id,
            hint_level=_current_hint_level(result_state, puzzle_id),
            state=PlaySessionState.model_validate(result_state),
            state_changes=state_changes,
        )
        now_db = datetime.now(timezone.utc).replace(tzinfo=None)
        interaction_id = str(uuid4())

        if result_state != current_state:
            play_session.state_json = result_state
            play_session.updated_at = now_db

        db.add(
            InteractionEvent(
                id=interaction_id,
                play_session_id=play_session_id,
                client_event_id=request.client_event_id,
                client_timestamp=_to_db_datetime(request.client_timestamp),
                interaction_type=HINT_INTERACTION_TYPE,
                target_id=puzzle_id,
                payload_json=payload_json,
                result_type=result_type,
                response_json=result.model_dump(mode="json"),
                created_at=now_db,
            )
        )

        try:
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            existing_event = await _find_interaction_event(
                db, play_session_id, request.client_event_id
            )
            if existing_event is None:
                raise error
            result = _replay_existing_event(
                existing_event, puzzle_id=puzzle_id, payload_json=payload_json
            )
            await db.rollback()
            return _with_text(existing_event.id, result, request.target_level, text)
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    return _with_text(interaction_id, result, request.target_level, text)


async def get_puzzle_hint_state(
    db: AsyncSession,
    play_session_id: str,
    puzzle_id: str,
    *,
    hint_source: HintSource,
    runtime_loader: RuntimeLoader = load_case_runtime,
) -> PuzzleHintState:
    """현재 단계와 해금한 단계의 원문을 돌려준다. 상태 · 이벤트를 바꾸지 않는다."""

    play_session = await db.get(PlaySession, play_session_id)
    if play_session is None:
        raise PlaySessionNotFoundError()

    _find_puzzle(runtime_loader(play_session.case_id), puzzle_id)
    current_level = _current_hint_level(play_session.state_json, puzzle_id)
    return PuzzleHintState(
        puzzle_id=puzzle_id,
        hint_level=current_level,
        unlocked=[
            HintText(
                level=level,
                text=_require_hint_text(
                    hint_source, play_session.case_id, puzzle_id, level
                ),
            )
            for level in range(1, current_level + 1)
        ],
    )


def _find_puzzle(runtime: PuzzleRuntimeDefinition, puzzle_id: str) -> PuzzleDefinition:
    puzzle = next(
        (puzzle for puzzle in runtime.puzzles if puzzle.puzzle_id == puzzle_id),
        None,
    )
    if puzzle is None:
        raise PuzzleNotFoundError(puzzle_id)
    return puzzle


def _current_hint_level(state: dict[str, Any], puzzle_id: str) -> int:
    level = state.get("hint_levels", {}).get(puzzle_id, 0)
    if isinstance(level, bool) or not isinstance(level, int):
        raise InvalidHintStateError(puzzle_id)
    if not 0 <= level <= MAX_HINT_LEVEL:
        raise InvalidHintStateError(puzzle_id)
    return level


def _require_hint_text(
    hint_source: HintSource,
    case_id: str,
    puzzle_id: str,
    level: int,
) -> str:
    text = hint_source(case_id, puzzle_id, level)
    if text is None or not text.strip():
        # 오류에는 퍼즐 ID와 단계만 싣는다.
        raise HintNotFoundError(f"{puzzle_id}:{level}")
    return text


def _replay_existing_event(
    event: InteractionEvent,
    *,
    puzzle_id: str,
    payload_json: dict[str, Any],
) -> HintUnlockResult:
    if not _is_same_request(
        event,
        interaction_type=HINT_INTERACTION_TYPE,
        target_id=puzzle_id,
        payload_json=payload_json,
    ):
        raise IdempotencyConflictError()
    return HintUnlockResult.model_validate(event.response_json)


def _with_text(
    interaction_id: str,
    result: HintUnlockResult,
    level: int,
    text: str,
) -> HintUnlockProcessResult:
    return HintUnlockProcessResult(
        interaction_id=interaction_id,
        result=result,
        hint=HintText(level=level, text=text),
    )
