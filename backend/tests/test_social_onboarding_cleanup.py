import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, or_, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.services import social_onboarding_cleanup as cleanup
from app.services.social_onboarding import PENDING_RETENTION
from scripts import cleanup_social_onboarding_pendings as cli

# 가상 테스트 데이터. 실제 사용자 · 실제 소셜 계정이 아니다.
# 배치 삭제 · 동시성은 tests/test_social_onboarding_cleanup_mysql.py가 실제 MySQL로 본다.
NOW = datetime(2026, 11, 3, 12, 0, 0)
EMAIL = "pending-user@example.invalid"
SUBJECT = "provider-subject-test"
BACKEND_DIR = Path(__file__).resolve().parents[1]


def pending(name: str, *, expires: timedelta, consumed: timedelta | None = None):
    return SocialOnboardingPending(
        id=name.ljust(36, "-"),
        token_hash=name.ljust(64, "0"),
        provider="google",
        provider_subject=SUBJECT,
        email=EMAIL,
        created_at=NOW - timedelta(days=3),
        expires_at=NOW + expires,
        consumed_at=None if consumed is None else NOW + consumed,
    )


ROWS = {
    "valid": dict(expires=timedelta(minutes=5)),
    "valid-edge": dict(expires=timedelta(microseconds=1)),
    "consumed-recent": dict(expires=timedelta(minutes=5), consumed=-timedelta(hours=1)),
    "expired-recent": dict(expires=-timedelta(hours=1)),
    "expired-at-cutoff": dict(expires=-PENDING_RETENTION),
    "expired-old": dict(expires=-PENDING_RETENTION - timedelta(seconds=1)),
    "consumed-old": dict(
        expires=-PENDING_RETENTION + timedelta(minutes=5),
        consumed=-PENDING_RETENTION - timedelta(seconds=1),
    ),
}


@pytest.fixture
def sqlite_rows():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[SocialOnboardingPending.__table__])
    with Session(engine) as session:
        session.add_all(pending(name, **kwargs) for name, kwargs in ROWS.items())
        session.commit()
        yield session
    engine.dispose()


def selected(session: Session, condition) -> set[str]:
    return {
        row.rstrip("-")
        for row in session.scalars(select(SocialOnboardingPending.id).where(condition))
    }


# ── 정리 대상 ──


def test_cleanup_targets_are_the_same_as_issue_pending_deletion(sqlite_rows) -> None:
    # issue_pending()이 새 기록을 낼 때 지우는 조건(app.services.social_onboarding)과 같다.
    cutoff = NOW - PENDING_RETENTION
    issue_pending_condition = or_(
        SocialOnboardingPending.expires_at < cutoff,
        SocialOnboardingPending.consumed_at < cutoff,
    )

    targets = selected(sqlite_rows, cleanup.cleanup_condition(NOW))

    assert targets == selected(sqlite_rows, issue_pending_condition)
    assert targets == {"expired-old", "consumed-old"}


def test_valid_unused_and_recently_used_records_are_never_targets(sqlite_rows) -> None:
    targets = selected(sqlite_rows, cleanup.cleanup_condition(NOW))

    # 유효 · 미사용은 지우지 않는다. 최근 소비 기록은 재사용 응답(409)을 위해 남긴다.
    assert not targets & {"valid", "valid-edge", "consumed-recent"}
    assert not targets & {"expired-recent", "expired-at-cutoff"}


@pytest.mark.parametrize("batch_size", [0, -1, 5001, True, 1.5])
def test_batch_size_is_bounded(batch_size: Any) -> None:
    with pytest.raises(ValueError):
        asyncio.run(cleanup.cleanup_onboarding_pendings(None, batch_size=batch_size))


# ── 결과 · 로그(비민감 정보만) ──


class FakeResult:
    def __init__(self, ids):
        self._ids = ids

    def all(self):
        return self._ids


class FakeSession:
    """배치마다 남은 ID를 돌려주는 가짜 세션. 실행한 SQL 문을 남긴다."""

    def __init__(self, store: "FakeStore") -> None:
        self.store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def begin(self):
        return self

    async def scalars(self, statement):
        self.store.statements.append(statement)
        if self.store.error is not None:
            raise self.store.error
        if statement._for_update_arg is not None:
            # 기본 키 잠금 · 조건 재확인: 고른 ID 중 아직 남은 것
            chosen = statement.compile().params["id_1"]
            return FakeResult([i for i in self.store.ids if i in chosen])
        return FakeResult(self.store.ids[: self.store.limit(statement)])

    async def execute(self, statement, params):
        # 기본 키 등호 삭제(executemany)
        assert "row_id" in str(statement)
        ids = [p["row_id"] for p in params]
        self.store.ids = [i for i in self.store.ids if i not in ids]

        class Result:
            rowcount = len(ids)

        return Result()


class FakeStore:
    def __init__(self, count: int) -> None:
        self.ids = [f"id-{n:04d}" for n in range(count)]
        self.statements: list[Any] = []
        self.error: Exception | None = None

    def limit(self, statement) -> int:
        return statement._limit_clause.value

    def __call__(self):
        return FakeSession(self)


def test_batches_until_no_targets_remain() -> None:
    store = FakeStore(250)

    result = asyncio.run(
        cleanup.cleanup_onboarding_pendings(store, batch_size=100, now=NOW)
    )

    assert result == cleanup.PendingCleanupResult(250, 3)
    assert store.ids == []


def test_max_batches_stops_early() -> None:
    store = FakeStore(250)

    result = asyncio.run(
        cleanup.cleanup_onboarding_pendings(
            store, batch_size=100, max_batches=1, now=NOW
        )
    )

    assert result == cleanup.PendingCleanupResult(100, 1)
    assert len(store.ids) == 150


def test_database_error_returns_only_an_error_code(caplog) -> None:
    store = FakeStore(10)
    store.error = OperationalError(
        "SELECT id FROM social_onboarding_pendings", {"email": EMAIL}, Exception(EMAIL)
    )

    with caplog.at_level(logging.INFO):
        result = asyncio.run(cleanup.cleanup_onboarding_pendings(store, now=NOW))

    assert result == cleanup.PendingCleanupResult(0, 0, "OperationalError")
    assert EMAIL not in caplog.text and "SELECT" not in caplog.text


def test_selection_reads_only_ids() -> None:
    store = FakeStore(3)

    asyncio.run(cleanup.cleanup_onboarding_pendings(store, now=NOW))

    # 이메일 · subject · 토큰 해시 칼럼은 읽지 않는다.
    selected_columns = {c.name for c in store.statements[0].selected_columns}
    assert selected_columns == {"id"}


# ── 실행 주체(명시적 CLI만) ──


def test_cli_defaults_to_dry_run(monkeypatch, capsys) -> None:
    calls = []

    async def count(db, **kwargs):
        return 7

    async def run_cleanup(*args, **kwargs):
        calls.append(kwargs)
        return cleanup.PendingCleanupResult(7, 1)

    class Sessions:
        def __call__(self):
            return self

        async def __aenter__(self):
            return object()

        async def __aexit__(self, *exc):
            return False

    class Engine:
        async def dispose(self):
            pass

    monkeypatch.setattr(cli, "count_cleanup_targets", count)
    monkeypatch.setattr(cli, "cleanup_onboarding_pendings", run_cleanup)
    monkeypatch.setattr(cli, "AsyncSessionLocal", Sessions())
    monkeypatch.setattr(cli, "engine", Engine())

    assert cli.main([]) == 0
    assert calls == []
    dry_run = capsys.readouterr().out
    assert "[DRY-RUN]" in dry_run and "targets=7" in dry_run

    assert cli.main(["--execute", "--batch-size", "50"]) == 0
    assert calls == [{"batch_size": 50, "max_batches": None}]
    out = capsys.readouterr().out
    assert "deleted=7" in out and EMAIL not in out


def test_cleanup_is_not_wired_into_the_app() -> None:
    # 서버 시작 · HTTP 경로에서 정리를 부르지 않는다(운영자가 CLI로만 실행).
    users = [
        path
        for path in (BACKEND_DIR / "app").rglob("*.py")
        if "social_onboarding_cleanup" in path.read_text(encoding="utf-8")
    ]
    assert users == []


def test_rows_are_locked_by_primary_key_and_rechecked() -> None:
    store = FakeStore(3)

    asyncio.run(cleanup.cleanup_onboarding_pendings(store, now=NOW))

    choose, lock = store.statements[0], store.statements[1]
    assert choose._for_update_arg is None  # 고르기는 잠금 없음
    assert lock._for_update_arg is not None and lock._for_update_arg.read is False
    sql = str(
        lock.compile(
            dialect=__import__("sqlalchemy.dialects.mysql").dialects.mysql.dialect()
        )
    )
    assert "FORCE INDEX (PRIMARY)" in sql
    assert "expires_at" in sql and "consumed_at" in sql  # 조건 재확인
