"""소셜 온보딩 pending 정리(운영자가 명시적으로 실행하는 내부 작업). 서버 시작 · HTTP에는 연결하지 않는다.

    .\\.venv\\Scripts\\python.exe -m scripts.cleanup_social_onboarding_pendings            # 대상 건수만(삭제 없음)
    .\\.venv\\Scripts\\python.exe -m scripts.cleanup_social_onboarding_pendings --execute  # 삭제

대상 DB는 앱 설정(.env의 DB_*)이다. 정리 기준은 `app.services.social_onboarding_cleanup`과 같다(만료 또는 소비 후
보관 기간 1일이 지난 기록). 출력에는 DB 이름 · 건수 · 배치 수 · 오류 코드만 있다.
"""

import argparse
import asyncio
import sys

from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.services.social_onboarding_cleanup import (
    DEFAULT_BATCH_SIZE,
    cleanup_onboarding_pendings,
    count_cleanup_targets,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--execute", action="store_true", help="실제로 삭제한다(없으면 건수만 센다)"
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--max-batches", type=int, default=None)
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    try:
        if not args.execute:
            async with AsyncSessionLocal() as db:
                targets = await count_cleanup_targets(db)
            print(f"[DRY-RUN] db={settings.db_name} targets={targets}")
            return 0
        result = await cleanup_onboarding_pendings(
            AsyncSessionLocal,
            batch_size=args.batch_size,
            max_batches=args.max_batches,
        )
        status = "FAIL" if result.error_code else "OK"
        print(
            f"[{status}] db={settings.db_name} deleted={result.deleted} "
            f"batches={result.batches} error={result.error_code}"
        )
        return 1 if result.error_code else 0
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_run(parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
