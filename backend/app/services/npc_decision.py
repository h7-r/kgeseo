"""NPC 자동 개입 판단 v0.1 (P3 규칙 기준선 이식 · 순수 함수 · 학습 모델 없음).

[출처] ai/companion_npc `training/baselines.py` 의 `RuleBaseline` 과 같은 규칙이다.
    개입 = 도움 요청 OR 대상 퍼즐 연속 오답 ≥ consecutive_min OR (대상 있음 AND 마지막 상호작용 뒤 ≥ idle_min_sec)
    관측 없음(None)인 조건은 거짓으로 본다.
같은 판정인지는 두 환경이 함께 읽는 견본(`tests/fixtures/npc_rule_parity.json`)으로 확인한다.

[왜 import 하지 않나] NPC 실험 패키지는 Python 3.12 · numpy 에 묶여 있고(pyproject `<3.13`), BE 런타임은
Python 3.13 이며 numpy 가 없다. 학습한 logreg · LightGBM 모델은 파일로 남아 있지 않아(결과 JSON 만 있다)
재학습 없이 쓸 수 없다. 그래서 학습이 필요 없는 규칙 기준선만 옮긴다.

[기본값] `RuleConfig` 기본값은 P3-A 합성 데이터 실험에서 고른 값(6회 · 240초)과 `docs/09` 의 개입 상한
(세션 3 · 퍼즐 2 · 60초)이다. 둘 다 **실험값이며 운영 확정값이 아니다**.

[개입 단계] 규칙은 「개입할지」만 정한다. 개입하면 `intervention_level` 1(주의 환기)로 둔다. 2(방향 제시 ·
힌트 안내)로 올리는 조건은 정해지지 않아 자동 판단은 1 을 넘지 않는다. `hint_levels`(해금 상태)는 읽지도
바꾸지도 않는다.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from app.services.npc_intervention import InterventionLevel

DecisionReason = Literal[
    "player_requested",
    "repeated_incorrect",
    "idle_too_long",
    "not_needed",
    "cooldown",
    "policy_blocked",
]
ANSWER_INTERACTION_TYPE = "submit_answer"
# 플레이어 행동이 아닌 기록(NPC · 힌트). 「마지막 상호작용」 계산에서 뺀다.
NON_PLAYER_INTERACTION_PREFIXES = ("npc_",)
NON_PLAYER_INTERACTION_TYPES = frozenset({"unlock_hint"})


@dataclass(frozen=True)
class RuleConfig:
    consecutive_min: int = 6
    idle_min_sec: float = 240.0
    cooldown_sec: float = 60.0
    max_per_session: int | None = 3
    max_per_puzzle: int | None = 2


@dataclass(frozen=True)
class DecisionSignals:
    """판단 입력. 서버 상태 · 이벤트에서만 만든다. None 은 「관측 없음」."""

    player_requested_help: bool
    target_puzzle_id: str | None
    target_consecutive_incorrect: int | None
    since_last_interaction_sec: float | None
    since_last_intervention_sec: float | None = None
    interventions_in_session: int = 0
    interventions_for_target: int = 0


@dataclass(frozen=True)
class NpcDecision:
    intervene: bool
    intervention_level: InterventionLevel
    reason: DecisionReason
    target_puzzle_id: str | None


def rule_fires(signals: DecisionSignals, config: RuleConfig) -> DecisionReason | None:
    """P3 RuleBaseline 과 같은 판정. 맞으면 이유, 아니면 None."""

    if signals.player_requested_help:
        return "player_requested"
    if (
        signals.target_consecutive_incorrect is not None
        and signals.target_consecutive_incorrect >= config.consecutive_min
    ):
        return "repeated_incorrect"
    if (
        signals.target_puzzle_id is not None
        and signals.since_last_interaction_sec is not None
        and signals.since_last_interaction_sec >= config.idle_min_sec
    ):
        return "idle_too_long"
    return None


def decide(signals: DecisionSignals, config: RuleConfig = RuleConfig()) -> NpcDecision:
    reason = rule_fires(signals, config)
    target = signals.target_puzzle_id
    if reason is None:
        return NpcDecision(False, 0, "not_needed", target)
    if (
        signals.since_last_intervention_sec is not None
        and signals.since_last_intervention_sec < config.cooldown_sec
    ):
        return NpcDecision(False, 0, "cooldown", target)
    if (
        config.max_per_session is not None
        and signals.interventions_in_session >= config.max_per_session
    ) or (
        target is not None
        and config.max_per_puzzle is not None
        and signals.interventions_for_target >= config.max_per_puzzle
    ):
        return NpcDecision(False, 0, "policy_blocked", target)
    return NpcDecision(True, 1, reason, target)


# --- 이벤트 → 신호 ---


@dataclass(frozen=True)
class AutoIntervention:
    """지난 자동 개입 한 번(시각 · 대상 퍼즐)."""

    at: datetime
    puzzle_id: str | None


def signals_from_events(
    events: Iterable[Any],
    *,
    now: datetime,
    target_puzzle_id: str | None,
    player_requested_help: bool = False,
    past_interventions: Iterable[AutoIntervention] = (),
) -> DecisionSignals:
    """`events`: interaction_events 행(interaction_type · target_id · result_type · created_at).

    시각은 BE 저장 형식과 같이 timezone 없는 UTC 로 본다(`now` 도 같은 형식).
    """

    ordered = sorted(events, key=lambda e: e.created_at)
    player = [e for e in ordered if _is_player_event(e)]
    since_last = (now - player[-1].created_at).total_seconds() if player else None

    consecutive: int | None = None
    if target_puzzle_id is not None:
        consecutive = 0
        for event in reversed(player):
            if (
                event.interaction_type != ANSWER_INTERACTION_TYPE
                or event.target_id != target_puzzle_id
            ):
                continue
            if event.result_type != "incorrect":
                break
            consecutive += 1

    past = sorted(past_interventions, key=lambda p: p.at)
    since_intervention = (now - past[-1].at).total_seconds() if past else None
    return DecisionSignals(
        player_requested_help=player_requested_help,
        target_puzzle_id=target_puzzle_id,
        target_consecutive_incorrect=consecutive,
        since_last_interaction_sec=since_last,
        since_last_intervention_sec=since_intervention,
        interventions_in_session=len(past),
        interventions_for_target=sum(
            1 for p in past if target_puzzle_id and p.puzzle_id == target_puzzle_id
        ),
    )


def _is_player_event(event: Any) -> bool:
    kind = event.interaction_type
    return not (
        kind in NON_PLAYER_INTERACTION_TYPES
        or kind.startswith(NON_PLAYER_INTERACTION_PREFIXES)
    )
