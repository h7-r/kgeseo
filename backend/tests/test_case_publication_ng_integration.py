"""CLI uses bundle-derived policies; synthetic content only, no DB writes."""

import os
import subprocess
import sys

import pytest

from app.services.npc_publication import NpcPublicationService
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
from tests.test_publication_gate import CASE_ID, base_documents

NG_CASES = [
    pytest.param({"ng": [], "open": []}, "PASS", id="empty-rules"),
    pytest.param({"open": []}, "UNVERIFIED", id="missing-ng"),
    pytest.param({"ng": []}, "UNVERIFIED", id="missing-open"),
    pytest.param({"ng": None, "open": []}, "UNVERIFIED", id="null-ng"),
    pytest.param({"ng": [], "open": None}, "UNVERIFIED", id="null-open"),
    pytest.param(
        {"ng": [{"text": "주제", "patterns": ["등대 방향"]}], "open": []},
        "FAIL",
        id="ng-match",
    ),
    pytest.param(
        {"ng": [], "open": [{"text": "주제", "patterns": ["등대 방향"]}]},
        "FAIL",
        id="u-match",
    ),
    pytest.param({"ng": [{"text": "!!!"}], "open": []}, "UNVERIFIED", id="invalid-ng"),
    pytest.param({"ng": [], "open": [{"text": "주제"}]}, "UNVERIFIED", id="invalid-u"),
    pytest.param(
        {
            "ng": [{"text": "다른 금지 문장"}],
            "open": [{"text": "주제", "patterns": ["다른 주제"]}],
        },
        "PASS",
        id="clean-nonempty-rules",
    ),
]


def policy_documents(policy):
    docs = documents()
    docs["npc"].update(policy)
    docs["npc"]["general_nudges"][0]["text"] = "등대의, 방향을 봐."
    return docs


@pytest.mark.parametrize(("policy", "expected"), NG_CASES)
@pytest.mark.parametrize("db_mode", [False, True], ids=["dry-run", "db-read-only"])
def test_cli_ng_status_without_approvals(
    tmp_path, monkeypatch, policy, expected, db_mode
):
    write_documents(tmp_path, policy_documents(policy))
    forbid_publish(monkeypatch)
    if db_mode:
        fake_view(monkeypatch)  # No approval records; gate remains authoritative.
    extra = ("--db",) if db_mode else ()
    code, out = run_publish(publish_args(tmp_path, *extra), sessions=NeverOpened())
    assert code == cli.EXIT_BLOCKED
    assert f"{'NG':<16} {expected:<14}" in out
    assert "APPROVALS        FAIL" in out
    assert "verdict=BLOCKED" in out
    assert "등대" not in out
    if not db_mode:
        assert "mode=dry-run" in out


@pytest.mark.parametrize(
    ("policy", "expected"), [case for case in NG_CASES if case.values[1] != "PASS"]
)
def test_commit_stays_blocked_by_ng_with_approved_test_view(
    tmp_path, monkeypatch, policy, expected
):
    fingerprint = write_documents(tmp_path, policy_documents(policy))
    fake_view(monkeypatch, approved(fingerprint))  # Synthetic in-memory records only.
    forbid_publish(monkeypatch)
    args = publish_args(
        tmp_path,
        "--commit",
        "--confirm-db",
        "test",
        actor="test",
        reason="synthetic test",
    )
    code, out = run_publish(
        args, sessions=NeverOpened(), db_name="test", root=str(tmp_path)
    )
    assert code == cli.EXIT_BLOCKED
    assert f"NG:{expected}" in out
    assert "APPROVALS:FAIL" not in out


def test_main_defaults_to_dry_run_even_with_valid_ng(tmp_path, monkeypatch, capsys):
    docs = policy_documents({"ng": [], "open": []})
    docs["idmap"] = base_documents()["idmap"]
    write_documents(tmp_path, docs)
    forbid_publish(monkeypatch)
    assert (
        cli.main(
            [
                "--case-id",
                CASE_ID,
                "--content-version",
                "1",
                "--content-root",
                str(tmp_path),
            ]
        )
        == cli.EXIT_BLOCKED
    )
    out = capsys.readouterr().out
    assert "mode=dry-run" in out
    assert "NG               PASS" in out
    assert "APPROVALS        FAIL" in out
    assert "LOCAL_IDS        UNVERIFIED" in out


def test_checker_uses_snapshot_and_accepts_gate_metadata_headers(tmp_path):
    docs = policy_documents({"ng": [{"text": "등대 방향"}], "open": []})
    docs["npc"]["published_at"] = "2026-11-05T00:00:00Z"
    write_documents(tmp_path, docs)
    bundle = cli.read_case_bundle(tmp_path, CASE_ID, 1)
    docs["npc"].update(ng=[], open=[])
    write_documents(tmp_path, docs)
    checker = cli.bundle_ng_checker(bundle)
    assert checker is not None and checker("등대의 방향을 봐.")


def test_invalid_npc_schema_remains_a_gate_failure(tmp_path):
    docs = policy_documents({"ng": [], "open": []})
    docs["npc"]["unexpected"] = "sensitive synthetic value"
    write_documents(tmp_path, docs)
    code, out = run_publish(publish_args(tmp_path))
    assert code == cli.EXIT_BLOCKED
    assert "NPC:FAIL" in out
    assert "sensitive synthetic value" not in out


@pytest.mark.parametrize(("policy", "expected"), NG_CASES)
def test_mysql_cli_ng_with_no_approvals(tmp_path, policy, expected):
    # Opt-in empty local MySQL only, with existing datadir/port/schema guards.
    if os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1":
        pytest.skip("explicit isolated NPC idempotency MySQL test database required")
    from tests.test_case_publication_cli_mysql import db_name
    from tests.test_content_release_mysql import mysql_run

    write_documents(tmp_path, policy_documents(policy))

    async def scenario(sessions):
        out = []
        code = await cli.run(
            publish_args(tmp_path, "--db"), sessions, db_name(), "", out.append
        )
        assert code == cli.EXIT_BLOCKED
        assert any(f"{'NG':<16} {expected:<14}" in line for line in out)
        assert any("APPROVALS        FAIL" in line for line in out)
        service = NpcPublicationService(sessions)
        assert await service.restorable_versions() == ()
        assert await service.events(CASE_ID, 1) == ()

    mysql_run(scenario)


def test_real_cli_process_defaults_to_dry_run(tmp_path):
    docs = policy_documents({"ng": [], "open": []})
    docs["idmap"] = base_documents()["idmap"]
    write_documents(tmp_path, docs)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.publish_case_content",
            "--case-id",
            CASE_ID,
            "--content-version",
            "1",
            "--content-root",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    assert result.returncode == cli.EXIT_BLOCKED, result.stderr
    assert "mode=dry-run" in result.stdout
    assert "NG               PASS" in result.stdout
    assert "APPROVALS        FAIL" in result.stdout
    assert "LOCAL_IDS        UNVERIFIED" in result.stdout
    assert "verdict=BLOCKED" in result.stdout


def test_final_gate_uses_same_snapshot_as_checker_if_disk_changes(
    tmp_path, monkeypatch
):
    from app.services.content_release import publish_and_register
    from app.services.npc_publication import PublicationGateFailedError
    from app.services.publication_gate import evaluate_publication

    docs = policy_documents({"ng": [{"text": "blocked sentinel"}], "open": []})
    fingerprint = write_documents(tmp_path, docs)
    original_npc = (tmp_path / CASE_ID / "v1" / "npc.json").read_bytes()
    checked = []

    async def read(sessions, target):
        # Simulate a file replacement while the CLI awaits its approval view.
        docs["npc"].pop("ng")
        docs["npc"]["general_nudges"][0]["text"] = "blocked sentinel"
        write_documents(tmp_path, docs)
        return cli.DbView(approved(fingerprint), {}, None)

    class FinalGateService:
        def __init__(self, sessions):
            pass

        async def publish_new(self, snapshot, **kwargs):
            assert snapshot.files["npc"] == original_npc
            assert kwargs["ng_checker"]("blocked sentinel")
            result = evaluate_publication(
                **snapshot.files, ng_checker=kwargs["ng_checker"], general_pack=None
            )
            assert result.check("NG").status == "PASS"
            assert result.check("APPROVALS").status == "FAIL"
            checked.append(result)
            raise PublicationGateFailedError(result)  # Actual final gate still blocks.

    monkeypatch.setattr(cli, "read_db_view", read)
    monkeypatch.setattr(cli, "NpcPublicationService", FinalGateService)
    monkeypatch.setattr(cli, "publish_and_register", publish_and_register)
    args = publish_args(
        tmp_path,
        "--commit",
        "--confirm-db",
        "test",
        actor="test",
        reason="synthetic test",
    )
    code, out = run_publish(
        args, sessions=NeverOpened(), db_name="test", root=str(tmp_path)
    )
    assert code == cli.EXIT_BLOCKED and len(checked) == 1
    assert "publish refused by the gate" in out


@pytest.mark.parametrize("changes", [{"case_id": "other_case"}, {"content_version": 2}])
def test_release_refuses_a_snapshot_for_another_target(tmp_path, changes):
    import asyncio
    from dataclasses import replace

    from app.services.content_release import publish_and_register
    from app.services.pinned_content import PinnedContentStore
    from app.services.published_content_loader import InvalidBundleLocationError

    write_documents(tmp_path, policy_documents({"ng": [], "open": []}))
    bundle = cli.read_case_bundle(tmp_path, CASE_ID, 1)
    with pytest.raises(InvalidBundleLocationError, match="snapshot target mismatch"):
        asyncio.run(
            publish_and_register(
                object(),
                PinnedContentStore(),
                tmp_path,
                CASE_ID,
                1,
                reason="synthetic test",
                actor="test",
                ng_checker=None,
                local_ids=None,
                snapshot=replace(bundle.snapshot, **changes),
            )
        )
