"""NPC 자동 개입 판단 v0.2 (P3 규칙 기준선 이식 · 순수 함수 · 학습 모델 없음 · PM v0.4.7).

[출처] ai/companion_npc `training/baselines.py` 의 `RuleBaseline` 과 같은 규칙이다.
    개입 = 도움 요청 OR 대상 퍼즐 연속 오답 ≥ consecutive_min OR (대상 있음 AND 마지막 상호작용 뒤 ≥ idle_min_sec)
    관측 없음(None)인 조건은 거짓으로 본다.
같은 판정인지는 두 환경이 함께 읽는 견본(`tests/fixtures/npc_rule_parity.json`)으로 확인한다.

[왜 import 하지 않나] NPC 실험 패키지는 Python 3.12 · numpy 에 묶여 있고(pyproject `<3.13`), BE 런타임은
Python 3.13 이며 numpy 가 없다. 학습한 logreg · LightGBM 모델은 파일로 남아 있지 않아(결과 JSON 만 있다)
재학습 없이 쓸 수 없다. 그래서 학습이 필요 없는 규칙 기준선만 옮긴다.

[기본값 — PM v0.4.7] 연속 오답 6회 · 무입력 240초 · 퍼즐당 최대 2회 · 세션당 제한 없음 · 제안 사이 180초 ·
거절 뒤 600초. 케이스 `npc.json.auto_nudge`가 있으면 적은 값만 덮어쓴다(`rule_config_for`).

[횟수 · 쿨다운] 실제로 화면에 표시된 제안(`npc_suggestion_shown`)만 퍼즐당 · 세션당 횟수와 180초 쿨다운에 들어간다.
표시되지 않은 제안(`npc_suggestion_suppressed`, 응답만 하고 보고가 없는 제안)은 소모하지 않는다. 거절
(`npc_suggestion_declined`)은 600초 쿨다운을 건다.

[개입 단계] 규칙은 「개입할지」만 정하고 `intervention_level` 1(주의 환기)로 둔다. 2단계(힌트 안내)로 올리는 것은
`npc_turn.run_auto_turn`이 「연속 오답 · 승인 넛지 없음」일 때만 한다. `hint_levels`(해금 상태)는 읽지도 바꾸지도 않는다.
"""

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal

from app.schemas.npc_content import NpcAutoNudgeConfig
from app.services.npc_intervention import InterventionLevel

DecisionReason = Literal[
    "player_requested",
    "repeated_incorrect",
    "idle_too_long",
    "not_needed",
    "cooldown",
    "declined_cooldown",
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
    # 표시된 제안 사이 최소 간격
    cooldown_sec: float = 180.0
    # 플레이어가 거절한 뒤 최소 간격
    decline_cooldown_sec: float = 600.0
    max_per_session: int | None = None
    max_per_puzzle: int | None = 2


def rule_config_for(
    overrides: NpcAutoNudgeConfig | None, base: RuleConfig = RuleConfig()
) -> RuleConfig:
    """케이스 `npc.json.auto_nudge`가 적은 값만 서버 기본값을 덮어쓴다."""

    if overrides is None:
        return base
    mapping = {
        "consecutive_incorrect_min": "consecutive_min",
        "idle_seconds": "idle_min_sec",
        "max_per_puzzle": "max_per_puzzle",
        "max_per_session": "max_per_session",
        "suggestion_cooldown_seconds": "cooldown_sec",
        "decline_cooldown_seconds": "decline_cooldown_sec",
    }
    changes = {
        target: getattr(overrides, source)
        for source, target in mapping.items()
        if getattr(overrides, source) is not None
    }
    return replace(base, **changes)


@dataclass(frozen=True)
class DecisionSignals:
    """판단 입력. 서버 상태 · 이벤트에서만 만든다. None 은 「관측 없음」."""

    player_requested_help: bool
    target_puzzle_id: str | None
    target_consecutive_incorrect: int | None
    since_last_interaction_sec: float | None
    # 마지막으로 표시된 제안 뒤 지난 시간
    since_last_intervention_sec: float | None = None
    # 마지막 거절 뒤 지난 시간
    since_last_decline_sec: float | None = None
    # 표시된 제안 수
    interventions_in_session: int = 0
    interventions_for_target: int = 0


@dataclass(frozen=True)
class NpcDecision:
    intervene: bool
    intervention_level: InterventionLevel
    reason: DecisionReason
    target_puzzle_id: str | None
    # 규칙이 본 값(연속 오답 수 · 무입력 초). 기록용
    trigger_value: float | None = None


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


def _trigger_value(reason: DecisionReason, signals: DecisionSignals) -> float | None:
    if reason == "repeated_incorrect":
        return signals.target_consecutive_incorrect
    if reason == "idle_too_long":
        return signals.since_last_interaction_sec
    return None


def decide(signals: DecisionSignals, config: RuleConfig = RuleConfig()) -> NpcDecision:
    reason = rule_fires(signals, config)
    target = signals.target_puzzle_id
    if reason is None:
        return NpcDecision(False, 0, "not_needed", target)
    value = _trigger_value(reason, signals)
    if (
        signals.since_last_decline_sec is not None
        and signals.since_last_decline_sec < config.decline_cooldown_sec
    ):
        return NpcDecision(False, 0, "declined_cooldown", target, value)
    if (
        signals.since_last_intervention_sec is not None
        and signals.since_last_intervention_sec < config.cooldown_sec
    ):
        return NpcDecision(False, 0, "cooldown", target, value)
    if (
        config.max_per_session is not None
        and signals.interventions_in_session >= config.max_per_session
    ) or (
        target is not None
        and config.max_per_puzzle is not None
        and signals.interventions_for_target >= config.max_per_puzzle
    ):
        return NpcDecision(False, 0, "policy_blocked", target, value)
    return NpcDecision(True, 1, reason, target, value)


# --- 이벤트 → 신호 ---


@dataclass(frozen=True)
class AutoIntervention:
    """화면에 표시된 자동 개입 제안 한 번(표시 시각 · 대상 퍼즐)."""

    at: datetime
    puzzle_id: str | None


def signals_from_events(
    events: Iterable[Any],
    *,
    now: datetime,
    target_puzzle_id: str | None,
    player_requested_help: bool = False,
    past_interventions: Iterable[AutoIntervention] = (),
    past_declines: Iterable[datetime] = (),
) -> DecisionSignals:
    """`events`: interaction_events 행(interaction_type · target_id · result_type · created_at).

    시각은 BE 저장 형식과 같이 timezone 없는 UTC 로 본다(`now` 도 같은 형식).
    `past_interventions`는 표시된 제안만, `past_declines`는 거절 시각만 넘긴다.
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
    declines = sorted(past_declines)
    since_decline = (now - declines[-1]).total_seconds() if declines else None
    return DecisionSignals(
        player_requested_help=player_requested_help,
        target_puzzle_id=target_puzzle_id,
        target_consecutive_incorrect=consecutive,
        since_last_interaction_sec=since_last,
        since_last_intervention_sec=since_intervention,
        since_last_decline_sec=since_decline,
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
