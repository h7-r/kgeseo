import asyncio
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

from app.db import session
from scripts import check_deployment as check
from tests.test_content_release import FakePublicationService, state, write_bundle


@pytest.mark.parametrize(
    ("revision", "status", "detail"),
    [
        ("head", "PASS", "DB="),
        ("base", "FAIL", "does not match"),
        ("secret-db-value", "FAIL", "DB=<unknown>"),
        (None, "FAIL", "DB=<none>"),
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
        assert detail in result.detail
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
    assert "found 2" in result.detail


def test_schema_reports_missing_tables_and_columns():
    with create_engine("sqlite://").connect() as connection:
        connection.execute(text("CREATE TABLE app_users (id VARCHAR(36))"))
        result = check.check_required_tables(connection)

    assert result.status == "FAIL"
    assert "missing tables:" in result.detail
    assert "play_sessions" in result.detail
    assert "missing columns:" in result.detail
    assert "app_users.email" in result.detail


@pytest.mark.parametrize(
    ("root_mode", "bundle_mode", "status", "detail"),
    [
        ("unset", "empty", "SKIP", "no publication records"),
        ("valid", "empty", "SKIP", "no publication records"),
        ("invalid", "empty", "FAIL", "not a readable directory"),
        ("unset", "missing", "FAIL", "is unset with publication records"),
        ("valid", "missing", "FAIL", "files_missing=1"),
        ("valid", "changed", "FAIL", "rebuild_failed=1"),
        ("valid", "valid", "PASS", "1 version(s) rebuilt"),
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
    assert detail in result.detail
    assert str(tmp_path) not in result.detail


def test_cli_db_connection_failure_redacts_driver_error(monkeypatch, capsys):
    class FailingConnection:
        async def __aenter__(self):
            raise OperationalError(None, None, ValueError("sensitive-db-password"))

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
    assert output.err == ""
    dispose.assert_awaited_once()


def test_cli_bad_configuration_has_no_traceback_or_input_values():
    environment = {
        **os.environ,
        "DB_PORT": "secret-invalid-port",
        "DB_PASSWORD": "secret-password",
        "NAVER_CLIENT_SECRET": "secret-oauth",
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


@pytest.mark.parametrize("args", [[], ["--schema-only"]])
def test_cli_success_with_skipped_content(monkeypatch, capsys, args):
    passed = check.Check("PASS", "checked")
    monkeypatch.setattr(
        check,
        "run_checks",
        AsyncMock(return_value=(passed, passed, check.Check("SKIP", "empty"))),
    )

    assert check.main(args) == 0
    output = capsys.readouterr().out
    check.run_checks.assert_awaited_once_with(bool(args))
    assert ("Running App Restore: SKIP" in output) is (not args)
    assert "Overall: PASS" in output
