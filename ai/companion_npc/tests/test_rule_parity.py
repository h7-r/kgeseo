"""P3 RuleBaseline ↔ backend npc_decision 규칙 동치 — 두 환경이 같은 견본을 읽는다.

backend(Python 3.13 · numpy 없음)는 이 패키지를 import 하지 않고 규칙을 옮겨 쓴다.
같은 견본(backend/tests/fixtures/npc_rule_parity.json)에서 여기 RuleBaseline 이 같은 판정을 내는지 본다.
"""

import json

import numpy as np
import pytest
from conftest import BACKEND_DIR

from companion_npc.training.baselines import RuleBaseline

FIXTURE = BACKEND_DIR / "tests" / "fixtures" / "npc_rule_parity.json"
COLUMNS = (
    "player_requested_help",
    "target_consecutive_incorrect",
    "target_known",
    "since_last_interaction_sec",
)

pytestmark = pytest.mark.skipif(not FIXTURE.is_file(), reason="backend not found")


def _nan(value):
    return np.nan if value is None else float(value)


def test_rule_baseline_matches_backend_parity_fixture() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rule = RuleBaseline(
        consecutive_min=data["consecutive_min"], idle_min_sec=data["idle_min_sec"]
    )
    X = np.array(
        [
            [
                1.0 if case["help"] else 0.0,
                _nan(case["consecutive"]),
                1.0 if case["target"] else 0.0,
                _nan(case["idle"]),
            ]
            for case in data["cases"]
        ]
    )

    scores = rule.score(X, COLUMNS)

    assert [bool(s) for s in scores] == [case["fires"] for case in data["cases"]]
