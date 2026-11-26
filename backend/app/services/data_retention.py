"""개인정보 · 보안 데이터 보존 기간 파기 v0.2 (1차 · 내부 서비스 · 운영 CLI `scripts.purge_retention_data` 전용).

HTTP 경로 · 자동 실행은 없다. 정책은 `docs/contracts/account_withdrawal_v0.2.md` §10(PM 최종 결정 11/25 · 11/26)을 따른다.
시각은 모두 UTC naive(저장 형식 그대로)다. 기준 시각 `now` 는 실행마다 한 번 정해 모든 작업 · 배치에 같이 쓴다
(CLI 는 이 PC 시계와 DB 서버 시계 중 **이른 쪽**을 쓴다 — `scripts.purge_retention_data`).

| 작업 | 대상 | 처리 |
|---|---|---|
| `inquiry_ip` | `inquiries.client_ip` 가 있고 `created_at <= now − 30일` | `client_ip` 만 NULL(축약 보관 없음 · 나머지 열 유지) |
| `audit_log_purge` | `TIMESTAMPADD(YEAR, 1, created_at) <= now` 인 감사 기록(IP · UA 유무 무관) | 행 삭제(WD-09 · `target_id` 도 함께) |
| `inquiry_purge` | `now >= INQUIRY_PURGE_AT` 이고 DB 서버 시계도 그 시각을 지났을 때만 · `created_at < INQUIRY_PURGE_AT` 인 문의 전부(상태 무관) | 행 삭제 · 답변은 FK CASCADE |

- 감사 기록 1년은 달력 기준이다. MySQL `TIMESTAMPADD(YEAR, 1, …)` 은 2/29 를 다음 해 2/28 로 옮긴다(말일 규칙).
  감사 기록 표에는 FK · 트리거가 없어(들어오는 것도 나가는 것도) 행 삭제가 다른 표로 번지지 않는다.
- `inquiry_purge` 는 기준 시각(2027-01-01 00:00 KST) 전이면 건너뛴다(다른 작업은 그대로 한다). DELETE 문장도 DB 서버
  시계(`UTC_TIMESTAMP()`)가 기준 시각을 지났는지 다시 본다 — 넘겨받은 `now` 만 믿지 않는다. 기준 시각 정각 · 이후에
  접수된 문의는 대상이 아니다(2027년 이후 문의 보존 정책은 추후 결정).
- 아직 없는 표(비밀번호 재설정 코드 등) · `login_throttles` 정리는 이 판에 없다(신규 인증 PR 검토 뒤).

[배치] 한 번에 `batch_size` 건씩 따로 트랜잭션으로 처리한다. 대상 키를 잠금 없이 고른 뒤, UPDATE · DELETE 문장이 그 키와
**같은 조건을 다시 확인**한다(그 사이 바뀐 행 · 이미 처리한 행은 건드리지 않는다). 배치가 실패하면 그 배치만 롤백되고, 앞서
커밋한 배치는 남는다 — 결과는 실패(`error_code`)로 보고한다. 여러 번 실행해도 이미 처리한 행은 대상이 아니다(0건).

[기록] 결과 · 로그에는 작업 이름 · 건수 · 배치 수 · 오류 종류 이름만 남긴다. 이메일 · 본문 · IP · User-Agent 는 읽지도 싣지도 않는다.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, func, literal_column, select, text, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.account_data import AdminAuditLog
from app.models.inquiry import Inquiry, InquiryReply
from app.services.local_auth import utc_now

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 500
MAX_BATCH_SIZE = 5000

INQUIRY_IP_RETENTION = timedelta(days=30)
# 시험운영 종료 파기 기준 시각: 2027-01-01 00:00 KST = 2026-12-31 15:00 UTC(코드 상수 — 실행 옵션으로 바꿀 수 없다)
INQUIRY_PURGE_AT = datetime(2026, 12, 31, 15, 0, 0)

TASK_INQUIRY_IP = "inquiry_ip"
TASK_AUDIT_LOG_PURGE = "audit_log_purge"
TASK_INQUIRY_PURGE = "inquiry_purge"
TASKS = (TASK_INQUIRY_IP, TASK_AUDIT_LOG_PURGE, TASK_INQUIRY_PURGE)

SKIP_BEFORE_PURGE_AT = "before_purge_at"


def current_time() -> datetime:
    """실행 기준 시각(UTC naive). CLI 는 이것만 쓴다 — 시각을 바꾸는 실행 옵션은 두지 않는다."""
    return utc_now()


def inquiry_ip_condition(now: datetime):
    return and_(
        Inquiry.client_ip.is_not(None),
        Inquiry.created_at <= now - INQUIRY_IP_RETENTION,
    )


def audit_log_purge_condition(now: datetime):
    # 달력 기준 1년(MySQL 전용 함수 — 감사 기록 표에는 created_at 인덱스가 없어 어차피 전체를 훑는다).
    # IP · UA 가 모두 NULL 인 행도 만료되면 지운다(행 전체 삭제 · 11/26 PM 결정).
    expires_at = func.timestampadd(literal_column("YEAR"), 1, AdminAuditLog.created_at)
    return expires_at <= now


def db_clock():
    """DB 서버의 지금 UTC 시각(SQL 식). 종료 파기 문장이 이 PC 시계와 따로 다시 확인한다."""
    return func.utc_timestamp(6)


def inquiry_purge_target_condition():
    """종료 파기 대상 문의(접수 시각만). 건수를 셀 때 쓴다 — 종료 시각 전 dry-run 도 미리 볼 수 있게."""
    return Inquiry.created_at < INQUIRY_PURGE_AT


def inquiry_purge_condition():
    """실제로 지울 때의 조건 — 대상 조건에 DB 서버 시계 재확인을 더한다."""
    return and_(inquiry_purge_target_condition(), db_clock() >= INQUIRY_PURGE_AT)


def purge_is_due(now: datetime) -> bool:
    return now >= INQUIRY_PURGE_AT


@dataclass(frozen=True)
class TaskPlan:
    task: str
    targets: int | None  # 대상 건수(건너뛰는 작업도 센다)
    skipped: str | None = None
    replies: int | None = None  # inquiry_purge: 함께 지워질 답변 수


@dataclass(frozen=True)
class TaskResult:
    task: str
    targets: int | None
    processed: int = 0
    batches: int = 0
    skipped: str | None = None
    replies_deleted: int = 0
    # 실패하면 오류 종류 이름만(메시지 · SQL · 값은 싣지 않는다). 실패 전 배치의 처리는 이미 확정됐다.
    error_code: str | None = None


def check_batch_size(batch_size: int) -> None:
    if (
        isinstance(batch_size, bool)
        or not isinstance(batch_size, int)
        or not 1 <= batch_size <= MAX_BATCH_SIZE
    ):
        raise ValueError(f"batch_size must be 1-{MAX_BATCH_SIZE}")


async def _count(db: AsyncSession, model, condition) -> int:
    return await db.scalar(select(func.count()).select_from(model).where(condition))


async def _count_purge_replies(db: AsyncSession) -> int:
    doomed = select(Inquiry.id).where(inquiry_purge_target_condition())
    return await db.scalar(
        select(func.count())
        .select_from(InquiryReply)
        .where(InquiryReply.inquiry_id.in_(doomed))
    )


async def plan(db: AsyncSession, now: datetime) -> list[TaskPlan]:
    """작업별 대상 건수(읽기만). MySQL 이면 읽기 전용 트랜잭션으로 센다."""
    if db.bind.dialect.name == "mysql":
        # 다음 트랜잭션 하나에만 적용된다 — 이 세션의 첫 문장이어야 한다
        await db.execute(text("SET TRANSACTION READ ONLY"))
    plans = [
        TaskPlan(TASK_INQUIRY_IP, await _count(db, Inquiry, inquiry_ip_condition(now))),
        TaskPlan(
            TASK_AUDIT_LOG_PURGE,
            await _count(db, AdminAuditLog, audit_log_purge_condition(now)),
        ),
    ]
    # 종료 파기는 실행할 수 없는 때(종료 시각 전)에도 대상 건수를 센다 — 건수와 건너뛴 사유를 따로 보인다
    plans.append(
        TaskPlan(
            TASK_INQUIRY_PURGE,
            await _count(db, Inquiry, inquiry_purge_target_condition()),
            skipped=None if purge_is_due(now) else SKIP_BEFORE_PURGE_AT,
            replies=await _count_purge_replies(db),
        )
    )
    await db.rollback()
    return plans


async def _clear_inquiry_ip(
    db: AsyncSession, now: datetime, batch_size: int
) -> tuple[int, int, int]:
    keys = (
        await db.scalars(
            select(Inquiry.seq)
            .where(inquiry_ip_condition(now))
            .order_by(Inquiry.seq)
            .limit(batch_size)
        )
    ).all()
    if not keys:
        return 0, 0, 0
    result = await db.execute(
        update(Inquiry)
        .where(Inquiry.seq.in_(keys), inquiry_ip_condition(now))
        .values(client_ip=None)
        .execution_options(synchronize_session=False)
    )
    return len(keys), result.rowcount, 0


async def _purge_audit_logs(
    db: AsyncSession, now: datetime, batch_size: int
) -> tuple[int, int, int]:
    keys = (
        await db.scalars(
            select(AdminAuditLog.id)
            .where(audit_log_purge_condition(now))
            .order_by(AdminAuditLog.id)
            .limit(batch_size)
        )
    ).all()
    if not keys:
        return 0, 0, 0
    result = await db.execute(
        delete(AdminAuditLog)
        .where(AdminAuditLog.id.in_(keys), audit_log_purge_condition(now))
        .execution_options(synchronize_session=False)
    )
    return len(keys), result.rowcount, 0


async def _purge_inquiries(
    db: AsyncSession, now: datetime, batch_size: int
) -> tuple[int, int, int]:
    keys = (
        await db.scalars(
            select(Inquiry.seq)
            .where(inquiry_purge_condition())
            .order_by(Inquiry.seq)
            .limit(batch_size)
        )
    ).all()
    if not keys:
        return 0, 0, 0
    # 지울 문의를 기본 키로 잠그고(조건 재확인) 그 답변 수를 센 뒤 지운다. 답변은 FK ON DELETE CASCADE 로 함께 지워진다.
    locked = (
        await db.scalars(
            select(Inquiry.id)
            .where(Inquiry.seq.in_(keys), inquiry_purge_condition())
            .with_for_update()
        )
    ).all()
    if not locked:
        return len(keys), 0, 0
    replies = await db.scalar(
        select(func.count())
        .select_from(InquiryReply)
        .where(InquiryReply.inquiry_id.in_(locked))
    )
    result = await db.execute(
        delete(Inquiry)
        .where(Inquiry.seq.in_(keys), inquiry_purge_condition())
        .execution_options(synchronize_session=False)
    )
    return len(keys), result.rowcount, replies


_RUNNERS = {
    TASK_INQUIRY_IP: _clear_inquiry_ip,
    TASK_AUDIT_LOG_PURGE: _purge_audit_logs,
    TASK_INQUIRY_PURGE: _purge_inquiries,
}


async def run_task(
    sessions: async_sessionmaker[AsyncSession],
    task: str,
    now: datetime,
    *,
    targets: int | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> TaskResult:
    check_batch_size(batch_size)
    if task == TASK_INQUIRY_PURGE and not purge_is_due(now):
        return TaskResult(task, targets, skipped=SKIP_BEFORE_PURGE_AT)
    runner = _RUNNERS[task]
    processed = batches = replies = 0
    try:
        while True:
            async with sessions() as db, db.begin():
                picked, changed, deleted_replies = await runner(db, now, batch_size)
            if not picked:
                break
            batches += 1
            processed += changed
            replies += deleted_replies
            if picked < batch_size:
                break
    except SQLAlchemyError as error:
        code = type(error).__name__
        logger.error(
            "retention task failed: task=%s processed=%d batches=%d error=%s",
            task,
            processed,
            batches,
            code,
        )
        return TaskResult(task, targets, processed, batches, None, replies, code)
    logger.info(
        "retention task done: task=%s processed=%d batches=%d", task, processed, batches
    )
    return TaskResult(task, targets, processed, batches, None, replies)


def check_tasks(tasks) -> tuple[str, ...]:
    """고른 작업을 정해진 순서(`TASKS`)로. 모르는 이름 · 중복 · 빈 목록은 ValueError."""
    chosen = tuple(tasks)
    if not chosen or len(set(chosen)) != len(chosen) or not set(chosen) <= set(TASKS):
        raise ValueError("tasks must be a non-empty subset of TASKS without duplicates")
    return tuple(task for task in TASKS if task in chosen)


async def run_all(
    sessions: async_sessionmaker[AsyncSession],
    now: datetime,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    tasks=TASKS,
) -> list[TaskResult]:
    """고른 작업(기본 전부)을 차례로 한다. 한 작업이 실패해도 다음 작업은 한다(결과에 실패가 남는다).

    고르지 않은 작업은 결과에 없다 — 운영 스케줄은 검토한 작업만 이름으로 고정해 부른다(후속 PR 의 새 작업이
    배포만으로 자동 실행되지 않게).
    """
    check_batch_size(batch_size)
    chosen = check_tasks(tasks)
    try:
        async with sessions() as db:
            plans = {p.task: p for p in await plan(db, now)}
    except SQLAlchemyError as error:
        code = type(error).__name__
        logger.error("retention planning failed: error=%s", code)
        return [TaskResult(task, None, error_code=code) for task in chosen]
    return [
        await run_task(
            sessions, task, now, targets=plans[task].targets, batch_size=batch_size
        )
        for task in chosen
    ]
