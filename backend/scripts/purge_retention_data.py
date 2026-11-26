"""보존 기간이 지난 개인정보 · 보안 데이터 파기(1차). 운영자가 명시적으로 실행하는 내부 작업 — 서버 시작 · HTTP 에는 연결하지 않는다.

    python -m scripts.purge_retention_data                                     # 대상 건수만(읽기 전용)
    python -m scripts.purge_retention_data --execute --confirm <DB 이름>        # 파기(지금 있는 작업 전부)
    python -m scripts.purge_retention_data --execute --confirm <DB 이름> \\
        --tasks inquiry_ip,audit_log_purge,inquiry_purge                        # 고른 작업만(운영 스케줄은 이 꼴)

대상 DB 는 앱 설정(.env 의 DB_*)이다. 작업 · 조건은 `app.services.data_retention` 과 같다(문의 IP 30일 · 감사 기록 행
1년 · 시험운영 종료 문의 파기). 운영 설정 · 실제 실행은 PM 담당이다.

- 기본은 확인(dry-run): 읽기 전용 트랜잭션으로 작업별 대상 건수(종료 파기는 문의 · 답변 따로)만 센다. 모든 줄에 changed=0.
  실행할 수 없는 작업(종료 시각 전 종료 파기)은 status=SKIPPED 와 사유를 대상 건수와 따로 보인다.
- --execute 에는 --confirm 으로 DB 이름을 한 번 더 적어야 한다. 설정의 DB 이름 · 실제로 접속한 DB(`SELECT DATABASE()`) ·
  확인 값이 모두 같아야 하고, 하나라도 다르면 아무것도 바꾸지 않고 종료 코드 2.
- 기준 시각은 시작할 때 한 번 정한다: 이 PC 시계(UTC)와 DB 서버 시계(`UTC_TIMESTAMP()`) 중 **이른 쪽**. 모든 작업이 이
  값 하나를 쓰므로, 종료 파기는 두 시계가 모두 종료 시각을 지나야 열린다(종료 파기 DELETE 는 DB 서버 시계를 한 번 더 본다).
  시각을 바꾸는 옵션은 없다. DB 서버 시계를 못 읽거나, 두 시계가 5분 넘게 다르면 시작하지 않는다(종료 코드 2).
- --tasks 로 실행할 작업을 이름으로 고정한다(쉼표로 구분 · 모르는 이름 · 중복이면 종료 코드 2). 고르지 않은 작업은 dry-run 에서
  status=NOT_SELECTED 로 건수만 보이고 --execute 에서도 실행하지 않는다. 운영 스케줄은 반드시 --tasks 로 검토한 작업만 부른다 —
  후속 PR 이 새 작업을 더해도 배포만으로 자동 실행되지 않는다.
- --execute 는 DB 잠금(`GET_LOCK`, 대상 DB 별 이름)을 잡고 한다. 다른 실행(스케줄 · 수동)이 잡고 있으면 바로 끝낸다(종료 코드 3).
- 출력에는 DB 이름 · 기준 시각 · 작업 이름 · 건수 · 배치 수 · 오류 종류 이름만 나온다(본문 · 이메일 · IP · UA · 접속 정보는 없다).
- 종료 코드: 0 = 정상(확인만 · 파기 · 대상 없음), 2 = 잘못된 사용 · 확인 실패(바꾸지 않음), 3 = 다른 실행이 진행 중(바꾸지 않음),
  4 = DB 오류(실패한 배치는 롤백 · 그 전 배치는 이미 확정 — 작업 줄의 status=PARTIAL(일부 처리) · FAIL(처리 0) 과
  processed 를 본다. 같은 명령으로 다시 실행하면 남은 것만 처리한다).
"""

import argparse
import asyncio
import sys
from datetime import datetime, timedelta

from sqlalchemy import text

from app.services import data_retention as retention

MAX_CLOCK_SKEW = timedelta(minutes=5)

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_BUSY = 3
EXIT_DB_ERROR = 4

LOCK_PREFIX = "kgeseo_retention_purge:"  # MySQL 잠금 이름은 64자까지


class UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    # argparse 기본(종료 코드 2)과 같되, 잘못 넣은 값은 되풀이하지 않는다
    def error(self, message: str):
        raise UsageError("알 수 없는 옵션이거나 값이 잘못되었습니다.")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    # 줄임 옵션(--exec · --conf 등)을 받지 않는다 — 파기 명령은 정확히 적은 것만 받는다
    parser = _Parser(description=__doc__.splitlines()[0], allow_abbrev=False)
    parser.add_argument(
        "--execute", action="store_true", help="실제로 파기한다(없으면 건수만 센다)"
    )
    parser.add_argument("--confirm", default=None, help="--execute 때 대상 DB 이름")
    parser.add_argument("--batch-size", type=int, default=retention.DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--tasks",
        default=None,
        help=f"실행할 작업(쉼표 구분, 없으면 전부): {','.join(retention.TASKS)}",
    )
    args = parser.parse_args(argv)
    try:
        retention.check_batch_size(args.batch_size)
    except ValueError:
        raise UsageError(
            f"--batch-size 는 1~{retention.MAX_BATCH_SIZE} 이어야 합니다."
        ) from None
    if args.tasks is None:
        args.tasks = retention.TASKS
    else:
        try:
            args.tasks = retention.check_tasks(
                name.strip() for name in args.tasks.split(",")
            )
        except ValueError:
            raise UsageError(
                f"--tasks 는 {','.join(retention.TASKS)} 중에서 겹치지 않게 고릅니다."
            ) from None
    return args


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds") + "Z"


def _counts(targets: int | None, replies: int | None) -> str:
    text = f"targets={'-' if targets is None else targets}"
    return text if replies is None else f"{text} replies={replies}"


def _skip_note(skipped: str) -> str:
    return f"reason={skipped} purge_at={_iso(retention.INQUIRY_PURGE_AT)}"


def _plan_line(item: retention.TaskPlan, selected: bool = True) -> str:
    """dry-run 한 줄 — 대상 건수(문의 종료 파기는 답변 수도) · 실제 변경 0 · 건너뛰면 사유 · 고르지 않았으면 NOT_SELECTED."""
    if not selected:
        status, note = "NOT_SELECTED", ""
    elif item.skipped:
        status, note = "SKIPPED", f" {_skip_note(item.skipped)}"
    else:
        status, note = "DRY_RUN", ""
    return (
        f"  task={item.task} status={status} {_counts(item.targets, item.replies)} "
        f"changed=0{note}"
    )


def _result_status(item: retention.TaskResult) -> str:
    if item.skipped:
        return "SKIPPED"
    if item.error_code:
        # 앞 묶음이 이미 확정됐으면 부분 실패, 하나도 못 했으면 실패
        return "PARTIAL" if item.processed or item.replies_deleted else "FAIL"
    return "OK"


def _result_line(item: retention.TaskResult) -> str:
    status = _result_status(item)
    if item.skipped:
        return (
            f"  task={item.task} status={status} {_counts(item.targets, None)} "
            f"changed=0 {_skip_note(item.skipped)}"
        )
    extra = (
        f" replies_deleted={item.replies_deleted}"
        if item.task == retention.TASK_INQUIRY_PURGE
        else ""
    )
    return (
        f"  task={item.task} status={status} {_counts(item.targets, None)} "
        f"processed={item.processed} batches={item.batches}{extra} error={item.error_code}"
    )


class CheckFailed(Exception):
    """실제 변경 전 확인(접속 DB · 시계)이 통과하지 못했다. 메시지에는 값을 싣지 않는다."""


async def _reference_time(sessions, configured_db: str, app_now: datetime) -> datetime:
    """실제 접속한 DB 이름 · 서버 시계를 확인하고 실행 기준 시각(두 시계 중 이른 쪽)을 돌려준다."""
    try:
        async with sessions() as db:
            database, server_now = (
                await db.execute(text("SELECT DATABASE(), UTC_TIMESTAMP(6)"))
            ).one()
            await db.rollback()
    except Exception as error:
        raise CheckFailed(
            f"접속한 DB 와 DB 서버 시계를 읽지 못했습니다({type(error).__name__})."
        ) from None
    if database != configured_db:
        raise CheckFailed("접속한 DB 가 설정의 DB 이름과 다릅니다.")
    if not isinstance(server_now, datetime):
        raise CheckFailed("DB 서버 시계를 읽지 못했습니다.")
    if abs(server_now - app_now) > MAX_CLOCK_SKEW:
        raise CheckFailed(
            "이 PC 시계와 DB 서버 시계가 5분 넘게 다릅니다. 시계를 확인한 뒤 다시 실행하세요."
        )
    # 이른 쪽을 쓴다 — 어느 한 시계만 종료 시각을 지났으면 종료 파기는 열리지 않고, 정기 파기도 늦은 쪽 기준이 된다
    return min(app_now, server_now)


async def _run(args: argparse.Namespace) -> int:
    from app.core.config import settings
    from app.db import session as session_module

    configured_db = settings.db_name
    if args.execute and args.confirm != configured_db:
        print(
            "사용 오류: --execute 에는 --confirm 으로 지금 설정의 DB 이름을 정확히 적어야 합니다.",
            file=sys.stderr,
        )
        return EXIT_USAGE
    if not args.execute and args.confirm is not None:
        print("사용 오류: --confirm 은 --execute 와 함께만 씁니다.", file=sys.stderr)
        return EXIT_USAGE

    app_now = retention.current_time()
    sessions = session_module.AsyncSessionLocal
    mode = "EXECUTE" if args.execute else "DRY-RUN"
    try:
        try:
            # 실행 기준 시각 — 여기서 한 번만 정한다
            now = await _reference_time(sessions, configured_db, app_now)
        except CheckFailed as refusal:
            print(f"확인 실패: {refusal} 아무것도 바꾸지 않았습니다.", file=sys.stderr)
            return EXIT_USAGE
        print(f"[{mode}] db={configured_db} now={_iso(now)}")
        if not args.execute:
            async with sessions() as db:
                plans = await retention.plan(db, now)
            for item in plans:
                print(_plan_line(item, selected=item.task in args.tasks))
            print("[DRY-RUN] changed_total=0 (읽기 전용 — 바꾸지 않았습니다)")
            print("파기하려면 --execute --confirm <DB 이름>.")
            return EXIT_OK
        lock = LOCK_PREFIX + configured_db[: 64 - len(LOCK_PREFIX)]
        async with sessions() as lock_db:
            got = (
                await lock_db.execute(text("SELECT GET_LOCK(:name, 0)"), {"name": lock})
            ).scalar()
            if got != 1:
                print(
                    "다른 파기 실행이 진행 중입니다(DB 잠금). 아무것도 바꾸지 않았습니다.",
                    file=sys.stderr,
                )
                return EXIT_BUSY
            try:
                results = await retention.run_all(
                    sessions, now, batch_size=args.batch_size, tasks=args.tasks
                )
            finally:
                await lock_db.execute(
                    text("SELECT RELEASE_LOCK(:name)"), {"name": lock}
                )
                await lock_db.rollback()
    # 메시지에는 SQL · 값 · 접속 정보가 섞일 수 있어 종류 이름만 낸다
    except Exception as error:
        print(f"[FAIL] DB 오류: {type(error).__name__}", file=sys.stderr)
        return EXIT_DB_ERROR
    finally:
        await session_module.engine.dispose()
    for item in results:
        print(_result_line(item))
    for task in retention.TASKS:
        if task not in args.tasks:
            print(f"  task={task} status=NOT_SELECTED changed=0")
    failed = [
        f"{item.task}({_result_status(item)})" for item in results if item.error_code
    ]
    if failed:
        print(f"[FAIL] 실패한 작업: {', '.join(failed)}", file=sys.stderr)
        return EXIT_DB_ERROR
    print("[OK] 파기를 마쳤습니다.")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
    except UsageError as error:
        print(f"사용 오류: {error}", file=sys.stderr)
        return EXIT_USAGE
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
