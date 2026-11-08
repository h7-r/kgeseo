import asyncio
from typing import Any

import pytest

from app.core.config import settings
from scripts import seed_test_account
from scripts.seed_test_account import (
    EXIT_REFUSED,
    MAX_EXISTING_USERS,
    SeedRefused,
    check_server,
    check_target,
)


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "localhost", "LOCALHOST", "::1", " 127.0.0.1 "]
)
def test_check_target_accepts_loopback_hosts(host: str) -> None:
    check_target(db_host=host, db_name="waegok_test", execute=False, confirm_db=None)


@pytest.mark.parametrize(
    "host",
    [
        "db.example.com",
        "10.0.0.5",
        "192.168.0.10",
        "waegok-prod.rds.amazonaws.com",
        "127.0.0.2",
        "0.0.0.0",
        "",
    ],
)
def test_check_target_refuses_remote_hosts(host: str) -> None:
    with pytest.raises(SeedRefused, match="DB_HOST"):
        check_target(
            db_host=host, db_name="waegok_test", execute=False, confirm_db=None
        )


@pytest.mark.parametrize(
    "name",
    ["waegok_test", "waegok_dev", "waegok_local", "test_waegok", "test_npc_idem_1103"],
)
def test_check_target_accepts_dev_and_test_names(name: str) -> None:
    check_target(db_host="127.0.0.1", db_name=name, execute=True, confirm_db=name)


@pytest.mark.parametrize(
    "name",
    [
        "waegok",
        "waegok_prod",
        "production",
        "test",
        "_test",
        "waegok_test_backup",
        "WAEGOK_TEST",
        "waegok-test",
        "",
    ],
)
def test_check_target_refuses_other_names(name: str) -> None:
    # 운영과 같은 이름(waegok)도 막는다. 이름이 겹치면 개발 DB 인지 운영 DB 인지 가릴 수 없다.
    with pytest.raises(SeedRefused, match="DB_NAME"):
        check_target(db_host="127.0.0.1", db_name=name, execute=False, confirm_db=None)


@pytest.mark.parametrize("confirm_db", [None, "", "waegok_dev", "WAEGOK_TEST"])
def test_check_target_requires_matching_confirmation_to_execute(
    confirm_db: str | None,
) -> None:
    with pytest.raises(SeedRefused, match="--confirm-db"):
        check_target(
            db_host="127.0.0.1",
            db_name="waegok_test",
            execute=True,
            confirm_db=confirm_db,
        )


def server_values(**overrides: Any) -> dict[str, Any]:
    values = {
        "db_name": "waegok_test",
        "server_db": "waegok_test",
        "server_hostname": "HOME-PC",
        "local_hostname": "home-pc",
        "existing_users": 0,
    }
    return {**values, **overrides}


def test_check_server_accepts_same_machine() -> None:
    check_server(**server_values())
    check_server(
        **server_values(
            server_hostname="home-pc.local", existing_users=MAX_EXISTING_USERS
        )
    )


def test_check_server_refuses_different_database() -> None:
    with pytest.raises(SeedRefused, match="접속한 DB"):
        check_server(**server_values(server_db="waegok"))


def test_check_server_refuses_tunnelled_server() -> None:
    # 127.0.0.1 로 접속했어도 서버 호스트 이름이 다르면 터널로 다른 서버에 닿은 것이다.
    with pytest.raises(SeedRefused, match="이 PC"):
        check_server(**server_values(server_hostname="ip-10-0-1-23"))


def test_check_server_refuses_database_with_many_accounts() -> None:
    with pytest.raises(SeedRefused, match="실데이터"):
        check_server(**server_values(existing_users=MAX_EXISTING_USERS + 1))


@pytest.fixture
def target(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "db_host", "127.0.0.1")
    monkeypatch.setattr(settings, "db_name", "waegok_test")


@pytest.fixture
def seed_calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    async def fake_run_seed() -> str:
        calls.append("seed")
        return "만들었습니다"

    monkeypatch.setattr(seed_test_account, "_run_seed", fake_run_seed)
    return calls


def test_main_without_execute_does_not_touch_database(
    target: None, seed_calls: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert seed_test_account.main([]) == 0
    assert seed_calls == []
    assert "[DRY-RUN]" in capsys.readouterr().out


def test_main_refuses_production_like_target_even_with_confirmation(
    monkeypatch: pytest.MonkeyPatch,
    seed_calls: list[str],
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(settings, "db_host", "waegok-prod.example.com")
    monkeypatch.setattr(settings, "db_name", "waegok")

    assert (
        seed_test_account.main(["--execute", "--confirm-db", "waegok"]) == EXIT_REFUSED
    )
    assert seed_calls == []
    assert "[REFUSED]" in capsys.readouterr().err


def test_main_refuses_execute_without_confirmation(
    target: None, seed_calls: list[str]
) -> None:
    assert seed_test_account.main(["--execute"]) == EXIT_REFUSED
    assert seed_calls == []


def test_main_seeds_with_matching_confirmation(
    target: None, seed_calls: list[str]
) -> None:
    assert seed_test_account.main(["--execute", "--confirm-db", "waegok_test"]) == 0
    assert seed_calls == ["seed"]


class FakeResult:
    def __init__(self, row: tuple[Any, ...]) -> None:
        self.row = row

    def one(self) -> tuple[Any, ...]:
        return self.row


class FakeSeedSession:
    def __init__(
        self, *, server_db: str, server_hostname: str, existing_users: int
    ) -> None:
        self.server_row = (server_db, server_hostname)
        self.existing_users = existing_users
        self.writes: list[str] = []

    async def __aenter__(self) -> "FakeSeedSession":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def execute(self, _statement: Any) -> FakeResult:
        return FakeResult(self.server_row)

    async def scalar(self, _statement: Any) -> int:
        return self.existing_users

    def add(self, _value: Any) -> None:
        self.writes.append("add")

    async def flush(self) -> None:
        self.writes.append("flush")

    async def commit(self) -> None:
        self.writes.append("commit")


def test_seed_checks_server_before_writing(
    monkeypatch: pytest.MonkeyPatch, target: None
) -> None:
    session = FakeSeedSession(
        server_db="waegok_test", server_hostname="prod-db-1", existing_users=0
    )
    monkeypatch.setattr(seed_test_account, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(seed_test_account.socket, "gethostname", lambda: "home-pc")

    with pytest.raises(SeedRefused):
        asyncio.run(seed_test_account.seed())
    assert session.writes == []
