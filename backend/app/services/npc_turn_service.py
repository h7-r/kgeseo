"""NPC 턴 처리(세션 · 고정 콘텐츠 · 이벤트 기록) v0.1 (PM v0.4.3).

- 세션이 고정한 콘텐츠 버전만 쓴다. 고정 버전이 없는 레거시 세션 · 저장소에 없는 버전 · fingerprint 불일치는
  `CASE_VERSION_UNAVAILABLE`(기존 오류 체계)이다. NPC 콘텐츠는 고정 묶음에만 있다.
- 공개 여부는 서버 세션 상태(`state_json`)로만 판정한다. 클라이언트는 퍼즐 ID 를 보내지 않는다(포커스 Object 만).
- PlaySession 상태를 바꾸지 않는다(잠금 없음). 이벤트 한 줄(`npc_turn`)만 쓴다. 대사 · 플레이어 원문은 저장하지 않고,
  같은 `client_event_id` 재전송 여부를 가리려고 플레이어 메시지는 SHA-256 만 남긴다.
- 재전송: 같은 요청이면 저장된 결과를 돌려준다. 승인 대사는 그때의 승인 콘텐츠에서 line_id 로 다시 읽고
  (승인이 빠졌으면 null), 생성 대사는 저장하지 않았으므로 null 이다.
- PM v0.4.7: 자동 개입 설정은 서버 기본값에 케이스 `npc.json.auto_nudge`를 덮어쓴다. 횟수 · 쿨다운은 FE가 보고한
  표시(`npc_suggestion_shown`) · 거절(`npc_suggestion_declined`) 기록으로만 센다(`npc_suggestion_events`).
- `suggest_hint`에는 내부 puzzle_id 대신 `hint_ref`를 싣는다. 발급 키가 없으면 `suggest_hint`를 내지 않는다(fail closed).
  이벤트에는 내부 puzzle_id를 남긴다.
- 케이스 대사 승인 · 게시 상태(`case_access`, 운영은 `npc_case_access.read_case_npc_access`): 계산 전에 잠금 없이
  읽고, 이벤트 확정 트랜잭션에서 공유 잠금으로 다시 읽는다. 근거가 바뀌었으면(철회 · 차단이 사이에 commit) 확정 전에
  다시 계산한다. 긴급 차단(blocked)이면 새 턴 · 재전송 모두 대사 · 힌트 제안 없이 `NPC_CONTENT_WITHDRAWN`이다
  (PM v0.4.6). 멱등 처리는 기존 `interaction_events`(`client_event_id`) 하나다.
"""

import asyncio
import hashlib
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.npc_content import GeneralLinePack
from app.schemas.npc_turn import (
    NpcAutoInterveneRecord,
    NpcReplyOut,
    NpcTurnEventRecord,
    NpcTurnRequest,
    NpcTurnResponse,
    SuggestHintOut,
)
from app.services.approval_history import ApprovalSource
from app.services.hint_ref import HintRefKeys, issue_hint_ref
from app.services.interaction import (
    IdempotencyConflictError,
    _find_interaction_event,
    _is_same_request,
    _to_db_datetime,
)
from app.services.npc_case_access import CaseAccessReader, CaseNpcAccess
from app.services.npc_decision import (
    AutoIntervention,
    RuleConfig,
    decide,
    rule_config_for,
    signals_from_events,
)
from app.services.npc_dialogue import PM_GENERIC_PUZZLE_LINES
from app.services.npc_general_dialogue import ModelGenerator
from app.services.npc_suggestion_events import shown_and_declined
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
MYSQL_DEADLOCK = 1213
DEADLOCK_RETRIES = 3
CONTENT_WITHDRAWN = "NPC_CONTENT_WITHDRAWN"

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
    db: AsyncSession, play_session_id: str, request: NpcTurnRequest, **options: Any
) -> NpcTurnResponse:
    """NPC 턴 한 번. MySQL 교착(1213)이면 같은 턴을 짧게 다시 시도한다.

    NPC 턴은 세션 행을 잠그지 않으므로, 같은 `client_event_id` 동시 요청의 INSERT가 교착할 수 있다. 교착 쪽
    트랜잭션은 전부 rollback되므로 다시 시도하면 확정된 이벤트를 재전송으로 돌려주거나 새로 확정한다.
    """

    attempt = 0
    while True:
        try:
            return await _process_npc_turn_once(db, play_session_id, request, **options)
        except DBAPIError as error:
            args = getattr(error.orig, "args", ())
            errno = args[0] if args and isinstance(args[0], int) else None
            if errno != MYSQL_DEADLOCK or attempt >= DEADLOCK_RETRIES:
                raise
            attempt += 1


async def _process_npc_turn_once(
    db: AsyncSession,
    play_session_id: str,
    request: NpcTurnRequest,
    *,
    store: PinnedContentStore,
    approval_source: ApprovalSource | None = None,
    case_access: CaseAccessReader | None = None,
    general_pack: GeneralLinePack | None = None,
    general_pack_approval: ApprovalSource | None = None,
    generation: NpcGenerationConfig = GENERATION_OFF,
    event_loader: EventLoader = load_session_events,
    rule_config: RuleConfig = RuleConfig(),
    hint_ref_keys: HintRefKeys | None = None,
    now: datetime | None = None,
) -> NpcTurnResponse:
    if case_access is not None and approval_source is not None:
        raise ValueError("pass either approval_source or case_access")
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
        fingerprint = bundle.pin.content_fingerprint

        def hint_ref_for(puzzle_id: str | None) -> SuggestHintOut | None:
            if puzzle_id is None or hint_ref_keys is None:
                return None
            return SuggestHintOut(
                hint_ref=issue_hint_ref(
                    hint_ref_keys,
                    play_session_id=play_session_id,
                    puzzle_id=puzzle_id,
                    content_fingerprint=fingerprint,
                )
            )

        async def read_access(lock: bool) -> CaseNpcAccess:
            if case_access is None:
                return CaseNpcAccess(approval_source)
            return await case_access(db, bundle.pin, lock=lock)

        def content_for(access: CaseNpcAccess) -> NpcTurnContent:
            return turn_content_from_pinned(
                bundle,
                access.approval_source,
                general_pack=general_pack,
                general_pack_approval=general_pack_approval,
            )

        async def compute(access: CaseNpcAccess) -> NpcTurnResult:
            if access.withdrawn:
                return _withdrawn_result(request.trigger)
            content = content_for(access)
            if request.trigger == "player_message":
                return run_player_message_turn(
                    request.message or "",
                    state=state,
                    content=content,
                    general_generator=generation.generator,
                    generation_enabled=generation.enabled,
                )
            current = now or datetime.now(timezone.utc).replace(tzinfo=None)
            events = await event_loader(db, play_session_id)
            target = _focus_puzzle(content, state, request.focus_object_id)
            shown, declined = shown_and_declined(events)
            signals = signals_from_events(
                events,
                now=current,
                target_puzzle_id=target,
                past_interventions=[AutoIntervention(at, pid) for at, pid in shown],
                past_declines=declined,
            )
            config = rule_config_for(
                content.npc_pack.auto_nudge if content.npc_pack else None, rule_config
            )
            return run_auto_turn(decide(signals, config), state=state, content=content)

        # 1. 계산 전 판정(잠금 없음)
        access = await read_access(lock=False)

        existing = await _find_interaction_event(db, play_session_id, client_event_id)
        if existing is not None:
            response = _replay(
                existing, payload_json, content_for(access), hint_ref_for, access
            )
            await db.rollback()
            return response

        # 2. 계산(잠금 없음)
        result = await compute(access)

        # 3. 확정 트랜잭션에서 공유 잠금으로 다시 읽는다. 그 사이 철회 · 차단이 commit됐으면 다시 계산한다.
        if case_access is not None:
            final = await read_access(lock=True)
            if final.basis != access.basis:
                access = final
                result = await compute(access)

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
            response = _replay(
                existing, payload_json, content_for(access), hint_ref_for, access
            )
            await db.rollback()
            return response
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    return _response(npc_event_id, result, hint_ref_for)


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
        fallback_reason=result.fallback_reason,
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
        # 보여 줄 것(대사 또는 힌트 안내)이 있는 자동 개입만 제안이다. 횟수는 표시 보고로 센다.
        auto_intervened=trigger == "auto"
        and (result.reply is not None or result.suggest_hint is not None),
        auto_intervene=(
            NpcAutoInterveneRecord(
                trigger=result.auto.trigger,
                value=result.auto.value,
                puzzle_ref=result.auto.puzzle_ref,
                nudge_missing=result.auto.nudge_missing,
                level=result.auto.level,
            )
            if result.auto is not None
            else None
        ),
    )


HintRefFor = Callable[[str | None], SuggestHintOut | None]


def _response(
    npc_event_id: str, result: NpcTurnResult, hint_ref_for: HintRefFor
) -> NpcTurnResponse:
    reply = result.reply
    return NpcTurnResponse(
        npc_event_id=UUID(npc_event_id),
        reply=(
            NpcReplyOut(source=reply.source, text=reply.text, line_id=reply.line_id)
            if reply
            else None
        ),
        suggest_hint=hint_ref_for(
            result.suggest_hint.puzzle_id if result.suggest_hint else None
        ),
        fallback_reason=result.fallback_reason,
    )


def _withdrawn_result(trigger: str) -> NpcTurnResult:
    # 긴급 차단: 케이스 콘텐츠(대사 · 힌트 제안)를 쓰지 않는다. 일반 팩 대사 제공 여부는 미결정이라 내지 않는다.
    return NpcTurnResult(
        trigger, None, "content_withdrawn", None, fallback_reason=CONTENT_WITHDRAWN
    )


def _replay(
    event: InteractionEvent,
    payload_json: dict[str, Any],
    content: NpcTurnContent,
    hint_ref_for: HintRefFor,
    access: CaseNpcAccess,
) -> NpcTurnResponse:
    if not _is_same_request(
        event,
        interaction_type=NPC_TURN_EVENT_TYPE,
        target_id=None,
        payload_json=payload_json,
    ):
        raise IdempotencyConflictError()
    if access.withdrawn:
        # 긴급 차단 뒤 재전송: 저장했던 케이스 응답을 돌려주지 않는다.
        return NpcTurnResponse(
            npc_event_id=UUID(event.id),
            reply=None,
            suggest_hint=None,
            fallback_reason=CONTENT_WITHDRAWN,
        )
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
        # 대사가 있던 응답은 대사가 아직 승인일 때만, 대사 없이 안내만 한 응답(일반 팩 없음)은 그대로 안내한다.
        suggest_hint=(
            hint_ref_for(record.suggest_hint_puzzle_id)
            if record.suggest_hint_puzzle_id
            and (text is not None or record.reply_source is None)
            else None
        ),
        fallback_reason=record.fallback_reason,
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
