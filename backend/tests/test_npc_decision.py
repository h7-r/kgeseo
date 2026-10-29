"""NPC 자동 개입 판단 — P3 규칙 기준선 이식 (PM v0.4.3)."""

import json
from dataclasses import dataclass, fields
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.services.npc_decision import (
    AutoIntervention,
    DecisionSignals,
    RuleConfig,
    decide,
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
        ({"since_last_intervention_sec": 59.0}, "cooldown"),
        ({"interventions_in_session": 3}, "policy_blocked"),
        ({"interventions_for_target": 2}, "policy_blocked"),
    ],
)
def test_cooldown_and_caps_block(kw: dict, reason: str) -> None:
    decision = decide(signals(**kw))

    assert (decision.intervene, decision.reason) == (False, reason)


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
