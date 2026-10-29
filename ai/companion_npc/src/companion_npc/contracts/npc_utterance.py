"""NpcUtterance v0.1 (초안) — NPC 의 결정과 발화, 그 근거.

[두 층의 출력이 한 객체에 모인다]
  decision   ← 판단층 (rule · logreg · lightgbm) : 끼어들까? 몇 단계로? 어느 퍼즐?
  speech     ← 발화층 (template · gpt_rag · qwen_local) : 뭐라고 말할까?
  grounding  ← 발화의 근거가 된 승인 힌트 · 지식 조각 ID
  safety     ← 정답 누설 검사 결과

[이 객체에 없는 것]
  state_changes. NPC 는 PlaySession 을 바꾸지 않는다 — 힌트 단계 저장·정답 판정은
  backend 책임이다. extra="forbid" 라서 그런 필드를 붙이면 검증에서 거부된다.
"""

from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import (
    CONTRACT_VERSION,
    AwareDatetime,
    ContractModel,
    Id,
    NpcHintLevel,
    SpoilerTier,
)

ReasonCode = Literal[
    # 개입
    "player_requested",
    "stuck_detected",
    "repeated_incorrect",
    "idle_too_long",
    "zone_entered",
    "progress_acknowledged",  # 퍼즐 완료·단서 획득에 짧게 반응
    # 비개입
    "not_needed",
    "cooldown",
    "paused",
    "level_cap_reached",
    "policy_blocked",  # 안전 검사 실패 등으로 막힘
]
# external — 판단 모델이 아니라 바깥(플레이어 요청 · 테스트)이 정한 결정 (P4-A 추가)
DecisionMethod = Literal["rule", "logreg", "lightgbm", "external"]
# fake — 테스트 전용 가짜 생성기 (P4-A 추가)
GenerationMethod = Literal["template", "gpt_rag", "qwen_local", "fake"]
# 발화 유형 · 시작 주체 (P4-A 추가). NPC 힌트 단계는 Hint API 의 hint_levels 와 별개다.
UtteranceKind = Literal["check_in", "clarify", "nudge", "hint"]
Initiator = Literal["auto", "player"]
KIND_LEVEL = {"check_in": 0, "clarify": 0, "nudge": 1, "hint": 2}
LeakCheck = Literal["passed", "failed", "not_run"]


class Decision(ContractModel):
    intervene: bool
    reason_code: ReasonCode
    target_puzzle_id: Id | None = None
    npc_hint_level: NpcHintLevel
    confidence: float | None = Field(default=None, ge=0, le=1)
    method: DecisionMethod
    model_version: str = Field(min_length=1)


class Speech(ContractModel):
    text: str = Field(min_length=1, max_length=280)
    display: Literal["bubble", "dialog"] = "bubble"


class Grounding(ContractModel):
    pack_id: Id
    hint_ids: list[Id] = Field(default_factory=list)
    chunk_ids: list[Id] = Field(default_factory=list)
    max_spoiler_tier_used: SpoilerTier = 0


class Generation(ContractModel):
    method: GenerationMethod
    model_name: str | None = None
    prompt_version: str | None = None
    latency_ms: int | None = Field(default=None, ge=0)
    tokens_in: int | None = Field(default=None, ge=0)
    tokens_out: int | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)


class Safety(ContractModel):
    answer_leak_check: LeakCheck
    blocked_reason: str | None = None


class NpcUtterance(ContractModel):
    contract: Literal["npc_utterance"] = "npc_utterance"
    contract_version: Literal["0.1"] = CONTRACT_VERSION
    utterance_id: str = Field(min_length=1, max_length=64)
    request_id: str = Field(min_length=1, max_length=64)  # NpcContext.request_id
    play_session_id: str = Field(min_length=1, max_length=36)
    created_at: AwareDatetime
    decision: Decision
    speech: Speech | None = None
    grounding: Grounding
    generation: Generation | None = None
    safety: Safety
    # P4-A 추가 — 이전 데이터(없음)와 호환되도록 선택 항목
    kind: UtteranceKind | None = None
    initiator: Initiator | None = None

    @model_validator(mode="after")
    def _rules(self) -> "NpcUtterance":
        d = self.decision
        if not d.intervene:
            if self.kind is not None:
                raise ValueError("kind only when the NPC speaks")
            if self.speech is not None or self.generation is not None:
                raise ValueError("no speech/generation when intervene is false")
            if d.npc_hint_level != 0:
                raise ValueError("npc_hint_level must be 0 when intervene is false")
            return self

        if self.speech is None or self.generation is None:
            raise ValueError("intervene requires speech and generation")
        # 힌트를 줄 때는 사람이 승인한 힌트가 근거여야 한다.
        if d.npc_hint_level >= 1:
            if d.target_puzzle_id is None:
                raise ValueError("hint utterance requires target_puzzle_id")
            if not self.grounding.hint_ids:
                raise ValueError(
                    "hint utterance requires at least one approved hint_id"
                )
        if self.kind is not None:
            # 유형마다 NPC 힌트 단계가 정해져 있다. check_in 은 검색을 하지 않는다.
            if d.npc_hint_level != KIND_LEVEL[self.kind]:
                raise ValueError(
                    f"{self.kind} requires npc_hint_level {KIND_LEVEL[self.kind]}"
                )
            if self.kind == "check_in" and (
                self.grounding.chunk_ids or self.grounding.hint_ids
            ):
                raise ValueError("check_in must not use retrieved knowledge or hints")
            if self.kind == "clarify" and self.grounding.hint_ids:
                raise ValueError("clarify must not use hints")
        if self.grounding.max_spoiler_tier_used > d.npc_hint_level:
            raise ValueError("used knowledge above the decided npc_hint_level")
        # 말을 내보내려면 누설 검사를 통과해야 한다.
        if self.safety.answer_leak_check != "passed":
            raise ValueError("speech requires answer_leak_check == 'passed'")
        return self
