import copy

import pytest
from pydantic import ValidationError

from companion_npc.contracts import NpcContext, NpcUtterance, ScenarioPack


# ── ScenarioPack ──────────────────────────────────────────────
@pytest.mark.parametrize("name", ["pack_case_001", "pack_fictional"])
def test_example_packs_are_valid(name, request):
    pack = ScenarioPack.model_validate(request.getfixturevalue(name))
    assert pack.contract_version == "0.1"


@pytest.mark.parametrize("field", ["accepted_answers", "answer"])
def test_pack_rejects_answer_fields_on_puzzle(pack_case_001, field):
    data = copy.deepcopy(pack_case_001)
    data["puzzles"][0][field] = ["VALVE"]
    with pytest.raises(ValidationError):
        ScenarioPack.model_validate(data)


def test_pack_rejects_unknown_top_level_field(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["clue_combinations"] = []
    with pytest.raises(ValidationError):
        ScenarioPack.model_validate(data)


def test_pack_rejects_dangling_reference(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["objects"][0]["puzzle_id"] = "PUZZLE_DOES_NOT_EXIST"
    with pytest.raises(ValidationError, match="unknown puzzle_id"):
        ScenarioPack.model_validate(data)


def test_pack_rejects_duplicate_ids(pack_fictional):
    data = copy.deepcopy(pack_fictional)
    data["zones"].append(copy.deepcopy(data["zones"][0]))
    with pytest.raises(ValidationError, match="duplicate zone_id"):
        ScenarioPack.model_validate(data)


def test_hint_chunk_must_keep_its_hint_level(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["knowledge"][3]["spoiler_tier"] = 0  # 2단계 힌트를 0등급으로 낮춰 적음
    with pytest.raises(ValidationError, match="spoiler_tier must equal"):
        ScenarioPack.model_validate(data)


def test_published_pack_requires_passed_audit(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["safety_audit"] = None
    with pytest.raises(ValidationError, match="safety_audit"):
        ScenarioPack.model_validate(data)


def test_approved_pack_requires_approver(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["publication"] = {"status": "approved"}
    with pytest.raises(ValidationError, match="approved_by"):
        ScenarioPack.model_validate(data)


def test_draft_pack_may_skip_audit(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["publication"] = {"status": "draft"}
    data["safety_audit"] = None
    ScenarioPack.model_validate(data)


# ── NpcContext ────────────────────────────────────────────────
def test_example_context_is_valid(context_case_001):
    ctx = NpcContext.model_validate(context_case_001)
    assert ctx.state.attempt_counts["PUZZLE_FIRE_CABINET_LOCK"] == 3


def test_context_rejects_raw_answer_payload(context_case_001):
    data = copy.deepcopy(context_case_001)
    data["recent_interactions"][0]["payload"] = {"answer": "VALVE"}
    with pytest.raises(ValidationError):
        NpcContext.model_validate(data)


def test_context_rejects_naive_timestamp(context_case_001):
    data = copy.deepcopy(context_case_001)
    data["requested_at"] = "2026-10-24T12:05:00"
    with pytest.raises(ValidationError, match="timezone"):
        NpcContext.model_validate(data)


def test_context_rejects_unordered_interactions(context_case_001):
    data = copy.deepcopy(context_case_001)
    data["recent_interactions"].reverse()
    with pytest.raises(ValidationError, match="oldest first"):
        NpcContext.model_validate(data)


def test_context_rejects_unknown_action(context_case_001):
    data = copy.deepcopy(context_case_001)
    data["recent_interactions"][0]["action"] = (
        "submit_answer"  # 내부 이름은 외부 계약에 없다
    )
    with pytest.raises(ValidationError):
        NpcContext.model_validate(data)


def test_player_request_needs_message(context_case_001):
    data = copy.deepcopy(context_case_001)
    data["trigger"] = {"type": "player_request", "source": "fe"}
    with pytest.raises(ValidationError, match="player_message"):
        NpcContext.model_validate(data)
    data["player_message"] = {"text": "어디를 봐야 할까?"}
    NpcContext.model_validate(data)


def test_context_ignores_new_backend_state_keys(context_case_001):
    data = copy.deepcopy(context_case_001)
    data["state"]["future_backend_key"] = 1
    NpcContext.model_validate(data)


# ── NpcUtterance ──────────────────────────────────────────────
def test_example_utterance_is_valid(utterance_case_001):
    NpcUtterance.model_validate(utterance_case_001)


def test_silence_is_valid(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["decision"].update(intervene=False, reason_code="cooldown", npc_hint_level=0)
    data["speech"] = None
    data["generation"] = None
    data["grounding"] = {"pack_id": "pack_case_001_fixture"}
    data["safety"] = {"answer_leak_check": "not_run"}
    NpcUtterance.model_validate(data)


def test_silence_cannot_carry_speech(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["decision"].update(intervene=False, reason_code="cooldown", npc_hint_level=0)
    with pytest.raises(ValidationError, match="no speech"):
        NpcUtterance.model_validate(data)


def test_hint_requires_approved_hint_grounding(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["grounding"]["hint_ids"] = []
    with pytest.raises(ValidationError, match="approved hint_id"):
        NpcUtterance.model_validate(data)


def test_speech_requires_passed_leak_check(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["safety"] = {"answer_leak_check": "not_run"}
    with pytest.raises(ValidationError, match="answer_leak_check"):
        NpcUtterance.model_validate(data)


def test_knowledge_tier_cannot_exceed_decision(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["grounding"]["max_spoiler_tier_used"] = 2
    with pytest.raises(ValidationError, match="above the decided"):
        NpcUtterance.model_validate(data)


def test_hint_level_three_does_not_exist(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["decision"]["npc_hint_level"] = 3
    with pytest.raises(ValidationError):
        NpcUtterance.model_validate(data)


def test_utterance_cannot_mutate_state(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["state_changes"] = [
        {"type": "hint_level_changed", "puzzle_id": "P", "hint_level": 2}
    ]
    with pytest.raises(ValidationError):
        NpcUtterance.model_validate(data)


# ── JSON Schema 를 뽑을 수 있어야 FE·BE 와 공유할 수 있다 ──────────
@pytest.mark.parametrize("model", [ScenarioPack, NpcContext, NpcUtterance])
def test_json_schema_exports(model):
    schema = model.model_json_schema()
    assert schema["additionalProperties"] is False
