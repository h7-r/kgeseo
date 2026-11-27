import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.db import session
from scripts import check_deployment as check
from tests.test_content_release import FakePublicationService, state, write_bundle


@pytest.mark.parametrize(
    ("revision", "status", "detail"),
    [
        ("head", "PASS", ""),
        ("base", "FAIL", "DB revision does not match code head"),
        ("secret-db-value", "FAIL", "DB revision does not match code head"),
        (None, "FAIL", "no DB revision"),
    ],
)
def test_alembic_revision(revision, status, detail):
    scripts = ScriptDirectory.from_config(Config(check.ALEMBIC_INI))
    if revision == "head":
        revision = scripts.get_current_head()
    elif revision == "base":
        revision = scripts.get_base()

    with create_engine("sqlite://").connect() as connection:
        if revision is not None:
            connection.execute(
                text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
            )
            connection.execute(
                text("INSERT INTO alembic_version VALUES (:revision)"),
                {"revision": revision},
            )
        result = check.check_alembic(connection, scripts)
        assert result.status == status
        assert detail == result.detail
        assert "secret-db-value" not in result.detail
        if revision is None:
            assert not inspect(connection).has_table("alembic_version")


def test_alembic_rejects_multiple_code_heads_even_when_db_matches(tmp_path):
    versions = tmp_path / "versions"
    versions.mkdir()
    for revision in ("first", "second"):
        (versions / f"{revision}.py").write_text(
            f"revision = {revision!r}\ndown_revision = None\n", encoding="utf-8"
        )
    scripts = ScriptDirectory(tmp_path)
    with create_engine("sqlite://").connect() as connection:
        connection.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
        )
        connection.execute(
            text("INSERT INTO alembic_version VALUES ('first'), ('second')")
        )
        result = check.check_alembic(connection, scripts)

    assert result.status == "FAIL"
    assert result.detail == "multiple code heads"


def test_schema_reports_missing_tables_and_columns():
    with create_engine("sqlite://").connect() as connection:
        connection.execute(text("CREATE TABLE app_users (id VARCHAR(36))"))
        result = check.check_required_tables(connection)

    assert result.status == "FAIL"
    assert result.detail == "missing tables; missing columns"


@pytest.mark.parametrize(
    ("root_mode", "bundle_mode", "status", "detail"),
    [
        ("unset", "empty", "SKIP", "WARNING: PUBLISHED_CONTENT_ROOT is unset"),
        ("valid", "empty", "SKIP", "no publication records"),
        ("invalid", "empty", "FAIL", "not a readable directory"),
        ("unset", "missing", "SKIP", "WARNING: PUBLISHED_CONTENT_ROOT is unset"),
        ("valid", "missing", "FAIL", "files_missing"),
        ("valid", "changed", "FAIL", "rebuild_failed"),
        ("valid", "valid", "PASS", ""),
        ("valid", "orphan", "FAIL", "lack matching version metadata"),
    ],
)
def test_content_check(tmp_path, monkeypatch, root_mode, bundle_mode, status, detail):
    root = {"unset": "", "valid": str(tmp_path), "invalid": str(tmp_path / "missing")}[
        root_mode
    ]
    states = []
    if bundle_mode in {"missing", "changed", "valid"}:
        fingerprint = write_bundle(tmp_path, 1)
        if bundle_mode == "missing":
            next(tmp_path.rglob("server.json")).unlink()
        elif bundle_mode == "changed":
            assert write_bundle(tmp_path, 1, "different answer") != fingerprint
        # Suspended versions must still be restored for pinned sessions.
        states.append(state(1, fingerprint, "suspended"))
    monkeypatch.setattr(
        check, "NpcPublicationService", lambda sessions: FakePublicationService(states)
    )
    connection = SimpleNamespace(
        scalar=AsyncMock(return_value=int(bundle_mode != "empty"))
    )

    result = asyncio.run(check.check_published_content(connection, root))

    assert result.status == status
    if detail:
        assert detail in result.detail
    else:
        assert result.detail == ""
    assert str(tmp_path) not in result.detail
    if root_mode == "unset":
        connection.scalar.assert_not_awaited()


def test_cli_db_connection_failure_redacts_driver_error(monkeypatch, capsys):
    connection_url = "mysql+aiomysql://user:sensitive-db-password@private-db.example/db"

    class FailingConnection:
        async def __aenter__(self):
            raise OperationalError(None, None, ValueError(connection_url))

        async def __aexit__(self, *exc):
            pass

    dispose = AsyncMock()
    monkeypatch.setattr(
        session, "engine", SimpleNamespace(connect=FailingConnection, dispose=dispose)
    )

    assert check.main([]) == 1
    output = capsys.readouterr()
    assert "Alembic: FAIL" in output.out
    assert "Required Tables: FAIL" in output.out
    assert "Published Content: SKIP" in output.out
    assert "Overall: FAIL" in output.out
    assert "sensitive-db-password" not in output.out
    assert "private-db.example" not in output.out
    assert "mysql+aiomysql" not in output.out
    assert output.err == ""
    dispose.assert_awaited_once()


def test_cli_bad_configuration_has_no_traceback_or_input_values():
    environment = {
        **os.environ,
        "DB_HOST": "secret-db-host",
        "DB_PORT": "secret-invalid-port",
        "DB_PASSWORD": "secret-password",
        "NAVER_CLIENT_ID": "secret-oauth-id",
        "NAVER_CLIENT_SECRET": "secret-oauth",
        "HINT_REF_KEYS": "secret-hint-key",
        "PUBLISHED_CONTENT_ROOT": "secret-root-path",
    }
    result = subprocess.run(
        [sys.executable, "-m", "scripts.check_deployment"],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    assert result.returncode == 1
    assert "Overall: FAIL" in result.stdout
    assert "secret-" not in result.stdout
    assert result.stderr == ""


def _shared_copy(tmp_path):
    shared = tmp_path / "shared"
    shared.mkdir()
    for name in check.SHARED_POLICY_KEYS:
        (shared / name).write_bytes((check.SHARED_DIR / name).read_bytes())
    return shared


def test_shared_policy_passes_with_a_copy_of_the_repository_files(tmp_path):
    assert check.check_shared_policy(_shared_copy(tmp_path)) == check.Check("PASS")


@pytest.mark.parametrize("name", ["nickname-policy.json", "regions.json"])
@pytest.mark.parametrize(
    "breakage",
    [
        "missing",
        "zero-bytes",
        "bad-json",
        "empty-object",
        "no-key",
        "list",
        "directory",
    ],
)
def test_shared_policy_fails_for_every_broken_file(tmp_path, name, breakage):
    """shared/ 가 빠지거나(11/27 운영) 파일이 깨지면 FAIL — 경로는 출력에 드러내지 않는다(세진 11/27 #219 리뷰)."""
    shared = _shared_copy(tmp_path)
    target = shared / name
    original = target.read_text(encoding="utf-8")
    target.unlink()
    if breakage == "zero-bytes":
        target.write_bytes(b"")
    elif breakage == "bad-json":
        target.write_text("{not json", encoding="utf-8")
    elif breakage == "empty-object":
        target.write_text("{}", encoding="utf-8")
    elif breakage == "no-key":
        data = json.loads(original)
        data.pop(check.SHARED_POLICY_KEYS[name][0])
        target.write_text(json.dumps(data), encoding="utf-8")
    elif breakage == "list":
        target.write_text("[1, 2]", encoding="utf-8")
    elif breakage == "directory":
        target.mkdir()
    result = check.check_shared_policy(shared)
    assert result.status == "FAIL" and name in result.detail
    assert str(tmp_path) not in result.detail


def test_importing_the_check_does_not_parse_the_shared_files():
    """맨 위 import 가 정책 모듈을 부르면 깨진 JSON 에서 점검 줄을 찍기 전에 traceback 으로 끝난다(세진 11/27)."""
    probe = (
        "import sys, scripts.check_deployment; "
        "print('app.services.nickname_policy' in sys.modules, "
        "'app.services.registration_input_policy' in sys.modules)"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False False"


def test_cli_prints_shared_policy_fail_instead_of_a_traceback(
    monkeypatch, capsys, tmp_path
):
    shared = _shared_copy(tmp_path)
    (shared / "nickname-policy.json").write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(check, "SHARED_DIR", shared)
    connect = AsyncMock()
    monkeypatch.setattr(
        session, "engine", SimpleNamespace(connect=connect, dispose=AsyncMock())
    )
    assert check.main(["--schema-only"]) == 1
    output = capsys.readouterr()
    assert (
        "Shared Policy: FAIL (shared policy missing or unreadable: nickname-policy.json)"
        in output.out
    )
    assert "Alembic: SKIP (shared policy failed)" in output.out
    assert "Overall: FAIL" in output.out
    assert "Traceback" not in output.out + output.err
    connect.assert_not_called()


@pytest.mark.parametrize("args", [[], ["--schema-only"], ["--full"]])
def test_cli_success_with_skipped_content(monkeypatch, capsys, args):
    connection = SimpleNamespace(
        run_sync=AsyncMock(return_value=check.Check("PASS", "checked")),
        scalar=AsyncMock(),
    )

    class Connection:
        async def __aenter__(self):
            return connection

        async def __aexit__(self, *exc):
            pass

    monkeypatch.setattr(settings, "published_content_root", " ")
    monkeypatch.setattr(
        session, "engine", SimpleNamespace(connect=Connection, dispose=AsyncMock())
    )

    assert check.main(args) == 0
    output = capsys.readouterr().out
    assert connection.run_sync.await_count == 2
    connection.scalar.assert_not_awaited()
    if args == ["--schema-only"]:
        assert "Published Content: SKIP (schema-only mode)" in output
        assert "WARNING" not in output
        assert "Running App Restore" not in output
    else:
        assert (
            "Published Content: SKIP (WARNING: PUBLISHED_CONTENT_ROOT is unset)"
            in output
        )
        assert "Running App Restore: SKIP" in output
    assert "Shared Policy: PASS" in output
    assert "Overall: PASS" in output


@pytest.mark.parametrize(
    "args", [["--secret-unknown-token"], ["--fu"], ["--full", "--schema-only"]]
)
def test_cli_rejects_invalid_options_without_echoing_them(capsys, args):
    with pytest.raises(SystemExit) as exc:
        check.main(args)

    assert exc.value.code == 2
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err.splitlines() == [
        "Options: FAIL (use --schema-only or --full; see --help)",
        "Overall: FAIL",
    ]


def test_cli_redacts_unexpected_exceptions_and_library_logs(
    monkeypatch, capsys, caplog
):
    async def fail(schema_only):
        logging.getLogger("deployment.test").error("cookie=secret-session-token")
        raise RuntimeError("invalid configuration file: secret-config-path")

    monkeypatch.setattr(check, "run_checks", fail)

    assert check.main(["--full"]) == 1
    output = capsys.readouterr()
    assert "Overall: FAIL" in output.out
    assert "secret-" not in output.out
    assert output.err == ""
    assert not caplog.records
