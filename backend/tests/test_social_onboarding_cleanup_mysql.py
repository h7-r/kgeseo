"""명시적으로 격리 확인된 빈 테스트 DB에서만 소셜 온보딩 pending 정리를 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
전체 migration 체인을 적용하고, 끝나면 그 전용 schema의 테이블을 모두 지운다.
기록은 가상 데이터다(실제 사용자 · 실제 소셜 계정 · 실제 토큰이 아니다).
"""

import asyncio
import os
import secrets
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.social_onboarding_pending import SocialOnboardingPending
from app.services.local_auth import utc_now
from app.services.social_onboarding import (
    PENDING_RETENTION,
    OnboardingError,
    locked_pending,
    token_digest,
)
from app.services.social_onboarding_cleanup import cleanup_onboarding_pendings
from tests.test_content_release_mysql import mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

OLD = PENDING_RETENTION + timedelta(hours=1)


def row(*, expires: timedelta, consumed: timedelta | None = None, token=None):
    now = utc_now()
    token = token or secrets.token_urlsafe(32)
    return SocialOnboardingPending(
        id=str(uuid4()),
        token_hash=token_digest(token),
        provider="google",
        provider_subject=f"subject-{uuid4().hex}",
        email=f"{uuid4().hex[:8]}@example.invalid",
        created_at=now - timedelta(days=3),
        expires_at=now + expires,
        consumed_at=None if consumed is None else now + consumed,
    )


async def add(sessions, *rows) -> None:
    async with sessions() as db, db.begin():
        db.add_all(rows)


async def remaining(sessions) -> set[str]:
    async with sessions() as db:
        return set(await db.scalars(select(SocialOnboardingPending.id)))


async def count(sessions) -> int:
    async with sessions() as db:
        return await db.scalar(
            select(func.count()).select_from(SocialOnboardingPending)
        )


def test_mysql_cleanup_deletes_only_old_records_in_batches():
    async def scenario(sessions):
        kept = [
            row(expires=timedelta(minutes=10)),  # 유효 · 미사용
            row(
                expires=timedelta(minutes=5), consumed=-timedelta(minutes=1)
            ),  # 최근 소비
            row(expires=-timedelta(hours=2)),  # 최근 만료
        ]
        old = [row(expires=-OLD) for _ in range(230)] + [
            row(expires=-OLD + timedelta(minutes=5), consumed=-OLD) for _ in range(20)
        ]
        await add(sessions, *kept, *old)

        result = await cleanup_onboarding_pendings(sessions, batch_size=100)
        again = await cleanup_onboarding_pendings(sessions, batch_size=100)

        assert (result.deleted, result.batches, result.error_code) == (250, 3, None)
        assert (again.deleted, again.batches) == (0, 0)
        assert await remaining(sessions) == {r.id for r in kept}

    mysql_run(scenario)


def test_mysql_concurrent_cleanups_delete_each_record_once():
    async def scenario(sessions):
        valid = row(expires=timedelta(minutes=10))
        await add(sessions, valid, *(row(expires=-OLD) for _ in range(600)))

        results = await asyncio.gather(
            *(cleanup_onboarding_pendings(sessions, batch_size=50) for _ in range(3))
        )

        assert all(r.error_code is None for r in results)
        assert sum(r.deleted for r in results) == 600
        assert await remaining(sessions) == {valid.id}

    mysql_run(scenario)


def test_mysql_cleanup_does_not_touch_a_token_being_consumed():
    """유효 토큰을 소비하는 트랜잭션이 잠금을 잡고 있어도 정리는 기다리지 않고, 그 기록을 지우지 않는다."""

    async def scenario(sessions):
        token = secrets.token_urlsafe(32)
        valid = row(expires=timedelta(minutes=10), token=token)
        await add(sessions, valid, *(row(expires=-OLD) for _ in range(30)))

        async with sessions() as consumer:
            pending = await locked_pending(consumer, token)  # FOR UPDATE
            result = await asyncio.wait_for(
                cleanup_onboarding_pendings(sessions, batch_size=10), timeout=10
            )
            pending.consumed_at = utc_now()
            await consumer.commit()

        assert result.deleted == 30
        assert await remaining(sessions) == {valid.id}
        # 같은 토큰 재사용은 지금처럼 409(onboarding_token_used)다.
        async with sessions() as db:
            with pytest.raises(OnboardingError) as raised:
                await locked_pending(db, token)
        assert (raised.value.code, raised.value.status_code) == (
            "onboarding_token_used",
            409,
        )

    mysql_run(scenario)


def test_mysql_cleanup_waits_only_for_a_locked_target_row():
    """오래된 기록을 다른 트랜잭션이 잠그고 있으면 그 배치만 기다렸다가 지운다."""

    async def scenario(sessions):
        locked = row(expires=-OLD)
        await add(sessions, locked, *(row(expires=-OLD) for _ in range(5)))

        async with sessions() as holder:
            await holder.execute(
                select(SocialOnboardingPending.id)
                .where(SocialOnboardingPending.id == locked.id)
                .with_for_update()
            )
            task = asyncio.create_task(cleanup_onboarding_pendings(sessions))
            await asyncio.sleep(1.0)
            assert not task.done(), "cleanup did not wait for the locked row"
            await holder.rollback()
        result = await asyncio.wait_for(task, timeout=30)

        assert result.deleted == 6
        assert await count(sessions) == 0

    mysql_run(scenario)
