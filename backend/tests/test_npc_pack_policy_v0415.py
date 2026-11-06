"""PM v0.4.15: synthetic review data, never edits existing content."""

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.case_content import CaseClientContent
from app.schemas.npc_content import NpcContentPack
from app.services.dialogue_pack_policy import (
    check_dialogue_pack,
    collect_proper_names,
)
from app.services.npc_general_pack import read_published_cases
from app.services.pinned_content import PinnedContentStore
from tests.test_npc_pack_policy_v0414 import pack
from tests.test_publication_gate import base_documents, run, seal


def documents(version=1):
    docs = base_documents(version)
    del docs["idmap"]
    return docs


def evaluate(docs, **kwargs):
    files, fingerprint = seal(docs)
    return run({**files, "idmap": None}, fingerprint, **kwargs)


@pytest.mark.parametrize("field", ["proper_nouns", "ng"])
@pytest.mark.parametrize("value", ["missing", None])
def test_required_review_data_blocks_even_without_configured_pack(field, value):
    docs = documents()
    if value == "missing":
        del docs["npc"][field]
    else:
        docs["npc"][field] = value
    result, store = evaluate(docs, general_pack=None)
    assert result.check("POLICY_DATA").status == "FAIL"
    assert f"npc:{field}:required" in result.check("POLICY_DATA").reasons
    assert not result.approved and not result.registered
    assert not store.versions(docs["npc"]["case_id"])


@pytest.mark.parametrize("kind", ["person", "place"])
def test_names_aliases_and_client_display_names_detected(kind):
    docs = documents()
    docs["npc"]["proper_nouns"] = [
        {"text": "가상인물", "kind": kind, "aliases": ["가상별칭"]}
    ]
    for name in ("가상인물", "가상별칭", "자물쇠", "쪽지"):
        result, _ = evaluate(docs, general_pack=pack(("GENERIC_PAUSE_09", name)))
        assert result.check("GEN_PACK").status == "FAIL"
        assert any(r.startswith("GEN-CASE:") for r in result.check("GEN_PACK").reasons)


@pytest.mark.parametrize(
    "noun",
    [
        {"text": "가상", "kind": "object", "aliases": []},
        {"text": " ", "kind": "person", "aliases": []},
        {"text": "가상", "kind": "place", "aliases": [" "]},
        {"text": "가상", "kind": "person"},
        {"text": "가상", "kind": "person", "aliases": "별칭"},
    ],
)
def test_invalid_nouns_fail_schema_and_publication(noun):
    docs = documents()
    docs["npc"]["proper_nouns"] = [noun]
    with pytest.raises(ValidationError):
        NpcContentPack.model_validate(
            {k: v for k, v in docs["npc"].items() if k != "generated_at"}
        )
    result, _ = evaluate(docs, general_pack=None)
    assert result.check("NPC").status == "FAIL"
    assert not result.registered


def test_empty_lists_valid_internal_ids_and_zone_names_are_not_display_names():
    docs = documents()
    candidate = pack(
        ("GENERIC_PAUSE_09", "OBJ_S1_LOCK_1 PUZZLE_A CLUE_A ZONE_A 가상 방")
    )
    result, store = evaluate(docs, general_pack=candidate)
    assert result.check("POLICY_DATA").status == "PASS"
    assert result.check("GEN_PACK").status == "PASS"
    assert result.registered
    bundle = store.get_version(result.case_id, result.content_version)
    assert collect_proper_names(bundle.client(), bundle.npc()) == ("자물쇠", "쪽지")


def test_ng_nonempty_and_republication_rechecked():
    store = PinnedContentStore()
    result, _ = evaluate(documents(), store=store, general_pack=None)
    assert result.registered
    docs = documents(2)
    docs["npc"]["ng"] = [{"text": "금지왜곡", "patterns": ["가상금칙"]}]
    result, _ = evaluate(
        docs, store=store, general_pack=pack(("GENERIC_PAUSE_09", "가상금칙"))
    )
    assert result.check("GEN_PACK").status == "FAIL"
    assert not result.registered
    assert store.versions(docs["npc"]["case_id"]) == (1,)
    del docs["npc"]["proper_nouns"]
    result, _ = evaluate(docs, store=store, general_pack=None)
    assert result.check("POLICY_DATA").status == "FAIL"
    assert store.versions(docs["npc"]["case_id"]) == (1,)


def test_missing_manual_data_never_passes_with_auto_names():
    docs = documents()
    del docs["npc"]["proper_nouns"]
    npc = NpcContentPack.model_validate(
        {k: v for k, v in docs["npc"].items() if k != "generated_at"}
    )
    client = CaseClientContent.model_validate(
        {k: v for k, v in docs["client"].items() if k != "content_version"}
    )
    assert collect_proper_names(client, npc) is None


def test_published_reader_uses_same_collection(monkeypatch):
    result, store = evaluate(documents(), general_pack=None)
    assert result.registered
    pin = store.get_version(result.case_id, result.content_version).pin
    state = SimpleNamespace(
        case_id=pin.case_id,
        content_version=pin.content_version,
        content_fingerprint=pin.content_fingerprint,
        status="published",
    )

    async def all_states(_self):
        return [state]

    monkeypatch.setattr(
        "app.services.npc_general_pack.NpcPublicationRepository.all_states", all_states
    )
    cases = asyncio.run(read_published_cases(None, store))
    assert cases[0].proper_names == ("자물쇠", "쪽지")
    assert (
        check_dialogue_pack(pack(("GENERIC_PAUSE_09", "자물쇠")), cases).check(
            "GEN-CASE"
        )
        == "FAIL"
    )
