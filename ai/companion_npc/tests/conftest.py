import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = REPO_ROOT / "backend"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def pack_case_001() -> dict:
    return load_fixture("scenario_pack_case_001.json")


@pytest.fixture
def pack_fictional() -> dict:
    return load_fixture("scenario_pack_fictional.json")


@pytest.fixture
def context_case_001() -> dict:
    return load_fixture("npc_context_case_001.json")


@pytest.fixture
def utterance_case_001() -> dict:
    return load_fixture("npc_utterance_case_001.json")
