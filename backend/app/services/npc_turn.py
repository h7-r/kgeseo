"""NPC 한 턴 처리 v0.1 (PM v0.4.3, 순수 함수 · DB 를 쓰지 않음).

    플레이어 상태 → (자동이면) NPC 판단 → (메시지면) 퍼즐 질문 판별
    → 허용된 nudge · 안내 또는 일반 대화 → 정책 검사 → 최종 응답

- 플레이어 메시지: `npc_dialogue.respond_to_player_message` (퍼즐 질문은 생성기를 부르지 않는다).
- 자동 개입: `npc_decision.decide` → `npc_intervention.allowed_auto_actions(intervention_level)` 안에서만
  승인된 nudge 원문 · 힌트 안내. 자동 개입은 정식 힌트 원문 · 정답 · Hint API 호출 · hint_levels 변경을 하지 않는다.
- 공급자는 고정 콘텐츠와 승인 이력에서 만든다(`turn_content_from_pinned`). 승인 정보가 없으면 모든 대사가
  미승인이라 내보낼 대사가 없다(기본 차단).
- 일반 대화 생성은 기본 OFF 다. 켜는 값은 호출하는 쪽이 정하고, 정책 규칙이 없으면 켤 수 없다.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.case_content import CaseClientContent
from app.schemas.npc_content import GeneralLinePack, NpcContentPack
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.approval_history import ApprovalSource
from app.services.hint import HintSource, server_hint_text
from app.services.npc import NpcLineSource, _ensure_no_protected_text
from app.services.npc_decision import NpcDecision
from app.services.npc_dialogue import (
    GENERIC_WITH_HINT_SUGGESTION,
    PM_GENERIC_PUZZLE_LINES,
    GenericLineApproval,
    NpcReply,
    SuggestHint,
    _has_server_hint,
    _revealed_approved_nudge,
    respond_to_player_message,
)
from app.services.npc_general_dialogue import ApprovedLineProvider, ModelGenerator
from app.services.npc_generation_policy import PolicyCheckResult, PolicyRules
from app.services.npc_intervention import allowed_auto_actions
from app.services.npc_line_supply import (
    fallback_line_provider,
    general_pack_line_provider,
    generic_line_approval,
    policy_rules_from_pack,
)
from app.services.pinned_content import HintTextResolver, PinnedContent
from app.services.puzzle_question import PuzzleQuestionDiagnosis

TurnTrigger = Literal["player_message", "auto"]


@dataclass(frozen=True)
class NpcTurnContent:
    case_id: str
    client: CaseClientContent
    runtime: PuzzleRuntimeDefinition
    npc_pack: NpcContentPack | None
    npc_id: str | None
    line_source: NpcLineSource
    hint_source: HintSource
    fallback_lines: ApprovedLineProvider
    general_pack_lines: ApprovedLineProvider
    generic_line_approval: GenericLineApproval
    policy_rules: PolicyRules | None
    puzzle_titles: Mapping[str, str] | None = None


@dataclass(frozen=True)
class NpcTurnResult:
    trigger: TurnTrigger
    reply: NpcReply | None
    # 발화가 없을 때의 이유(판단 결과 · 미승인 · 생성 OFF 등). 원문은 담지 않는다.
    no_reply_reason: str | None
    suggest_hint: SuggestHint | None
    decision: NpcDecision | None = None
    diagnosis: PuzzleQuestionDiagnosis | None = None
    policy: PolicyCheckResult | None = None

    @property
    def generated(self) -> bool:
        return self.reply is not None and self.reply.source == "generated"


def turn_content_from_pinned(
    bundle: PinnedContent,
    approval_source: ApprovalSource | None,
    *,
    general_pack: GeneralLinePack | None = None,
    general_pack_approval: ApprovalSource | None = None,
    hint_resolver: HintTextResolver = server_hint_text,
    puzzle_titles: Mapping[str, str] | None = None,
) -> NpcTurnContent:
    pack = bundle.npc()
    return NpcTurnContent(
        case_id=bundle.pin.case_id,
        client=bundle.client(),
        runtime=bundle.server(),
        npc_pack=pack,
        npc_id=pack.npc_id if pack is not None else None,
        line_source=bundle.line_source(approval_source),
        hint_source=bundle.hint_source(hint_resolver),
        fallback_lines=fallback_line_provider(bundle, approval_source),
        general_pack_lines=general_pack_line_provider(
            general_pack, general_pack_approval
        ),
        generic_line_approval=generic_line_approval(
            general_pack, general_pack_approval, PM_GENERIC_PUZZLE_LINES
        ),
        policy_rules=policy_rules_from_pack(pack),
        puzzle_titles=puzzle_titles,
    )


def run_player_message_turn(
    message: str,
    *,
    state: Mapping[str, Any],
    content: NpcTurnContent,
    general_generator: ModelGenerator | None = None,
    generation_enabled: bool = False,
) -> NpcTurnResult:
    outcome = respond_to_player_message(
        message,
        case_id=content.case_id,
        state=state,
        client=content.client,
        runtime=content.runtime,
        npc_pack=content.npc_pack,
        npc_id=content.npc_id or "",
        line_source=content.line_source,
        hint_source=content.hint_source,
        puzzle_titles=content.puzzle_titles,
        generic_line_approval=content.generic_line_approval,
        general_generator=general_generator,
        generation_enabled=generation_enabled,
        policy_rules=content.policy_rules,
        fallback_lines=content.fallback_lines,
        general_pack_lines=content.general_pack_lines,
    )
    return NpcTurnResult(
        trigger="player_message",
        reply=outcome.reply,
        no_reply_reason=outcome.no_reply_reason,
        suggest_hint=outcome.suggest_hint,
        diagnosis=outcome.diagnosis,
        policy=outcome.policy,
    )


def run_auto_turn(
    decision: NpcDecision,
    *,
    state: Mapping[str, Any],
    content: NpcTurnContent,
) -> NpcTurnResult:
    """판단 결과에 따라 허용된 동작만 한다. 생성기는 받지 않는다(자동 개입은 생성하지 않는다)."""

    if not decision.intervene:
        return NpcTurnResult("auto", None, decision.reason, None, decision)
    actions = allowed_auto_actions(decision.intervention_level)
    target = decision.target_puzzle_id

    if "nudge" in actions and content.npc_id is not None:
        nudge = _revealed_approved_nudge(
            content.npc_pack,
            content.npc_id,
            target,
            state,
            content.case_id,
            content.line_source,
        )
        if nudge is not None:
            _ensure_no_protected_text(
                nudge.text,
                content.case_id,
                content.runtime,
                content.hint_source,
                allowed_puzzle_id=None,
            )
            reply = NpcReply("approved_line", nudge.text, nudge.line_id)
            return NpcTurnResult("auto", reply, None, None, decision)

    if (
        "hint_guidance" in actions
        and target is not None
        and _has_server_hint(content.case_id, target, content.hint_source)
        and content.generic_line_approval(GENERIC_WITH_HINT_SUGGESTION)
    ):
        text = PM_GENERIC_PUZZLE_LINES[GENERIC_WITH_HINT_SUGGESTION]
        reply = NpcReply("approved_line", text, GENERIC_WITH_HINT_SUGGESTION)
        return NpcTurnResult("auto", reply, None, SuggestHint(target), decision)

    return NpcTurnResult("auto", None, "no_approved_line", None, decision)
