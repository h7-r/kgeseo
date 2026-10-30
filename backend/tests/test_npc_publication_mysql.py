"""격리 MySQL에서 게시 상태 조회 · 전이 · 재시작 복원 · 긴급 차단 · 멱등 확정 guard를 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
"""

import asyncio
import os
from datetime import datetime, timedelta
from types import MappingProxyType
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.interaction_event import InteractionEvent
from app.models.npc_publication import NpcPublicationEvent
from app.models.npc_turn_idempotency import NpcTurnResponseBody
from app.repositories.approval_history import ApprovalHistoryRepository
from app.repositories.npc_turn_idempotency import (
    NpcTurnIdempotencyRepository,
    TurnContentRef,
)
from app.schemas.gate_review import ApprovalTarget
from app.schemas.npc_turn import NpcReplyOut, NpcTurnResponse, SuggestHintOut
from app.services.approval_history import GATES, ReviewRecord
from app.services.npc_publication import (
    BlockedReapprovalRequiredError,
    ContentFingerprintMismatchError,
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
from app.services.published_content_loader import BundleSnapshot
from tests.test_npc_turn_idempotency_mysql import (
    KEYS,
    REQUEST,
    T0,
    Clock,
    count,
    event_writer,
    mysql_run,
    new_play_session,
    request_row,
    response,
)
from tests.test_publication_gate import (
    CASE_ID,
    LOCAL_IDS,
    base_documents,
    hint_source,
    no_idmap_files,
    seal,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

# 가상 테스트 데이터. 실제 승인 결과 · 운영자가 아니다.
ACTOR = "test-operator"
GENERIC = {"GENERIC_01": "(가상) 일반 대사"}.get


# 서버가 읽은 것으로 보는 가상 게시 파일 묶음(실제 게시 디렉터리가 아니다).
CASE = CASE_ID
FILES, FP = no_idmap_files()
BUNDLE = BundleSnapshot(CASE, 1, MappingProxyType(dict(FILES)))
V1 = TurnContentRef(CASE, 1, FP)
V2 = TurnContentRef(CASE, 2, "sha256:" + "2" * 64)  # 게시 상태 없음
TARGET = ApprovalTarget(target_type="case_content", target_id=CASE, content_version=1)
GATE_INPUTS = {
    "hint_source": hint_source,
    "ng_checker": lambda text: False,
    "local_ids": LOCAL_IDS,
}


def other_bundle() -> BundleSnapshot:
    """같은 case · version이지만 내용이 다른 묶음."""

    documents = base_documents(1)
    del documents["idmap"]
    documents["npc"]["general_nudges"][0]["text"] = "(가상) 다른 문장."
    files, _ = seal(documents)
    return BundleSnapshot(CASE, 1, MappingProxyType({**files, "idmap": None}))


def stamp(at: datetime) -> str:
    return at.isoformat(timespec="milliseconds") + "Z"


class Reviews:
    """관문별 직전 기록을 이어 붙여(supersedes) 서버 기록과 같은 형태의 승인 이력을 DB에 쓴다."""

    def __init__(self, sessions, fingerprint: str = FP) -> None:
        self.sessions = sessions
        self.fingerprint = fingerprint
        self.last: dict[str, ReviewRecord] = {}

    async def add(self, at: datetime, decision: str = "approved", gates=GATES):
        async with self.sessions() as db:
            repository = ApprovalHistoryRepository(db)
            for gate in gates:
                previous = self.last.get(gate)
                record = ReviewRecord(
                    review_id=str(uuid4()),
                    gate=gate,
                    target_hash=self.fingerprint,
                    decision=decision,
                    reviewer="test-reviewer",
                    reviewed_at=stamp(at),
                    reason=None
                    if decision == "approved" and previous is None
                    else "(가상) 사유",
                    supersedes=previous.review_id if previous else None,
                )
                await repository.append(TARGET, record)
                self.last[gate] = record
            await db.commit()


async def publish(service: NpcPublicationService, sessions, *, reviews=None):
    async with sessions() as db:
        if not await ApprovalHistoryRepository(db).records(TARGET):
            await (reviews or Reviews(sessions)).add(T0 - timedelta(hours=1))
    outcome = await service.publish_new(
        BUNDLE, reason="최초 게시", actor=ACTOR, **GATE_INPUTS
    )
    return outcome.snapshot


async def resume(service: NpcPublicationService, bundle: BundleSnapshot = BUNDLE):
    outcome = await service.resume(bundle, reason="재개", actor=ACTOR, **GATE_INPUTS)
    return outcome.snapshot


async def block(service: NpcPublicationService, content: TurnContentRef = None, **kw):
    content = content or V1
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

        assert (await publish(service, sessions)).status == "published"
        assert (
            await service.suspend(CASE, 1, reason="일반 중단", actor=ACTOR)
        ).status == "suspended"
        assert (await resume(service)).status == "published"  # 재개
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
            current = await restarted.current(CASE, 1)
            assert (current.status, current.revision, current.content_fingerprint) == (
                "blocked",
                4,
                V1.content_fingerprint,
            )
            restorable = await restarted.restorable_versions()
            assert [(s.case_id, s.content_version, s.status) for s in restorable] == [
                (CASE, 1, "blocked")
            ]
            events = await restarted.events(CASE, 1)
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
            "재개",
            "긴급 차단",
        ]

    mysql_run(scenario)


def test_mysql_invalid_transitions_and_immutable_versions():
    async def scenario(sessions):
        service, _ = stores(sessions)
        await publish(service, sessions)

        with pytest.raises(PublicationTransitionError):
            await publish(service, sessions)  # published → published
        await block(service)
        # blocked 재개: 차단 이후 재승인 없이는 거부(PM v0.4.6)
        with pytest.raises(BlockedReapprovalRequiredError):
            await resume(service)
        with pytest.raises(PublicationTransitionError):
            await service.suspend(CASE, 1, reason="중단", actor=ACTOR)
        with pytest.raises(PublicationStateNotFoundError):
            await service.suspend(CASE, 9, reason="중단", actor=ACTOR)
        # 같은 버전을 다른 내용(fingerprint)으로 재개할 수 없다(버전은 불변).
        with pytest.raises(ContentFingerprintMismatchError):
            await resume(service, other_bundle())
        # 이미 blocked면 상태 · 이력은 그대로, 철회만 다시 한다.
        again = await block(service)
        assert (again.changed, again.snapshot.revision) == (False, 2)
        assert len(await service.events(CASE, 1)) == 2

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
        await Reviews(sessions).add(T0 - timedelta(hours=1))
        first = await asyncio.gather(
            *(attempt(publish(service, sessions)) for _ in range(4))
        )
        assert first.count("published") == 1
        assert first.count("PublicationTransitionError") == 3

        # 같은 published에서 일반 중단 · 긴급 차단 동시 실행: 하나만 성공한다.
        async def blocked():
            return (await block(service, expected_status="published")).snapshot

        results = await asyncio.gather(
            attempt(service.suspend(CASE, 1, reason="중단", actor=ACTOR)),
            attempt(blocked()),
        )
        assert sorted(results) in (
            ["PublicationStateConflictError", "suspended"],
            ["PublicationTransitionError", "blocked"],
        )
        assert len(await service.events(CASE, 1)) == 2

    mysql_run(scenario)


def test_mysql_failed_block_rolls_back_state_events_and_bodies(monkeypatch):
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service, sessions)
        key = turn_key(await new_play_session(sessions, V1), str(uuid4()))
        await store.complete(await store.claim(key, V1, REQUEST), response())

        async def broken(self, *args, **kwargs):
            raise RuntimeError("철회 중 오류")

        monkeypatch.setattr(
            NpcTurnIdempotencyRepository, "withdraw_content_version", broken
        )
        with pytest.raises(RuntimeError):
            await block(service)
        monkeypatch.undo()

        current = await service.current(CASE, 1)
        assert (current.status, current.revision) == ("published", 1)
        assert len(await service.events(CASE, 1)) == 1
        assert await count(sessions, NpcTurnResponseBody) == 1

    mysql_run(scenario)


def test_mysql_state_reads_do_not_reuse_a_stale_snapshot():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service, sessions)
        key = turn_key(await new_play_session(sessions, V1), str(uuid4()))
        claim = await store.claim(key, V1, REQUEST)

        async with sessions() as stale:
            plain = text(
                "SELECT status FROM npc_publication_states "
                "WHERE case_id = 'case_gate_test' AND content_version = 1"
            )
            assert (await stale.execute(plain)).scalar_one() == "published"
            await block(service)
            # 같은 트랜잭션의 일반 조회는 오래된 snapshot을 본다(REPEATABLE READ).
            assert (await stale.execute(plain)).scalar_one() == "published"
            # 서비스 조회와 확정 guard는 새 트랜잭션의 잠금 읽기라 차단을 본다.
            assert (await service.current(CASE, 1)).status == "blocked"
            with pytest.raises(TurnWithdrawnError):
                await store.complete(claim, response())
            await stale.rollback()

    mysql_run(scenario)


# --- 멱등 저장소 guard 연결 ---


def test_mysql_new_request_after_block_cannot_store_case_lines():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service, sessions)
        session_id = await new_play_session(sessions, V1)
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
        await publish(service, sessions)
        session_id = await new_play_session(sessions, V1)
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
        await publish(service, sessions)
        key = turn_key(await new_play_session(sessions, V1), str(uuid4()))
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
        await publish(service, sessions)
        session_id = await new_play_session(sessions, V1)
        ready = turn_key(session_id, str(uuid4()))
        stored = await store.complete(await store.claim(ready, V1, REQUEST), response())
        in_flight = await store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)

        await service.suspend(CASE, 1, reason="일반 중단", actor=ACTOR)

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
        await publish(service, sessions)
        session_id = await new_play_session(sessions, V1)
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
        assert (await service.current(CASE, 1)).status == "blocked"

    mysql_run(scenario)


def test_mysql_missing_state_mismatch_or_lock_failure_never_stores():
    async def scenario(sessions):
        service, store = stores(sessions)
        await publish(service, sessions)
        session_id = await new_play_session(sessions, V1)

        # V2는 게시 상태가 없다 → fail closed
        missing = await store.claim(turn_key(session_id, str(uuid4())), V2, REQUEST)
        with pytest.raises(PublicationStateUnavailableError):
            await store.complete(missing, response())
        # 등록된 fingerprint와 다른 콘텐츠 → fail closed
        forged = TurnContentRef(CASE, 1, "sha256:" + "9" * 64)
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
                        "WHERE case_id = 'case_gate_test' AND content_version = 1 FOR UPDATE"
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
        await publish(service, sessions)
        session_id = await new_play_session(sessions, V1)
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
