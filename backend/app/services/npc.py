"""NPC 서비스 코어 v0.1 (팀 검토 대기, 라우터 미등록).

NPC는 게임 진행 상태를 바꾸지 않는다. 승인된 nudge 문장을 내주거나, 플레이어가 Hint API로
이미 해금한 정식 힌트 한 단계를 다시 보여 주고, 그 사실을 이벤트로 남기기만 한다.

- `state_json` · `hint_levels`를 쓰지 않고 `hint_level_changed`를 만들지 않는다.
  그래서 PlaySession 행 잠금을 잡지 않는다. 트랜잭션은 이벤트 한 줄 INSERT뿐이다.
- 승인 콘텐츠(`npc.json` 위치 미정)와 힌트 원문은 호출하는 쪽이 넘긴다. 힌트 원문의 공식 원본은
  server.json `puzzles[].hints[]`이며 `app.services.hint.server_hint_source()`로 만든다.
- 대사 · 힌트 원문은 이벤트에 저장하지 않는다. 응답할 때마다 원본에서 읽는다.
- 요청의 `trigger`는 인가 근거가 아니다(플레이어가 실제로 눌렀다는 증명이 아니다).
  허용 판정은 늘 서버의 `hint_levels`로 한다. 다만 자동 도움 제안은 nudge만 쓰므로,
  `trigger="auto_help_offer"`라고 밝힌 재표시 요청은 단계와 상관없이 거부한다
  (정직한 클라이언트의 실수를 막는 장치일 뿐, 값을 빼거나 바꾼 요청은 막지 못한다).

[정답 차단의 한계] 문자열 포함 검사다(공백 제거 · 대소문자 무시). 다음은 막지 못한다.
- `MIN_ANSWER_LENGTH_FOR_LINE_CHECK`보다 짧은(1자) 정답
- 같은 뜻의 다른 표현 · 동의어 · 숫자를 글자로 쓴 것 · 글자 사이 기호 · 순서 바꿈 · 일부만 쓴 것
- 정답을 직접 쓰지 않고 풀이를 암시하는 문장
그래서 승인 대사는 기획 G3 검수가 1차 방어선이고, 이 검사는 검수 누락을 잡는 보조 장치다.
"""

import asyncio
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.npc import (
    ApprovedNpcLine,
    NpcEventRecord,
    NpcHintReshowRequest,
    NpcLineText,
    NpcNudgeRequest,
    NpcProcessResult,
    NpcRequest,
    ReshownHint,
)
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import (
    HintSource,
    _current_hint_level,
    _find_puzzle,
    _require_hint_text,
)
from app.services.interaction import (
    IdempotencyConflictError,
    _find_interaction_event,
    _is_same_request,
    _to_db_datetime,
)
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import load_case_runtime, normalize_answer

RuntimeLoader = Callable[[str], PuzzleRuntimeDefinition]
# (case_id, npc_id, line_id) -> 승인 콘텐츠 한 줄. 없으면 None.
NpcLineSource = Callable[[str, str, str], ApprovedNpcLine | None]

NPC_NUDGE_EVENT_TYPE = "npc_nudge_given"
NPC_HINT_RESHOWN_EVENT_TYPE = "npc_hint_reshown"

# 자동 도움 제안 흐름이 밝히는 출처. 이 출처의 재표시 요청은 받지 않는다.
AUTO_HELP_OFFER_TRIGGER = "auto_help_offer"

# 이보다 짧은 정답은 대사 속 우연한 글자와 구별할 수 없어 대사 검사에서 뺀다.
MIN_ANSWER_LENGTH_FOR_LINE_CHECK = 2


class NpcServiceError(Exception):
    pass


class NpcLineNotFoundError(NpcServiceError):
    """대사가 없거나 · 승인되지 않았거나 · nudge가 아니거나 · ID가 다르다(구분해 알리지 않는다)."""


class NpcLineScopeError(NpcServiceError):
    """퍼즐 범위 대사인데 요청 퍼즐이 다르거나 없다."""


class HintNotUnlockedError(NpcServiceError):
    """서버의 현재 해금 단계가 요청 단계보다 낮다. 현재 단계는 알리지 않는다."""


class NpcContentUnsafeError(NpcServiceError):
    """내보낼 원문에 정답 · 다른 힌트 원문이 들어 있다. 콘텐츠를 고쳐야 한다."""


class NpcReshowNotAllowedError(NpcServiceError):
    """자동 도움 제안 출처의 재표시 요청이다. 자동 도움 제안은 nudge만 쓴다."""


async def process_npc_request(
    db: AsyncSession,
    play_session_id: str,
    request: NpcRequest,
    *,
    line_source: NpcLineSource,
    hint_source: HintSource,
    runtime_loader: RuntimeLoader = load_case_runtime,
) -> NpcProcessResult:
    event_type, target_id, payload_json = _request_values(request)
    try:
        # NPC는 상태를 쓰지 않으므로 잠그지 않는다.
        play_session = await db.get(PlaySession, play_session_id)
        if play_session is None:
            raise PlaySessionNotFoundError()
        # rollback은 ORM 객체를 만료시키므로 판정에 쓸 값은 먼저 읽어 둔다.
        case_id = play_session.case_id
        state = play_session.state_json

        existing_event = await _find_interaction_event(
            db, play_session_id, request.client_event_id
        )
        if existing_event is not None:
            record = _replay_existing_event(
                existing_event,
                event_type=event_type,
                target_id=target_id,
                payload_json=payload_json,
            )
            event_id = existing_event.id
            await db.rollback()
            line, reshown = _resolve(
                request,
                case_id,
                state,
                runtime_loader(case_id),
                line_source,
                hint_source,
            )
            return NpcProcessResult(
                npc_event_id=event_id, result=record, line=line, reshown_hint=reshown
            )

        line, reshown = _resolve(
            request, case_id, state, runtime_loader(case_id), line_source, hint_source
        )
        record = NpcEventRecord(
            result_type=(
                "nudge_given"
                if isinstance(request, NpcNudgeRequest)
                else "hint_reshown"
            ),
            npc_id=request.npc_id,
            line_id=request.line_id if isinstance(request, NpcNudgeRequest) else None,
            puzzle_id=request.puzzle_id,
            hint_level=(
                request.hint_level
                if isinstance(request, NpcHintReshowRequest)
                else None
            ),
        )
        npc_event_id = str(uuid4())
        db.add(
            InteractionEvent(
                id=npc_event_id,
                play_session_id=play_session_id,
                client_event_id=request.client_event_id,
                client_timestamp=_to_db_datetime(request.client_timestamp),
                interaction_type=event_type,
                target_id=target_id,
                payload_json=payload_json,
                result_type=record.result_type,
                response_json=record.model_dump(mode="json"),
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
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
            record = _replay_existing_event(
                existing_event,
                event_type=event_type,
                target_id=target_id,
                payload_json=payload_json,
            )
            npc_event_id = existing_event.id
            await db.rollback()
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    return NpcProcessResult(
        npc_event_id=npc_event_id, result=record, line=line, reshown_hint=reshown
    )


def _request_values(request: NpcRequest) -> tuple[str, str, dict[str, Any]]:
    if isinstance(request, NpcNudgeRequest):
        return (
            NPC_NUDGE_EVENT_TYPE,
            request.line_id,
            {"npc_id": request.npc_id, "puzzle_id": request.puzzle_id},
        )
    return (
        NPC_HINT_RESHOWN_EVENT_TYPE,
        request.puzzle_id,
        {
            "npc_id": request.npc_id,
            "hint_level": request.hint_level,
            "trigger": request.trigger,
        },
    )


def _resolve(
    request: NpcRequest,
    case_id: str,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
    line_source: NpcLineSource,
    hint_source: HintSource,
) -> tuple[NpcLineText | None, ReshownHint | None]:
    if isinstance(request, NpcNudgeRequest):
        return _resolve_nudge(request, case_id, runtime, line_source, hint_source), None
    return None, _resolve_reshow(request, case_id, state, runtime, hint_source)


def _resolve_nudge(
    request: NpcNudgeRequest,
    case_id: str,
    runtime: PuzzleRuntimeDefinition,
    line_source: NpcLineSource,
    hint_source: HintSource,
) -> NpcLineText:
    line = line_source(case_id, request.npc_id, request.line_id)
    if (
        line is None
        or not line.approved
        or line.kind != "nudge"
        or line.line_id != request.line_id
        or not line.text.strip()
    ):
        raise NpcLineNotFoundError(request.line_id)
    if request.puzzle_id is not None:
        _find_puzzle(runtime, request.puzzle_id)
    if line.puzzle_id is not None and line.puzzle_id != request.puzzle_id:
        raise NpcLineScopeError(request.line_id)
    # 일반 대사는 예외 없이 모든 퍼즐의 정답 · 힌트 원문과 겹치면 막는다.
    _ensure_no_protected_text(
        line.text, case_id, runtime, hint_source, allowed_puzzle_id=None
    )
    return NpcLineText(line_id=line.line_id, text=line.text)


def _resolve_reshow(
    request: NpcHintReshowRequest,
    case_id: str,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
    hint_source: HintSource,
) -> ReshownHint:
    # 원문 · 해금 상태를 읽기 전에 거부한다. 값이 없거나 다른 값이어도 아래 서버 판정은 그대로다.
    if request.trigger == AUTO_HELP_OFFER_TRIGGER:
        raise NpcReshowNotAllowedError(request.puzzle_id)
    _find_puzzle(runtime, request.puzzle_id)
    # 서버에 저장된 그 퍼즐의 단계만 본다(다른 퍼즐 · 클라이언트 값은 쓰지 않는다).
    if _current_hint_level(state, request.puzzle_id) < request.hint_level:
        raise HintNotUnlockedError(request.puzzle_id)
    text = _require_hint_text(
        hint_source, case_id, request.puzzle_id, request.hint_level
    )
    # 예외는 이 퍼즐 · 이 단계 원문에만 준다. 다른 퍼즐의 정답 · 원문이 섞였으면 막는다.
    _ensure_no_protected_text(
        text, case_id, runtime, hint_source, allowed_puzzle_id=request.puzzle_id
    )
    return ReshownHint(puzzle_id=request.puzzle_id, level=request.hint_level, text=text)


def _ensure_no_protected_text(
    text: str,
    case_id: str,
    runtime: PuzzleRuntimeDefinition,
    hint_source: HintSource,
    *,
    allowed_puzzle_id: str | None,
) -> None:
    normalized_text = normalize_answer(text)
    allowed_answers = {
        normalize_answer(answer)
        for puzzle in runtime.puzzles
        if puzzle.puzzle_id == allowed_puzzle_id
        for answer in puzzle.accepted_answers
    }
    for puzzle in runtime.puzzles:
        for answer in puzzle.accepted_answers:
            normalized = normalize_answer(answer)
            if (
                len(normalized) >= MIN_ANSWER_LENGTH_FOR_LINE_CHECK
                and normalized not in allowed_answers
                and normalized in normalized_text
            ):
                # 오류에는 퍼즐 ID만 싣는다(정답 · 원문 없음).
                raise NpcContentUnsafeError(puzzle.puzzle_id)
        if puzzle.puzzle_id == allowed_puzzle_id:
            continue
        for level in (1, 2):
            other = hint_source(case_id, puzzle.puzzle_id, level)
            if other and other.strip() and normalize_answer(other) in normalized_text:
                raise NpcContentUnsafeError(puzzle.puzzle_id)


def _replay_existing_event(
    event: InteractionEvent,
    *,
    event_type: str,
    target_id: str,
    payload_json: dict[str, Any],
) -> NpcEventRecord:
    if not _is_same_request(
        event,
        interaction_type=event_type,
        target_id=target_id,
        payload_json=payload_json,
    ):
        raise IdempotencyConflictError()
    return NpcEventRecord.model_validate(event.response_json)
