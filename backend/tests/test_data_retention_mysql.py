"""격리 MySQL 에서 보존 기간 파기(1차)를 본다 — 배치 · 트랜잭션 · 경계 · CASCADE · CLI 확인 장치.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_*`). 전체 migration 체인을 적용하고, 끝나면 표를
지운다. 서비스 함수에는 가상 기준 시각을 넣어 경계를 본다(운영 CLI 에는 시각을 바꾸는 옵션이 없다). 데이터는 모두 가상 값이다.
"""

import os
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import DateTime, event, func, literal, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from app.models.account_data import AdminAuditLog
from app.models.inquiry import Inquiry, InquiryReply
from app.services import data_retention as retention
from app.services.local_auth import utc_now
from scripts import purge_retention_data as cli
from tests.test_admin_api_mysql import mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

US = timedelta(microseconds=1)
NOW = datetime(2026, 12, 13, 3, 0, 0)  # 가상 기준 시각(UTC naive)
PURGE_AT = retention.INQUIRY_PURGE_AT
IP = "198.51.100.23"  # 문서용 주소 대역(가상)
UA = "Mozilla/5.0 (retention-test-agent)"
EMAIL_TAG = "retention-test"


def inquiry(
    created_at: datetime, *, ip: str | None = IP, status: str = "open"
) -> Inquiry:
    key = uuid4().hex[:10]
    return Inquiry(
        id=str(uuid4()),
        number=f"T-{key}",
        email=f"{EMAIL_TAG}-{key}@example.invalid",
        category="etc",
        title=f"(가상) 제목 {key}",
        body=f"(가상) 본문 {key}",
        status=status,
        priority="normal",
        client_ip=ip,
        created_at=created_at,
        updated_at=created_at,
        answered_at=created_at if status != "open" else None,
    )


def reply(parent: Inquiry) -> InquiryReply:
    return InquiryReply(
        id=str(uuid4()),
        inquiry_id=parent.id,
        body="(가상) 답변",
        created_at=parent.created_at + timedelta(minutes=5),
    )


def audit(
    created_at: datetime, *, ip: str | None = IP, ua: str | None = UA
) -> AdminAuditLog:
    return AdminAuditLog(
        admin_user_id=str(uuid4()),
        action="read_inquiry",
        target_user_id=str(uuid4()),
        created_at=created_at,
        client_ip=ip,
        user_agent=ua,
        target_type="inquiry",
        target_id=str(uuid4()),
    )


async def add(sessions, *rows) -> None:
    async with sessions() as db, db.begin():
        db.add_all(rows)


async def snapshot(sessions, model, *columns):
    async with sessions() as db:
        rows = await db.execute(select(*columns).order_by(columns[0]))
        return [tuple(row) for row in rows]


INQUIRY_COLUMNS = (
    Inquiry.id,
    Inquiry.number,
    Inquiry.email,
    Inquiry.title,
    Inquiry.body,
    Inquiry.status,
    Inquiry.priority,
    Inquiry.client_ip,
    Inquiry.created_at,
    Inquiry.updated_at,
    Inquiry.answered_at,
)
AUDIT_COLUMNS = (
    AdminAuditLog.id,
    AdminAuditLog.admin_user_id,
    AdminAuditLog.action,
    AdminAuditLog.target_user_id,
    AdminAuditLog.created_at,
    AdminAuditLog.client_ip,
    AdminAuditLog.user_agent,
    AdminAuditLog.target_type,
    AdminAuditLog.target_id,
)


async def ips(sessions) -> dict[str, str | None]:
    async with sessions() as db:
        return dict((await db.execute(select(Inquiry.id, Inquiry.client_ip))).all())


async def count(sessions, model) -> int:
    async with sessions() as db:
        return await db.scalar(select(func.count()).select_from(model))


# ---------------------------------------------------------------- 문의 접수 IP 30일


def test_mysql_inquiry_ip_is_cleared_from_exactly_thirty_days():
    async def scenario(sessions):
        cutoff = NOW - timedelta(days=30)
        young = inquiry(cutoff + US)  # 30일 미만
        exact = inquiry(cutoff)  # 정확히 30일
        old = inquiry(cutoff - timedelta(days=3), status="closed")
        already = inquiry(cutoff - timedelta(days=9), ip=None)
        await add(sessions, young, exact, old, already)
        await add(sessions, reply(old))
        before = await snapshot(sessions, Inquiry, *INQUIRY_COLUMNS)

        result = await retention.run_task(sessions, retention.TASK_INQUIRY_IP, NOW)
        again = await retention.run_task(sessions, retention.TASK_INQUIRY_IP, NOW)

        assert (result.processed, result.batches, result.error_code) == (2, 1, None)
        assert (again.processed, again.batches) == (0, 0)
        assert await ips(sessions) == {
            young.id: IP,
            exact.id: None,
            old.id: None,
            already.id: None,
        }
        after = await snapshot(sessions, Inquiry, *INQUIRY_COLUMNS)
        # client_ip(INQUIRY_COLUMNS[7]) 말고는 모두 그대로 — 이메일 · 본문 · 상태 · 시각
        strip = lambda rows: [row[:7] + row[8:] for row in rows]  # noqa: E731
        assert strip(after) == strip(before)
        assert await count(sessions, InquiryReply) == 1

    mysql_run(scenario)


@pytest.mark.parametrize(
    ("targets", "batch_size", "batches"),
    [(5, 2, 3), (4, 2, 2), (1, 1, 1), (3, 5, 1)],
)
def test_mysql_inquiry_ip_batch_boundaries(targets, batch_size, batches):
    async def scenario(sessions):
        old = NOW - timedelta(days=40)
        await add(sessions, *(inquiry(old) for _ in range(targets)), inquiry(NOW))
        result = await retention.run_task(
            sessions, retention.TASK_INQUIRY_IP, NOW, batch_size=batch_size
        )
        assert (result.processed, result.batches, result.error_code) == (
            targets,
            batches,
            None,
        )
        assert sum(ip is not None for ip in (await ips(sessions)).values()) == 1

    mysql_run(scenario)


def test_mysql_failed_batch_rolls_back_only_itself_and_is_reported():
    async def scenario(sessions):
        old = NOW - timedelta(days=40)
        await add(sessions, *(inquiry(old) for _ in range(5)))
        engine = sessions.kw["bind"].sync_engine
        seen = {"updates": 0}

        def fail_second_update(conn, cursor, statement, parameters, context, many):
            if statement.lstrip().upper().startswith("UPDATE INQUIRIES"):
                seen["updates"] += 1
                if seen["updates"] == 2:
                    raise OperationalError("(simulated)", None, Exception("simulated"))

        event.listen(engine, "before_cursor_execute", fail_second_update)
        try:
            result = await retention.run_task(
                sessions, retention.TASK_INQUIRY_IP, NOW, batch_size=2
            )
        finally:
            event.remove(engine, "before_cursor_execute", fail_second_update)

        assert (result.processed, result.batches, result.error_code) == (
            2,
            1,
            "OperationalError",
        )
        assert sum(ip is None for ip in (await ips(sessions)).values()) == 2
        # 다시 실행하면 남은 것만 처리한다
        again = await retention.run_task(
            sessions, retention.TASK_INQUIRY_IP, NOW, batch_size=2
        )
        assert (again.processed, again.error_code) == (3, None)
        assert all(ip is None for ip in (await ips(sessions)).values())

    mysql_run(scenario)


# ---------------------------------------------------------------- 감사 기록 행 달력 1년 삭제(WD-09)


async def audit_ids(sessions) -> set[int]:
    async with sessions() as db:
        return set(await db.scalars(select(AdminAuditLog.id)))


def test_mysql_audit_log_table_has_no_foreign_keys_or_triggers():
    """행 삭제가 다른 표로 번지거나(CASCADE) 막히지(RESTRICT · 트리거) 않는지 실제 스키마로 본다."""

    async def scenario(sessions):
        async with sessions() as db:
            fks = await db.scalar(
                text(
                    "SELECT COUNT(*) FROM information_schema.referential_constraints "
                    "WHERE constraint_schema = DATABASE() "
                    "AND (table_name = 'admin_audit_logs' "
                    "OR referenced_table_name = 'admin_audit_logs')"
                )
            )
            triggers = await db.scalar(
                text(
                    "SELECT COUNT(*) FROM information_schema.triggers "
                    "WHERE trigger_schema = DATABASE() "
                    "AND event_object_table = 'admin_audit_logs'"
                )
            )
        assert (fks, triggers) == (0, 0)

    mysql_run(scenario)


@pytest.mark.parametrize(
    ("created_at", "now", "deleted"),
    [
        # 평년: 정확히 1년 되는 순간부터
        (datetime(2026, 11, 26, 3, 0), datetime(2027, 11, 26, 3, 0) - US, False),
        (datetime(2026, 11, 26, 3, 0), datetime(2027, 11, 26, 3, 0), True),
        (datetime(2026, 11, 26, 3, 0), datetime(2027, 11, 27), True),
        # 2/29 수집 → 다음 해 2/28 같은 시각에 만료(달력 말일 규칙)
        (datetime(2028, 2, 29, 10, 0), datetime(2029, 2, 28, 10, 0) - US, False),
        (datetime(2028, 2, 29, 10, 0), datetime(2029, 2, 28, 10, 0), True),
        # 윤년으로 넘어가는 해: 2/28 수집 → 2/28 만료(2/29 까지 기다리지 않는다)
        (datetime(2027, 2, 28, 12, 0), datetime(2028, 2, 28, 12, 0) - US, False),
        (datetime(2027, 2, 28, 12, 0), datetime(2028, 2, 28, 12, 0), True),
        (datetime(2027, 3, 1, 0, 0), datetime(2028, 2, 29, 23, 59), False),
        # 365일이 아니라 달력 1년이다(윤일이 낀 해는 366일)
        (datetime(2027, 6, 1), datetime(2027, 6, 1) + timedelta(days=365), False),
        (datetime(2027, 6, 1), datetime(2028, 6, 1), True),
    ],
)
def test_mysql_audit_log_calendar_year_boundaries(created_at, now, deleted):
    async def scenario(sessions):
        row = audit(created_at)
        await add(sessions, row)
        result = await retention.run_task(sessions, retention.TASK_AUDIT_LOG_PURGE, now)
        assert result.processed == (1 if deleted else 0)
        assert (row.id in await audit_ids(sessions)) is not deleted

    mysql_run(scenario)


def test_mysql_audit_log_purge_deletes_whole_expired_rows_only():
    async def scenario(sessions):
        old = NOW - timedelta(days=400)
        one_year_ago = datetime(2025, 12, 13, 3, 0)  # NOW 의 정확히 1년 전
        expired = {
            "both": audit(old),
            "ip_only": audit(old, ua=None),
            "ua_only": audit(old, ip=None),
            "none": audit(old, ip=None, ua=None),  # IP · UA 가 없어도 만료되면 지운다
            "exactly_one_year": audit(one_year_ago),
        }
        young = {
            "young": audit(NOW - timedelta(days=10)),
            "almost": audit(one_year_ago + US),
            "young_no_ip": audit(NOW - timedelta(days=1), ip=None, ua=None),
        }
        assert all(
            row.target_id for row in expired.values()
        )  # 문의 target_id 가 있는 행
        await add(sessions, *expired.values(), *young.values())
        young_ids = {row.id for row in young.values()}
        kept_before = [
            row
            for row in await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS)
            if row[0] in young_ids
        ]

        async with sessions() as db:
            plans = {p.task: p for p in await retention.plan(db, NOW)}
        assert (
            await count(sessions, AdminAuditLog) == 8
        )  # 건수만 센다(dry-run 은 지우지 않는다)
        result = await retention.run_task(
            sessions, retention.TASK_AUDIT_LOG_PURGE, NOW, batch_size=2
        )
        again = await retention.run_task(sessions, retention.TASK_AUDIT_LOG_PURGE, NOW)

        assert plans[retention.TASK_AUDIT_LOG_PURGE].targets == 5
        assert (result.processed, result.batches, result.error_code) == (5, 3, None)
        assert (again.processed, again.batches) == (0, 0)
        assert await audit_ids(sessions) == young_ids
        # 만료되지 않은 기록은 모든 열이 그대로 남는다
        assert await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS) == kept_before

    mysql_run(scenario)


def test_mysql_audit_log_failed_batch_rolls_back_only_itself():
    async def scenario(sessions):
        await add(sessions, *(audit(NOW - timedelta(days=400)) for _ in range(5)))
        engine = sessions.kw["bind"].sync_engine
        seen = {"deletes": 0}

        def fail_second_delete(conn, cursor, statement, parameters, context, many):
            if statement.lstrip().upper().startswith("DELETE FROM ADMIN_AUDIT_LOGS"):
                seen["deletes"] += 1
                if seen["deletes"] == 2:
                    raise OperationalError("(simulated)", None, Exception("simulated"))

        event.listen(engine, "before_cursor_execute", fail_second_delete)
        try:
            result = await retention.run_task(
                sessions, retention.TASK_AUDIT_LOG_PURGE, NOW, batch_size=2
            )
        finally:
            event.remove(engine, "before_cursor_execute", fail_second_delete)

        assert (result.processed, result.batches, result.error_code) == (
            2,
            1,
            "OperationalError",
        )
        assert await count(sessions, AdminAuditLog) == 3  # 실패한 배치(2건)는 롤백
        again = await retention.run_task(
            sessions, retention.TASK_AUDIT_LOG_PURGE, NOW, batch_size=2
        )
        assert (again.processed, again.error_code) == (3, None)
        assert await count(sessions, AdminAuditLog) == 0

    mysql_run(scenario)


# ---------------------------------------------------------------- 시험운영 종료 문의 파기


async def purge_fixture(sessions):
    doomed = [
        inquiry(datetime(2026, 11, 13, 1, 0), status="open"),
        inquiry(datetime(2026, 12, 1), status="answered"),
        inquiry(PURGE_AT - US, status="closed"),  # 기준 시각 직전
    ]
    kept = [
        inquiry(PURGE_AT, status="open"),  # 정각 · 이후 접수는 정책 미정 → 보존
        inquiry(PURGE_AT + timedelta(days=2), status="answered"),
    ]
    await add(sessions, *doomed, *kept)
    await add(
        sessions, reply(doomed[1]), reply(doomed[1]), reply(doomed[2]), reply(kept[1])
    )
    await add(
        sessions, audit(datetime(2026, 12, 2)), audit(datetime(2026, 12, 20), ip=None)
    )
    return doomed, kept


async def inquiry_ids(sessions) -> set[str]:
    async with sessions() as db:
        return set(await db.scalars(select(Inquiry.id)))


def test_mysql_purge_is_skipped_before_the_instant():
    async def scenario(sessions):
        doomed, kept = await purge_fixture(sessions)
        audits = await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS)
        result = await retention.run_task(
            sessions, retention.TASK_INQUIRY_PURGE, PURGE_AT - US
        )
        assert (result.skipped, result.processed) == (retention.SKIP_BEFORE_PURGE_AT, 0)
        assert await inquiry_ids(sessions) == {r.id for r in doomed + kept}
        assert await count(sessions, InquiryReply) == 4
        assert await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS) == audits

    mysql_run(scenario)


@pytest.fixture
def db_clock_at(monkeypatch):
    """종료 파기 문장이 다시 보는 DB 서버 시계를 가상 값으로 바꾼다(실제 DB 시계는 아직 종료 시각 전이다)."""

    def install(moment: datetime):
        monkeypatch.setattr(retention, "db_clock", lambda: literal(moment, DateTime()))

    return install


def test_mysql_purge_statement_rechecks_the_real_db_clock():
    """넘겨받은 기준 시각이 종료 시각을 지나도, 실제 DB 서버 시계가 아직 전이면 한 건도 지우지 않는다."""

    async def scenario(sessions):
        doomed, kept = await purge_fixture(sessions)
        async with sessions() as db:
            server_now = await db.scalar(text("SELECT UTC_TIMESTAMP(6)"))
        assert server_now < PURGE_AT  # 이 시험은 종료 시각 전에만 의미가 있다
        result = await retention.run_task(
            sessions, retention.TASK_INQUIRY_PURGE, PURGE_AT + timedelta(days=1)
        )
        assert (result.processed, result.error_code) == (0, None)
        assert await inquiry_ids(sessions) == {r.id for r in doomed + kept}
        assert await count(sessions, InquiryReply) == 4

    mysql_run(scenario)


@pytest.mark.parametrize("now", [PURGE_AT, PURGE_AT + timedelta(days=3)])
def test_mysql_purge_deletes_every_status_before_the_instant_with_replies(
    now, db_clock_at
):
    async def scenario(sessions):
        db_clock_at(now)
        doomed, kept = await purge_fixture(sessions)
        audits = await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS)

        async with sessions() as db:
            plans = {p.task: p for p in await retention.plan(db, now)}
        result = await retention.run_task(
            sessions, retention.TASK_INQUIRY_PURGE, now, batch_size=2
        )
        again = await retention.run_task(sessions, retention.TASK_INQUIRY_PURGE, now)

        purge_plan = plans[retention.TASK_INQUIRY_PURGE]
        assert (purge_plan.targets, purge_plan.replies, purge_plan.skipped) == (
            3,
            3,
            None,
        )
        assert (result.processed, result.batches, result.replies_deleted) == (3, 2, 3)
        assert result.error_code is None
        assert (again.processed, again.batches) == (0, 0)
        assert await inquiry_ids(sessions) == {r.id for r in kept}
        async with sessions() as db:
            left = set(await db.scalars(select(InquiryReply.inquiry_id)))
        assert left == {kept[1].id}  # 지운 문의의 답변은 CASCADE 로 함께 사라졌다
        # 감사 기록(target_id 포함)은 그대로 — 이 작업은 감사 기록을 건드리지 않는다
        assert await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS) == audits

    mysql_run(scenario)


def test_mysql_run_all_keeps_other_tasks_running_before_the_instant():
    async def scenario(sessions):
        doomed, kept = await purge_fixture(sessions)
        now = PURGE_AT - timedelta(days=1)
        results = {r.task: r for r in await retention.run_all(sessions, now)}

        assert (
            results[retention.TASK_INQUIRY_PURGE].skipped
            == retention.SKIP_BEFORE_PURGE_AT
        )
        # 11/13 접수 문의(하나)는 30일이 지나 IP 만 지워지고 문의는 남는다
        assert results[retention.TASK_INQUIRY_IP].processed == 1
        assert results[retention.TASK_INQUIRY_IP].targets == 1
        assert await inquiry_ids(sessions) == {r.id for r in doomed + kept}
        assert all(r.error_code is None for r in results.values())

    mysql_run(scenario)


# ---------------------------------------------------------------- 읽기 전용 확인 · CLI


def test_mysql_dry_run_transaction_is_read_only():
    async def scenario(sessions):
        await add(sessions, inquiry(NOW - timedelta(days=40)))
        async with sessions() as db:
            await db.execute(text("SET TRANSACTION READ ONLY"))
            with pytest.raises(OperationalError) as raised:
                await db.execute(text("UPDATE inquiries SET client_ip = NULL"))
            assert raised.value.orig.args[0] == 1792  # read-only transaction
            await db.rollback()
        assert set((await ips(sessions)).values()) == {IP}

    mysql_run(scenario)


class _KeepEngine:
    async def dispose(self):
        pass  # 하네스 엔진은 하네스가 닫는다


@pytest.fixture
def cli_on_test_db(monkeypatch):
    import app.db.session as session_module
    from app.core.config import settings

    def install(sessions):
        monkeypatch.setattr(session_module, "AsyncSessionLocal", sessions)
        monkeypatch.setattr(session_module, "engine", _KeepEngine())
        monkeypatch.setattr(
            settings, "db_name", make_url(os.environ["ADMIN_API_MYSQL_URL"]).database
        )
        return settings.db_name

    return install


def test_mysql_cli_dry_run_execute_and_repeat_without_personal_data(
    cli_on_test_db, capsys
):
    async def scenario(sessions):
        db_name = cli_on_test_db(sessions)
        real_now = utc_now()  # CLI 는 실제 시계를 쓴다(가상 시각 없음)
        rows = [
            inquiry(real_now - timedelta(days=31)),
            inquiry(real_now - timedelta(days=1)),
        ]
        await add(
            sessions, *rows, reply(rows[0]), audit(real_now - timedelta(days=400))
        )
        before = await snapshot(sessions, Inquiry, *INQUIRY_COLUMNS)

        dry = await cli._run(cli.parse_args([]))
        assert await snapshot(sessions, Inquiry, *INQUIRY_COLUMNS) == before
        assert (
            await count(sessions, AdminAuditLog) == 1
        )  # dry-run 은 감사 기록도 지우지 않는다
        wrong = await cli._run(
            cli.parse_args(["--execute", "--confirm", db_name + "-x"])
        )
        assert await snapshot(sessions, Inquiry, *INQUIRY_COLUMNS) == before
        first = await cli._run(cli.parse_args(["--execute", "--confirm", db_name]))
        second = await cli._run(cli.parse_args(["--execute", "--confirm", db_name]))
        captured = capsys.readouterr()

        assert (dry, wrong, first, second) == (0, 2, 0, 0)
        assert "task=inquiry_ip status=DRY_RUN targets=1 changed=0" in captured.out
        assert "task=audit_log_purge status=DRY_RUN targets=1 changed=0" in captured.out
        assert "[DRY-RUN] changed_total=0" in captured.out
        assert (
            "task=inquiry_ip status=OK targets=1 processed=1 batches=1" in captured.out
        )
        assert (
            "task=inquiry_ip status=OK targets=0 processed=0 batches=0" in captured.out
        )
        assert "task=inquiry_purge status=SKIPPED" in captured.out
        assert await ips(sessions) == {rows[0].id: None, rows[1].id: IP}
        assert (
            await count(sessions, Inquiry) == 2
            and await count(sessions, InquiryReply) == 1
        )
        assert await count(sessions, AdminAuditLog) == 0  # 400일 된 감사 기록 행은 삭제
        assert "task=audit_log_purge status=OK targets=1 processed=1" in captured.out
        output = captured.out + captured.err
        for secret in (
            IP,
            UA,
            EMAIL_TAG,
            "(가상) 본문",
            "(가상) 제목",
            "(가상) 답변",
            rows[0].id,
        ):
            assert secret not in output

    mysql_run(scenario)


def test_mysql_cli_refuses_when_host_clock_runs_ahead_of_the_db(
    cli_on_test_db, monkeypatch, capsys
):
    """이 PC 시계를 종료 시각 뒤로 돌려도(가상) DB 서버 시계와 어긋나 종료 파기를 시작하지 않는다."""

    async def scenario(sessions):
        db_name = cli_on_test_db(sessions)
        doomed, kept = await purge_fixture(sessions)
        monkeypatch.setattr(
            retention, "current_time", lambda: PURGE_AT + timedelta(days=1)
        )
        code = await cli._run(cli.parse_args(["--execute", "--confirm", db_name]))
        assert code == cli.EXIT_USAGE
        assert "시계" in capsys.readouterr().err
        assert await inquiry_ids(sessions) == {r.id for r in doomed + kept}
        assert set((await ips(sessions)).values()) == {IP}

    mysql_run(scenario)


async def table_state(sessions):
    return (
        await snapshot(sessions, Inquiry, *INQUIRY_COLUMNS),
        await snapshot(sessions, AdminAuditLog, *AUDIT_COLUMNS),
        await snapshot(
            sessions, InquiryReply, InquiryReply.id, InquiryReply.inquiry_id
        ),
    )


def test_mysql_cli_dry_run_counts_each_item_and_changes_nothing(cli_on_test_db, capsys):
    """dry-run 건수가 실제 대상과 같고(종료 파기는 문의 · 답변 따로, 종료 시각 전이라 SKIPPED), 표가 그대로다."""

    async def scenario(sessions):
        cli_on_test_db(sessions)
        real_now = utc_now()
        old_ip = [inquiry(real_now - timedelta(days=31 + i)) for i in range(3)]
        fresh = inquiry(real_now - timedelta(days=2))
        no_ip = inquiry(real_now - timedelta(days=40), ip=None)
        await add(sessions, *old_ip, fresh, no_ip)
        await add(sessions, reply(old_ip[0]), reply(old_ip[0]), reply(fresh))
        await add(
            sessions,
            audit(real_now - timedelta(days=400)),
            audit(real_now - timedelta(days=500), ip=None, ua=None),
            audit(real_now - timedelta(days=30)),
        )
        before = await table_state(sessions)

        code = await cli._run(cli.parse_args([]))
        captured = capsys.readouterr()

        assert code == cli.EXIT_OK
        lines = captured.out.splitlines()
        assert "  task=inquiry_ip status=DRY_RUN targets=3 changed=0" in lines
        assert "  task=audit_log_purge status=DRY_RUN targets=2 changed=0" in lines
        # 종료 시각 전(실제 시계): 접수된 문의 5건 · 답변 3건이 대상이지만 건너뛴다
        assert (
            "  task=inquiry_purge status=SKIPPED targets=5 replies=3 changed=0 "
            "reason=before_purge_at purge_at=2026-12-31T15:00:00Z"
        ) in lines
        assert "[DRY-RUN] changed_total=0 (읽기 전용 — 바꾸지 않았습니다)" in lines
        assert await table_state(sessions) == before
        output = captured.out + captured.err
        for secret in (IP, UA, EMAIL_TAG, "(가상)", fresh.id, old_ip[0].number):
            assert secret not in output

    mysql_run(scenario)


def test_mysql_cli_dry_run_with_no_targets(cli_on_test_db, capsys):
    async def scenario(sessions):
        cli_on_test_db(sessions)
        code = await cli._run(cli.parse_args([]))
        lines = capsys.readouterr().out.splitlines()
        assert code == cli.EXIT_OK
        assert "  task=inquiry_ip status=DRY_RUN targets=0 changed=0" in lines
        assert "  task=audit_log_purge status=DRY_RUN targets=0 changed=0" in lines
        assert any(
            line.startswith("  task=inquiry_purge status=SKIPPED targets=0 replies=0")
            for line in lines
        )

    mysql_run(scenario)


def test_mysql_cli_execute_is_refused_while_another_run_holds_the_lock(
    cli_on_test_db, capsys
):
    async def scenario(sessions):
        db_name = cli_on_test_db(sessions)
        real_now = utc_now()
        await add(sessions, inquiry(real_now - timedelta(days=40)))
        lock = cli.LOCK_PREFIX + db_name
        async with sessions() as holder:
            assert (
                await holder.execute(text("SELECT GET_LOCK(:n, 0)"), {"n": lock})
            ).scalar() == 1
            code = await cli._run(cli.parse_args(["--execute", "--confirm", db_name]))
            await holder.execute(text("SELECT RELEASE_LOCK(:n)"), {"n": lock})
        assert code == cli.EXIT_BUSY
        assert "다른 파기 실행이 진행 중" in capsys.readouterr().err
        assert set((await ips(sessions)).values()) == {IP}  # 바뀐 것 없음
        # 잠금이 풀리면 같은 명령으로 실행된다(잠금도 다시 풀린다)
        again = await cli._run(cli.parse_args(["--execute", "--confirm", db_name]))
        assert again == cli.EXIT_OK
        assert set((await ips(sessions)).values()) == {None}
        async with sessions() as db:
            free = (
                await db.execute(text("SELECT IS_FREE_LOCK(:n)"), {"n": lock})
            ).scalar()
        assert free == 1

    mysql_run(scenario)


def test_mysql_cli_pinned_tasks_leave_other_items_untouched(cli_on_test_db, capsys):
    async def scenario(sessions):
        db_name = cli_on_test_db(sessions)
        real_now = utc_now()
        await add(
            sessions,
            inquiry(real_now - timedelta(days=40)),
            audit(real_now - timedelta(days=400)),
        )
        argv = ["--execute", "--confirm", db_name, "--tasks", "audit_log_purge"]
        assert await cli._run(cli.parse_args(argv)) == cli.EXIT_OK
        lines = capsys.readouterr().out.splitlines()
        assert await count(sessions, AdminAuditLog) == 0
        assert set((await ips(sessions)).values()) == {
            IP
        }  # inquiry_ip 는 고르지 않았다
        assert "  task=inquiry_ip status=NOT_SELECTED changed=0" in lines

    mysql_run(scenario)
