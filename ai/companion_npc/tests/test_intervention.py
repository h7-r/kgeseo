"""런타임 개입 결정 — intervention_level (PM v0.4.3)."""

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import load_fixture
from pydantic import ValidationError

from companion_npc.contracts.intervention import (
    INTERVENTION_LEVEL_MEANING,
    RuntimeDecision,
    to_runtime_decision,
)
from companion_npc.contracts.npc_utterance import Decision, NpcUtterance

MODULE = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "companion_npc"
    / "contracts"
    / "intervention.py"
)


def _decision(**overrides) -> Decision:
    base = {
        "intervene": True,
        "reason_code": "stuck_detected",
        "target_puzzle_id": "PZ_A",
        "npc_hint_level": 2,
        "method": "rule",
        "model_version": "rule/0.1",
    }
    return Decision.model_validate(base | overrides)


def test_meanings_follow_pm_contract() -> None:
    assert INTERVENTION_LEVEL_MEANING == {
        0: "개입 없음",
        1: "주의 환기",
        2: "방향 제시 또는 힌트 안내",
    }


@pytest.mark.parametrize("level", [1, 2])
def test_legacy_decision_maps_level_by_name_only(level: int) -> None:
    runtime = to_runtime_decision(_decision(npc_hint_level=level))
    dumped = runtime.model_dump()

    assert dumped["intervention_level"] == level
    assert "npc_hint_level" not in dumped


def test_committed_utterance_fixture_converts() -> None:
    utterance = NpcUtterance.model_validate(load_fixture("npc_utterance_case_001.json"))

    runtime = to_runtime_decision(utterance.decision)

    assert runtime.intervention_level == utterance.decision.npc_hint_level


def test_no_intervention_maps_to_zero() -> None:
    runtime = to_runtime_decision(
        _decision(intervene=False, npc_hint_level=0, reason_code="not_needed")
    )

    assert (runtime.intervene, runtime.intervention_level) == (False, 0)


def test_legacy_check_in_level_zero_is_not_a_runtime_decision() -> None:
    with pytest.raises(ValidationError):
        to_runtime_decision(_decision(npc_hint_level=0, target_puzzle_id=None))


def test_runtime_json_rejects_legacy_name_and_text_fields() -> None:
    base = to_runtime_decision(_decision()).model_dump()

    for extra in (
        {"npc_hint_level": 2},
        {"hint_level": 2},
        {"text": "x"},
        {"hint_text": "x"},
    ):
        with pytest.raises(ValidationError):
            RuntimeDecision.model_validate(base | extra)


def test_runtime_decision_has_no_hint_level_or_speech_fields() -> None:
    assert set(RuntimeDecision.model_fields) == {
        "intervene",
        "intervention_level",
        "reason_code",
        "target_puzzle_id",
        "confidence",
        "method",
        "model_version",
    }


@pytest.mark.parametrize("level", [-1, 3, True, "2"])
def test_invalid_levels_are_rejected(level) -> None:
    base = to_runtime_decision(_decision()).model_dump()

    with pytest.raises(ValidationError):
        RuntimeDecision.model_validate(base | {"intervention_level": level})


# --- 생성 경로와 분리 ---


def test_runtime_module_does_not_import_speech_or_llm() -> None:
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    imported = [
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    ] + [
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    ]

    assert not [m for m in imported if "speech" in m or "llm" in m]


def test_importing_runtime_contract_loads_no_generator() -> None:
    code = (
        "import sys, companion_npc.contracts.intervention as m; "
        "print(sorted(n for n in sys.modules "
        "if n.startswith(('companion_npc.speech', 'companion_npc.llm_net', 'openai'))))"
    )
    src = str(MODULE.parents[2])
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "PYTHONPATH": src, "PYTHONDONTWRITEBYTECODE": "1"},
    )

    assert result.stdout.strip() == "[]"
