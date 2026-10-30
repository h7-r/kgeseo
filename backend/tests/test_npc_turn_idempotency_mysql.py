"""명시적으로 격리 확인된 빈 테스트 DB에서만 NPC 턴 멱등 저장소를 검증한다.

기존 앱 DB 설정은 사용하지 않는다. 실행 조건은 `docs/npc_turn_idempotency_store.md`를 따른다.
전체 migration 체인을 그대로 적용하고 시나리오가 끝나면 모두 되돌린다.
"""

import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.npc_turn_idempotency import NpcTurnRequest, NpcTurnResponseBody
from app.models.play_session import PlaySession
from app.repositories.npc_turn_idempotency import (
    NpcTurnIdempotencyRepository,
    TurnContentRef,
)
from app.schemas.npc_turn import NpcReplyOut, NpcTurnResponse
from app.services.npc_turn_idempotency import (
    ContentPublicationBlockedError,
    IdempotencyMismatchError,
    NpcTurnIdempotencyStore,
    PublicationStateUnavailableError,
    RequestHashKeys,
    TurnClaim,
    TurnExpiredError,
    TurnInProgressError,
    TurnLeaseLostError,
    TurnReplay,
    TurnStatusUndecidedError,
    TurnWithdrawn,
    TurnWithdrawnError,
    fail_closed_publication_guard,
    turn_key,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
# 가상 테스트 키 · 콘텐츠 · 대사. 실제 운영 값이 아니다.
KEYS = RequestHashKeys("k1", {"k1": b"k1-test-only-" + b"a" * 32})
V1 = TurnContentRef("case_test", 1, "sha256:" + "1" * 64)
V2 = TurnContentRef("case_test", 2, "sha256:" + "2" * 64)
RAW_MESSAGE = "가상원문-정답알려줘-7f3a"
REQUEST = {"trigger": "player_message", "message": RAW_MESSAGE, "focus": None}
T0 = datetime(2026, 10, 30, 1, 0, 0)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta) -> None:
        self.now += timedelta(**delta)


def response(text: str = "(가상) 저장된 대사") -> NpcTurnResponse:
    return NpcTurnResponse(
        npc_event_id=uuid4(),
        reply=NpcReplyOut(source="approved_line", text=text, line_id="LINE_01"),
        suggest_hint=None,
    )


REVISION = "e4c1f7a2b9d6"


def script() -> ScriptDirectory:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(config)


def upgrade_chain(connection) -> None:
    """base부터 head까지 실제 revision을 순서대로 적용한다."""

    revisions = list(reversed(list(script().walk_revisions())))
    with Operations.context(MigrationContext.configure(connection)):
        for revision in revisions:
            revision.module.upgrade()


def downgrade_new_revision(connection) -> None:
    with Operations.context(MigrationContext.configure(connection)):
        script().get_revision(REVISION).module.downgrade()


def drop_remaining_tables(connection) -> None:
    # 기존 revision 중 일부는 downgrade가 MySQL에서 실패한다(auth_identities의 FK 인덱스).
    # 이 테스트 범위가 아니므로 격리 확인된 전용 schema의 나머지 테이블은 직접 지운다.
    tables = [row[0] for row in connection.exec_driver_sql("SHOW TABLES").all()]
    connection.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
    try:
        for table in tables:
            connection.exec_driver_sql(f"DROP TABLE `{table}`")
    finally:
        connection.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")


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
                await connection.execute(text(PUBLICATION_DDL))
                for content in (V1, V2):
                    await connection.execute(
                        text(
                            "INSERT INTO test_publication_states "
                            "VALUES (:c, :v, 'published')"
                        ),
                        {"c": content.case_id, "v": content.content_version},
                    )
            sessions = async_sessionmaker(engine, expire_on_commit=False)
            await scenario(sessions)
        finally:
            if initialized:
                async with engine.begin() as connection:
                    for model in (NpcTurnResponseBody, NpcTurnRequest):
                        await connection.execute(delete(model))
                    # 새 revision의 downgrade는 실제로 실행해 검증한다.
                    await connection.run_sync(downgrade_new_revision)
                    tables = {
                        row[0]
                        for row in (await connection.execute(text("SHOW TABLES"))).all()
                    }
                    assert not tables & {
                        "npc_turn_requests",
                        "npc_turn_response_bodies",
                    }
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


async def new_play_session(sessions, content: TurnContentRef = V1) -> str:
    anonymous_id, session_id = str(uuid4()), str(uuid4())
    async with sessions() as db, db.begin():
        db.add(AnonymousSession(id=anonymous_id, created_at=T0, expires_at=T0))
        await db.flush()
        db.add(
            PlaySession(
                id=session_id,
                anonymous_session_id=anonymous_id,
                case_id=content.case_id,
                state_json={},
                created_at=T0,
                updated_at=T0,
                completed_at=None,
                content_version=content.content_version,
                content_fingerprint=content.content_fingerprint,
            )
        )
    return session_id


def event_writer(play_session_id: str, client_event_id: str | None = None):
    async def write(db) -> None:
        db.add(
            InteractionEvent(
                id=str(uuid4()),
                play_session_id=play_session_id,
                client_event_id=client_event_id or str(uuid4()),
                client_timestamp=None,
                interaction_type="npc_turn",
                target_id=None,
                payload_json={},
                result_type="replied",
                response_json={"reply_source": "approved_line"},
                created_at=T0,
            )
        )

    return write


async def count(sessions, model, **where) -> int:
    async with sessions() as db:
        statement = select(func.count()).select_from(model)
        for column, value in where.items():
            statement = statement.where(getattr(model, column) == value)
        return (await db.execute(statement)).scalar_one()


async def request_row(sessions, key) -> NpcTurnRequest:
    async with sessions() as db:
        return await db.get(NpcTurnRequest, (key.play_session_id, key.turn_request_id))


def make_store(sessions, clock, **kwargs) -> NpcTurnIdempotencyStore:
    kwargs.setdefault("publication_guard", publication_guard)
    kwargs.setdefault("hash_keys", KEYS)
    return NpcTurnIdempotencyStore(sessions, clock=clock, **kwargs)


# --- 테스트용 가상 게시 상태(운영 게시 상태 시스템이 아니다) ---
# 작업 D의 게시 상태 저장소가 지켜야 할 잠금 계약만 재현한다:
# guard는 게시 상태 행을 공유 잠금으로 읽고, 긴급 차단은 같은 행을 배타 잠금으로 바꾼 트랜잭션에서
# 요청 행을 철회한다.

PUBLICATION_DDL = (
    "CREATE TABLE test_publication_states ("
    " case_id VARCHAR(64) NOT NULL, content_version INT NOT NULL,"
    " status VARCHAR(16) NOT NULL, PRIMARY KEY (case_id, content_version)"
    ") ENGINE=InnoDB"
)


async def publication_guard(db, content: TurnContentRef) -> None:
    status = (
        await db.execute(
            text(
                "SELECT status FROM test_publication_states "
                "WHERE case_id = :c AND content_version = :v FOR SHARE"
            ),
            {"c": content.case_id, "v": content.content_version},
        )
    ).scalar_one_or_none()
    if status is None:
        raise LookupError("publication state missing")
    if status == "blocked":
        raise ContentPublicationBlockedError()


async def set_publication_status(sessions, content: TurnContentRef, status: str):
    async with sessions() as db, db.begin():
        await db.execute(
            text(
                "UPDATE test_publication_states SET status = :s "
                "WHERE case_id = :c AND content_version = :v"
            ),
            {"s": status, "c": content.case_id, "v": content.content_version},
        )


async def emergency_block(sessions, content: TurnContentRef, *, hold=None):
    """게시 상태 행을 배타 잠금 → blocked → 같은 트랜잭션에서 저장 응답 철회."""

    async with sessions() as db, db.begin():
        await db.execute(
            text(
                "SELECT status FROM test_publication_states "
                "WHERE case_id = :c AND content_version = :v FOR UPDATE"
            ),
            {"c": content.case_id, "v": content.content_version},
        )
        await db.execute(
            text(
                "UPDATE test_publication_states SET status = 'blocked' "
                "WHERE case_id = :c AND content_version = :v"
            ),
            {"c": content.case_id, "v": content.content_version},
        )
        counts = await NpcTurnIdempotencyRepository(db).withdraw_content_version(
            content.case_id, content.content_version, now=T0
        )
        if hold is not None:
            await hold()
    return counts


# --- 최초 처리 · 재현 ---


def test_mysql_first_turn_is_committed_with_event_and_replayed_exactly():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock)
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))

        claim = await store.claim(key, V1, REQUEST)
        assert isinstance(claim, TurnClaim) and not claim.reclaimed
        first = await store.complete(
            claim, response(), write_event=event_writer(session_id)
        )
        row = await request_row(sessions, key)
        assert (row.status, row.issued_at, row.expires_at) == (
            "READY",
            T0,
            T0 + timedelta(hours=24),
        )
        assert (row.case_id, row.content_version, row.content_fingerprint) == (
            V1.case_id,
            V1.content_version,
            V1.content_fingerprint,
        )

        clock.advance(hours=23, minutes=59)
        again = await store.claim(key, V1, dict(reversed(REQUEST.items())))
        assert isinstance(again, TurnReplay)
        assert again.response.model_dump() == first.model_dump()
        # 재전송은 이벤트를 더 쓰지 않고 기한도 늘리지 않는다.
        assert await count(sessions, InteractionEvent) == 1
        assert (await request_row(sessions, key)).expires_at == T0 + timedelta(hours=24)

    mysql_run(scenario)


def test_mysql_same_turn_request_id_in_other_session_is_independent():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        shared = str(uuid4())
        a = turn_key(await new_play_session(sessions), shared)
        b = turn_key(await new_play_session(sessions), shared)

        claim_a = await store.claim(a, V1, REQUEST)
        await store.complete(claim_a, response("(가상) A"))
        claim_b = await store.claim(b, V1, {**REQUEST, "message": "다른 세션"})

        assert isinstance(claim_b, TurnClaim)
        await store.complete(claim_b, response("(가상) B"))
        replay_a = await store.claim(a, V1, REQUEST)
        assert replay_a.response.reply.text == "(가상) A"

    mysql_run(scenario)


# --- 변경 요청 422 · 만료 410 · tombstone ---


def test_mysql_changed_request_is_422_in_every_state():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock)
        session_id = await new_play_session(sessions)
        changed = {**REQUEST, "message": "가상원문-바뀜"}
        keys = [turn_key(session_id, str(uuid4())) for _ in range(4)]

        processing = keys[0]
        await store.claim(processing, V1, REQUEST)
        for ready in keys[1:]:
            await store.complete(await store.claim(ready, V1, REQUEST), response())
        clock.advance(hours=25)
        await store.purge_expired()  # keys[1..3] → EXPIRED tombstone
        for key in keys:
            with pytest.raises(IdempotencyMismatchError):
                await store.claim(key, V1, changed)

    mysql_run(scenario)


def test_mysql_expiry_boundary_purge_and_tombstone():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock)
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        await store.complete(await store.claim(key, V1, REQUEST), response())
        deadline = T0 + timedelta(hours=24)

        clock.now = deadline - timedelta(microseconds=1)
        assert isinstance(await store.claim(key, V1, REQUEST), TurnReplay)
        assert await store.purge_expired() == 0
        clock.now = deadline
        # 정리 작업 전이라도 기한이 지나면 410이고 본문을 돌려주지 않는다.
        with pytest.raises(TurnExpiredError):
            await store.claim(key, V1, REQUEST)
        assert await store.purge_expired() == 1
        assert await count(sessions, NpcTurnResponseBody) == 0
        row = await request_row(sessions, key)
        assert (row.status, row.purged_at) == ("EXPIRED", deadline)
        with pytest.raises(TurnExpiredError):
            await store.claim(key, V1, REQUEST)

    mysql_run(scenario)


def test_mysql_session_end_shortens_but_never_extends_deadline():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock)
        session_id = await new_play_session(sessions)
        ended = T0 - timedelta(hours=1)
        first = turn_key(session_id, str(uuid4()))
        await store.complete(
            await store.claim(first, V1, REQUEST), response(), session_ended_at=ended
        )
        assert (await request_row(sessions, first)).expires_at == ended + timedelta(
            hours=24
        )

        second = turn_key(session_id, str(uuid4()))
        await store.complete(await store.claim(second, V1, REQUEST), response())
        # 더 늦은 종료 시각은 기한을 늘리지 않는다.
        assert (
            await store.shorten_for_session_end(session_id, T0 + timedelta(hours=5))
            == 0
        )
        assert (await request_row(sessions, second)).expires_at == T0 + timedelta(
            hours=24
        )
        # 같은 기한은 바꾸지 않는다(경계).
        assert await store.shorten_for_session_end(session_id, T0) == 0
        assert (await request_row(sessions, second)).expires_at == T0 + timedelta(
            hours=24
        )
        assert await store.shorten_for_session_end(session_id, ended) == 1
        assert (await request_row(sessions, second)).expires_at == ended + timedelta(
            hours=24
        )

    mysql_run(scenario)


def test_mysql_tombstones_are_kept_until_24h_after_session_end_or_session_removal():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock)
        ended_session = await new_play_session(sessions)
        other_session = await new_play_session(sessions)
        for session_id in (ended_session, other_session):
            key = turn_key(session_id, str(uuid4()))
            await store.complete(await store.claim(key, V1, REQUEST), response())

        ended = T0
        clock.now = ended + timedelta(hours=24) - timedelta(microseconds=1)
        assert await store.delete_ended_session_records(ended_session, ended) == 0
        clock.now = ended + timedelta(hours=24)
        assert await store.delete_ended_session_records(ended_session, ended) == 1
        assert await count(sessions, NpcTurnRequest, play_session_id=ended_session) == 0
        assert await count(sessions, NpcTurnRequest, play_session_id=other_session) == 1

        # 게스트 기록 정리로 세션이 지워지면 tombstone · 본문도 함께 지워진다(FK cascade).
        async with sessions() as db, db.begin():
            await db.execute(delete(PlaySession).where(PlaySession.id == other_session))
        assert await count(sessions, NpcTurnRequest) == 0
        assert await count(sessions, NpcTurnResponseBody) == 0

    mysql_run(scenario)


# --- 동시성 · lease ---


def test_mysql_concurrent_duplicates_confirm_a_single_final_response():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))

        async def attempt():
            try:
                return await store.claim(key, V1, REQUEST)
            except TurnInProgressError:
                return "in_progress"

        results = await asyncio.gather(*(attempt() for _ in range(10)))
        claims = [r for r in results if isinstance(r, TurnClaim)]
        assert len(claims) == 1 and results.count("in_progress") == 9

        async def finish(text):
            try:
                return await store.complete(
                    claims[0], response(text), write_event=event_writer(session_id)
                )
            except TurnLeaseLostError:
                return "lost"

        done = await asyncio.gather(finish("(가상) 1"), finish("(가상) 2"))
        assert done.count("lost") == 1
        assert await count(sessions, NpcTurnResponseBody) == 1
        assert await count(sessions, InteractionEvent) == 1

    mysql_run(scenario)


def test_mysql_expired_lease_is_reclaimed_and_old_owner_cannot_store():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock, lease=timedelta(seconds=30))
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        old = await store.claim(key, V1, REQUEST)

        clock.advance(seconds=29)
        with pytest.raises(TurnInProgressError):
            await store.claim(key, V1, REQUEST)
        clock.advance(seconds=1)
        new = await store.claim(key, V1, REQUEST)
        assert isinstance(new, TurnClaim) and new.reclaimed
        with pytest.raises(TurnLeaseLostError):
            await store.complete(old, response("(가상) 늦은 저장"))
        await store.complete(new, response("(가상) 새 작업자"))
        with pytest.raises(TurnLeaseLostError):
            await store.complete(old, response("(가상) 늦은 저장"))
        assert (
            await store.claim(key, V1, REQUEST)
        ).response.reply.text == "(가상) 새 작업자"

    mysql_run(scenario)


def test_mysql_release_lets_same_request_retry_immediately():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        first = await store.claim(key, V1, REQUEST)

        await store.release(first)
        retry = await store.claim(key, V1, REQUEST)
        assert isinstance(retry, TurnClaim) and retry.reclaimed
        with pytest.raises(TurnLeaseLostError):
            await store.complete(first, response())
        with pytest.raises(IdempotencyMismatchError):
            await store.claim(key, V1, {**REQUEST, "message": "다른 문장"})

    mysql_run(scenario)


# --- 원자적 저장 경계 · rollback ---


def test_mysql_failed_event_write_stores_nothing_and_keeps_ownership():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)

        async def broken(db):
            await event_writer(session_id)(db)
            raise RuntimeError("이벤트 기록 실패")

        with pytest.raises(RuntimeError):
            await store.complete(claim, response(), write_event=broken)
        duplicate = str(uuid4())
        await store.complete(
            await store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST),
            response(),
            write_event=event_writer(session_id, duplicate),
        )
        # 이벤트 제약 위반(같은 client_event_id)도 본문을 남기지 않는다.
        with pytest.raises(IntegrityError):
            await store.complete(
                claim, response(), write_event=event_writer(session_id, duplicate)
            )

        async def cancelled(db):
            raise asyncio.CancelledError()

        with pytest.raises(asyncio.CancelledError):
            await store.complete(claim, response(), write_event=cancelled)
        row = await request_row(sessions, key)
        assert (row.status, row.owner_token) == ("PROCESSING", claim.owner_token)
        assert (
            await count(
                sessions, NpcTurnResponseBody, turn_request_id=key.turn_request_id
            )
            == 0
        )
        assert await count(sessions, InteractionEvent) == 1
        # 같은 작업자는 lease 안에서 다시 확정할 수 있다.
        await store.complete(claim, response(), write_event=event_writer(session_id))
        assert await count(sessions, InteractionEvent) == 2

    mysql_run(scenario)


def test_mysql_unknown_play_session_is_rejected_by_foreign_key():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        with pytest.raises(IntegrityError):
            await store.claim(turn_key(str(uuid4()), str(uuid4())), V1, REQUEST)
        assert await count(sessions, NpcTurnRequest) == 0

    mysql_run(scenario)


# --- 콘텐츠 버전 식별 · 긴급 차단용 본문 삭제 경계 ---


def test_mysql_withdrawal_deletes_only_that_version_and_keeps_tombstones():
    async def scenario(sessions):
        clock = Clock()
        store = make_store(sessions, clock)
        v1_session = await new_play_session(sessions, V1)
        v2_session = await new_play_session(sessions, V2)
        v1_ready = turn_key(v1_session, str(uuid4()))
        v1_processing = turn_key(v1_session, str(uuid4()))
        v2_ready = turn_key(v2_session, str(uuid4()))
        await store.complete(await store.claim(v1_ready, V1, REQUEST), response())
        in_flight = await store.claim(v1_processing, V1, REQUEST)
        await store.complete(await store.claim(v2_ready, V2, REQUEST), response())

        counts = await store.withdraw_content_version("case_test", 1)
        assert (counts.bodies_deleted, counts.processing_fenced) == (1, 1)
        assert await count(sessions, NpcTurnResponseBody) == 1  # v2만 남음
        assert await count(sessions, NpcTurnRequest) == 3  # tombstone 유지

        withdrawn = await store.claim(v1_ready, V1, REQUEST)
        assert isinstance(withdrawn, TurnWithdrawn) and withdrawn.content == V1
        with pytest.raises(IdempotencyMismatchError):
            await store.claim(v1_ready, V1, {**REQUEST, "message": "다른 문장"})
        # 처리 중이던 요청은 차단 뒤 확정하지 않는다.
        with pytest.raises(TurnWithdrawnError):
            await store.complete(in_flight, response())
        assert isinstance(await store.claim(v1_processing, V1, REQUEST), TurnWithdrawn)
        assert isinstance(await store.claim(v2_ready, V2, REQUEST), TurnReplay)
        # 다시 차단해도 바뀌는 것이 없다.
        again = await store.withdraw_content_version("case_test", 1)
        assert (again.bodies_deleted, again.processing_fenced) == (0, 0)

        # 차단과 기한 만료가 겹치면 판정하지 않는다(PM 미정).
        clock.advance(hours=24)
        with pytest.raises(TurnStatusUndecidedError):
            await store.claim(v1_ready, V1, REQUEST)

    mysql_run(scenario)


def test_mysql_withdrawal_and_completion_are_serialized():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)
        entered, release = asyncio.Event(), asyncio.Event()

        async def slow_event(db):
            await event_writer(session_id)(db)
            entered.set()
            await release.wait()

        completing = asyncio.create_task(
            store.complete(claim, response(), write_event=slow_event)
        )
        await entered.wait()
        withdrawing = asyncio.create_task(
            store.withdraw_content_version("case_test", 1)
        )
        await asyncio.sleep(0.5)
        # 확정 트랜잭션이 요청 행을 잠그고 있어 차단이 기다린다.
        assert not withdrawing.done()
        release.set()
        await completing
        counts = await withdrawing
        # 확정이 먼저 commit되었으므로 차단이 그 본문을 지운다.
        assert counts.bodies_deleted == 1
        assert isinstance(await store.claim(key, V1, REQUEST), TurnWithdrawn)

    mysql_run(scenario)


# --- 저장 금지 데이터 ---


def test_mysql_no_player_text_or_model_context_is_stored():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        request = {**REQUEST, "model_context": {"blocked": "가상차단문-91c2"}}
        claim = await store.claim(key, V1, request)
        await store.complete(claim, response())

        async with sessions() as db:
            dumped = json.dumps(
                [
                    [
                        list(row)
                        for row in (await db.execute(text(f"SELECT * FROM {t}"))).all()
                    ]
                    for t in ("npc_turn_requests", "npc_turn_response_bodies")
                ],
                default=str,
                ensure_ascii=False,
            )
        for forbidden in (
            RAW_MESSAGE,
            "가상차단문-91c2",
            "model_context",
            "player_message",
        ):
            assert forbidden not in dumped
        body = (await store.claim(key, V1, request)).response.model_dump()
        assert set(body) == {"npc_event_id", "reply", "suggest_hint"}

    mysql_run(scenario)


# --- 리뷰 보완: READY 422 · 게시 상태 guard (F1) · 키 사용량 (F2) ---


def test_mysql_ready_changed_request_is_422_directly():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        key = turn_key(await new_play_session(sessions), str(uuid4()))
        await store.complete(await store.claim(key, V1, REQUEST), response())

        with pytest.raises(IdempotencyMismatchError):
            await store.claim(key, V1, {**REQUEST, "message": "가상원문-바뀜"})
        assert isinstance(await store.claim(key, V1, REQUEST), TurnReplay)

    mysql_run(scenario)


def test_mysql_new_claim_after_emergency_block_cannot_store_case_lines():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        before = turn_key(session_id, str(uuid4()))
        await store.complete(await store.claim(before, V1, REQUEST), response())

        counts = await emergency_block(sessions, V1)
        assert counts.bodies_deleted == 1

        # 차단 직후 새 요청: claim → 계산 → 확정해도 원래 대사 · 이벤트가 저장되지 않는다.
        after = turn_key(session_id, str(uuid4()))
        claim = await store.claim(after, V1, REQUEST)
        assert isinstance(claim, TurnClaim)
        with pytest.raises(TurnWithdrawnError):
            await store.complete(
                claim,
                response("(가상) 차단된 원래 대사"),
                write_event=event_writer(session_id),
            )
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == 0
        assert (await request_row(sessions, after)).withdrawn_at is not None
        assert isinstance(await store.claim(after, V1, REQUEST), TurnWithdrawn)
        assert isinstance(await store.claim(before, V1, REQUEST), TurnWithdrawn)

        # 승인된 일반 팩 대사로만 만든 generic 응답은 저장 · 재현할 수 있다.
        # (작업 D1: 케이스 대사를 generic으로 표시하면 거부한다 — test_npc_publication_mysql)
        generic_store = make_store(
            sessions, Clock(), generic_lines={"GENERIC_01": "(가상) generic"}.get
        )
        generic = turn_key(session_id, str(uuid4()))
        stored = await generic_store.complete(
            await generic_store.claim(generic, V1, REQUEST),
            NpcTurnResponse(
                npc_event_id=uuid4(),
                reply=NpcReplyOut(
                    source="approved_line", text="(가상) generic", line_id="GENERIC_01"
                ),
                suggest_hint=None,
            ),
            content_mode="generic",
        )
        replay = await generic_store.claim(generic, V1, REQUEST)
        assert replay.response.model_dump() == stored.model_dump()

    mysql_run(scenario)


def test_mysql_block_waits_for_in_flight_completion_then_withdraws_it():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)
        entered, release = asyncio.Event(), asyncio.Event()

        async def slow_event(db):
            await event_writer(session_id)(db)
            entered.set()
            await release.wait()

        completing = asyncio.create_task(
            store.complete(claim, response(), write_event=slow_event)
        )
        await entered.wait()
        blocking = asyncio.create_task(emergency_block(sessions, V1))
        await asyncio.sleep(0.5)
        # 확정이 게시 상태 행 공유 잠금을 잡고 있어 차단이 기다린다.
        assert not blocking.done()
        release.set()
        await completing
        counts = await blocking
        # 확정이 먼저 commit되었고, 차단이 같은 트랜잭션에서 그 본문을 지운다.
        assert counts.bodies_deleted == 1
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert isinstance(await store.claim(key, V1, REQUEST), TurnWithdrawn)

    mysql_run(scenario)


def test_mysql_completion_waits_for_in_flight_block_then_refuses():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)
        holding, release = asyncio.Event(), asyncio.Event()

        async def hold():
            holding.set()
            await release.wait()

        blocking = asyncio.create_task(emergency_block(sessions, V1, hold=hold))
        await holding.wait()
        completing = asyncio.create_task(
            store.complete(claim, response(), write_event=event_writer(session_id))
        )
        await asyncio.sleep(0.5)
        # 차단 트랜잭션이 게시 상태 행 배타 잠금을 잡고 있어 확정이 guard에서 기다린다.
        assert not completing.done()
        release.set()
        await blocking
        with pytest.raises(TurnWithdrawnError):
            await completing
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == 0
        assert isinstance(await store.claim(key, V1, REQUEST), TurnWithdrawn)

    mysql_run(scenario)


def test_mysql_concurrent_completions_and_block_never_leave_case_lines():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        session_id = await new_play_session(sessions)
        claims = [
            await store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)
            for _ in range(6)
        ]

        async def finish(claim, delay):
            async def write(db):
                await event_writer(session_id)(db)
                await asyncio.sleep(delay)

            try:
                await store.complete(claim, response(), write_event=write)
                return "stored"
            except TurnWithdrawnError:
                return "withdrawn"

        results = await asyncio.gather(
            *(finish(c, 0.05 * i) for i, c in enumerate(claims)),
            emergency_block(sessions, V1),
        )
        outcomes = results[:-1]
        counts = results[-1]
        # 교착 없이 끝나고, 차단 전에 확정된 것만 차단이 지운다. 차단 뒤 확정은 없다.
        assert set(outcomes) <= {"stored", "withdrawn"}
        assert counts.bodies_deleted == outcomes.count("stored")
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == outcomes.count("stored")
        for claim in claims:
            assert isinstance(await store.claim(claim.key, V1, REQUEST), TurnWithdrawn)

    mysql_run(scenario)


def test_mysql_suspended_publication_keeps_in_flight_sessions():
    async def scenario(sessions):
        store = make_store(sessions, Clock())
        key = turn_key(await new_play_session(sessions), str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)
        # 일반 중단은 신규 세션만 막는다(세션 생성 쪽 책임). 진행 중 세션의 확정은 계속된다.
        await set_publication_status(sessions, V1, "suspended")

        await store.complete(claim, response())
        assert isinstance(await store.claim(key, V1, REQUEST), TurnReplay)

    mysql_run(scenario)


def test_mysql_missing_or_failing_guard_never_confirms_case_lines():
    async def scenario(sessions):
        session_id = await new_play_session(sessions)
        unknown = TurnContentRef("case_test", 3, "sha256:" + "3" * 64)
        store = make_store(sessions, Clock())
        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, unknown, REQUEST)
        with pytest.raises(LookupError):  # 게시 상태 행 없음 → guard 오류
            await store.complete(
                claim, response(), write_event=event_writer(session_id)
            )

        closed = make_store(
            sessions, Clock(), publication_guard=fail_closed_publication_guard
        )
        other = await closed.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)
        with pytest.raises(PublicationStateUnavailableError):
            await closed.complete(
                other, response(), write_event=event_writer(session_id)
            )

        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == 0
        for pending in (key, other.key):
            row = await request_row(sessions, pending)
            assert (row.status, row.withdrawn_at) == ("PROCESSING", None)

    mysql_run(scenario)


def test_mysql_hash_key_usage_counts_tombstones_before_key_retirement():
    async def scenario(sessions):
        clock = Clock()
        old_store = make_store(sessions, clock)
        session_id = await new_play_session(sessions)
        old_key = turn_key(session_id, str(uuid4()))
        await old_store.complete(
            await old_store.claim(old_key, V1, REQUEST), response()
        )
        clock.advance(hours=25)
        await old_store.purge_expired()  # 본문은 지워지고 tombstone만 남는다

        rotated = RequestHashKeys(
            "k2", {"k1": KEYS.keys["k1"], "k2": b"k2-test-only-" + b"b" * 32}
        )
        new_store = make_store(sessions, clock, hash_keys=rotated)
        await new_store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)

        assert await new_store.hash_key_usage("k1") == 1
        assert await new_store.hash_key_usage("k2") == 1
        # 이전 키를 보관하는 동안은 오래된 tombstone도 410 · 422로 정상 판정된다.
        with pytest.raises(TurnExpiredError):
            await new_store.claim(old_key, V1, REQUEST)
        with pytest.raises(IdempotencyMismatchError):
            await new_store.claim(old_key, V1, {**REQUEST, "message": "다름"})

    mysql_run(scenario)
