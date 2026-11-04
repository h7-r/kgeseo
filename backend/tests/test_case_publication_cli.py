"""케이스 승인 · 게시 · 복구 확인 CLI(DB 없이: 입력 검사 · fingerprint · 게이트 표시 · 실행 조건).

콘텐츠 · 승인 기록은 모두 가상 데이터다(실제 PM 콘텐츠 · 실제 판정이 아니다).
실제 DB 기록 · 게시 · 복구는 tests/test_case_publication_cli_mysql.py가 격리 MySQL로 본다.
"""

import asyncio
import json
from pathlib import Path

import pytest

from app.repositories.npc_publication import PublicationSnapshot
from app.services.content_release import RegistrationEntry, ReleaseResult
from scripts import check_published_restore as restore_cli
from scripts import publish_case_content as publish_cli
from scripts import record_gate_review as review_cli
from tests.test_content_publication import documents
from tests.test_content_release import write_bundle
from tests.test_publication_gate import (
    CASE_ID,
    LOCAL_IDS,
    base_documents,
    review,
    seal,
)

GATES = ("G1", "G2", "G3")
REVIEWERS = {"G1": "박지하", "G2": "이해랑", "G3": "황미르"}


class NeverOpened:
    """DB 를 열면 실패한다 — 실행 조건 검사가 DB 보다 먼저인지 본다."""

    def __call__(self):
        raise AssertionError("database must not be opened")


def lines() -> tuple[list[str], callable]:
    collected: list[str] = []
    return collected, collected.append


def write_idmap_bundle(root: Path, version: int = 1) -> str:
    # 게시 경로용 가상 묶음(정답 · 정식 힌트 포함)에 게이트 테스트의 idmap 을 더한다
    docs = documents(version)
    docs["idmap"] = base_documents(version)["idmap"]
    files, fingerprint = seal(docs)
    directory = root / CASE_ID / f"v{version}"
    directory.mkdir(parents=True, exist_ok=True)
    for role, content in files.items():
        (directory / f"{role}.json").write_bytes(content)
    return fingerprint


def approved(fingerprint: str, gates=GATES):
    return tuple(review(gate, "approved", fingerprint) for gate in gates)


# ── 1. 승인 기록 CLI: case_content ──


def review_args(root: Path, fingerprint: str, *extra: str, **values: str) -> list[str]:
    base = {
        "--target-type": "case_content",
        "--target-id": CASE_ID,
        "--target-version": "1",
        "--gate": "G1",
        "--decision": "approved",
        "--actor": "세진",
        "--reviewer": "박지하",
        "--reason": "(가상) 사실 검토",
        "--target-hash": fingerprint,
        "--content-root": str(root),
    }
    for key, value in values.items():
        base["--" + key.replace("_", "-")] = value
    return [item for pair in base.items() for item in pair] + list(extra)


def test_review_dry_run_recomputes_the_case_bundle_fingerprint(
    tmp_path, capsys
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    assert review_cli.main(review_args(tmp_path, fingerprint)) == 0
    out = capsys.readouterr().out
    assert f"target_type=case_content target_id={CASE_ID}" in out
    assert f"target_hash={fingerprint}" in out
    assert "mode=dry-run" in out


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"target_hash": "sha256:" + "0" * 64}, "target_hash mismatch"),
        ({"reviewer": "이해랑"}, "not allowed to record G1"),
        ({"gate": "G3", "reviewer": "박지하"}, "not allowed to record G3"),
        ({"gate": "G2", "reviewer": "가상 판정자"}, "not allowed to record G2"),
        ({"target_version": "2"}, "bundle not readable"),
        ({"reason": " "}, "reason"),
    ],
)
def test_review_rejects_invalid_case_input(tmp_path, capsys, values, message) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    assert review_cli.main(review_args(tmp_path, fingerprint, **values)) == 1
    assert message in capsys.readouterr().out


def test_review_refuses_a_bundle_whose_header_is_not_the_recomputed_value(
    tmp_path, capsys
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    server = tmp_path / CASE_ID / "v1" / "server.json"
    body = json.loads(server.read_text(encoding="utf-8"))
    body["content_fingerprint"] = (
        "sha256:" + "1" * 64
    )  # 머리만 바꿈(fingerprint 계산에서는 빠지는 필드)
    server.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    assert review_cli.main(review_args(tmp_path, fingerprint)) == 1
    assert "file header does not match" in capsys.readouterr().out


def test_review_commit_requires_matching_confirm_db_before_opening_db(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    args = review_cli.parse_args(
        review_args(tmp_path, fingerprint, "--commit", "--confirm-db", "other_db")
    )
    with pytest.raises(review_cli.CliInputError, match="confirm-db"):
        asyncio.run(
            review_cli.run(args, NeverOpened(), "configured_db", out=lambda *_: None)
        )


# ── 2. 게시 CLI ──


def publish_args(root: Path, *extra: str, **values: str):
    base = {
        "--case-id": CASE_ID,
        "--content-version": "1",
        "--content-root": str(root),
    }
    for key, value in values.items():
        base["--" + key.replace("_", "-")] = value
    return publish_cli.parse_args(
        [item for pair in base.items() for item in pair] + list(extra)
    )


def run_publish(
    args, *, sessions=None, db_name="", root="", **kwargs
) -> tuple[int, str]:
    out, add = lines()
    code = asyncio.run(publish_cli.run(args, sessions, db_name, root, add, **kwargs))
    return code, "\n".join(out)


def fake_view(monkeypatch, records=(), registered=None, status=None) -> None:
    async def read(sessions, target):
        return publish_cli.DbView(tuple(records), registered or {}, status)

    monkeypatch.setattr(publish_cli, "read_db_view", read)


def forbid_publish(monkeypatch) -> None:
    async def publish(*args, **kwargs):
        raise AssertionError("must not publish")

    monkeypatch.setattr(publish_cli, "publish_and_register", publish)


def test_publish_dry_run_shows_every_check_and_blocks_without_db(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    code, out = run_publish(publish_args(tmp_path))
    assert code == publish_cli.EXIT_BLOCKED
    assert f"content_fingerprint={fingerprint}" in out
    assert "mode=dry-run" in out
    for check in ("PARSE", "FINGERPRINT", "HEADER", "VERSION_ORDER", "CLIENT_SERVER"):
        assert f"  {check} " in out
    # 승인은 DB 없이 확인할 수 없고, NG 검사기는 없다 — 둘 다 게시를 막는다
    assert "APPROVALS        FAIL" in out and "no trusted approval source" in out
    assert "NG               UNVERIFIED" in out
    assert (
        "verdict=BLOCKED" in out and "APPROVALS:FAIL" in out and "NG:UNVERIFIED" in out
    )


def test_publish_db_view_passes_only_with_all_gates_and_a_checker(
    tmp_path, monkeypatch
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    forbid_publish(monkeypatch)
    fake_view(monkeypatch, approved(fingerprint))
    code, out = run_publish(
        publish_args(tmp_path, "--db"), sessions=object(), ng_checker=lambda text: False
    )
    assert code == publish_cli.EXIT_OK
    assert "verdict=PUBLISHABLE" in out and "mode=read-only" in out
    assert "G1: approved reviewer=" in out


def test_publish_without_ng_checker_stays_blocked_even_when_approved(
    tmp_path, monkeypatch
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    fake_view(monkeypatch, approved(fingerprint))
    code, out = run_publish(publish_args(tmp_path, "--db"), sessions=object())
    assert code == publish_cli.EXIT_BLOCKED
    assert "NG:UNVERIFIED" in out and "APPROVALS:FAIL" not in out


@pytest.mark.parametrize(
    ("records", "reason", "line"),
    [
        (lambda fp: approved(fp, ("G1", "G2")), "G3:missing", "G3: missing"),
        (
            lambda fp: (
                *approved(fp, ("G1", "G2")),
                review("G3", "hold", fp, reason="(가상) 보류"),
            ),
            "G3:hold",
            "G3: hold",
        ),
        (
            lambda fp: approved("sha256:" + "2" * 64),
            "G1:stale target_hash",
            "G1: stale",
        ),
    ],
)
def test_publish_reports_unapproved_gates(
    tmp_path, monkeypatch, records, reason, line
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    fake_view(monkeypatch, records(fingerprint))
    code, out = run_publish(
        publish_args(tmp_path, "--db"), sessions=object(), ng_checker=lambda text: False
    )
    assert code == publish_cli.EXIT_BLOCKED
    assert reason in out and line in out


def test_publish_local_ids_decide_the_idmap_check(tmp_path, monkeypatch) -> None:
    fingerprint = write_idmap_bundle(tmp_path)
    fake_view(monkeypatch, approved(fingerprint))
    code, out = run_publish(
        publish_args(tmp_path, "--db"), sessions=object(), ng_checker=lambda text: False
    )
    assert code == publish_cli.EXIT_BLOCKED and "LOCAL_IDS:UNVERIFIED" in out

    local = tmp_path / "local_ids.json"
    local.write_text(
        json.dumps({k: list(v) for k, v in LOCAL_IDS.items()}), encoding="utf-8"
    )
    code, out = run_publish(
        publish_args(tmp_path, "--db", local_ids=str(local)),
        sessions=object(),
        ng_checker=lambda text: False,
    )
    assert "LOCAL_IDS        PASS" in out and "LOCAL_IDS:" not in out
    # 이 가상 idmap 은 장면 대응이 있어 장면 완료 조건이 필요하다 — 게이트가 그대로 막는다(CLI 가 통과시키지 않는다)
    assert code == publish_cli.EXIT_BLOCKED and "SCENES:UNVERIFIED" in out


def test_publish_reports_a_version_registered_with_other_files(
    tmp_path, monkeypatch
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    fake_view(monkeypatch, approved(fingerprint), registered={1: "sha256:" + "3" * 64})
    code, out = run_publish(publish_args(tmp_path, "--db"), sessions=object())
    assert (
        code == publish_cli.EXIT_CONFLICT
        and "registered with another fingerprint" in out
    )


@pytest.mark.parametrize(
    ("extra", "values", "configured", "message"),
    [
        (("--commit", "--confirm-db", "db"), {"reason": "(가상)"}, "ROOT", "--actor"),
        (("--commit", "--confirm-db", "db"), {"actor": "세진"}, "ROOT", "--reason"),
        (
            ("--commit", "--confirm-db", "other"),
            {"actor": "세진", "reason": "r"},
            "ROOT",
            "confirm-db",
        ),
        (("--commit",), {"actor": "세진", "reason": "r"}, "ROOT", "confirm-db"),
        (
            ("--commit", "--confirm-db", "db"),
            {"actor": "세진", "reason": "r"},
            "",
            "PUBLISHED_CONTENT_ROOT",
        ),
        (
            ("--commit", "--confirm-db", "db"),
            {"actor": "세진", "reason": "r"},
            "elsewhere",
            "PUBLISHED_CONTENT_ROOT",
        ),
    ],
)
def test_publish_commit_conditions_are_checked_before_db(
    tmp_path, extra, values, configured, message
) -> None:
    write_bundle(tmp_path, 1)
    root = (
        str(tmp_path)
        if configured == "ROOT"
        else (str(tmp_path / configured) if configured else "")
    )
    args = publish_args(tmp_path, *extra, **values)
    with pytest.raises(publish_cli.CliInputError, match=message):
        asyncio.run(publish_cli.run(args, NeverOpened(), "db", root, lambda *_: None))


def test_publish_commit_never_publishes_a_blocked_bundle(tmp_path, monkeypatch) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    forbid_publish(monkeypatch)
    fake_view(monkeypatch, approved(fingerprint, ("G1", "G2")))
    args = publish_args(
        tmp_path, "--commit", "--confirm-db", "db", actor="세진", reason="(가상)"
    )
    code, out = run_publish(
        args,
        sessions=object(),
        db_name="db",
        root=str(tmp_path),
        ng_checker=lambda t: False,
    )
    assert code == publish_cli.EXIT_BLOCKED and "G3:missing" in out


def test_publish_commit_calls_the_existing_release_and_explains_restore(
    tmp_path, monkeypatch
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    fake_view(monkeypatch, approved(fingerprint))
    calls = []

    async def publish(service, store, root, case_id, version, **kwargs):
        calls.append((Path(root), case_id, version, kwargs["actor"], kwargs["reason"]))
        snapshot = PublicationSnapshot(
            case_id, version, fingerprint, "published", 1, None
        )
        return ReleaseResult(
            "published",
            snapshot,
            RegistrationEntry(case_id, version, "registered", "published"),
        )

    monkeypatch.setattr(publish_cli, "publish_and_register", publish)
    args = publish_args(
        tmp_path, "--commit", "--confirm-db", "db", actor="세진", reason="(가상) 게시"
    )
    code, out = run_publish(
        args,
        sessions=object(),
        db_name="db",
        root=str(tmp_path),
        ng_checker=lambda t: False,
    )
    assert code == publish_cli.EXIT_OK, out
    assert calls == [(tmp_path, CASE_ID, 1, "세진", "(가상) 게시")]
    assert (
        "published outcome=published publication=published registration=registered"
        in out
    )
    assert f"check_published_restore --expect {CASE_ID}:1" in out


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"case_id": "../escape"}, "bundle not readable"),
        ({"content_version": "0"}, "bundle not readable"),
        ({"local_ids": "missing.json"}, "local ids not readable"),
    ],
)
def test_publish_rejects_invalid_input(tmp_path, capsys, values, message) -> None:
    write_bundle(tmp_path, 1)
    argv = [
        "--case-id",
        CASE_ID,
        "--content-version",
        "1",
        "--content-root",
        str(tmp_path),
    ]
    for key, value in values.items():
        flag = "--" + key.replace("_", "-")
        if flag in argv:
            argv[argv.index(flag) + 1] = value
        else:
            argv += [flag, str(tmp_path / value)]
    assert publish_cli.main(argv) == publish_cli.EXIT_INPUT
    assert message in capsys.readouterr().out


def test_publish_rejects_local_ids_with_unknown_kinds(tmp_path) -> None:
    path = tmp_path / "ids.json"
    path.write_text(json.dumps({"rooms": ["x"]}), encoding="utf-8")
    with pytest.raises(publish_cli.CliInputError, match="keys"):
        publish_cli.load_local_ids(str(path))


# ── 3. 복구 확인 CLI ──


def restore_args(*argv: str):
    return restore_cli.parse_args(list(argv))


def fake_restore(result):
    async def restore(root, sessions, store):
        assert store.versions(CASE_ID) == ()  # 늘 빈 저장소에 채워 본다
        return result

    return restore


def run_restore(args, result, root="ROOT") -> tuple[int, str]:
    out, add = lines()
    code = asyncio.run(
        restore_cli.run(args, object(), root, add, restore=fake_restore(result))
    )
    return code, "\n".join(out)


def test_restore_check_needs_a_content_root() -> None:
    with pytest.raises(restore_cli.CliInputError, match="PUBLISHED_CONTENT_ROOT"):
        asyncio.run(restore_cli.run(restore_args(), object(), "", lambda *_: None))


def test_restore_check_reports_database_failure() -> None:
    code, out = run_restore(restore_args(), None)
    assert code == restore_cli.EXIT_FAILED and "restore=FAILED" in out


def test_restore_check_lists_unavailable_versions() -> None:
    entries = (
        RegistrationEntry(CASE_ID, 1, "registered", "published"),
        RegistrationEntry(CASE_ID, 2, "files_missing", "published", "npc"),
    )
    code, out = run_restore(restore_args(), entries)
    assert code == restore_cli.EXIT_FAILED
    assert f"{CASE_ID}:v1 registered publication=published -> ok" in out
    assert (
        f"{CASE_ID}:v2 files_missing publication=published reason=npc -> UNAVAILABLE"
        in out
    )


def test_restore_check_requires_expected_versions() -> None:
    entries = (RegistrationEntry(CASE_ID, 1, "registered", "published"),)
    code, out = run_restore(restore_args("--expect", f"{CASE_ID}:1"), entries)
    assert code == restore_cli.EXIT_OK and "restore=OK" in out
    code, out = run_restore(restore_args("--expect", f"{CASE_ID}:2"), entries)
    assert (
        code == restore_cli.EXIT_FAILED
        and f"expected {CASE_ID}:v2 -> NOT RESTORED" in out
    )


@pytest.mark.parametrize("value", ["naju", "naju:0", ":1", "naju:x"])
def test_restore_check_rejects_bad_expect(value) -> None:
    with pytest.raises(restore_cli.CliInputError, match="--expect"):
        restore_cli.parse_expect([value])
