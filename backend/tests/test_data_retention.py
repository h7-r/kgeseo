"""보존 기간 파기(1차) 단위 테스트 — CLI 안전 장치 · 출력 · 조건 경계(SQLite).

실제 배치 · 트랜잭션 · 감사 기록 달력 1년(MySQL 함수) · CASCADE 는 tests/test_data_retention_mysql.py 가 격리 MySQL 로 본다.
데이터는 모두 가상 값이다.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import DateTime, create_engine, literal, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import Base
from app.models.app_user import AppUser
from app.models.inquiry import Inquiry, InquiryReply
from app.services import data_retention as retention
from scripts import purge_retention_data as cli

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 12, 13, 3, 0, 0)  # 가상 기준 시각(UTC naive)
SECRET = "secret-value-that-must-not-print"


# ---------------------------------------------------------------- 정책 상수 · 경계


def test_purge_at_is_new_year_kst_in_utc():
    expected = datetime(2027, 1, 1, 0, 0, tzinfo=KST).astimezone(timezone.utc)
    assert retention.INQUIRY_PURGE_AT == expected.replace(tzinfo=None)
    assert retention.INQUIRY_PURGE_AT == datetime(2026, 12, 31, 15, 0, 0)


@pytest.mark.parametrize(
    ("now", "due"),
    [
        (datetime(2026, 12, 31, 14, 59, 59, 999999), False),
        (datetime(2026, 12, 31, 15, 0, 0), True),  # 정각부터
        (datetime(2027, 1, 5), True),
        (datetime(2026, 11, 26), False),
    ],
)
def test_purge_is_due_only_from_the_purge_instant(now, due):
    assert retention.purge_is_due(now) is due


def test_inquiry_ip_retention_is_thirty_days():
    assert retention.INQUIRY_IP_RETENTION == timedelta(days=30)


@pytest.fixture
def sqlite():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[AppUser.__table__, Inquiry.__table__, InquiryReply.__table__],
    )
    with Session(engine) as session:
        yield session


def _inquiry(seq: int, created_at: datetime, ip: str | None = "198.51.100.7"):
    return Inquiry(
        seq=seq,
        id=str(uuid4()),
        number=f"Q-{seq}",
        email=f"user{seq}@example.invalid",
        category="etc",
        title="(가상) 제목",
        body="(가상) 본문",
        status="open",
        priority="normal",
        client_ip=ip,
        created_at=created_at,
        updated_at=created_at,
    )


def test_inquiry_ip_condition_boundaries(sqlite):
    cutoff = NOW - timedelta(days=30)
    rows = {
        1: cutoff + timedelta(microseconds=1),  # 30일 미만 → 유지
        2: cutoff,  # 정확히 30일 → 파기
        3: cutoff - timedelta(days=1),  # 30일 초과 → 파기
    }
    sqlite.add_all(_inquiry(seq, at) for seq, at in rows.items())
    sqlite.add(_inquiry(4, cutoff - timedelta(days=5), ip=None))  # 이미 NULL → 제외
    sqlite.commit()
    picked = sqlite.scalars(
        select(Inquiry.seq).where(retention.inquiry_ip_condition(NOW))
    ).all()
    assert sorted(picked) == [2, 3]


@pytest.fixture
def db_clock_at(monkeypatch):
    """종료 파기 문장이 다시 보는 DB 서버 시계를 가상 값으로(SQLite 에는 UTC_TIMESTAMP 가 없다)."""

    def install(moment: datetime):
        monkeypatch.setattr(retention, "db_clock", lambda: literal(moment, DateTime()))

    return install


def test_inquiry_purge_condition_boundaries(sqlite, db_clock_at):
    at = retention.INQUIRY_PURGE_AT
    db_clock_at(at)
    sqlite.add_all(
        [
            _inquiry(1, at - timedelta(microseconds=1)),  # 직전 → 파기
            _inquiry(2, at),  # 정각 → 보존(정책 미정)
            _inquiry(3, at + timedelta(hours=1)),  # 이후 → 보존
            _inquiry(4, datetime(2026, 11, 13)),
        ]
    )
    sqlite.commit()
    picked = sqlite.scalars(
        select(Inquiry.seq).where(retention.inquiry_purge_condition())
    ).all()
    assert sorted(picked) == [1, 4]
    # DB 서버 시계가 아직 종료 시각 전이면 넘겨받은 시각과 상관없이 문장이 아무것도 고르지 않는다
    db_clock_at(at - timedelta(microseconds=1))
    assert (
        sqlite.scalars(
            select(Inquiry.seq).where(retention.inquiry_purge_condition())
        ).all()
        == []
    )


@pytest.mark.parametrize("size", [0, -1, retention.MAX_BATCH_SIZE + 1, True, 1.5])
def test_batch_size_bounds_are_enforced(size):
    with pytest.raises(ValueError):
        retention.check_batch_size(size)


@pytest.mark.parametrize("size", [1, retention.MAX_BATCH_SIZE])
def test_batch_size_edges_are_accepted(size):
    retention.check_batch_size(size)


def test_run_task_skips_purge_before_the_instant_without_opening_db():
    result = asyncio.run(
        retention.run_task(
            _boom_sessions,
            retention.TASK_INQUIRY_PURGE,
            retention.INQUIRY_PURGE_AT - timedelta(seconds=1),
        )
    )
    assert (result.skipped, result.processed, result.error_code) == (
        retention.SKIP_BEFORE_PURGE_AT,
        0,
        None,
    )


# ---------------------------------------------------------------- CLI 안전 장치


def _boom_sessions():
    raise AssertionError("DB session must not be opened")


class _Engine:
    disposed = 0

    async def dispose(self):
        _Engine.disposed += 1


class _Row:
    def __init__(self, values):
        self.values = values

    def one(self):
        return self.values

    def scalar(self):
        return self.values[0]


class _IdentitySession:
    """`SELECT DATABASE(), UTC_TIMESTAMP(6)` 와 실행 잠금(GET_LOCK · RELEASE_LOCK)에만 답하는 가짜 세션."""

    def __init__(self, database, server_now, lock_state=None):
        self.database, self.server_now = database, server_now
        self.lock_state = (
            lock_state if lock_state is not None else {"get": 1, "log": []}
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "GET_LOCK" in sql or "RELEASE_LOCK" in sql:
            kind = "get" if "GET_LOCK" in sql else "release"
            self.lock_state["log"].append((kind, params["name"]))
            return _Row((self.lock_state["get"] if kind == "get" else 1,))
        assert "SELECT DATABASE(), UTC_TIMESTAMP(6)" in sql
        return _Row((self.database, self.server_now))

    async def rollback(self):
        pass


class _FailingSession(_IdentitySession):
    def __init__(self, error):
        self.error = error

    async def execute(self, statement, params=None):
        raise self.error


@pytest.fixture
def harness(monkeypatch):
    """CLI 가 쓰는 DB · 시계 · 서비스를 가짜로 바꾸고 호출을 기록한다."""
    import app.db.session as session_module

    calls: dict[str, list] = {"plan": [], "run_all": [], "clock": [], "tasks": []}
    state = {
        "database": settings.db_name,
        "server_now": NOW,
        "app_now": NOW,
        "results": None,
        "lock": {"get": 1, "log": []},
    }

    def sessions():
        if isinstance(state["server_now"], Exception):
            return _FailingSession(state["server_now"])
        return _IdentitySession(state["database"], state["server_now"], state["lock"])

    def clock():
        calls["clock"].append(state["app_now"])
        return state["app_now"]

    async def fake_plan(db, now):
        calls["plan"].append(now)
        return [
            retention.TaskPlan(retention.TASK_INQUIRY_IP, 3),
            retention.TaskPlan(retention.TASK_AUDIT_LOG_PURGE, 0),
            retention.TaskPlan(
                retention.TASK_INQUIRY_PURGE,
                2,
                skipped=retention.SKIP_BEFORE_PURGE_AT,
                replies=5,
            ),
        ]

    async def fake_run_all(sessions_arg, now, *, batch_size, tasks):
        calls["run_all"].append((now, batch_size))
        calls["tasks"].append(tasks)
        return state["results"] or [
            retention.TaskResult(retention.TASK_INQUIRY_IP, 3, 3, 1),
            retention.TaskResult(retention.TASK_AUDIT_LOG_PURGE, 0, 0, 0),
            retention.TaskResult(
                retention.TASK_INQUIRY_PURGE,
                None,
                skipped=retention.SKIP_BEFORE_PURGE_AT,
            ),
        ]

    monkeypatch.setattr(session_module, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(session_module, "engine", _Engine())
    monkeypatch.setattr(retention, "current_time", clock)
    monkeypatch.setattr(retention, "plan", fake_plan)
    monkeypatch.setattr(retention, "run_all", fake_run_all)
    return calls, state


@pytest.fixture
def no_db(monkeypatch):
    import app.db.session as session_module

    monkeypatch.setattr(session_module, "AsyncSessionLocal", _boom_sessions)
    monkeypatch.setattr(session_module, "engine", _Engine())


@pytest.mark.parametrize(
    "argv",
    [
        ["--execute"],
        ["--execute", "--confirm", ""],
        ["--execute", "--confirm", f"{settings.db_name}-mismatch"],
        ["--execute", "--confirm", settings.db_name.upper() + "X"],
        ["--confirm", settings.db_name],  # --execute 없이 확인 값만
    ],
)
def test_missing_or_wrong_confirm_stops_before_opening_db(no_db, argv, capsys):
    assert cli.main(argv) == cli.EXIT_USAGE
    assert "사용 오류" in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [
        ["--now", "2027-01-02T00:00:00"],  # 시각을 바꾸는 옵션은 없다
        ["--exec"],  # 줄임 옵션 거부
        ["--execute", "--conf", "x"],
        ["--batch-size", "0"],
        ["--batch-size", str(retention.MAX_BATCH_SIZE + 1)],
        ["--batch-size", "abc"],
        ["--unknown"],
    ],
)
def test_bad_options_stop_before_opening_db(no_db, argv, capsys):
    assert cli.main(argv) == cli.EXIT_USAGE
    err = capsys.readouterr().err
    assert "사용 오류" in err and "2027-01-02" not in err


def test_connected_db_that_differs_from_settings_changes_nothing(harness, capsys):
    calls, state = harness
    state["database"] = "some_other_db"
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_USAGE
    assert calls["plan"] == [] and calls["run_all"] == []
    assert "확인 실패" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("skew", "code"),
    [
        (cli.MAX_CLOCK_SKEW + timedelta(seconds=1), cli.EXIT_USAGE),
        (-(cli.MAX_CLOCK_SKEW + timedelta(seconds=1)), cli.EXIT_USAGE),
        (cli.MAX_CLOCK_SKEW, cli.EXIT_OK),
    ],
)
def test_clock_skew_against_db_server_blocks_execution(harness, skew, code, capsys):
    calls, state = harness
    state["server_now"] = NOW + skew
    assert cli.main(["--execute", "--confirm", settings.db_name]) == code
    assert len(calls["run_all"]) == (1 if code == cli.EXIT_OK else 0)


AT = retention.INQUIRY_PURGE_AT
SEC = timedelta(seconds=1)


@pytest.mark.parametrize(
    ("app_now", "server_now", "due"),
    [
        (AT - 2 * SEC, AT - SEC, False),  # 둘 다 종료 시각 전
        (AT + SEC, AT - SEC, False),  # 이 PC 시계만 지남
        (AT - SEC, AT + SEC, False),  # DB 서버 시계만 지남
        (AT, AT, True),  # 둘 다 정각
        (AT + 2 * SEC, AT + SEC, True),  # 둘 다 지남
    ],
)
def test_purge_opens_only_when_both_clocks_reached_the_instant(
    harness, app_now, server_now, due
):
    calls, state = harness
    state["app_now"], state["server_now"] = app_now, server_now
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_OK
    [(now, _)] = calls["run_all"]
    # 기준 시각은 두 시계 중 이른 쪽 하나 — 정기 파기도 같은 값을 쓴다
    assert now == min(app_now, server_now)
    assert retention.purge_is_due(now) is due


@pytest.mark.parametrize("server_now", [None, "2027-01-01 00:00:00"])
def test_unreadable_db_clock_changes_nothing(harness, server_now, capsys):
    calls, state = harness
    state["server_now"] = server_now
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_USAGE
    assert calls["plan"] == [] and calls["run_all"] == []
    assert "확인 실패" in capsys.readouterr().err


def test_failed_clock_query_changes_nothing_and_hides_details(harness, capsys):
    calls, state = harness
    state["server_now"] = OperationalError(
        f"SELECT ... '{SECRET}'", {"p": SECRET}, Exception(SECRET)
    )
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_USAGE
    captured = capsys.readouterr()
    assert calls["plan"] == [] and calls["run_all"] == []
    assert "확인 실패" in captured.err and "OperationalError" in captured.err
    assert SECRET not in captured.out + captured.err


def test_dry_run_counts_only_and_uses_one_fixed_time(harness, capsys):
    calls, _ = harness
    assert cli.main([]) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert calls["run_all"] == []
    assert calls["plan"] == [NOW] and calls["clock"] == [NOW]
    assert f"[DRY-RUN] db={settings.db_name} now=2026-12-13T03:00:00Z" in out
    lines = out.splitlines()
    assert "  task=inquiry_ip status=DRY_RUN targets=3 changed=0" in lines
    assert "  task=audit_log_purge status=DRY_RUN targets=0 changed=0" in lines  # 0건
    # 종료 시각 전: 대상 건수(문의 · 답변 따로)와 건너뛴 사유를 함께, 변경은 0
    assert (
        "  task=inquiry_purge status=SKIPPED targets=2 replies=5 changed=0 "
        "reason=before_purge_at purge_at=2026-12-31T15:00:00Z"
    ) in lines
    assert "[DRY-RUN] changed_total=0 (읽기 전용 — 바꾸지 않았습니다)" in lines


def test_execute_passes_the_fixed_time_and_batch_size(harness, capsys):
    calls, _ = harness
    argv = ["--execute", "--confirm", settings.db_name, "--batch-size", "7"]
    assert cli.main(argv) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert calls["run_all"] == [(NOW, 7)] and calls["clock"] == [NOW]
    assert "task=inquiry_ip status=OK targets=3 processed=3 batches=1" in out
    assert "[OK]" in out


def test_partial_and_total_failures_are_told_apart(harness, capsys):
    _, state = harness
    state["results"] = [
        # 앞 묶음 4건은 확정된 뒤 실패 → 부분 실패
        retention.TaskResult(
            retention.TASK_INQUIRY_IP, 10, 4, 2, error_code="OperationalError"
        ),
        # 하나도 처리하지 못하고 실패 → 실패
        retention.TaskResult(
            retention.TASK_AUDIT_LOG_PURGE, 3, 0, 0, error_code="OperationalError"
        ),
        retention.TaskResult(
            retention.TASK_INQUIRY_PURGE, 2, skipped=retention.SKIP_BEFORE_PURGE_AT
        ),
    ]
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_DB_ERROR
    captured = capsys.readouterr()
    lines = captured.out.splitlines()
    assert (
        "  task=inquiry_ip status=PARTIAL targets=10 processed=4 batches=2 "
        "error=OperationalError"
    ) in lines
    assert (
        "  task=audit_log_purge status=FAIL targets=3 processed=0 batches=0 "
        "error=OperationalError"
    ) in lines
    assert (
        "  task=inquiry_purge status=SKIPPED targets=2 changed=0 "
        "reason=before_purge_at purge_at=2026-12-31T15:00:00Z"
    ) in lines
    assert "[OK]" not in captured.out
    assert (
        "[FAIL] 실패한 작업: inquiry_ip(PARTIAL), audit_log_purge(FAIL)" in captured.err
    )


def test_dry_run_db_error_prints_only_the_error_type(harness, monkeypatch, capsys):
    async def failing_plan(db, now):
        raise OperationalError(
            f"SELECT ... '{SECRET}'", {"p": SECRET}, Exception(SECRET)
        )

    monkeypatch.setattr(retention, "plan", failing_plan)
    assert cli.main([]) == cli.EXIT_DB_ERROR
    captured = capsys.readouterr()
    assert "[FAIL] DB 오류: OperationalError" in captured.err
    assert SECRET not in captured.out + captured.err


def test_db_error_prints_only_the_error_type(harness, monkeypatch, capsys):
    async def failing_run_all(*args, **kwargs):
        raise OperationalError(
            f"UPDATE ... '{SECRET}'", {"p": SECRET}, Exception(SECRET)
        )

    monkeypatch.setattr(retention, "run_all", failing_run_all)
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_DB_ERROR
    captured = capsys.readouterr()
    assert "[FAIL] DB 오류: OperationalError" in captured.err
    assert SECRET not in captured.out + captured.err


def test_cli_has_no_time_option_in_help(capsys):
    with pytest.raises(SystemExit):
        cli.parse_args(["--help"])
    out = capsys.readouterr().out
    assert "--now" not in out and "--execute" in out and "--confirm" in out


# ---------------------------------------------------------------- 작업 고정(--tasks) · 실행 잠금


def test_check_tasks_returns_canonical_order_and_rejects_bad_lists():
    assert retention.check_tasks(["inquiry_purge", "inquiry_ip"]) == (
        retention.TASK_INQUIRY_IP,
        retention.TASK_INQUIRY_PURGE,
    )
    for bad in ([], ["inquiry_ip", "inquiry_ip"], ["password_reset_codes"]):
        with pytest.raises(ValueError):
            retention.check_tasks(bad)


@pytest.mark.parametrize(
    "value",
    [
        "",
        "inquiry_ip,inquiry_ip",
        "inquiry_ip,login_throttles",  # 아직 없는 작업 이름
        "audit_ip_ua",  # 옛 작업 이름
        ",",
    ],
)
def test_bad_task_lists_stop_before_opening_db(no_db, value, capsys):
    argv = ["--execute", "--confirm", settings.db_name, "--tasks", value]
    assert cli.main(argv) == cli.EXIT_USAGE
    assert "--tasks" in capsys.readouterr().err


def test_execute_runs_only_the_pinned_tasks(harness, capsys):
    calls, state = harness
    state["results"] = [retention.TaskResult(retention.TASK_INQUIRY_IP, 3, 3, 1)]
    argv = ["--execute", "--confirm", settings.db_name, "--tasks", " inquiry_ip "]
    assert cli.main(argv) == cli.EXIT_OK
    lines = capsys.readouterr().out.splitlines()
    assert calls["tasks"] == [(retention.TASK_INQUIRY_IP,)]
    assert "  task=audit_log_purge status=NOT_SELECTED changed=0" in lines
    assert "  task=inquiry_purge status=NOT_SELECTED changed=0" in lines


def test_execute_without_tasks_runs_every_current_task(harness, capsys):
    calls, _ = harness
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_OK
    assert calls["tasks"] == [retention.TASKS]
    assert "NOT_SELECTED" not in capsys.readouterr().out


def test_dry_run_still_counts_tasks_that_are_not_selected(harness, capsys):
    calls, _ = harness
    assert cli.main(["--tasks", "inquiry_ip"]) == cli.EXIT_OK
    lines = capsys.readouterr().out.splitlines()
    assert calls["run_all"] == []
    assert "  task=inquiry_ip status=DRY_RUN targets=3 changed=0" in lines
    # 고르지 않은 작업도 대상 건수는 보인다 — 스케줄에 넣기 전에 PM 이 검토할 수 있게
    assert "  task=audit_log_purge status=NOT_SELECTED targets=0 changed=0" in lines
    assert (
        "  task=inquiry_purge status=NOT_SELECTED targets=2 replies=5 changed=0"
        in lines
    )


def test_execute_takes_and_releases_the_db_lock(harness):
    calls, state = harness
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_OK
    lock = cli.LOCK_PREFIX + settings.db_name
    assert state["lock"]["log"] == [("get", lock), ("release", lock)]
    assert len(lock) <= 64


@pytest.mark.parametrize("answer", [0, None])  # 다른 실행이 잡고 있음 · 잠금 오류
def test_busy_lock_stops_execution_without_changes(harness, answer, capsys):
    calls, state = harness
    state["lock"]["get"] = answer
    assert cli.main(["--execute", "--confirm", settings.db_name]) == cli.EXIT_BUSY
    assert calls["run_all"] == []
    assert "다른 파기 실행이 진행 중" in capsys.readouterr().err


def test_dry_run_does_not_take_the_lock(harness):
    _, state = harness
    assert cli.main([]) == cli.EXIT_OK
    assert state["lock"]["log"] == []


def test_lock_name_fits_mysql_limit_for_long_db_names(harness, monkeypatch):
    _, state = harness
    long_name = "d" * 64
    monkeypatch.setattr(settings, "db_name", long_name)
    state["database"] = long_name
    assert cli.main(["--execute", "--confirm", long_name]) == cli.EXIT_OK
    assert all(len(name) <= 64 for _, name in state["lock"]["log"])
