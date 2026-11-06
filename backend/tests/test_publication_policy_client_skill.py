"""Synthetic CLI contracts combining v0.4.15, NG/U and client_skill."""

import pytest

from app.core.config import settings
from scripts import publish_case_content as cli
from tests.test_case_publication_cli import (
    NeverOpened,
    approved,
    fake_view,
    forbid_publish,
    publish_args,
    run_publish,
    write_documents,
)
from tests.test_content_publication import documents
from tests.test_npc_pack_policy_v0414 import pack
from tests.test_publication_gate import ANSWER


def skill_documents():
    docs = documents()
    docs["npc"].update(ng=[], open=[], proper_nouns=[])
    docs["server"]["puzzles"][0].pop("accepted_answers")
    docs["server"]["puzzles"][0]["solve"] = {"mode": "client_skill"}
    docs["client"]["zones"][0]["objects"][0]["interaction"]["type"] = "complete"
    return docs


@pytest.mark.parametrize("field", ["ng", "open", "proper_nouns"])
@pytest.mark.parametrize("missing", [True, False])
def test_cli_missing_review_data_is_not_filled_in(tmp_path, monkeypatch, field, missing):
    docs = skill_documents()
    if missing:
        del docs["npc"][field]
    else:
        docs["npc"][field] = None
    fingerprint = write_documents(tmp_path, docs)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    code, out = run_publish(
        publish_args(tmp_path, "--db"), sessions=NeverOpened()
    )
    assert code == cli.EXIT_BLOCKED
    policy = "PASS" if field == "open" else "FAIL"
    ng = "PASS" if field == "proper_nouns" else "UNVERIFIED"
    assert f"{'POLICY_DATA':<16} {policy:<14}" in out
    assert f"{'NG':<16} {ng:<14}" in out
    assert "APPROVALS        PASS" in out
    if field != "open":
        assert f"npc:{field}:required" in out
        assert cli.CHECK_HINTS["POLICY_DATA"] in out


@pytest.mark.parametrize(
    "nouns", [[], [{"text": "가상인물", "kind": "person", "aliases": ["가상별칭"]}]]
)
def test_cli_accepts_empty_and_valid_policy_lists_for_skill(tmp_path, monkeypatch, nouns):
    docs = skill_documents()
    docs["npc"]["proper_nouns"] = nouns
    fingerprint = write_documents(tmp_path, docs)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    code, out = run_publish(publish_args(tmp_path, "--db"), sessions=NeverOpened())
    assert code == cli.EXIT_OK
    assert "POLICY_DATA      PASS" in out and "NG               PASS" in out
    assert "mode=read-only" in out


@pytest.mark.parametrize("scope", ["general", "puzzle"])
@pytest.mark.parametrize("kind", ["ng", "open"])
def test_cli_checks_both_nudge_scopes_with_runtime_rules(
    tmp_path, monkeypatch, scope, kind
):
    docs = skill_documents()
    docs["npc"][kind] = [{"text": "가상 주제", "patterns": ["등대 방향"]}]
    nudge = (
        docs["npc"]["general_nudges"][0]
        if scope == "general"
        else docs["npc"]["puzzles"][0]["nudges"][0]
    )
    nudge["text"] = "등대의, 방향을 봐."
    fingerprint = write_documents(tmp_path, docs)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    code, out = run_publish(publish_args(tmp_path, "--db"), sessions=NeverOpened())
    assert code == cli.EXIT_BLOCKED
    assert "NG               FAIL" in out and nudge["line_id"] in out
    assert "등대" not in out


@pytest.mark.parametrize("text,code", [("자물쇠", "GEN-CASE"), ("가상별도정답", "GEN-LEAK")])
def test_cli_keeps_general_pack_checks_for_mixed_skill_bundle(
    tmp_path, monkeypatch, text, code
):
    docs = skill_documents()
    docs["server"]["puzzles"].append(
        {
            "puzzle_id": "VALUE_SYNTHETIC",
            "accepted_answers": ["가상별도정답"],
            "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        }
    )
    fingerprint = write_documents(tmp_path, docs)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    monkeypatch.setattr(settings, "npc_general_pack", "test_pack/v1")
    monkeypatch.setattr(
        "app.services.npc_general_pack.load_general_pack",
        lambda setting: pack(("GENERIC_PAUSE_09", text)),
    )
    status, out = run_publish(publish_args(tmp_path, "--db"), sessions=NeverOpened())
    assert status == cli.EXIT_BLOCKED
    assert "GEN_PACK         FAIL" in out and code + ":" in out


def test_cli_protected_text_is_independent_of_empty_ng_lists(tmp_path, monkeypatch):
    docs = documents()
    docs["npc"].update(ng=[], open=[], proper_nouns=[])
    docs["npc"]["general_nudges"][0]["text"] = ANSWER
    fingerprint = write_documents(tmp_path, docs)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    code, out = run_publish(publish_args(tmp_path, "--db"), sessions=NeverOpened())
    assert code == cli.EXIT_BLOCKED
    assert "NPC              FAIL" in out and "PROTECTED_TEXT" in out
    assert ANSWER not in out
