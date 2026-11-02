"""게임 런타임용 개입 결정 — `intervention_level` (PM v0.4.3).

[이름]
  런타임에서는 NPC 의 개입 강도를 `intervention_level` 이라 부른다.
    0 = 개입 없음 · 1 = 주의 환기 · 2 = 방향 제시 또는 힌트 안내
  backend 의 `hint_level`(PlaySession `hint_levels`, 정식 힌트 해금 상태)과 다른 값이다.
  이 계약에는 hint_level 칸이 없고, 어느 쪽 값도 다른 쪽으로 바꾸지 않는다.

[호환]
  P3 · P4 실험의 `Decision.npc_hint_level` 은 같은 눈금을 옛 이름으로 쓴다. 실험 JSON · 입력 해시를
  지키려고 실험 계약은 그대로 두고, `to_runtime_decision()` 이 이름만 옮긴다(값은 바꾸지 않는다).
  런타임 JSON 은 옛 이름 `npc_hint_level` 을 받지 않는다 — 두 이름이 섞이지 않게 한다.

[런타임에 없는 것]
  발화 문장 · 승인 힌트 · 근거 조각 · 생성기 정보. 런타임 개입 결정은 「무엇을 할지」만 담고,
  nudge 원문 · 힌트 안내는 backend 가 승인 콘텐츠에서 고른다(LLM 재작성 · 힌트 원문 생성 경로 없음).
  이 모듈은 speech(생성기 · LLM)를 import 하지 않는다 — tests/test_intervention.py 가 확인한다.
"""

from typing import Annotated

from pydantic import Field, model_validator

from companion_npc.contracts.common import ContractModel, Id
from companion_npc.contracts.npc_utterance import Decision, DecisionMethod, ReasonCode

# 0 · 1 · 2. bool · 문자열 · 실수는 받지 않는다(Literal 은 True 를 1 로 받아 버린다).
InterventionLevel = Annotated[int, Field(strict=True, ge=0, le=2)]
INTERVENTION_LEVEL_MEANING: dict[int, str] = {
    0: "개입 없음",
    1: "주의 환기",
    2: "방향 제시 또는 힌트 안내",
}


class RuntimeDecision(ContractModel):
    """판단층 → backend. 개입 여부와 강도만 담는다(문장 · hint_level 없음)."""

    intervene: bool
    intervention_level: InterventionLevel
    reason_code: ReasonCode
    target_puzzle_id: Id | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    method: DecisionMethod
    model_version: str = Field(min_length=1)

    @model_validator(mode="after")
    def _rules(self) -> "RuntimeDecision":
        if not self.intervene and self.intervention_level != 0:
            raise ValueError("intervention_level must be 0 when intervene is false")
        if self.intervene and self.intervention_level == 0:
            raise ValueError("intervene requires intervention_level 1 or 2")
        return self


def to_runtime_decision(decision: Decision) -> RuntimeDecision:
    """실험 계약의 Decision → 런타임 결정. `npc_hint_level` 값을 `intervention_level` 로 옮긴다.

    [check_in] 실험에서 check_in(잡담 · 안부)은 intervene=true · 단계 0 이었다. 런타임의 0 은
    「개입 없음」이라 뜻이 다르다. 같은 것으로 보지 않으려고 그 조합은 런타임 결정으로 옮기지 않는다
    (ValidationError). 실험 기록 · 페이로드는 그대로다. check_in 을 런타임에 쓰려면 어느 단계 · 어떤
    동작으로 옮길지 **명시적 매핑**을 정해 여기에 더해야 한다(PM 결정 전에는 거부를 유지한다).
    """

    return RuntimeDecision(
        intervene=decision.intervene,
        intervention_level=decision.npc_hint_level,
        reason_code=decision.reason_code,
        target_puzzle_id=decision.target_puzzle_id,
        confidence=decision.confidence,
        method=decision.method,
        model_version=decision.model_version,
    )
