"""명시적으로 격리 확인된 빈 테스트 DB에서만 DB 승인 이력 게시(`publish_with_stored_approvals`)를 검증한다.

실행 조건 · 안전 장치는 `test_approval_persistence_mysql.py`와 같다(`APPROVAL_MYSQL_*`).
승인 이력 migration(d2a6f8b1c903)과 레거시 content_reviews migration(e2a7c4f9b1d3)만 적용하고 끝나면 되돌린다.
승인 기록 · 콘텐츠는 가상 데이터다(실제 승인자 · 실제 PM 콘텐츠가 아니다).
"""

import asyncio
import importlib.util
import os
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services import content_publication, publication_approval
from app.services.approval_history import ReviewRecord
from app.services.content_publication import publish_with_stored_approvals
from app.services.gate_review import VerifiedAdmin, create_gate_review
from app.services.pinned_content import PinnedContentStore
from tests.test_content_publication import sealed
from tests.test_publication_gate import CASE_ID

pytestmark = pytest.mark.skipif(
    os.environ.get("APPROVAL_MYSQL_ISOLATED") != "1",
    reason="explicit isolated approval MySQL test database required",
)

VERSIONS_DIR = Path(__file__).parents[1] / "alembic/versions"
MIGRATIONS = (
    "d2a6f8b1c903_add_npc_approval_reviews.py",
    "e2a7c4f9b1d3_create_content_reviews.py",
)
ADMIN = VerifiedAdmin(reviewer="가상 운영자")
TARGET = ApprovalTarget(
    target_type="case_content", target_id=CASE_ID, content_version=1
)


def migrate(connection, action: str) -> None:
    names = MIGRATIONS if action == "upgrade" else tuple(reversed(MIGRATIONS))
    with Operations.context(MigrationContext.configure(connection)):
        for name in names:
            spec = importlib.util.spec_from_file_location(
                f"stored_approval_{name[:12]}", VERSIONS_DIR / name
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            getattr(module, action)()


def mysql_run(scenario) -> None:
    async def execute():
        url = make_url(os.environ["APPROVAL_MYSQL_URL"])
        # 접속 전에 전용 호스트 · DB 이름을 확인하고, 접속 후 실제 datadir도 대조한다.
        assert url.drivername == "mysql+aiomysql"
        assert url.host in {"127.0.0.1", "localhost"}
        assert url.port is not None and url.port != 3306
        assert url.database and url.database.startswith("test_npc_approval_")
        expected = Path(os.environ["APPROVAL_MYSQL_DATADIR"]).resolve()
        engine = create_async_engine(url, hide_parameters=True)
        initialized = False
        try:
            async with engine.begin() as connection:
                database, datadir = (
                    await connection.execute(text("SELECT DATABASE(), @@datadir"))
                ).one()
                assert database == url.database
                assert Path(datadir).resolve() == expected
                assert not (await connection.execute(text("SHOW TABLES"))).all(), (
                    "test schema must be empty"
                )
                await connection.run_sync(lambda sync: migrate(sync, "upgrade"))
                initialized = True
            await scenario(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(lambda sync: migrate(sync, "downgrade"))
            await engine.dispose()

    asyncio.run(execute())


def request(gate: str, fingerprint: str, decision: str = "approved", **extra):
    if decision != "approved":
        extra.setdefault("reason", "(가상) 사유")
    return GateReviewCreate(
        **TARGET.model_dump(),
        gate=gate,
        target_hash=fingerprint,
        decision=decision,
        **extra,
    )


async def review(sessions, gate: str, fingerprint: str, **kwargs) -> ReviewRecord:
    async with sessions() as db:
        return await create_gate_review(
            db, request(gate, fingerprint, **kwargs), admin=ADMIN
        )


async def approve_all(sessions, fingerprint: str, gates=("G1", "G2", "G3")):
    return {gate: await review(sessions, gate, fingerprint) for gate in gates}


async def publish(sessions, store, bundle):
    return await publish_with_stored_approvals(
        sessions, store, bundle, ng_checker=lambda text: False
    )


def approval_reasons(report) -> tuple[str, ...]:
    return next(c for c in report.checks if c.code == "APPROVALS").reasons


async def records(sessions) -> tuple[ReviewRecord, ...]:
    async with sessions() as db:
        return tuple(await ApprovalHistoryRepository(db).records(TARGET))


# ── 차단 ──


def test_mysql_missing_gate_and_other_fingerprint_block_registration():
    bundle, fingerprint = sealed()
    _, other = sealed(answer="가상다른정답")

    async def scenario(sessions):
        store = PinnedContentStore()
        await approve_all(sessions, fingerprint, ("G1", "G2"))
        report = await publish(sessions, store, bundle)
        assert approval_reasons(report) == ("G3:missing",)

        # 다른 fingerprint의 G3 승인은 이 묶음의 G3이 아니다.
        await review(sessions, "G3", other)
        report = await publish(sessions, store, bundle)
        assert approval_reasons(report) == ("G3:stale target_hash",)
        assert store.versions(CASE_ID) == ()

        await review(sessions, "G3", fingerprint)
        assert (await publish(sessions, store, bundle)).outcome == "published"
        # 승인된 fingerprint와 다른 같은 버전 묶음은 등록되지 않는다.
        other_bundle, _ = sealed(answer="가상다른정답")
        report = await publish(sessions, store, other_bundle)
        assert report.outcome == "version_conflict"
        assert store.get_version(CASE_ID, 1).pin.content_fingerprint == fingerprint

    mysql_run(scenario)


def test_mysql_withdrawal_blocks_and_keeps_history():
    bundle, fingerprint = sealed()

    async def scenario(sessions):
        store = PinnedContentStore()
        approved = await approve_all(sessions, fingerprint)
        await review(
            sessions,
            "G2",
            fingerprint,
            decision="rejected",
            supersedes=approved["G2"].review_id,
        )

        report = await publish(sessions, store, bundle)

        assert report.outcome == "rejected"
        assert approval_reasons(report) == ("G2:rejected",)
        assert store.versions(CASE_ID) == ()
        assert [r.decision for r in await records(sessions) if r.gate == "G2"] == [
            "approved",
            "rejected",
        ]

    mysql_run(scenario)


def test_mysql_legacy_content_reviews_rows_do_not_approve():
    bundle, fingerprint = sealed()

    async def scenario(sessions):
        # 레거시 테이블에 정확한 fingerprint의 세 관문 승인이 있어도 판정에 쓰지 않는다.
        async with sessions() as db:
            for n, gate in enumerate(("G1", "G2", "G3")):
                await db.execute(
                    text(
                        "INSERT INTO content_reviews (review_id, subject_id, "
                        "subject_version, gate, target_hash, decision, reviewer, "
                        "reviewed_at, recorded_at) VALUES (:id, :subject, 1, :gate, "
                        ":hash, 'approved', 'legacy', NOW(3), NOW(6))"
                    ),
                    {
                        "id": f"00000000-0000-4000-8000-00000000000{n}",
                        "subject": CASE_ID,
                        "gate": gate,
                        "hash": fingerprint,
                    },
                )
            await db.commit()
        store = PinnedContentStore()

        report = await publish(sessions, store, bundle)

        assert approval_reasons(report) == ("G1:missing", "G2:missing", "G3:missing")
        assert store.versions(CASE_ID) == ()
        async with sessions() as db:
            await db.execute(text("DELETE FROM content_reviews"))
            await db.commit()

    mysql_run(scenario)


def test_mysql_unreachable_database_blocks_registration():
    bundle, fingerprint = sealed()

    async def scenario(sessions):
        await approve_all(sessions, fingerprint)
        url = make_url(os.environ["APPROVAL_MYSQL_URL"]).set(port=1)
        broken = create_async_engine(url, hide_parameters=True)
        store = PinnedContentStore()
        try:
            report = await publish(async_sessionmaker(broken), store, bundle)
        finally:
            await broken.dispose()

        assert report.outcome == "rejected"
        assert approval_reasons(report) == ("approval source unavailable",)
        assert store.versions(CASE_ID) == ()

    mysql_run(scenario)


# ── 동시성 ──


def test_mysql_withdrawal_waits_until_publication_registered(monkeypatch):
    """판정 · 등록 도중의 철회는 등록이 끝날 때까지 기다린다(조회와 등록 사이에 끼어들지 않는다)."""

    bundle, fingerprint = sealed()
    entered, release = asyncio.Event(), asyncio.Event()
    real = publication_approval.locked_approval_history

    @asynccontextmanager
    async def paused(sessions, target):
        async with real(sessions, target) as value:
            entered.set()
            await release.wait()
            yield value

    monkeypatch.setattr(content_publication, "locked_approval_history", paused)

    async def scenario(sessions):
        store = PinnedContentStore()
        approved = await approve_all(sessions, fingerprint)
        publication = asyncio.create_task(publish(sessions, store, bundle))
        await asyncio.wait_for(entered.wait(), timeout=30)
        withdrawal = asyncio.create_task(
            review(
                sessions,
                "G2",
                fingerprint,
                decision="rejected",
                supersedes=approved["G2"].review_id,
            )
        )
        await asyncio.sleep(1.0)
        assert not withdrawal.done(), "withdrawal was not held by the approval lock"
        assert store.versions(CASE_ID) == ()

        release.set()
        report = await asyncio.wait_for(publication, timeout=30)
        withdrawn = await asyncio.wait_for(withdrawal, timeout=30)

        # 철회는 게시가 커밋된 이력으로 등록을 마친 뒤에 기록된다.
        assert report.outcome == "published"
        assert store.versions(CASE_ID) == (1,)
        assert withdrawn.decision == "rejected"
        # 게시 뒤 철회는 게시본을 자동으로 내리지 않는다(PM). 다음 게시 판정은 철회를 본다.
        again = await publish(sessions, PinnedContentStore(), bundle)
        assert approval_reasons(again) == ("G2:rejected",)

    mysql_run(scenario)


def test_mysql_publication_waits_for_uncommitted_withdrawal():
    """먼저 잠금을 잡은 철회가 commit될 때까지 게시가 기다리고, 그 철회를 보고 막힌다."""

    bundle, fingerprint = sealed()

    async def scenario(sessions):
        store = PinnedContentStore()
        approved = await approve_all(sessions, fingerprint)
        async with sessions() as db:
            await ApprovalHistoryRepository(db).lock_target(TARGET)
            publication = asyncio.create_task(publish(sessions, store, bundle))
            await asyncio.sleep(1.0)
            assert not publication.done(), "publication did not wait for the lock"
            # 같은 트랜잭션에서 철회를 기록하고 commit한다(잠금 해제).
            await create_gate_review(
                db,
                request(
                    "G2",
                    fingerprint,
                    decision="hold",
                    supersedes=approved["G2"].review_id,
                ),
                admin=ADMIN,
            )
        report = await asyncio.wait_for(publication, timeout=30)

        assert report.outcome == "rejected"
        assert approval_reasons(report) == ("G2:hold",)
        assert store.versions(CASE_ID) == ()

    mysql_run(scenario)


def test_mysql_concurrent_publications_register_once():
    bundle, fingerprint = sealed()
    other_bundle, _ = sealed(answer="가상다른정답")

    async def scenario(sessions):
        store = PinnedContentStore()
        await approve_all(sessions, fingerprint)

        reports = await asyncio.gather(
            *(publish(sessions, store, bundle) for _ in range(5)),
            publish(sessions, store, other_bundle),
        )

        outcomes = sorted(report.outcome for report in reports)
        assert outcomes.count("published") == 1
        assert outcomes.count("already_published") == 4
        # 승인 없는 다른 fingerprint 묶음은 등록 전이면 rejected, 뒤면 version_conflict다.
        assert outcomes.count("rejected") + outcomes.count("version_conflict") == 1
        assert store.versions(CASE_ID) == (1,)
        assert store.get_version(CASE_ID, 1).pin.content_fingerprint == fingerprint

    mysql_run(scenario)
