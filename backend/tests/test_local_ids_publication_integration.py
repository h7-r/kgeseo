"""Synthetic idmap/CLI contracts; never fabricates a real Naju idmap."""

import json

import pytest

from scripts import check_idmap_local_ids as check_cli
from scripts import publish_case_content as publish_cli
from tests.test_case_publication_cli import (
    NeverOpened,
    approved,
    fake_view,
    forbid_publish,
    publish_args,
    run_publish,
    write_documents,
    write_idmap_bundle,
)
from tests.test_check_idmap_local_ids import fe_list
from tests.test_content_publication import documents
from tests.test_publication_gate import base_documents


def write_list(path, values):
    path.write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")
    return str(path)


def test_five_kind_export_shape_is_accepted_by_checker_and_publisher(tmp_path):
    values = fe_list()
    path = write_list(tmp_path / "local-ids.json", values)
    assert check_cli.parse_local_ids(values) == publish_cli.load_local_ids(path)
    assert set(publish_cli.load_local_ids(path)) == set(check_cli.LOCAL_ID_KINDS)


@pytest.mark.parametrize("state,expected", [("present", "PASS"), ("missing", "FAIL"), ("absent", "UNVERIFIED")])
def test_publication_local_ids_verdicts_keep_other_gates(
    tmp_path, monkeypatch, state, expected
):
    fingerprint = write_idmap_bundle(tmp_path)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    values = fe_list()
    if state == "missing":
        values["objects"] = values["objects"][1:]
    extra = [] if state == "absent" else ["--local-ids", write_list(tmp_path / "ids.json", values)]
    code, out = run_publish(publish_args(tmp_path, "--db", *extra), sessions=NeverOpened())
    assert f"{'LOCAL_IDS':<16} {expected:<14}" in out
    assert "NG               PASS" in out and "POLICY_DATA      PASS" in out
    assert "APPROVALS        PASS" in out
    # LOCAL_IDS PASS cannot override this fixture's missing scene completion.
    assert "SCENES           UNVERIFIED" in out
    assert code == publish_cli.EXIT_BLOCKED


@pytest.mark.parametrize("bad", [[], {**fe_list(), "interactables": ["runtime-only"]}, {**fe_list(), "objects": [42]}])
def test_non_contract_kind_and_bad_types_are_rejected_by_both_loaders(tmp_path, bad):
    with pytest.raises(check_cli.CliInputError):
        check_cli.parse_local_ids(bad)
    with pytest.raises(publish_cli.CliInputError):
        publish_cli.load_local_ids(write_list(tmp_path / "bad.json", bad))


@pytest.mark.parametrize("patch", [{"zones": [" "]}, {"scenes": []}, {"objects": ["a#0", "a#0"]}])
def test_strict_extract_checker_rejects_blank_empty_and_duplicate_values(patch):
    with pytest.raises(check_cli.CliInputError):
        check_cli.parse_local_ids({**fe_list(), **patch})


def test_matching_local_ids_can_pass_with_complete_synthetic_scene_contract(tmp_path, monkeypatch):
    docs = documents()
    docs["idmap"] = base_documents()["idmap"]
    docs["npc"].update(ng=[], open=[], proper_nouns=[])
    docs["server"]["scenes"] = [
        {"scene_id": "SCENE_ONE", "clear_when": {"puzzle_completed": "PUZZLE_A"}}
    ]
    fingerprint = write_documents(tmp_path, docs)
    fake_view(monkeypatch, approved(fingerprint))
    forbid_publish(monkeypatch)
    path = write_list(tmp_path / "ids.json", fe_list())
    code, out = run_publish(publish_args(tmp_path, "--db", "--local-ids", path), sessions=NeverOpened())
    assert "LOCAL_IDS        PASS" in out and "SCENES           PASS" in out
    assert code == publish_cli.EXIT_OK, out
