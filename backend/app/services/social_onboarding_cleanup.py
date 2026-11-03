"""소셜 온보딩 pending 기록 정리 v0.1 (내부 서비스 · 운영 CLI 전용, HTTP 경로 없음 · 자동 실행 없음).

정리 대상은 `issue_pending()`이 새 기록을 낼 때 지우는 기준과 같다(보관 기간 `PENDING_RETENTION`, 1일).
- 만료 시각이 보관 기간보다 오래 지난 기록
- 소비 시각이 보관 기간보다 오래 지난 기록
아직 유효하고 쓰지 않은 기록(만료 전 · 미소비)은 대상이 될 수 없다. 최근에 소비된 기록은 남겨, 같은 토큰을 다시 쓰면
지금처럼 `onboarding_token_used`(409)로 답한다(응답 계약 유지).

[배치] 한 번에 `batch_size`건씩 따로 트랜잭션으로 지운다. 대상 ID는 잠금 없이 고르고, DELETE는 그 ID와 같은 조건을
다시 확인한다. 그래서 그 배치의 행만 잠그고, 그 사이 상태가 바뀐 행(조건에서 벗어난 행)은 지우지 않는다.
여러 번 · 동시에 실행해도 같은 행을 두 번 지우지 않는다(이미 지운 행은 0건으로 센다).

[기록] 결과와 로그에는 삭제 건수 · 배치 수 · 오류 코드만 남긴다. 이메일 · provider subject · 토큰 해시는 읽지도 싣지도 않는다.
"""

import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, bindparam, delete, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.social_onboarding_pending import SocialOnboardingPending
from app.services.local_auth import utc_now
from app.services.social_onboarding import PENDING_RETENTION

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 500
MAX_BATCH_SIZE = 5000


@dataclass(frozen=True)
class PendingCleanupResult:
    deleted: int
    batches: int
    # 실패하면 오류 종류 이름만(메시지 · SQL · 값은 싣지 않는다). 실패 전 배치의 삭제는 이미 확정됐다.
    error_code: str | None = None


def cleanup_condition(now: datetime):
    cutoff = now - PENDING_RETENTION
    return or_(
        SocialOnboardingPending.expires_at < cutoff,
        and_(
            SocialOnboardingPending.consumed_at.is_not(None),
            SocialOnboardingPending.consumed_at < cutoff,
        ),
    )


async def count_cleanup_targets(
    db: AsyncSession, *, now: datetime | None = None
) -> int:
    now = now or utc_now()
    return await db.scalar(
        select(func.count())
        .select_from(SocialOnboardingPending)
        .where(cleanup_condition(now))
    )


async def cleanup_onboarding_pendings(
    sessions: async_sessionmaker[AsyncSession],
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_batches: int | None = None,
    now: datetime | None = None,
) -> PendingCleanupResult:
    if (
        isinstance(batch_size, bool)
        or not isinstance(batch_size, int)
        or not 1 <= batch_size <= MAX_BATCH_SIZE
    ):
        raise ValueError(f"batch_size must be 1-{MAX_BATCH_SIZE}")
    # 기준 시각은 실행마다 한 번 정한다(배치 사이에 대상이 늘어나지 않는다).
    now = now or utc_now()
    deleted = batches = 0
    try:
        while max_batches is None or batches < max_batches:
            async with sessions() as db, db.begin():
                ids = (
                    await db.scalars(
                        select(SocialOnboardingPending.id)
                        .where(cleanup_condition(now))
                        .order_by(SocialOnboardingPending.id)
                        .limit(batch_size)
                    )
                ).all()
                if not ids:
                    break
                # 고른 ID를 기본 키로만 잠그며 조건을 다시 확인한다. 보조 인덱스(expires_at · consumed_at) 범위를
                # 잠그면 정리 대상이 아닌 행(소비 중인 유효 토큰 등)까지 기다릴 수 있다.
                locked = (
                    await db.scalars(
                        select(SocialOnboardingPending.id)
                        .with_hint(
                            SocialOnboardingPending, "FORCE INDEX (PRIMARY)", "mysql"
                        )
                        .where(
                            SocialOnboardingPending.id.in_(ids),
                            cleanup_condition(now),
                        )
                        .with_for_update()
                    )
                ).all()
                if not locked:
                    batches += 1
                    continue
                # 기본 키 등호로 한 행씩 지운다(IN 범위 삭제는 다음 행까지 next-key 잠금을 잡는다).
                # 잠근 행이므로 그 사이 바뀌거나 지워지지 않는다.
                table = SocialOnboardingPending.__table__
                await db.execute(
                    delete(table).where(table.c.id == bindparam("row_id")),
                    [{"row_id": row_id} for row_id in locked],
                )
            deleted += len(locked)
            batches += 1
            if len(ids) < batch_size:
                break
    except SQLAlchemyError as error:
        code = type(error).__name__
        logger.error(
            "onboarding pending cleanup failed: deleted=%d batches=%d error=%s",
            deleted,
            batches,
            code,
        )
        return PendingCleanupResult(deleted, batches, code)
    logger.info(
        "onboarding pending cleanup done: deleted=%d batches=%d", deleted, batches
    )
    return PendingCleanupResult(deleted, batches)
