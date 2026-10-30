"""격리 MySQL에서 게시 상태 조회 · 전이 · 재시작 복원 · 긴급 차단 · 멱등 확정 guard를 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
"""

import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.interaction_event import InteractionEvent
from app.models.npc_publication import NpcPublicationEvent
from app.models.npc_turn_idempotency import NpcTurnResponseBody
from app.repositories.npc_publication import ContentFingerprintConflictError
from app.repositories.npc_turn_idempotency import (
    NpcTurnIdempotencyRepository,
    TurnContentRef,
)
from app.schemas.npc_turn import NpcReplyOut, NpcTurnResponse, SuggestHintOut
from app.services.npc_publication import (
    NpcPublicationService,
    PublicationStateConflictError,
    PublicationStateNotFoundError,
    PublicationTransitionError,
    build_npc_turn_idempotency_store,
)
from app.services.npc_turn_idempotency import (
    GenericResponseRejectedError,
    PublicationStateUnavailableError,
    TurnClaim,
    TurnReplay,
    TurnWithdrawn,
    TurnWithdrawnError,
    turn_key,
)
from app.services.publication_gate import PublicationResult
from tests.test_npc_turn_idempotency_mysql import (
    KEYS,
    REQUEST,
    V1,
    V2,
    Clock,
    count,
    event_writer,
    mysql_run,
    new_play_session,
    request_row,
    response,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

# 가상 테스트 데이터. 실제 승인 결과 · 운영자가 아니다.
ACTOR = "test-operator"
GENERIC = {"GENERIC_01": "(가상) 일반 대사"}.get


def approved_gate(content: TurnContentRef) -> PublicationResult:
    return PublicationResult(
        approved=True,
        registered=False,
        case_id=content.case_id,
        content_version=content.content_version,
    )


async def publish(service: NpcPublicationService, content: TurnContentRef = V1):
    return await service.publish(
        content.case_id,
        content.content_version,
        content.content_fingerprint,
        gate=approved_gate(content),
        reason="최초 게시",
        actor=ACTOR,
    )


async def block(service: NpcPublicationService, content: TurnContentRef = V1, **kw):
    return await service.block(
        content.case_id,
        content.content_version,
        reason="긴급 차단",
        actor=ACTOR,
        **kw,
    )


def stores(sessions, clock=None, **kw):
    clock = clock or Clock()
    return (
        NpcPublicationService(sessions, clock=clock),
        build_npc_turn_idempotency_store(
            sessions, hash_keys=KEYS, clock=clock, generic_lines=GENERIC, **kw
        ),
    )


def isolated_engine(**connect_args):
    return create_async_engine(
        make_url(os.environ["NPC_IDEMPOTENCY_MYSQL_URL"]),
        hide_parameters=True,
        connect_args=connect_args,
    )


# --- 상태 전이 · 이력 · 재시작 복원 ---


def test_mysql_transitions_record_events_and_survive_restart():
    async def scenario(sessions):
        service, _ = stores(sessions)

        assert (await publish(service)).status == "published"
        assert (
            await service.suspend("case_test", 1, reason="일반 중단", actor=ACTOR)
        ).status == "suspended"
        assert (await publish(service)).status == "published"  # 재개
        result = await block(service)
        assert (result.snapshot.status, result.snapshot.revision, result.changed) == (
            "blocked",
            4,
            True,
        )

        # 서버 재시작: 새 엔진 · 새 연결에서 마지막 commit 상태가 그대로 복원된다.
        engine = isolated_engine()
        try:
            restarted = NpcPublicationService(
                async_sessionmaker(engine, expire_on_commit=False)
            )
            current = await restarted.current("case_test", 1)
            assert (current.status, current.revision, current.content_fingerprint) == (
                "blocked",
                4,
                V1.content_fingerprint,
            )
            restorable = await restarted.restorable_versions()
            assert [(s.case_id, s.content_version, s.status) for s in restorable] == [
                ("case_test", 1, "blocked")
            ]
            events = await restarted.events("case_test", 1)
        finally:
            await engine.dispose()
        assert [(e.from_status, e.to_status, e.state_revision) for e in events] == [
            (None, "published", 1),
            ("published", "suspended", 2),
            ("suspended", "published", 3),
            ("published", "blocked", 4),
        ]
        assert {e.actor for e in events} == {ACTOR}
        assert [e.reason for e in events] == [
            "최초 게시",
            "일반 중단",
            "최초 게시",
            "긴급 차단",
        ]

    mysql_run(scenario)


def test_mysql_invalid_transitions_and_immutable_versions():
    async def scenario(sessions):
        service, _ = stores(sessions)
        await publish(service)

        with pytest.raises(PublicationTransitionError):
            await publish(service)  # published → published
        await block(service)
        for attempt in (
            publish(service),
            service.suspend("case_test", 1, reason="중단", actor=ACTOR),
        ):
            with pytest.raises(PublicationTransitionError):
                await attempt  # blocked에서 벗어나는 전이는 PM 미정
        with pytest.raises(PublicationStateNotFoundError):
            await service.suspend("case_test", 9, reason="중단", actor=ACTOR)
        # 같은 버전을 다른 fingerprint로 다시 등록할 수 없다.
        with pytest.raises(ContentFingerprintConflictError):
            await service.publish(
                "case_test",
                1,
                "sha256:" + "f" * 64,
                gate=approved_gate(V1),
                reason="다른 콘텐츠",
                actor=ACTOR,
            )
        # 이미 blocked면 상태 · 이력은 그대로, 철회만 다시 한다.
        again = await block(service)
        assert (again.changed, again.snapshot.revision) == (False, 2)
        assert len(await service.events("case_test", 1)) == 2

        async with sessions() as db:
            row = (await db.execute(select(NpcPublicationEvent))).scalars().first()
            row.reason = "고침"
            with pytest.raises(ValueError, match="append-only"):
                await db.flush()
            await db.rollback()

    mysql_run(scenario)


def test_mysql_concurrent_state_changes_are_serialized():
    async def scenario(sessions):
        service, _ = stores(sessions)

        async def attempt(operation):
            try:
                return (await operation).status
            except (PublicationTransitionError, PublicationStateConflictError) as error:
                return type(error).__name__

        # 새 버전 동시 최초 게시: 하나만 published, 나머지는 전이 오류(이력 1건)
        first = await asyncio.gather(*(attempt(publish(service)) for _ in range(4)))
        assert first.count("published") == 1
        assert first.count("PublicationTransitionError") == 3

        # 같은 published에서 일반 중단 · 긴급 차단 동시 실행: 하나만 성공한다.
        async def blocked():
            return (await block(service, expected_status="published")).snapshot

        results = await asyncio.gather(
            attempt(service.suspend("case_test", 1, reason="중단", actor=ACTOR)),
            attempt(blocked()),
        )
        assert sorted(results) in (
            ["PublicationStateConflictError", "suspended"],
            ["PublicationTransitionError", "blocked"],
        )
        assert len(await service.events("case_test", 1)) == 2

    mysql_run(scenario)


def test_mysql_failed_block_rolls_back_state_events_and_bodies(monkeypatch):
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        key = turn_key(await new_play_session(sessions), str(uuid4()))
        await store.complete(await store.claim(key, V1, REQUEST), response())

        async def broken(self, *args, **kwargs):
            raise RuntimeError("철회 중 오류")

        monkeypatch.setattr(
            NpcTurnIdempotencyRepository, "withdraw_content_version", broken
        )
        with pytest.raises(RuntimeError):
            await block(service)
        monkeypatch.undo()

        current = await service.current("case_test", 1)
        assert (current.status, current.revision) == ("published", 1)
        assert len(await service.events("case_test", 1)) == 1
        assert await count(sessions, NpcTurnResponseBody) == 1

    mysql_run(scenario)


def test_mysql_state_reads_do_not_reuse_a_stale_snapshot():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        key = turn_key(await new_play_session(sessions), str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)

        async with sessions() as stale:
            plain = text(
                "SELECT status FROM npc_publication_states "
                "WHERE case_id = 'case_test' AND content_version = 1"
            )
            assert (await stale.execute(plain)).scalar_one() == "published"
            await block(service)
            # 같은 트랜잭션의 일반 조회는 오래된 snapshot을 본다(REPEATABLE READ).
            assert (await stale.execute(plain)).scalar_one() == "published"
            # 서비스 조회와 확정 guard는 새 트랜잭션의 잠금 읽기라 차단을 본다.
            assert (await service.current("case_test", 1)).status == "blocked"
            with pytest.raises(TurnWithdrawnError):
                await store.complete(claim, response())
            await stale.rollback()

    mysql_run(scenario)


# --- 멱등 저장소 guard 연결 ---


def test_mysql_new_request_after_block_cannot_store_case_lines():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        session_id = await new_play_session(sessions)
        await block(service)

        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)
        assert isinstance(claim, TurnClaim)
        with pytest.raises(TurnWithdrawnError):
            await store.complete(
                claim,
                response("(가상) 원래 대사"),
                write_event=event_writer(session_id),
            )
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == 0
        assert isinstance(await store.claim(key, V1, REQUEST), TurnWithdrawn)

    mysql_run(scenario)


def test_mysql_block_during_computation_stops_the_final_store():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        session_id = await new_play_session(sessions)
        key = turn_key(session_id, str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)  # 계산 시작

        result = await block(service)  # 계산 중 차단
        assert result.withdrawal.processing_fenced == 1
        with pytest.raises(TurnWithdrawnError):
            await store.complete(
                claim, response(), write_event=event_writer(session_id)
            )
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == 0

    mysql_run(scenario)


def test_mysql_block_after_completion_deletes_the_stored_body():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        key = turn_key(await new_play_session(sessions), str(uuid4()))
        await store.complete(await store.claim(key, V1, REQUEST), response())

        result = await block(service)
        assert result.withdrawal.bodies_deleted == 1
        assert await count(sessions, NpcTurnResponseBody) == 0
        withdrawn = await store.claim(key, V1, REQUEST)
        assert isinstance(withdrawn, TurnWithdrawn) and withdrawn.content == V1

    mysql_run(scenario)


def test_mysql_suspension_keeps_existing_session_npc_responses():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        session_id = await new_play_session(sessions)
        ready = turn_key(session_id, str(uuid4()))
        stored = await store.complete(await store.claim(ready, V1, REQUEST), response())
        in_flight = await store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)

        await service.suspend("case_test", 1, reason="일반 중단", actor=ACTOR)

        replay = await store.claim(ready, V1, REQUEST)
        assert replay.response.model_dump() == stored.model_dump()
        await store.complete(in_flight, response())
        later = turn_key(session_id, str(uuid4()))
        await store.complete(await store.claim(later, V1, REQUEST), response())
        assert await count(sessions, NpcTurnResponseBody) == 3

    mysql_run(scenario)


def test_mysql_concurrent_completions_and_block_leave_no_partial_state():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
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
            *(finish(c, 0.05 * i) for i, c in enumerate(claims)), block(service)
        )
        outcomes, blocked = results[:-1], results[-1]
        assert set(outcomes) <= {"stored", "withdrawn"}
        assert blocked.withdrawal.bodies_deleted == outcomes.count("stored")
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == outcomes.count("stored")
        assert (await service.current("case_test", 1)).status == "blocked"

    mysql_run(scenario)


def test_mysql_missing_state_mismatch_or_lock_failure_never_stores():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        session_id = await new_play_session(sessions)

        # V2는 게시 상태가 없다 → fail closed
        missing = await store.claim(turn_key(session_id, str(uuid4())), V2, REQUEST)
        with pytest.raises(PublicationStateUnavailableError):
            await store.complete(missing, response())
        # 등록된 fingerprint와 다른 콘텐츠 → fail closed
        forged = TurnContentRef("case_test", 1, "sha256:" + "9" * 64)
        mismatch = await store.claim(
            turn_key(session_id, str(uuid4())), forged, REQUEST
        )
        with pytest.raises(PublicationStateUnavailableError):
            await store.complete(mismatch, response())

        # 게시 상태 행 잠금 대기 초과 → DB 오류 그대로, 저장 없음
        engine = isolated_engine(
            init_command="SET SESSION innodb_lock_wait_timeout = 1"
        )
        try:
            fast_store = build_npc_turn_idempotency_store(
                async_sessionmaker(engine, expire_on_commit=False), hash_keys=KEYS
            )
            key = turn_key(session_id, str(uuid4()))
            claim = await fast_store.claim(key, V1, REQUEST)
            async with sessions() as holder, holder.begin():
                await holder.execute(
                    text(
                        "SELECT status FROM npc_publication_states "
                        "WHERE case_id = 'case_test' AND content_version = 1 FOR UPDATE"
                    )
                )
                with pytest.raises(OperationalError) as timeout:
                    await fast_store.complete(
                        claim, response(), write_event=event_writer(session_id)
                    )
                assert timeout.value.orig.args[0] == 1205
        finally:
            await engine.dispose()
        assert await count(sessions, NpcTurnResponseBody) == 0
        assert await count(sessions, InteractionEvent) == 0
        assert (await request_row(sessions, key)).status == "PROCESSING"

    mysql_run(scenario)


def test_mysql_blocked_case_content_cannot_pass_as_generic():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service)
        session_id = await new_play_session(sessions)
        await block(service)

        disguised = [
            response("(가상) 차단된 케이스 대사"),  # line_id LINE_01(케이스 대사)
            NpcTurnResponse(
                npc_event_id=uuid4(),
                reply=None,
                suggest_hint=SuggestHintOut(puzzle_id="PZ_A"),
            ),
        ]
        for fake in disguised:
            claim = await store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)
            with pytest.raises(GenericResponseRejectedError):
                await store.complete(claim, fake, content_mode="generic")
        assert await count(sessions, NpcTurnResponseBody) == 0

        # 승인 일반 팩 대사 · 일반 팩 없음(reply null)은 generic으로 저장 · 재현된다.
        for real in (
            NpcTurnResponse(
                npc_event_id=uuid4(),
                reply=NpcReplyOut(
                    source="approved_line",
                    text="(가상) 일반 대사",
                    line_id="GENERIC_01",
                ),
                suggest_hint=None,
            ),
            NpcTurnResponse(npc_event_id=uuid4(), reply=None, suggest_hint=None),
        ):
            key = turn_key(session_id, str(uuid4()))
            await store.complete(
                await store.claim(key, V1, REQUEST), real, content_mode="generic"
            )
            assert isinstance(await store.claim(key, V1, REQUEST), TurnReplay)

    mysql_run(scenario)
