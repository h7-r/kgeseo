"""발화 파이프라인 — 계획 → 사전 조건 → 검색 → 생성 → 검증 → (대체) → NpcUtterance.

[사전 조건]
  · 팩이 published 이고 같은 사건이어야 한다. 아니면 보류.
  · nudge · hint 는 다음을 모두 확인한다.
    - 대상 퍼즐이 확인됨 (자동 = FE 포커스 · 요청 = 플레이어가 고름)
    - 아직 안 푼 퍼즐
    - 그 단계의 승인 힌트가 있음
    - 그 힌트 조각의 공개 조건이 열려 있음
    - NpcContext.limits.max_npc_hint_level 안
    하나라도 못 맞추면: 플레이어 요청 → clarify(일반 질문) · 자동 → 보류.
  · clarify 는 플레이어 요청에서만. 오브젝트 이름은 플레이어 메시지가 그 이름을 짚었을 때만
    (현재 구역에서 보이는 이름 조각과 TF-IDF 유사도 ≥ 0.3). 아니면 일반 질문.
  · LLM 생성기는 NpcContext.limits.allow_llm 이 참일 때만 쓴다. 아니면 템플릿으로 바꾼다.

[검증 실패] 승인 템플릿으로 대체하고 **그것도 검증**한다. 그래도 실패하면 보류한다.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime

from companion_npc.adapters.npc_merge import MergedPack
from companion_npc.contracts.npc_context import NpcContext
from companion_npc.contracts.npc_utterance import (
    KIND_LEVEL,
    Decision,
    Generation,
    Grounding,
    Initiator,
    NpcUtterance,
    ReasonCode,
    Safety,
    Speech,
    UtteranceKind,
)
from companion_npc.contracts.scenario_pack import ApprovedHint
from companion_npc.contracts.visibility import visible_chunks
from companion_npc.speech.generators import Draft, Generator, TemplateGenerator
from companion_npc.speech.guard import SpeechGuard
from companion_npc.speech.payload import build_payload, sanitize_player_message
from companion_npc.speech.retrieval import allowed_chunks, rank

OBJECT_MATCH_MIN = 0.3
MODEL_VERSION = "p4a/0.1"


@dataclass(frozen=True)
class SpeechPlan:
    """판단층(또는 테스트 · 플레이어 요청)이 정한 것."""

    kind: UtteranceKind
    initiator: Initiator
    target_puzzle_id: str | None = None
    target_confirmed: bool = (
        False  # 자동: observed_focus · 요청: 플레이어가 대상을 골랐음
    )
    player_message: str | None = None
    reason_code: ReasonCode = "stuck_detected"
    # FE 가 「지금 플레이어에게 보인다」고 확인한 오브젝트. clarify 가 이름을 쓸 수 있는 유일한 근거다.
    # 비어 있으면 clarify 는 언제나 일반 질문이다.
    confirmed_visible_object_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class SpeechOutcome:
    utterance: NpcUtterance
    status: str  # spoke · fallback · held
    requested_kind: UtteranceKind
    final_kind: UtteranceKind | None
    failures: tuple[str, ...]
    downgrade_reason: str | None


def _uid(*parts: str) -> str:
    return "utt-" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:24]


def _approved_hint(
    merged: MergedPack, context: NpcContext, puzzle_id: str, level: int
) -> ApprovedHint | None:
    """그 단계의 승인 힌트 중, 지금 공개 조건이 열린 힌트 조각이 있는 것."""

    open_hint_ids = {
        c.hint_id
        for c in visible_chunks(
            merged.pack, context.case_id, context.state, max_tier=level
        )
        if c.kind == "hint" and c.puzzle_id == puzzle_id
    }
    return next(
        (
            h
            for h in merged.pack.hints
            if h.puzzle_id == puzzle_id
            and h.npc_hint_level == level
            and h.hint_id in open_hint_ids
        ),
        None,
    )


def _hold(
    context: NpcContext,
    plan: SpeechPlan,
    merged: MergedPack,
    now: datetime,
    reason: str,
    failures=(),
) -> SpeechOutcome:
    utterance = NpcUtterance(
        utterance_id=_uid(context.request_id, plan.kind, "held"),
        request_id=context.request_id,
        play_session_id=context.play_session_id,
        created_at=now,
        decision=Decision(
            intervene=False,
            reason_code="policy_blocked",
            npc_hint_level=0,
            method="external",
            model_version=MODEL_VERSION,
        ),
        grounding=Grounding(pack_id=merged.pack.pack_id),
        safety=Safety(
            answer_leak_check="failed" if failures else "not_run", blocked_reason=reason
        ),
        initiator=plan.initiator,
    )
    return SpeechOutcome(utterance, "held", plan.kind, None, tuple(failures), reason)


def speak(
    context: NpcContext,
    plan: SpeechPlan,
    merged: MergedPack,
    generator: Generator,
    guard: SpeechGuard,
    *,
    now: datetime,
) -> SpeechOutcome:
    pack = merged.pack
    if (
        pack.publication.status != "published"
        or pack.case_id != context.case_id
        or pack.pack_id != context.pack_id
    ):
        return _hold(context, plan, merged, now, "pack_not_published_or_mismatch")

    kind: UtteranceKind = plan.kind
    downgrade = None
    if kind == "clarify" and plan.initiator != "player":
        kind, downgrade = "check_in", "clarify_requires_player"
    hint: ApprovedHint | None = None
    if kind in ("nudge", "hint"):
        level = min(KIND_LEVEL[kind], context.limits.max_npc_hint_level)
        if level < KIND_LEVEL[kind]:
            kind = "nudge" if level == 1 else kind
            downgrade = "level_cap"
        reason = None
        if level == 0:
            reason = "level_cap"
        elif not (plan.target_puzzle_id and plan.target_confirmed):
            reason = "target_unconfirmed"
        elif plan.target_puzzle_id in context.state.completed_puzzle_ids:
            reason = "target_completed"
        else:
            hint = _approved_hint(
                merged, context, plan.target_puzzle_id, KIND_LEVEL[kind]
            )
            if hint is None:
                reason = "no_approved_hint"
        if reason:
            if plan.initiator == "auto":
                return _hold(context, plan, merged, now, reason)
            kind, downgrade, hint = "clarify", reason, None

    message = sanitize_player_message(plan.player_message)
    chunks = allowed_chunks(
        pack,
        context.case_id,
        context.state,
        kind,
        plan.target_puzzle_id,
        frozenset(plan.confirmed_visible_object_ids),
    )
    object_name = None
    if kind == "clarify":
        best = rank(chunks, message, top_k=1)
        if best and best[0][1] >= OBJECT_MATCH_MIN:
            chunks, object_name = [best[0][0]], best[0][0].text
        else:
            chunks = []
    elif kind in ("nudge", "hint"):
        query = " ".join(t for t in (message, hint.text if hint else None) if t)
        chunks = [c for c, _ in rank(chunks, query, top_k=3)]
    payload = build_payload(
        request_id=context.request_id,
        kind=kind,
        initiator=plan.initiator,
        npc_hint_level=KIND_LEVEL[kind],
        persona=pack.persona,
        templates=merged.templates,
        hint=hint,
        chunks=chunks,
        object_name=object_name,
        player_message=message,
    )

    if generator.uses_llm and not context.limits.allow_llm:
        generator, downgrade = TemplateGenerator(), downgrade or "llm_not_allowed"
    try:
        draft = generator.generate(payload)
    except Exception as error:  # 생성기 오류도 대체 경로로
        draft, gen_error = None, type(error).__name__
    else:
        gen_error = None
    failures: tuple[str, ...] = ()
    status = "spoke"
    if draft is not None:
        result = guard.check(draft.text, payload, chunks)
        failures = result.failures
    if draft is None or failures:
        failures = failures or (
            (f"generator_error:{gen_error}",) if gen_error else ("no_draft",)
        )
        draft = TemplateGenerator().generate(payload)
        status = "fallback"
        if draft is None or not guard.check(draft.text, payload, chunks).passed:
            return _hold(context, plan, merged, now, "fallback_failed", failures)

    return SpeechOutcome(
        _utterance(
            context, plan, merged, now, kind, payload, chunks, hint, draft, failures
        ),
        status,
        plan.kind,
        kind,
        failures,
        downgrade,
    )


def _utterance(
    context, plan, merged, now, kind, payload, chunks, hint, draft: Draft, failures
) -> NpcUtterance:
    used = [
        payload.label_map[label]
        for label in draft.used_labels
        if label in payload.label_map
    ]
    chunk_ids = [cid for cid in used if not hint or cid != hint.hint_id]
    tiers = [c.spoiler_tier for c in chunks if c.chunk_id in chunk_ids]
    return NpcUtterance(
        utterance_id=_uid(context.request_id, kind),
        request_id=context.request_id,
        play_session_id=context.play_session_id,
        created_at=now,
        decision=Decision(
            intervene=True,
            reason_code="player_requested"
            if plan.initiator == "player"
            else plan.reason_code,
            target_puzzle_id=plan.target_puzzle_id
            if kind in ("nudge", "hint")
            else None,
            npc_hint_level=KIND_LEVEL[kind],
            method="external",
            model_version=MODEL_VERSION,
        ),
        speech=Speech(
            text=draft.text,
            display="dialog" if plan.initiator == "player" else "bubble",
        ),
        grounding=Grounding(
            pack_id=merged.pack.pack_id,
            hint_ids=[hint.hint_id] if hint and kind in ("nudge", "hint") else [],
            chunk_ids=[] if kind == "check_in" else chunk_ids,
            max_spoiler_tier_used=max(tiers, default=0),
        ),
        generation=Generation(
            method=draft.method,
            model_name=draft.model_name,
            prompt_version=draft.prompt_version,
            latency_ms=draft.latency_ms,
            tokens_in=draft.tokens_in,
            tokens_out=draft.tokens_out,
        ),
        safety=Safety(
            answer_leak_check="passed",
            blocked_reason=("fallback:" + ",".join(failures)) if failures else None,
        ),
        kind=kind,
        initiator=plan.initiator,
    )
