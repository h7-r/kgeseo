"""NPC 자동 개입 판단 — P3 규칙 기준선 이식 (PM v0.4.3)."""

import json
from dataclasses import dataclass, fields
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.npc_content import NpcAutoNudgeConfig
from app.services.npc_decision import (
    AutoIntervention,
    DecisionSignals,
    RuleConfig,
    decide,
    rule_config_for,
    rule_fires,
    signals_from_events,
)

PARITY = Path(__file__).resolve().parent / "fixtures" / "npc_rule_parity.json"
NOW = datetime(2026, 10, 29, 12, 0, 0)


def test_rule_matches_shared_parity_fixture() -> None:
    data = json.loads(PARITY.read_text(encoding="utf-8"))
    config = RuleConfig(
        consecutive_min=data["consecutive_min"], idle_min_sec=data["idle_min_sec"]
    )

    for case in data["cases"]:
        signals = DecisionSignals(
            player_requested_help=case["help"],
            target_puzzle_id=case["target"],
            target_consecutive_incorrect=case["consecutive"],
            since_last_interaction_sec=case["idle"],
        )
        assert (rule_fires(signals, config) is not None) == case["fires"], case["id"]


def signals(**kw) -> DecisionSignals:
    base = dict(
        player_requested_help=False,
        target_puzzle_id="PZ_A",
        target_consecutive_incorrect=6,
        since_last_interaction_sec=1.0,
    )
    return DecisionSignals(**(base | kw))


def test_fired_rule_intervenes_at_level_one_only() -> None:
    for kw in (
        {},
        {"player_requested_help": True},
        {"since_last_interaction_sec": 999.0},
    ):
        decision = decide(signals(**kw))
        assert (decision.intervene, decision.intervention_level) == (True, 1)


def test_no_rule_means_no_intervention() -> None:
    decision = decide(signals(target_consecutive_incorrect=0))

    assert (decision.intervene, decision.intervention_level, decision.reason) == (
        False,
        0,
        "not_needed",
    )


@pytest.mark.parametrize(
    ("kw", "reason"),
    [
        # PM v0.4.7: 표시된 제안 사이 180초, 거절 뒤 600초, 퍼즐당 2회
        ({"since_last_intervention_sec": 179.0}, "cooldown"),
        ({"since_last_decline_sec": 599.0}, "declined_cooldown"),
        ({"interventions_for_target": 2}, "policy_blocked"),
    ],
)
def test_cooldown_and_caps_block(kw: dict, reason: str) -> None:
    decision = decide(signals(**kw))

    assert (decision.intervene, decision.reason) == (False, reason)


@pytest.mark.parametrize(
    "kw",
    [
        {"since_last_intervention_sec": 180.0},
        {"since_last_decline_sec": 600.0},
        {"interventions_for_target": 1},
        # 세션당 제한 없음(PM v0.4.7)
        {"interventions_in_session": 50},
    ],
)
def test_pm_v047_boundaries_allow_intervention(kw: dict) -> None:
    decision = decide(signals(**kw))

    assert (decision.intervene, decision.reason) == (True, "repeated_incorrect")
    assert decision.trigger_value == 6


def test_pm_v047_server_defaults() -> None:
    config = RuleConfig()

    assert (
        config.consecutive_min,
        config.idle_min_sec,
        config.max_per_puzzle,
        config.max_per_session,
        config.cooldown_sec,
        config.decline_cooldown_sec,
    ) == (6, 240.0, 2, None, 180.0, 600.0)


def test_case_auto_nudge_overrides_only_given_fields() -> None:
    overrides = NpcAutoNudgeConfig(
        consecutive_incorrect_min=3, max_per_session=4, decline_cooldown_seconds=60
    )
    config = rule_config_for(overrides)

    assert (config.consecutive_min, config.max_per_session) == (3, 4)
    assert config.decline_cooldown_sec == 60
    # 적지 않은 값은 서버 기본값 그대로
    assert (config.idle_min_sec, config.cooldown_sec, config.max_per_puzzle) == (
        240.0,
        180.0,
        2,
    )
    assert rule_config_for(None) == RuleConfig()
    assert decide(signals(target_consecutive_incorrect=3), config).intervene
    assert not decide(signals(target_consecutive_incorrect=3)).intervene
    assert (
        decide(signals(interventions_in_session=4), config).reason == "policy_blocked"
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"consecutive_incorrect_min": 0},
        {"idle_seconds": -1},
        {"max_per_puzzle": True},
        {"suggestion_cooldown_seconds": "180"},
        {"unknown_field": 1},
    ],
)
def test_auto_nudge_config_rejects_invalid_values(bad: dict) -> None:
    with pytest.raises(ValidationError):
        NpcAutoNudgeConfig.model_validate(bad)


def test_decision_inputs_have_no_hint_level() -> None:
    names = {f.name for f in fields(DecisionSignals)}

    assert not any("hint" in name for name in names)


# --- 이벤트 → 신호 ---


@dataclass
class Event:
    interaction_type: str
    target_id: str | None
    result_type: str
    created_at: datetime


def ev(kind: str, target: str | None, result: str, seconds_ago: float) -> Event:
    return Event(kind, target, result, NOW - timedelta(seconds=seconds_ago))


def test_consecutive_incorrect_counts_back_to_last_non_incorrect() -> None:
    events = [
        ev("submit_answer", "PZ_A", "incorrect", 50),
        ev("submit_answer", "PZ_A", "correct", 40),
        ev("submit_answer", "PZ_A", "incorrect", 30),
        ev("submit_answer", "PZ_B", "incorrect", 25),  # 다른 퍼즐은 끊지 않는다
        ev("inspect", "OBJ", "ok", 22),
        ev("submit_answer", "PZ_A", "incorrect", 20),
    ]

    result = signals_from_events(events, now=NOW, target_puzzle_id="PZ_A")

    assert result.target_consecutive_incorrect == 2
    assert result.since_last_interaction_sec == 20.0


def test_npc_and_hint_events_are_not_player_activity() -> None:
    events = [
        ev("inspect", "OBJ", "ok", 300),
        ev("npc_nudge_given", "NUDGE_X", "nudge_given", 10),
        ev("unlock_hint", "PZ_A", "hint_unlocked", 5),
    ]

    result = signals_from_events(events, now=NOW, target_puzzle_id="PZ_A")

    assert result.since_last_interaction_sec == 300.0


def test_no_target_or_no_events_are_unobserved() -> None:
    result = signals_from_events([], now=NOW, target_puzzle_id=None)

    assert result.target_consecutive_incorrect is None
    assert result.since_last_interaction_sec is None


def test_past_interventions_feed_cooldown_and_caps() -> None:
    past = [
        AutoIntervention(NOW - timedelta(seconds=500), "PZ_A"),
        AutoIntervention(NOW - timedelta(seconds=30), "PZ_B"),
    ]

    result = signals_from_events(
        [], now=NOW, target_puzzle_id="PZ_A", past_interventions=past
    )

    assert result.since_last_intervention_sec == 30.0
    assert result.interventions_in_session == 2
    assert result.interventions_for_target == 1


def test_past_declines_feed_decline_cooldown() -> None:
    result = signals_from_events(
        [],
        now=NOW,
        target_puzzle_id="PZ_A",
        past_declines=[NOW - timedelta(seconds=900), NOW - timedelta(seconds=120)],
    )

    assert result.since_last_decline_sec == 120.0
    assert result.interventions_in_session == 0


def test_paused_time_is_not_idle_time() -> None:
    """멈춤 메뉴 · 설정처럼 게임이 얼어 있던 시간은 무입력에서 뺀다(미르 11/11) — 경과보다 크면 0."""
    events = [ev("inspect", "OBJ", "ok", 300)]

    paused = signals_from_events(
        events, now=NOW, target_puzzle_id="PZ_A", paused_sec=100
    )
    over = signals_from_events(
        events, now=NOW, target_puzzle_id="PZ_A", paused_sec=900
    )
    none = signals_from_events([], now=NOW, target_puzzle_id="PZ_A", paused_sec=100)

    assert paused.since_last_interaction_sec == 200.0
    assert decide(paused).reason == "not_needed"
    assert decide(signals_from_events(events, now=NOW, target_puzzle_id="PZ_A")).reason == "idle_too_long"
    assert over.since_last_interaction_sec == 0.0
    assert none.since_last_interaction_sec is None
