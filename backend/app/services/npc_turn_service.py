"""NPC 턴 처리(세션 · 고정 콘텐츠 · 이벤트 기록) v0.1 (PM v0.4.3).

- 세션이 고정한 콘텐츠 버전만 쓴다. 고정 버전이 없는 레거시 세션 · 저장소에 없는 버전 · fingerprint 불일치는
  `CASE_VERSION_UNAVAILABLE`(기존 오류 체계)이다. NPC 콘텐츠는 고정 묶음에만 있다.
- 공개 여부는 서버 세션 상태(`state_json`)로만 판정한다. 클라이언트는 퍼즐 ID 를 보내지 않는다(포커스 Object 만).
- PlaySession 상태를 바꾸지 않는다(잠금 없음). 이벤트 한 줄(`npc_turn`)만 쓴다. 대사 · 플레이어 원문은 저장하지 않고,
  같은 `client_event_id` 재전송 여부를 가리려고 플레이어 메시지는 SHA-256 만 남긴다.
- 재전송: 같은 요청이면 저장된 결과를 돌려준다. 승인 대사는 그때의 승인 콘텐츠에서 line_id 로 다시 읽고
  (승인이 빠졌으면 null), 생성 대사는 저장하지 않았으므로 null 이다.
"""

import asyncio
import hashlib
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.npc_content import GeneralLinePack
from app.schemas.npc_turn import (
    NpcReplyOut,
    NpcTurnEventRecord,
    NpcTurnRequest,
    NpcTurnResponse,
    SuggestHintOut,
)
from app.services.approval_history import ApprovalSource
from app.services.interaction import (
    IdempotencyConflictError,
    _find_interaction_event,
    _is_same_request,
    _to_db_datetime,
)
from app.services.npc_decision import (
    AutoIntervention,
    RuleConfig,
    decide,
    signals_from_events,
)
from app.services.npc_dialogue import PM_GENERIC_PUZZLE_LINES
from app.services.npc_general_dialogue import ModelGenerator
from app.services.npc_turn import (
    NpcTurnContent,
    NpcTurnResult,
    run_auto_turn,
    run_player_message_turn,
    turn_content_from_pinned,
)
from app.services.object_state import resolve_effective_object_states
from app.services.pinned_content import PinnedContentStore, resolve_session_content
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_question import PUZZLE_INTERACTION_TYPES

NPC_TURN_EVENT_TYPE = "npc_turn"

EventLoader = Callable[[AsyncSession, str], Awaitable[Sequence[Any]]]


class NpcContentUnavailableError(Exception):
    """세션에 고정 콘텐츠 버전이 없다(레거시 세션). NPC 콘텐츠를 쓸 수 없다."""


@dataclass(frozen=True)
class NpcGenerationConfig:
    """일반 대화 생성 스위치. 운영 기본값은 OFF 다."""

    enabled: bool = False
    generator: ModelGenerator | None = None


GENERATION_OFF = NpcGenerationConfig()


async def load_session_events(db: AsyncSession, play_session_id: str) -> list[Any]:
    result = await db.execute(
        select(InteractionEvent)
        .where(InteractionEvent.play_session_id == play_session_id)
        .order_by(InteractionEvent.created_at)
    )
    return list(result.scalars().all())


async def process_npc_turn(
    db: AsyncSession,
    play_session_id: str,
    request: NpcTurnRequest,
    *,
    store: PinnedContentStore,
    approval_source: ApprovalSource | None,
    general_pack: GeneralLinePack | None = None,
    general_pack_approval: ApprovalSource | None = None,
    generation: NpcGenerationConfig = GENERATION_OFF,
    event_loader: EventLoader = load_session_events,
    rule_config: RuleConfig = RuleConfig(),
    now: datetime | None = None,
) -> NpcTurnResponse:
    client_event_id = str(request.client_event_id)
    payload_json = _payload(request)
    try:
        play_session = await db.get(PlaySession, play_session_id)
        if play_session is None:
            raise PlaySessionNotFoundError()
        bundle = resolve_session_content(play_session, store)
        if bundle is None:
            raise NpcContentUnavailableError()
        # rollback 은 ORM 객체를 만료시키므로 판정에 쓸 값은 먼저 읽어 둔다.
        state = dict(play_session.state_json)
        content = turn_content_from_pinned(
            bundle,
            approval_source,
            general_pack=general_pack,
            general_pack_approval=general_pack_approval,
        )

        existing = await _find_interaction_event(db, play_session_id, client_event_id)
        if existing is not None:
            response = _replay(existing, payload_json, content)
            await db.rollback()
            return response

        if request.trigger == "player_message":
            result = run_player_message_turn(
                request.message or "",
                state=state,
                content=content,
                general_generator=generation.generator,
                generation_enabled=generation.enabled,
            )
        else:
            current = now or datetime.now(timezone.utc).replace(tzinfo=None)
            events = await event_loader(db, play_session_id)
            target = _focus_puzzle(content, state, request.focus_object_id)
            signals = signals_from_events(
                events,
                now=current,
                target_puzzle_id=target,
                past_interventions=_past_interventions(events),
            )
            result = run_auto_turn(
                decide(signals, rule_config), state=state, content=content
            )

        record = _record(request.trigger, result)
        npc_event_id = str(uuid4())
        db.add(
            InteractionEvent(
                id=npc_event_id,
                play_session_id=play_session_id,
                client_event_id=client_event_id,
                client_timestamp=_to_db_datetime(request.client_timestamp),
                interaction_type=NPC_TURN_EVENT_TYPE,
                target_id=None,
                payload_json=payload_json,
                result_type="replied" if result.reply is not None else "no_reply",
                response_json=record.model_dump(mode="json"),
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )
        )
        try:
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            existing = await _find_interaction_event(
                db, play_session_id, client_event_id
            )
            if existing is None:
                raise error
            response = _replay(existing, payload_json, content)
            await db.rollback()
            return response
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    return _response(npc_event_id, result)


def _payload(request: NpcTurnRequest) -> dict[str, Any]:
    digest = (
        hashlib.sha256(request.message.encode("utf-8")).hexdigest()
        if request.message is not None
        else None
    )
    return {
        "trigger": request.trigger,
        "focus_object_id": request.focus_object_id,
        "message_sha256": digest,
    }


def _focus_puzzle(
    content: NpcTurnContent, state: Mapping[str, Any], object_id: str | None
) -> str | None:
    """현재 구역에서 보이는 포커스 Object 가 아직 안 푼 퍼즐로 이어지면 그 퍼즐."""

    if object_id is None:
        return None
    zone_id = state.get("current_zone_id")
    zone = next((z for z in content.client.zones if z.zone_id == zone_id), None)
    obj = (
        next((o for o in zone.objects if o.object_id == object_id), None)
        if zone
        else None
    )
    if zone is None or obj is None or obj.interaction is None:
        return None
    effective = resolve_effective_object_states(
        content.client, state.get("object_states", {})
    )
    puzzle_ids = {p.puzzle_id for p in content.runtime.puzzles}
    target = obj.interaction.target_id
    if (
        not effective[(zone.zone_id, obj.object_id)].visible
        or obj.interaction.type not in PUZZLE_INTERACTION_TYPES
        or target not in puzzle_ids
        or target in (state.get("completed_puzzle_ids") or [])
    ):
        return None
    return target


def _past_interventions(events: Sequence[Any]) -> list[AutoIntervention]:
    past = []
    for event in events:
        if event.interaction_type != NPC_TURN_EVENT_TYPE:
            continue
        record = event.response_json or {}
        if record.get("auto_intervened"):
            decision = record.get("decision") or {}
            past.append(
                AutoIntervention(event.created_at, decision.get("target_puzzle_id"))
            )
    return past


def _record(trigger: str, result: NpcTurnResult) -> NpcTurnEventRecord:
    decision = result.decision
    diagnosis = result.diagnosis
    return NpcTurnEventRecord(
        trigger=trigger,
        reply_source=result.reply.source if result.reply else None,
        line_id=result.reply.line_id if result.reply else None,
        generated=result.generated,
        no_reply_reason=result.no_reply_reason,
        suggest_hint_puzzle_id=(
            result.suggest_hint.puzzle_id if result.suggest_hint else None
        ),
        policy=[
            {"code": v.code, "rule_id": v.rule_id}
            for v in (result.policy.violations if result.policy else ())
        ],
        decision=(
            {
                "intervene": decision.intervene,
                "intervention_level": decision.intervention_level,
                "reason": decision.reason,
                "target_puzzle_id": decision.target_puzzle_id,
            }
            if decision
            else None
        ),
        diagnosis=(
            {
                "is_puzzle_question": diagnosis.is_puzzle_question,
                "reason": diagnosis.reason,
                "signal_a": list(diagnosis.signal_a),
                "signal_b": list(diagnosis.signal_b),
                "matched_puzzle_count": diagnosis.matched_puzzle_count,
            }
            if diagnosis
            else None
        ),
        auto_intervened=trigger == "auto" and result.reply is not None,
    )


def _response(npc_event_id: str, result: NpcTurnResult) -> NpcTurnResponse:
    reply = result.reply
    return NpcTurnResponse(
        npc_event_id=UUID(npc_event_id),
        reply=(
            NpcReplyOut(source=reply.source, text=reply.text, line_id=reply.line_id)
            if reply
            else None
        ),
        suggest_hint=(
            SuggestHintOut(puzzle_id=result.suggest_hint.puzzle_id)
            if result.suggest_hint
            else None
        ),
    )


def _replay(
    event: InteractionEvent, payload_json: dict[str, Any], content: NpcTurnContent
) -> NpcTurnResponse:
    if not _is_same_request(
        event,
        interaction_type=NPC_TURN_EVENT_TYPE,
        target_id=None,
        payload_json=payload_json,
    ):
        raise IdempotencyConflictError()
    record = NpcTurnEventRecord.model_validate(event.response_json)
    text = (
        _approved_text(content, record.line_id)
        if record.reply_source == "approved_line" and record.line_id
        else None
    )
    return NpcTurnResponse(
        npc_event_id=UUID(event.id),
        reply=(
            NpcReplyOut(source="approved_line", text=text, line_id=record.line_id)
            if text
            else None
        ),
        suggest_hint=(
            SuggestHintOut(puzzle_id=record.suggest_hint_puzzle_id)
            if text and record.suggest_hint_puzzle_id
            else None
        ),
    )


def _approved_text(content: NpcTurnContent, line_id: str) -> str | None:
    """지금도 승인된 대사에서만 원문을 다시 읽는다."""

    if content.npc_id is not None:
        line = content.line_source(content.case_id, content.npc_id, line_id)
        if line is not None and line.approved:
            return line.text
    for provider in (content.fallback_lines, content.general_pack_lines):
        for line in provider():
            if line.approved and line.line_id == line_id:
                return line.text
    if line_id in PM_GENERIC_PUZZLE_LINES and content.generic_line_approval(line_id):
        return PM_GENERIC_PUZZLE_LINES[line_id]
    return None
