"""NPC 상황 대사 선택 · 쿨다운 v0.1 (계약 v0.4.16 §4 · §5 · §8 · §9 · §10, 순수 함수 · DB 를 쓰지 않음).

FE가 감지한 상황(`situation.code`)을 받아 BE가 「말할지 · 무엇을 말할지」를 정한다. LLM은 쓰지 않고 고정
묶음(`PinnedContent`)의 승인 원문만 돌려준다.

[우선순위] 같은 auto 턴의 퍼즐 자동 개입(v0.4.7)이 보여 줄 것(대사 · 힌트 안내)을 냈으면 그것이 우선이다
(§8-5 겹침 방지). 상황 대사는 그 결과를 바꾸지 않고, 퍼즐 개입이 말하지 않을 때만 고른다.

[대사 고르기]
- 상황 코드(QUIET 제외): `situations[]`에서 같은 코드의 대사. 요청 `focus_object_id`와 같은 Object에 지정된 대사가
  있으면 그것만, 없으면 Object 조건 없는 대사(§8-1). 다른 Object에 지정된 대사는 고르지 않는다.
- QUIET: 케이스 팩 `general_nudges`에서(§8-4 · §6). `reveal_when`이 지금 세션 상태로 공개된 대사만 후보다.
  `situation.zone_id`와 같은 구역 대사가 있으면 그것만, 없으면 구역 조건 없는 대사(§9-7).
- 승인은 고정 묶음의 승인 이력(`line_source`, G1~G3)으로만 본다. 원문이 콘텐츠와 다르면 쓰지 않는다.
- 돌아가며 고른다(§4): 후보 목록(콘텐츠 순서)에서, 같은 코드로 마지막에 낸 후보의 다음 대사. 후보가 둘 이상이면
  직전 대사는 다시 나오지 않는다. 처음이면 첫 대사.

[쿨다운 · 횟수] 이 세션에 실제로 응답한 상황 대사(`npc_turn` 이벤트, `situation_replied`)로만 센다. 시각은
이벤트의 서버 저장 시각(`created_at`, timezone 없는 UTC)이다. 메모리에 두지 않으므로 서버를 다시 띄워도, 이어하기
뒤에도 그대로다(§8-6). 퍼즐 자동 개입 횟수(표시 보고)와는 따로 센다(§4).
1. 상황 대사 전체 최소 간격 20초(§8-2) — 마지막 상황 대사(QUIET 포함) 뒤 20초 안이면 말하지 않는다.
2. `(code, focus_object_id)`마다 콘텐츠 `cooldown_seconds`, 없으면 60초(§4 · §8-2). BREATH_LOW 45초는 콘텐츠 값이다(§10-6).
3. QUIET: 코드 쿨다운 180초(Object와 무관하게 코드 하나로 센다) · 세션당 5회(§8-4). 퍼즐 자동 개입 쿨다운
   (표시 뒤 · 거절 뒤) 중이거나, 다른 상황 코드의 쿨다운이 아직 남았으면 말하지 않는다(우선순위 가장 낮음).
말하지 않은 턴(쿨다운 · 대사 없음 · 퍼즐 우선)은 횟수 · 쿨다운을 쓰지 않는다.

[응답] `suggest_hint`는 늘 없다(§5). 힌트 단계 · 잔액 · 별을 바꾸지 않는다. 대사 원문은 기록하지 않는다.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from app.schemas.npc_content import NpcContentPack
from app.services.npc import _ensure_no_protected_text
from app.services.npc_decision import DecisionSignals, RuleConfig
from app.services.npc_dialogue import NpcReply
from app.services.npc_reveal import is_revealed
from app.services.npc_turn import NpcTurnContent, NpcTurnResult

QUIET = "QUIET"
SITUATION_EVENT_TYPE = "npc_turn"

# 말하지 않은 이유(기록용 · 응답에는 싣지 않는다)
PREEMPTED_BY_PUZZLE = "situation_preempted_by_puzzle"
GLOBAL_GAP = "situation_global_gap"
COOLDOWN = "situation_cooldown"
QUIET_LIMIT = "situation_quiet_limit"
QUIET_PUZZLE_COOLDOWN = "situation_quiet_puzzle_cooldown"
QUIET_OTHER_COOLDOWN = "situation_quiet_other_cooldown"
NO_LINE = "situation_no_approved_line"


@dataclass(frozen=True)
class SituationConfig:
    """서버 기본값(🟡 운영하며 조정). 코드별 값은 콘텐츠 `situations[].cooldown_seconds`가 덮어쓴다."""

    default_cooldown_sec: float = 60.0
    global_gap_sec: float = 20.0
    quiet_cooldown_sec: float = 180.0
    quiet_max_per_session: int = 5


@dataclass(frozen=True)
class SituationRequest:
    code: str
    focus_object_id: str | None
    zone_id: str | None


@dataclass(frozen=True)
class SituationReplyRecord:
    """이 세션에 응답한 상황 대사 한 번(이벤트에서 다시 읽는다)."""

    at: datetime
    code: str
    focus_object_id: str | None
    line_id: str


def situation_history(events: Iterable[Any]) -> list[SituationReplyRecord]:
    """세션 이벤트에서 실제로 응답한 상황 대사만 시각 순으로 뽑는다(대사 원문은 없다)."""

    history: list[SituationReplyRecord] = []
    for event in events:
        if event.interaction_type != SITUATION_EVENT_TYPE:
            continue
        record = event.response_json or {}
        if not record.get("situation_replied"):
            continue
        code = record.get("situation_code")
        line_id = record.get("line_id")
        if not isinstance(code, str) or not isinstance(line_id, str):
            continue
        payload = event.payload_json or {}
        history.append(
            SituationReplyRecord(
                event.created_at, code, payload.get("focus_object_id"), line_id
            )
        )
    return sorted(history, key=lambda item: item.at)


def cooldown_for(
    pack: NpcContentPack | None, code: str, config: SituationConfig
) -> float:
    entry = (
        next((item for item in (pack.situations or ()) if item.code == code), None)
        if pack is not None
        else None
    )
    if entry is not None and entry.cooldown_seconds is not None:
        return float(entry.cooldown_seconds)
    return config.quiet_cooldown_sec if code == QUIET else config.default_cooldown_sec


def _since(now: datetime, at: datetime) -> float:
    return (now - at).total_seconds()


def blocked_reason(
    request: SituationRequest,
    history: Sequence[SituationReplyRecord],
    *,
    pack: NpcContentPack | None,
    now: datetime,
    signals: DecisionSignals,
    rule_config: RuleConfig,
    config: SituationConfig,
) -> str | None:
    """쿨다운 · 횟수로 지금 말하면 안 되는 이유. 말해도 되면 None."""

    if history and _since(now, history[-1].at) < config.global_gap_sec:
        return GLOBAL_GAP
    own = cooldown_for(pack, request.code, config)
    if request.code == QUIET:
        quiet = [item for item in history if item.code == QUIET]
        if len(quiet) >= config.quiet_max_per_session:
            return QUIET_LIMIT
        if quiet and _since(now, quiet[-1].at) < own:
            return COOLDOWN
        # 퍼즐 자동 개입 쿨다운(표시 뒤 · 거절 뒤) 중에는 잡담하지 않는다(§8-4).
        if (
            signals.since_last_intervention_sec is not None
            and signals.since_last_intervention_sec < rule_config.cooldown_sec
        ) or (
            signals.since_last_decline_sec is not None
            and signals.since_last_decline_sec < rule_config.decline_cooldown_sec
        ):
            return QUIET_PUZZLE_COOLDOWN
        for item in history:
            if item.code != QUIET and _since(now, item.at) < cooldown_for(
                pack, item.code, config
            ):
                return QUIET_OTHER_COOLDOWN
        return None
    same = [
        item
        for item in history
        if item.code == request.code and item.focus_object_id == request.focus_object_id
    ]
    if same and _since(now, same[-1].at) < own:
        return COOLDOWN
    return None


@dataclass(frozen=True)
class _Candidate:
    line_id: str
    text: str


def _approved(content: NpcTurnContent, line_id: str, text: str, *, kind: str) -> bool:
    if content.npc_id is None:
        return False
    line = content.line_source(content.case_id, content.npc_id, line_id)
    return (
        line is not None
        and line.approved
        and line.kind == kind
        and line.line_id == line_id
        and line.text == text
        and line.puzzle_id is None
    )


def situation_candidates(
    request: SituationRequest,
    *,
    state: Mapping[str, Any],
    content: NpcTurnContent,
) -> list[_Candidate]:
    """지금 고를 수 있는 승인 대사(우선 단계 하나만). 없으면 빈 목록."""

    pack = content.npc_pack
    if pack is None or content.npc_id is None or pack.npc_id != content.npc_id:
        return []
    if request.code == QUIET:
        revealed = [
            nudge
            for nudge in pack.general_nudges
            if is_revealed(nudge.reveal_when, state)
            and _approved(content, nudge.line_id, nudge.text, kind="nudge")
        ]
        zoned = (
            [n for n in revealed if n.zone_id == request.zone_id]
            if request.zone_id is not None
            else []
        )
        chosen = zoned or [n for n in revealed if n.zone_id is None]
        return [_Candidate(n.line_id, n.text) for n in chosen]
    entry = next(
        (item for item in (pack.situations or ()) if item.code == request.code), None
    )
    if entry is None:
        return []
    usable = [
        line
        for line in entry.lines
        if _approved(content, line.line_id, line.text, kind="situation")
    ]
    focused = (
        [line for line in usable if line.focus_object_id == request.focus_object_id]
        if request.focus_object_id is not None
        else []
    )
    chosen = focused or [line for line in usable if line.focus_object_id is None]
    return [_Candidate(line.line_id, line.text) for line in chosen]


def rotate(
    candidates: Sequence[_Candidate],
    history: Sequence[SituationReplyRecord],
    code: str,
) -> _Candidate:
    """같은 코드로 마지막에 낸 후보의 다음 대사(없으면 첫 대사)."""

    ids = [candidate.line_id for candidate in candidates]
    for item in reversed(history):
        if item.code == code and item.line_id in ids:
            return candidates[(ids.index(item.line_id) + 1) % len(candidates)]
    return candidates[0]


def run_situation_turn(
    puzzle_result: NpcTurnResult,
    request: SituationRequest,
    *,
    events: Iterable[Any],
    state: Mapping[str, Any],
    content: NpcTurnContent,
    now: datetime,
    signals: DecisionSignals,
    rule_config: RuleConfig,
    config: SituationConfig = SituationConfig(),
) -> NpcTurnResult:
    """퍼즐 자동 개입 결과 위에 상황 대사를 얹는다. 퍼즐 결과가 보여 줄 것이 있으면 그대로 둔다."""

    tagged = replace(puzzle_result, situation_code=request.code)
    if puzzle_result.reply is not None or puzzle_result.suggest_hint is not None:
        return replace(tagged, situation_reason=PREEMPTED_BY_PUZZLE)
    history = situation_history(events)
    reason = blocked_reason(
        request,
        history,
        pack=content.npc_pack,
        now=now,
        signals=signals,
        rule_config=rule_config,
        config=config,
    )
    if reason is None:
        candidates = situation_candidates(request, state=state, content=content)
        if not candidates:
            reason = NO_LINE
    if reason is not None:
        return replace(tagged, no_reply_reason=reason, situation_reason=reason)
    chosen = rotate(candidates, history, request.code)
    # 게시 검사를 지난 대사여도 응답 직전에 정답 · 힌트 원문을 한 번 더 막는다(넛지와 같은 방어).
    _ensure_no_protected_text(
        chosen.text,
        content.case_id,
        content.runtime,
        content.hint_source,
        allowed_puzzle_id=None,
    )
    return replace(
        tagged,
        reply=NpcReply("approved_line", chosen.text, chosen.line_id),
        no_reply_reason=None,
        suggest_hint=None,
        situation_replied=True,
        situation_reason=None,
    )
