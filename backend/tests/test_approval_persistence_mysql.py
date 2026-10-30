"""명시적으로 격리 확인된 빈 테스트 DB에서만 새 migration을 검증한다.

기존 앱 DB 설정은 사용하지 않는다. 실행 조건과 안전 장치는 운영 문서를 따른다.
"""

import asyncio
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import delete, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.npc_approval_review import NpcApprovalReview, NpcApprovalTarget
from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.approval_history import (
    ApprovalLog,
    DuplicateReviewError,
    ReviewRecord,
    UnknownSupersedesError,
    gate_decisions,
)
from app.services.gate_review import VerifiedAdmin, create_gate_review
from app.services.pinned_content import ContentPin, PinnedContentStore
from app.services.publication_approval import (
    check_target_approval,
    evaluate_publication_with_db_reviews,
    locked_approval_history,
)
from tests.test_publication_gate import CASE_ID, hint_source, no_idmap_files

pytestmark = pytest.mark.skipif(
    os.environ.get("APPROVAL_MYSQL_ISOLATED") != "1",
    reason="explicit isolated approval MySQL test database required",
)

FP = "sha256:" + "a" * 64
TARGET = ApprovalTarget(
    target_type="case_content", target_id="case_test", content_version=1
)


def record(**kwargs):
    return ReviewRecord(
        **(
            {
                "review_id": str(uuid4()),
                "gate": "G1",
                "target_hash": FP,
                "decision": "approved",
                "reviewer": "가상 운영자",
                "reviewed_at": "2026-10-29T00:00:00.123Z",
            }
            | kwargs
        )
    )


def request(target=TARGET, **kwargs):
    return GateReviewCreate(
        **(
            target.model_dump()
            | {"gate": "G1", "target_hash": FP, "decision": "approved"}
            | kwargs
        )
    )


def migrate(connection, action):
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/d2a6f8b1c903_add_npc_approval_reviews.py"
    )
    spec = importlib.util.spec_from_file_location("approval_migration_mysql", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(module, action)()


def mysql_run(scenario):
    async def execute():
        url = make_url(os.environ["APPROVAL_MYSQL_URL"])
        # 접속 전에 전용 호스트·DB 이름을 확인하고, 접속 후 실제 datadir도 대조한다.
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


def test_mysql_history_roundtrip_matches_memory_and_reapproval():
    async def scenario(sessions):
        log = ApprovalLog()
        history = [record(gate=g) for g in ("G1", "G2", "G3")]
        first = history[-1]
        hold = record(
            gate="G3",
            decision="hold",
            reason="검토 보류",
            supersedes=first.review_id,
            reviewed_at="2026-10-29T00:00:00.124Z",
        )
        again = record(
            gate="G3",
            reason="재검토 완료",
            supersedes=hold.review_id,
            reviewed_at="2026-10-29T00:00:00.125Z",
        )
        async with sessions() as db:
            for item in [*history, hold, again]:
                await ApprovalHistoryRepository(db).append(TARGET, item)
                await db.commit()
                log.append(TARGET.target_id, 1, item)
                fetched = await ApprovalHistoryRepository(db).records(TARGET)
                assert fetched == tuple(
                    sorted(log.records(TARGET.target_id, 1), key=lambda r: r.order_key)
                )
                assert gate_decisions(fetched, FP) == gate_decisions(
                    log.records(TARGET.target_id, 1), FP
                )
                if item is hold:
                    assert gate_decisions(fetched, FP) == ("G3:hold",)
            assert gate_decisions(fetched, FP) == ()
        async with sessions() as db:
            assert len(await ApprovalHistoryRepository(db).records(TARGET)) == 5

    mysql_run(scenario)


def test_mysql_target_type_version_and_hash_isolation():
    async def scenario(sessions):
        async with sessions() as db:
            for target in [
                TARGET,
                TARGET.model_copy(update={"target_type": "dialogue_pack"}),
                TARGET.model_copy(update={"content_version": 2}),
                TARGET.model_copy(update={"target_id": "CASE_TEST"}),
            ]:
                for gate in ("G1", "G2", "G3"):
                    await ApprovalHistoryRepository(db).append(
                        target, record(gate=gate, reviewer=target.target_type)
                    )
                await db.commit()
                rows = await ApprovalHistoryRepository(db).records(target)
                assert len(rows) == 3
                assert {r.reviewer for r in rows} == {target.target_type}
                assert await check_target_approval(sessions, target, FP) == ()
                assert await check_target_approval(
                    sessions, target, "sha256:" + "b" * 64
                )
            assert (
                await ApprovalHistoryRepository(db).records(
                    TARGET.model_copy(update={"content_version": 3})
                )
                == ()
            )

    mysql_run(scenario)


def test_mysql_duplicate_id_race_and_bad_reference():
    async def scenario(sessions):
        item = record()

        async def append():
            async with sessions() as db:
                try:
                    await ApprovalHistoryRepository(db).append(TARGET, item)
                    await db.commit()
                    return "saved"
                except DuplicateReviewError:
                    await db.rollback()
                    return "duplicate"

        assert sorted(await asyncio.gather(append(), append())) == [
            "duplicate",
            "saved",
        ]
        async with sessions() as db:
            with pytest.raises(UnknownSupersedesError):
                await ApprovalHistoryRepository(db).append(
                    TARGET, record(supersedes=str(uuid4()))
                )
            await db.rollback()
            assert len(await ApprovalHistoryRepository(db).records(TARGET)) == 1

    mysql_run(scenario)


def test_mysql_duplicate_id_across_namespaces_is_globally_rejected():
    async def scenario(sessions):
        item = record()

        async def append(target):
            async with sessions() as db:
                try:
                    await ApprovalHistoryRepository(db).append(target, item)
                    await db.commit()
                    return "saved"
                except DuplicateReviewError:
                    await db.rollback()
                    return "duplicate"

        result = await asyncio.gather(
            append(TARGET),
            append(TARGET.model_copy(update={"target_type": "dialogue_pack"})),
        )
        assert sorted(result) == ["duplicate", "saved"]

    mysql_run(scenario)


def test_mysql_previous_hash_reference_preserves_existing_history_rules():
    async def scenario(sessions):
        async with sessions() as db:
            repository = ApprovalHistoryRepository(db)
            old = record(target_hash="sha256:" + "b" * 64)
            new = record(supersedes=old.review_id)
            await repository.append(TARGET, old)
            await repository.append(TARGET, new)
            await db.commit()
            rows = await repository.records(TARGET)
            assert "G1:invalid history" not in gate_decisions(rows, FP)
            # 다른 버전 참조도 저장은 허용하되, 기존 판정 범위에 참조가 없으면 FAIL이다.
            other_version = TARGET.model_copy(update={"content_version": 2})
            await repository.append(other_version, record(supersedes=old.review_id))
            await db.commit()
            assert "G1:invalid history" in await check_target_approval(
                sessions, other_version, FP
            )

    mysql_run(scenario)


def test_mysql_concurrent_admin_writes_have_server_order_and_rollback():
    async def scenario(sessions):
        async def create():
            async with sessions() as db:
                return await create_gate_review(
                    db,
                    request(decision="hold", reason="동시 검토"),
                    admin=VerifiedAdmin("관리자"),
                )

        created = await asyncio.gather(*(create() for _ in range(8)))
        assert len({r.review_id for r in created}) == 8
        assert len({r.reviewed_at for r in created}) == 8
        assert all(len(r.reviewed_at.rsplit(".", 1)[1]) == 4 for r in created)
        async with sessions() as db:
            rows = await ApprovalHistoryRepository(db).records(TARGET)
            assert len(rows) == 8
            with pytest.raises(UnknownSupersedesError):
                await create_gate_review(
                    db, request(supersedes=str(uuid4())), admin=VerifiedAdmin("관리자")
                )
            assert len(await ApprovalHistoryRepository(db).records(TARGET)) == 8

    mysql_run(scenario)


def test_mysql_database_rejects_bulk_update_and_delete():
    async def scenario(sessions):
        async with sessions() as db:
            await ApprovalHistoryRepository(db).append(TARGET, record())
            await db.commit()
            for statement in (
                update(NpcApprovalReview).values(decision="hold"),
                delete(NpcApprovalReview),
            ):
                with pytest.raises(DBAPIError, match="append-only"):
                    await db.execute(statement)
                await db.rollback()
            assert len(await ApprovalHistoryRepository(db).records(TARGET)) == 1

    mysql_run(scenario)


def test_mysql_pub_gate_uses_db_and_does_not_withdraw_published_bundle():
    async def scenario(sessions):
        files, fingerprint = no_idmap_files()
        target = TARGET.model_copy(update={"target_id": CASE_ID})
        store = PinnedContentStore()
        async with sessions() as db:
            for gate in ("G1", "G2", "G3"):
                last = await create_gate_review(
                    db,
                    request(target, gate=gate, target_hash=fingerprint),
                    admin=VerifiedAdmin("관리자"),
                )

            async def evaluate():
                return await evaluate_publication_with_db_reviews(
                    sessions,
                    case_id=CASE_ID,
                    content_version=1,
                    **files,
                    hint_source=hint_source,
                    ng_checker=lambda _: False,
                    store=store,
                )

            result = await evaluate()
            assert result.approved and result.registered
            pin = ContentPin(CASE_ID, 1, fingerprint)
            published = store.get(pin)
            await create_gate_review(
                db,
                request(
                    target,
                    gate="G3",
                    target_hash=fingerprint,
                    decision="rejected",
                    reason="새 게시 보류",
                    supersedes=last.review_id,
                ),
                admin=VerifiedAdmin("관리자"),
            )
            result = await evaluate()
            assert not result.approved
            assert result.check("APPROVALS").reasons == ("G3:rejected",)
            assert store.get(pin) is published

    mysql_run(scenario)


# --- 게시 판정의 트랜잭션 소유권 · 최신 철회 반영 ---

OTHER = TARGET.model_copy(update={"target_id": "case_other"})


async def seed_approved(sessions) -> ReviewRecord:
    """G1~G3 승인을 commit하고 마지막(G3) 기록을 돌려준다."""

    async with sessions() as db:
        history = [record(gate=gate) for gate in ("G1", "G2", "G3")]
        for item in history:
            await ApprovalHistoryRepository(db).append(TARGET, item)
        await db.commit()
    return history[-1]


def hold_after(previous: ReviewRecord) -> ReviewRecord:
    return record(
        gate="G3",
        decision="hold",
        reason="철회",
        supersedes=previous.review_id,
        reviewed_at="2026-10-29T00:00:00.124Z",
    )


def fast_lock_timeout_sessions():
    """잠금 대기 1초로 연결하는 세션 팩토리(잠금 실패 재현용)."""

    engine = create_async_engine(
        make_url(os.environ["APPROVAL_MYSQL_URL"]),
        hide_parameters=True,
        connect_args={"init_command": "SET SESSION innodb_lock_wait_timeout = 1"},
    )
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def test_mysql_stale_snapshot_is_reproduced_and_publication_check_sees_withdrawal():
    async def scenario(sessions):
        last = await seed_approved(sessions)
        async with sessions() as caller:
            # 호출자 세션 A: snapshot을 만들고(승인 상태), 커밋하지 않은 변경도 둔다.
            stale = ApprovalHistoryRepository(caller)
            assert gate_decisions(await stale.records(TARGET), FP) == ()
            await stale.append(OTHER, record())
            # 세션 B가 철회(hold)를 commit한다.
            async with sessions() as other:
                await ApprovalHistoryRepository(other).append(TARGET, hold_after(last))
                await other.commit()
            # 결함: 같은 트랜잭션의 일반 조회는 오래된 snapshot을 본다(REPEATABLE READ).
            assert gate_decisions(await stale.records(TARGET), FP) == ()
            # 수정: 철회 commit 뒤에 시작한 게시 판정은 새 트랜잭션에서 최신 철회를 본다.
            assert await check_target_approval(sessions, TARGET, FP) == ("G3:hold",)
            # 호출자 트랜잭션과 미커밋 변경은 그대로다(판정이 commit · rollback하지 않았다).
            assert caller.in_transaction()
            assert len(await stale.records(OTHER)) == 1
            async with sessions() as outside:
                assert await ApprovalHistoryRepository(outside).records(OTHER) == ()
            await caller.rollback()

    mysql_run(scenario)


def test_mysql_publication_check_waits_for_in_flight_withdrawal():
    async def scenario(sessions):
        last = await seed_approved(sessions)
        async with sessions() as writer:
            # 철회 기록이 대상 잠금을 잡은 채 아직 commit 전이다.
            await ApprovalHistoryRepository(writer).append(TARGET, hold_after(last))
            check = asyncio.create_task(check_target_approval(sessions, TARGET, FP))
            await asyncio.sleep(0.5)
            # 오래된 이력으로 먼저 승인하지 않고 잠금을 기다린다.
            assert not check.done()
            await writer.commit()
        assert await check == ("G3:hold",)

    mysql_run(scenario)


def test_mysql_append_waits_while_locked_history_is_held():
    async def scenario(sessions):
        last = await seed_approved(sessions)

        async def withdraw():
            async with sessions() as db:
                await ApprovalHistoryRepository(db).append(TARGET, hold_after(last))
                await db.commit()

        async with locked_approval_history(sessions, TARGET) as (_, records):
            append = asyncio.create_task(withdraw())
            await asyncio.sleep(0.5)
            # 잠금을 잡은 동안(향후 게시 확정 구간) 철회가 끼어들지 못한다.
            assert not append.done()
            assert gate_decisions(records, FP) == ()
        await append
        assert await check_target_approval(sessions, TARGET, FP) == ("G3:hold",)

    mysql_run(scenario)


def test_mysql_lock_timeout_is_an_error_not_an_approval():
    async def scenario(sessions):
        await seed_approved(sessions)
        engine, fast = fast_lock_timeout_sessions()
        files, fingerprint = no_idmap_files()
        store = PinnedContentStore()
        try:
            async with sessions() as holder:
                await ApprovalHistoryRepository(holder).lock_target(TARGET)
                with pytest.raises(OperationalError) as timeout:
                    await check_target_approval(fast, TARGET, FP)
                assert timeout.value.orig.args[0] == 1205
                case_target = TARGET.model_copy(update={"target_id": CASE_ID})
                await ApprovalHistoryRepository(holder).lock_target(case_target)
                with pytest.raises(OperationalError):
                    await evaluate_publication_with_db_reviews(
                        fast,
                        case_id=CASE_ID,
                        content_version=1,
                        **files,
                        hint_source=hint_source,
                        ng_checker=lambda _: False,
                        store=store,
                    )
                assert store.versions(CASE_ID) == ()
                await holder.rollback()
            # 잠금이 풀리면 같은 판정이 정상 동작한다.
            assert await check_target_approval(fast, TARGET, FP) == ()
        finally:
            await engine.dispose()

    mysql_run(scenario)


def test_mysql_failed_or_cancelled_check_rolls_back_its_own_transaction():
    async def scenario(sessions):
        fresh = TARGET.model_copy(update={"target_id": "case_fresh"})
        with pytest.raises(RuntimeError):
            async with locked_approval_history(sessions, fresh):
                raise RuntimeError("판정 중 오류")
        async with sessions() as db:
            # 잠금 행 upsert도 rollback되어 남지 않는다.
            rows = await db.execute(
                select(NpcApprovalTarget).where(
                    NpcApprovalTarget.target_id == "case_fresh"
                )
            )
            assert rows.scalars().all() == []

        last = await seed_approved(sessions)
        async with sessions() as holder:
            await ApprovalHistoryRepository(holder).lock_target(TARGET)
            check = asyncio.create_task(check_target_approval(sessions, TARGET, FP))
            await asyncio.sleep(0.3)
            check.cancel()
            with pytest.raises(asyncio.CancelledError):
                await check
            await ApprovalHistoryRepository(holder).append(TARGET, hold_after(last))
            await holder.commit()
        # 취소된 판정이 잠금 · 연결을 남기지 않았다.
        assert await check_target_approval(sessions, TARGET, FP) == ("G3:hold",)

    mysql_run(scenario)
