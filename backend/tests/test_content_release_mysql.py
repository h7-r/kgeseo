"""명시적으로 격리 확인된 빈 테스트 DB에서만 게시 상태 ↔ 세션 콘텐츠 저장소 연결을 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
전체 migration 체인을 적용하고, 끝나면 그 전용 schema의 테이블을 모두 지운다.
승인 기록 · 콘텐츠 · 운영자는 가상 데이터다(실제 승인자 · 실제 PM 콘텐츠가 아니다).
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.anonymous_session import AnonymousSession
from app.models.play_session import PlaySession
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.content_release import (
    ContentNotPublishedError,
    publish_and_register,
    require_published_for_new_session,
    restore_on_startup,
)
from app.services.gate_review import VerifiedAdmin, create_gate_review
from app.services.npc_publication import (
    NpcPublicationService,
    PublicationGateFailedError,
)
from app.services.pinned_content import (
    ContentVersionNotFoundError,
    PinnedContentStore,
    resolve_session_content,
)
from app.services.play_session import create_play_session
from tests.test_content_release import write_bundle
from tests.test_npc_turn_idempotency_mysql import (
    drop_remaining_tables,
    upgrade_chain,
)
from tests.test_publication_gate import CASE_ID

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

ADMIN = VerifiedAdmin(reviewer="가상 운영자")


def mysql_run(scenario) -> None:
    async def execute():
        url = make_url(os.environ["NPC_IDEMPOTENCY_MYSQL_URL"])
        # 접속 전에 전용 호스트 · DB 이름을 확인하고, 접속 후 실제 datadir도 대조한다.
        assert url.drivername == "mysql+aiomysql"
        assert url.host in {"127.0.0.1", "localhost"}
        assert url.port is not None and url.port != 3306
        assert url.database and url.database.startswith("test_npc_idem_")
        expected = Path(os.environ["NPC_IDEMPOTENCY_MYSQL_DATADIR"]).resolve()
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
                await connection.run_sync(upgrade_chain)
                initialized = True
            await scenario(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


async def approve(sessions, version: int, fingerprint: str, **kwargs):
    records = {}
    for gate in ("G1", "G2", "G3"):
        decision = kwargs.get(gate, "approved")
        extra = {} if decision == "approved" else {"reason": "(가상) 사유"}
        if gate in kwargs.get("supersede", {}):
            extra["supersedes"] = kwargs["supersede"][gate]
        async with sessions() as db:
            records[gate] = await create_gate_review(
                db,
                GateReviewCreate(
                    **ApprovalTarget(
                        target_type="case_content",
                        target_id=CASE_ID,
                        content_version=version,
                    ).model_dump(),
                    gate=gate,
                    target_hash=fingerprint,
                    decision=decision,
                    **extra,
                ),
                admin=ADMIN,
            )
    return records


async def release(service, store, root, version: int = 1):
    return await publish_and_register(
        service,
        store,
        root,
        CASE_ID,
        version,
        reason="(가상) 게시",
        actor="operator-test",
        ng_checker=lambda text: False,
        local_ids=None,
    )


async def anonymous_session(sessions) -> str:
    anonymous_id = str(uuid4())
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    async with sessions() as db, db.begin():
        db.add(
            AnonymousSession(
                id=anonymous_id, created_at=now, expires_at=now + timedelta(days=1)
            )
        )
    return anonymous_id


async def new_session(sessions, store, version: int = 1, guard=None):
    anonymous_id = await anonymous_session(sessions)
    async with sessions() as db:
        return await create_play_session(
            db,
            anonymous_id,
            CASE_ID,
            pinned_content=store.get_version(CASE_ID, version),
            publication_guard=guard or require_published_for_new_session,
            initial_hint_balance=3,
        )


async def session_count(sessions) -> int:
    async with sessions() as db:
        return await db.scalar(select(func.count()).select_from(PlaySession))


async def reload(sessions, session_id: str) -> PlaySession:
    async with sessions() as db:
        return await db.get(PlaySession, session_id)


# ── 게시 → 세션 ──


def test_mysql_publish_then_create_session_and_duplicate_publication(tmp_path):
    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        await approve(sessions, 1, fingerprint)

        results = await asyncio.gather(
            *(release(service, store, tmp_path) for _ in range(3))
        )

        outcomes = sorted(r.outcome for r in results)
        assert outcomes == ["already_published", "already_published", "published"]
        assert all(r.registration.available for r in results)
        assert store.versions(CASE_ID) == (1,)
        assert len(await service.events(CASE_ID, 1)) == 1

        # 게시 직후 세션 생성: 고정 값이 DB 등록 fingerprint와 같다.
        created = await new_session(sessions, store)
        row = await reload(sessions, created.id)
        assert (row.content_version, row.content_fingerprint) == (1, fingerprint)

    mysql_run(scenario)


def test_mysql_withdrawal_before_publication_leaves_no_state(tmp_path):
    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        approved = await approve(sessions, 1, fingerprint)
        async with sessions() as db:
            await create_gate_review(
                db,
                GateReviewCreate(
                    target_type="case_content",
                    target_id=CASE_ID,
                    content_version=1,
                    gate="G2",
                    target_hash=fingerprint,
                    decision="rejected",
                    reason="(가상) 철회",
                    supersedes=approved["G2"].review_id,
                ),
                admin=ADMIN,
            )

        with pytest.raises(PublicationGateFailedError):
            await release(service, store, tmp_path)

        assert await service.current(CASE_ID, 1) is None
        assert store.versions(CASE_ID) == ()

    mysql_run(scenario)


# ── 중단 ──


def test_mysql_suspension_waits_for_in_flight_session_creation(tmp_path):
    """신규 세션 INSERT 트랜잭션이 게시 상태 행을 공유 잠금으로 잡는 동안 일반 중단은 기다린다."""

    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        await approve(sessions, 1, fingerprint)
        await release(service, store, tmp_path)
        entered, proceed = asyncio.Event(), asyncio.Event()

        async def paused_guard(db, pin):
            await require_published_for_new_session(db, pin)
            entered.set()
            await proceed.wait()

        creation = asyncio.create_task(new_session(sessions, store, guard=paused_guard))
        try:
            await asyncio.wait_for(entered.wait(), timeout=30)
            suspension = asyncio.create_task(
                service.suspend(CASE_ID, 1, reason="(가상) 점검", actor="operator-test")
            )
            await asyncio.sleep(1.0)
            assert not suspension.done(), "suspension did not wait for the share lock"
        finally:
            proceed.set()
        created = await asyncio.wait_for(creation, timeout=30)
        suspended = await asyncio.wait_for(suspension, timeout=30)

        assert suspended.status == "suspended"
        assert (await reload(sessions, created.id)).content_version == 1
        # 중단이 commit된 뒤에는 신규 세션을 만들지 않는다. 진행 중 세션은 그대로 묶음을 쓴다.
        before = await session_count(sessions)
        with pytest.raises(ContentNotPublishedError):
            await new_session(sessions, store)
        assert await session_count(sessions) == before
        assert resolve_session_content(created, store).pin.content_version == 1

    mysql_run(scenario)


def test_mysql_blocked_content_rejects_new_sessions_but_keeps_game_content(tmp_path):
    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        await approve(sessions, 1, fingerprint)
        await release(service, store, tmp_path)
        existing = await new_session(sessions, store)

        blocked = await service.block(
            CASE_ID, 1, reason="(가상) 긴급", actor="operator-test"
        )

        assert blocked.snapshot.status == "blocked"
        with pytest.raises(ContentNotPublishedError):
            await new_session(sessions, store)
        # 긴급 중단에도 진행 중 세션의 게임 콘텐츠는 유지한다(PM v0.4.6).
        assert resolve_session_content(existing, store).pin.content_fingerprint == (
            fingerprint
        )

    mysql_run(scenario)


# ── 재시작 ──


def test_mysql_restart_restores_store_from_database_and_files(tmp_path):
    fingerprints = {v: write_bundle(tmp_path, v, f"가상정답{v}") for v in (1, 2, 3)}

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        store = PinnedContentStore()
        existing = {}
        for version in (1, 2, 3):
            await approve(sessions, version, fingerprints[version])
            await release(service, store, tmp_path, version)
            existing[version] = await new_session(sessions, store, version)
        await service.suspend(CASE_ID, 2, reason="(가상) 점검", actor="operator-test")
        # v3 원본이 게시 뒤 바뀌었다(다른 fingerprint).
        write_bundle(tmp_path, 3, "가상교체정답")

        restarted = PinnedContentStore()  # 새 프로세스
        entries = await restore_on_startup(str(tmp_path), sessions, restarted)

        assert [
            (e.content_version, e.status, e.publication_status) for e in entries
        ] == [
            (1, "registered", "published"),
            (2, "registered", "suspended"),
            (3, "rebuild_failed", "published"),
        ]
        # 재시작 뒤 기존 고정 세션 조회: v1 · v2(중단)는 그대로, v3는 쓸 수 없다(409).
        for version in (1, 2):
            row = await reload(sessions, existing[version].id)
            assert (
                resolve_session_content(row, restarted).pin.content_fingerprint
                == (fingerprints[version])
            )
        with pytest.raises(ContentVersionNotFoundError):
            resolve_session_content(await reload(sessions, existing[3].id), restarted)
        # 신규 세션: 게시 중인 v1만
        await new_session(sessions, restarted, 1)
        with pytest.raises(ContentNotPublishedError):
            await new_session(sessions, restarted, 2)
        # 같은 원본으로 다시 채워도 바뀌는 것이 없다(재조정은 여러 번 해도 된다).
        again = await restore_on_startup(str(tmp_path), sessions, restarted)
        assert [e.status for e in again] == [
            "already_registered",
            "already_registered",
            "rebuild_failed",
        ]

    mysql_run(scenario)


def test_mysql_memory_only_content_cannot_start_sessions(tmp_path):
    """DB 게시 기록 없이 메모리에만 있는 묶음(유령 게시본)으로는 신규 세션을 만들지 않는다."""

    fingerprint = write_bundle(tmp_path, 1)

    async def scenario(sessions):
        service = NpcPublicationService(sessions)
        await approve(sessions, 1, fingerprint)
        await release(service, PinnedContentStore(), tmp_path)
        ghost = PinnedContentStore()
        await release(service, ghost, tmp_path)  # 등록만 맞춘다(already_published)
        await service.suspend(CASE_ID, 1, reason="(가상) 점검", actor="operator-test")

        with pytest.raises(ContentNotPublishedError):
            await new_session(sessions, ghost)
        assert await session_count(sessions) == 0

    mysql_run(scenario)
