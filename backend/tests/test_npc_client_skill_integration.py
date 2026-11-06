"""Synthetic combined publication contracts for NPC policy and client_skill."""

import pytest

from tests.test_npc_pack_policy_v0414 import pack
from tests.test_publication_gate import base_documents, run, seal


def skill_documents():
    docs = base_documents()
    docs["server"]["puzzles"][0].pop("accepted_answers")
    docs["server"]["puzzles"][0]["solve"] = {"mode": "client_skill"}
    docs["client"]["zones"][0]["objects"][0]["interaction"]["type"] = "complete"
    return docs


def evaluate(docs, general_pack=None):
    docs.pop("idmap", None)
    files, fingerprint = seal(docs)
    return run({**files, "idmap": None}, fingerprint, general_pack=general_pack)


def test_skill_with_explicit_empty_review_lists_and_safe_general_pack_registers():
    docs = skill_documents()
    result, store = evaluate(
        docs, pack(("GENERIC_PAUSE_09", "(가상) 잠시 생각을 가다듬자."))
    )
    assert result.approved and result.registered
    for code in ("POLICY_DATA", "CLIENT_SERVER", "LEAK_CLIENT", "GEN_PACK"):
        assert result.check(code).status == "PASS"
    bundle = store.get_version(result.case_id, result.content_version)
    assert bundle.server().puzzles[0].accepted_answers == []
    assert bundle.server().puzzles[0].solve.mode == "client_skill"
    assert bundle.npc().ng == [] and bundle.npc().proper_nouns == []


@pytest.mark.parametrize("field", ["proper_nouns", "ng"])
@pytest.mark.parametrize("missing", [True, False])
def test_skill_does_not_bypass_required_npc_review_data(field, missing):
    docs = skill_documents()
    if missing:
        del docs["npc"][field]
    else:
        docs["npc"][field] = None
    result, store = evaluate(docs)
    assert result.check("POLICY_DATA").status == "FAIL"
    assert f"npc:{field}:required" in result.check("POLICY_DATA").reasons
    assert not result.registered and not store.versions(result.case_id)


@pytest.mark.parametrize(
    "text,code",
    [
        ("가상통합인물", "GEN-CASE"),
        ("가상통합별칭", "GEN-CASE"),
        ("자물쇠", "GEN-CASE"),
        ("가상통합금칙", "GEN-LEAK"),
        ("가상통합정답", "GEN-LEAK"),
    ],
)
def test_general_pack_checks_still_cover_mixed_skill_and_answer_bundle(text, code):
    docs = skill_documents()
    docs["npc"]["proper_nouns"] = [
        {"text": "가상통합인물", "kind": "person", "aliases": ["가상통합별칭"]}
    ]
    docs["npc"]["ng"] = [{"text": "가상 규칙", "patterns": ["가상통합금칙"]}]
    docs["server"]["puzzles"].append(
        {
            "puzzle_id": "VALUE_INTEGRATION_TEST",
            "accepted_answers": ["가상통합정답"],
            "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        }
    )
    result, store = evaluate(docs, pack(("GENERIC_PAUSE_09", text)))
    assert result.check("POLICY_DATA").status == "PASS"
    assert result.check("GEN_PACK").status == "FAIL"
    assert any(r.startswith(code + ":") for r in result.check("GEN_PACK").reasons)
    assert not result.registered and not store.versions(result.case_id)


def test_skill_executable_reference_gate_survives_policy_merge():
    docs = skill_documents()
    docs["idmap"]["objects"][0]["interaction"] = {"type": "complete"}
    docs["idmap"]["puzzles"][0]["status"] = "blocked"
    files, fingerprint = seal(docs)
    result, store = run(files, fingerprint, general_pack=None)
    assert result.check("POLICY_DATA").status == "PASS"
    assert result.check("EXECUTABLE_REFS").status == "FAIL"
    assert "interaction_puzzle:PUZZLE_A" in result.check("EXECUTABLE_REFS").reasons
    assert not result.registered and not store.versions(result.case_id)
