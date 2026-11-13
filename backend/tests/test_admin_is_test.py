"""팀 테스트 계정 표시 is_test(미르 11/13) — DB 없이 보는 것: 열 정의 · 제외 조건 SQL · 서버 명령.

실제 집계는 격리 MySQL 검사(`tests/test_admin_is_test_mysql.py`)가 본다.
"""

import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import mysql

from app.api.v1 import admin as admin_api
from app.main import app
from app.models.app_user import AppUser
from app.models.beta_event import BetaEvent
from app.models.play_session import PlaySession
from app.services.user_session import current_user
from scripts import set_test_account as cli

USER_ID = "00000000-0000-4000-8000-0000000000aa"
MIGRATIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _sql(model, clause) -> str:
    return str(
        select(model.id)
        .where(clause)
        .compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True})
    )


# --- 열 · migration ---


def test_is_test_column_is_not_null_and_defaults_false():
    column = AppUser.__table__.c.is_test
    assert column.nullable is False
    assert column.default.arg is False  # ORM 으로 만든 새 회원
    assert column.server_default is not None  # 기존 회원 · 원시 INSERT
    # BOOLEAN 은 MySQL 에서 TINYINT(1)(BOOL) · CHECK 제약은 만들지 않는다
    assert column.type.compile(dialect=mysql.dialect()) == "BOOL"
    assert column.type.create_constraint is False


def _load_migration():
    path = MIGRATIONS / "f3c8a1d6e2b7_add_app_users_is_test.py"
    spec = importlib.util.spec_from_file_location("migration_f3c8a1d6e2b7", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_adds_one_column_on_top_of_previous_head():
    module = _load_migration()
    assert module.revision == "f3c8a1d6e2b7"
    assert module.down_revision == "a3f9c2e7b1d4"

    calls: list[tuple[str, tuple, dict]] = []

    class RecordingOp:
        def __getattr__(self, name):
            return lambda *args, **kwargs: calls.append((name, args, kwargs))

    original = module.op
    module.op = RecordingOp()
    try:
        module.upgrade()
        module.downgrade()
    finally:
        module.op = original
    (add, drop) = calls
    assert add[0] == "add_column" and add[1][0] == "app_users"
    column = add[1][1]
    assert column.name == "is_test" and column.nullable is False
    assert str(column.server_default.arg.compile(dialect=mysql.dialect())) == "false"
    assert drop == ("drop_column", ("app_users", "is_test"), {})


# --- 제외 조건 ---


def test_member_stats_exclude_admins_and_test_accounts_unless_internal():
    assert admin_api._internal_excluded(True) is None
    sql = _sql(AppUser, admin_api._internal_excluded(False))
    assert "app_users.`role` != 'admin'" in sql
    assert "app_users.is_test IS false" in sql


def test_internal_account_is_admin_or_test_account():
    """최종 정책(미르 11/13): 내부 계정 = role == "admin" OR is_test == true. 회원 쪽 조건은 정확히 그 반대다."""

    sql = _sql(AppUser, admin_api._internal_account(AppUser))
    assert "app_users.`role` = 'admin' OR app_users.is_test IS true" in sql


def test_guest_stats_exclude_guests_transferred_to_internal_accounts():
    assert admin_api._guest_internal_excluded(True) is None
    sql = _sql(PlaySession, admin_api._guest_internal_excluded(False))
    assert "NOT (EXISTS" in sql
    assert (
        "guest_session_transfers.anonymous_session_id = play_sessions.anonymous_session_id"
        in sql
    )
    assert "guest_session_transfers.app_user_id = transfer_account.id" in sql
    # 관리자 · 테스트 계정 둘 다(승계 받은 계정의 별칭으로 — 바깥 쿼리의 app_users 와 섞이지 않는다)
    assert (
        "transfer_account.`role` = 'admin' OR transfer_account.is_test IS true" in sql
    )
    assert "app_users." not in sql


def test_creation_time_owner_rule_keeps_its_five_conditions():
    """is_test 는 생성 당시 소유자 판정(M1 · G안)에 섞지 않는다 — 다섯 조건 그대로, 테스트 계정 조건 없음."""

    sql = _sql(PlaySession, admin_api._transferred_after_creation())
    for condition in (
        "guest_session_transfers.anonymous_session_id = play_sessions.anonymous_session_id",
        "play_sessions.created_at < guest_session_transfers.transferred_at",
        "guest_session_transfers.play_session_count > 0",
        "play_sessions.owner_user_id = guest_session_transfers.app_user_id",
        "play_sessions.updated_at >= guest_session_transfers.transferred_at",
    ):
        assert condition in sql
    assert "is_test" not in sql


def test_beta_events_exclusion_uses_linked_accounts_only():
    sql = _sql(BetaEvent, admin_api._beta_event_internal_excluded())
    # 회원 id 가 있는 기록 — 그 회원이 지금 관리자 · 테스트 계정인지
    assert "event_account.id = beta_events.app_user_id" in sql
    assert "event_account.`role` = 'admin' OR event_account.is_test IS true" in sql
    # 회원 id 가 없는 게스트 기록 — 그 게스트가 관리자 · 테스트 계정으로 승계됐을 때만
    assert "beta_events.app_user_id IS NOT NULL OR NOT (EXISTS" in sql
    assert (
        "guest_session_transfers.guest_session_id = beta_events.guest_session_id" in sql
    )
    assert "linked_account.`role` = 'admin' OR linked_account.is_test IS true" in sql
    # 참여 코드 · 탭으로는 판단하지 않는다
    assert "participant_code" not in sql and "tab_id" not in sql


@pytest.fixture
def as_admin():
    admin = AppUser(id=USER_ID, email="a@example.com", nickname="가나", role="admin")
    app.dependency_overrides[current_user] = lambda: admin
    yield
    app.dependency_overrides.pop(current_user, None)


def test_game_include_internal_rejects_unknown_values(client, db_session, as_admin):
    response = client.get("/api/v1/admin/stats/game?include_internal=maybe")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_query"
    assert db_session.execute_calls == []


# --- 서버 명령 scripts/set_test_account.py ---


class RowSession:
    """apply() 가 쓰는 만큼만 흉내 낸다 — 첫 execute 는 (id, role, is_test) 한 줄을 돌려준다."""

    def __init__(self, row: tuple | None) -> None:
        self.row = row
        self.statements: list[Any] = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(first=lambda: self.row)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def _sql_text(statement) -> str:
    return str(statement.compile(dialect=mysql.dialect()))


def test_cli_reads_only_id_role_and_flag():
    db = RowSession((USER_ID, "user", False))
    asyncio.run(cli.apply(db, USER_ID, True, execute=False))
    read = _sql_text(db.statements[0])
    assert "app_users.id, app_users.`role`, app_users.is_test" in read
    for private in ("email", "nickname", "password", "token"):
        assert private not in read


def test_cli_dry_run_does_not_write():
    db = RowSession((USER_ID, "user", False))
    outcome = asyncio.run(cli.apply(db, USER_ID, True, execute=False))
    assert outcome == cli.Outcome(USER_ID, "user", False, False, False)
    assert len(db.statements) == 1 and db.commits == 0 and db.rollbacks == 1
    assert "FOR UPDATE" not in _sql_text(db.statements[0])


@pytest.mark.parametrize("before,value", [(False, True), (True, False)])
def test_cli_execute_sets_and_clears_with_row_lock(before, value):
    db = RowSession((USER_ID, "user", before))
    outcome = asyncio.run(cli.apply(db, USER_ID, value, execute=True))
    assert outcome == cli.Outcome(USER_ID, "user", before, value, True)
    assert "FOR UPDATE" in _sql_text(db.statements[0])
    write = _sql_text(db.statements[1])
    assert write.startswith("UPDATE app_users SET is_test=")
    assert "WHERE app_users.id = " in write
    assert db.commits == 1


def test_cli_execute_same_value_writes_nothing():
    db = RowSession((USER_ID, "admin", True))
    outcome = asyncio.run(cli.apply(db, USER_ID, True, execute=True))
    assert outcome == cli.Outcome(USER_ID, "admin", True, True, False)
    assert len(db.statements) == 1 and db.commits == 0


def test_cli_missing_user_returns_none_without_writing():
    db = RowSession(None)
    assert asyncio.run(cli.apply(db, USER_ID, True, execute=True)) is None
    assert len(db.statements) == 1 and db.commits == 0 and db.rollbacks == 1


@pytest.mark.parametrize(
    "argv,message",
    [
        (["not-a-uuid", "true"], "UUID"),
        ([USER_ID, "yes"], "true 또는 false"),
        ([USER_ID, "true", "--execute"], "--confirm"),
        (
            [
                USER_ID,
                "true",
                "--execute",
                "--confirm",
                "00000000-0000-4000-8000-0000000000bb",
            ],
            "다릅니다",
        ),
        ([USER_ID, "true", "--execute", "--confirm", "oops"], "UUID"),
    ],
)
def test_cli_refuses_bad_usage_before_touching_the_db(
    monkeypatch, capsys, argv, message
):
    async def must_not_run(*args):
        raise AssertionError("DB 에 닿으면 안 된다")

    monkeypatch.setattr(cli, "_run", must_not_run)
    assert cli.main(argv) == cli.EXIT_USAGE
    assert message in capsys.readouterr().err


def test_cli_accepts_uppercase_uuid_and_value(monkeypatch, capsys):
    seen = {}

    async def fake_run(user_id, value, execute):
        seen.update(user_id=user_id, value=value, execute=execute)
        return cli.Outcome(user_id, "user", False, True, True)

    monkeypatch.setattr(cli, "_run", fake_run)
    code = cli.main(
        [USER_ID.upper(), "TRUE", "--execute", "--confirm", USER_ID.upper()]
    )
    assert code == 0
    assert seen == {"user_id": USER_ID, "value": True, "execute": True}
    assert "is_test: false -> true" in capsys.readouterr().out


def test_cli_not_found_exit_code(monkeypatch, capsys):
    async def fake_run(*args):
        return None

    monkeypatch.setattr(cli, "_run", fake_run)
    assert cli.main([USER_ID, "true"]) == cli.EXIT_NOT_FOUND
    assert "그런 회원이 없습니다" in capsys.readouterr().err


@pytest.mark.parametrize(
    "outcome,value,execute,expected",
    [
        (cli.Outcome(USER_ID, "user", False, False, False), True, False, "[DRY-RUN]"),
        (cli.Outcome(USER_ID, "user", True, True, False), True, False, "이미 그 값"),
        (cli.Outcome(USER_ID, "user", True, True, False), True, True, "[UNCHANGED]"),
        (cli.Outcome(USER_ID, "user", True, False, True), False, True, "true -> false"),
    ],
)
def test_cli_output_has_no_personal_data(outcome, value, execute, expected):
    line = cli.describe(outcome, value, execute=execute, target="db=waegok_test")
    assert expected in line
    assert USER_ID in line and "role=user" in line
    assert "@" not in line
