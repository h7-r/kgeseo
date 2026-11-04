"""Synthetic policy data only; never creates approval records or publishes."""

import pytest

from app.schemas.npc_content import NpcContentPack
from app.services.case_ng_check import build_case_ng_checker
from app.services.npc_line_supply import policy_rules_from_pack
from app.services.publication_gate import evaluate_publication
from tests.test_npc_generation_policy import check as runtime_check
from tests.test_publication_gate import ANSWER, base_documents, hint_source, seal


def pack_from(document):
    return NpcContentPack.model_validate(
        {k: v for k, v in document.items() if k != "generated_at"}
    )


def evaluate(documents):
    pack = pack_from(documents["npc"])
    del documents["idmap"]
    files, _ = seal(documents)
    result = evaluate_publication(
        **files,
        idmap=None,
        general_pack=None,
        ng_checker=build_case_ng_checker(pack),
        hint_source=hint_source,
    )
    assert not result.approved
    assert not result.registered
    assert result.check("APPROVALS").status == "FAIL"
    return result


@pytest.mark.parametrize(
    ("ng", "opened", "expected"),
    [
        (None, [], "UNVERIFIED"),
        ([], None, "UNVERIFIED"),
        ([], [], "PASS"),
        ([{"text": "..."}], [], "UNVERIFIED"),
        ([{"text": "주제", "patterns": ["금지", "!!!"]}], [], "UNVERIFIED"),
        ([], [{"text": "주제"}], "UNVERIFIED"),
        ([], [{"text": "주제", "patterns": ["!!!"]}], "UNVERIFIED"),
        ([], [{"text": "주제", "patterns": ["유보", "!!!"]}], "UNVERIFIED"),
    ],
)
def test_gate_rule_readiness(ng, opened, expected):
    docs = base_documents()
    for key, value in (("ng", ng), ("open", opened)):
        if value is not None:
            docs["npc"][key] = value
    assert evaluate(docs).check("NG").status == expected


@pytest.mark.parametrize("scope", ["general", "puzzle"])
@pytest.mark.parametrize("kind", ["ng", "open"])
def test_gate_checks_both_nudge_scopes(scope, kind):
    docs = base_documents()
    docs["npc"].update(ng=[], open=[])
    docs["npc"][kind] = [{"text": "주제", "patterns": ["등대 방향"]}]
    nudge = (
        docs["npc"]["general_nudges"][0]
        if scope == "general"
        else docs["npc"]["puzzles"][0]["nudges"][0]
    )
    nudge["text"] = "등대의, 방향을 봐."
    result = evaluate(docs)
    assert result.check("NG").status == "FAIL"
    assert result.check("NG").reasons == (nudge["line_id"],)


@pytest.mark.parametrize("kind", ["ng", "open"])
@pytest.mark.parametrize(
    "text", ["등대 방향", "등대의, 방향을 봐.", "등대 방향일지도", "주변을 봐."]
)
def test_matches_runtime(kind, text):
    doc = base_documents()["npc"]
    doc.update(ng=[], open=[])
    doc[kind] = [{"text": "주제", "patterns": ["등대 방향"]}]
    pack = pack_from(doc)
    checker = build_case_ng_checker(pack)
    assert checker is not None
    result = runtime_check(text, rules=policy_rules_from_pack(pack))
    flagged = any(v.code in ("NG", "U_ASSERT") for v in result.violations)
    assert checker(text) == flagged


def test_ng_text_fallback_and_pattern_precedence():
    doc = base_documents()["npc"]
    doc.update(ng=[{"text": "등대 방향"}], open=[])
    checker = build_case_ng_checker(pack_from(doc))
    assert checker is not None and checker("등대의 방향을")
    doc["ng"][0]["patterns"] = ["금지 문장"]
    checker = build_case_ng_checker(pack_from(doc))
    assert checker is not None and not checker("등대 방향")
    assert checker("금지 문장")


def test_leak_check_is_separate():
    docs = base_documents()
    docs["npc"].update(ng=[], open=[])
    docs["client"]["zones"][0]["description"] = ANSWER
    checker = build_case_ng_checker(pack_from(docs["npc"]))
    assert checker is not None and not checker(ANSWER)
    result = evaluate(docs)
    assert result.check("NG").status == "PASS"
    assert result.check("LEAK_CLIENT").status == "FAIL"


def test_fallback_and_scenario_are_outside_ng_scope():
    docs = base_documents()
    docs["npc"].update(
        ng=[{"text": "금지 문장"}],
        open=[],
        fallback_lines=[{"line_id": "FALLBACK", "text": "금지 문장", "use": "blocked"}],
        npc_scenario={"address": "금지 문장", "avoid_topics": ["금지 문장"]},
    )
    assert evaluate(docs).check("NG").status == "PASS"


def test_missing_pack():
    assert build_case_ng_checker(None) is None
