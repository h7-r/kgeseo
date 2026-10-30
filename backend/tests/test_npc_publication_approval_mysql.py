"""격리 MySQL에서 PUB-GATE(DB 승인 이력) · 게시 확정 · 재개 · 철회 경쟁을 검증한다(작업 D2).

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).
"""

import asyncio
import os
from datetime import timedelta
from types import MappingProxyType
from uuid import uuid4

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.npc_approval_review import NpcApprovalReview
from app.models.npc_publication import (
    NpcContentVersion,
    NpcPublicationEvent,
    NpcPublicationState,
)
from app.models.npc_turn_idempotency import NpcTurnResponseBody
from app.repositories.approval_history import ApprovalHistoryRepository
from app.repositories.npc_publication import NpcPublicationRepository
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import ReviewRecord
from app.services.npc_publication import (
    BlockedReapprovalRequiredError,
    ContentFingerprintMismatchError,
    PublicationGateFailedError,
)
from app.services.npc_turn_idempotency import (
    TurnWithdrawn,
    TurnWithdrawnError,
    turn_key,
)
from app.services.published_content_loader import BundleSnapshot
from tests.test_npc_publication_mysql import (
    ACTOR,
    BUNDLE,
    CASE,
    FP,
    GATE_INPUTS,
    TARGET,
    V1,
    Reviews,
    block,
    isolated_engine,
    other_bundle,
    publish,
    resume,
    stores,
)
from tests.test_npc_turn_idempotency_mysql import (
    REQUEST,
    T0,
    count,
    event_writer,
    mysql_run,
    new_play_session,
    response,
)
from tests.test_publication_gate import base_documents, encode, seal

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

BEFORE = T0 - timedelta(hours=1)


async def publication_rows(sessions) -> tuple[int, int, int]:
    return (
        await count(sessions, NpcContentVersion),
        await count(sessions, NpcPublicationState),
        await count(sessions, NpcPublicationEvent),
    )


async def approval_rows(sessions) -> int:
    return await count(sessions, NpcApprovalReview)


def pause_method(monkeypatch, owner, name):
    """비동기 메서드를 판정 뒤 · 확정 전 지점에서 멈출 수 있게 감싼다."""

    entered, release = asyncio.Event(), asyncio.Event()
    original = getattr(owner, name)

    async def paused(self, *args, **kwargs):
        entered.set()
        await release.wait()
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(owner, name, paused)
    return entered, release


async def race_while_paused(entered, release, first, second):
    """첫 작업이 멈춘 동안 두 번째를 시작해, 그것이 기다리는지 본다. 실패해도 멈춤을 풀고 두 작업을 끝낸다."""

    first_task = asyncio.create_task(first)
    second_task = None
    try:
        await asyncio.wait_for(entered.wait(), timeout=10)
        second_task = asyncio.create_task(second())
        await asyncio.sleep(0.5)
        waited = not second_task.done()
    finally:
        release.set()
        tasks = [first_task] + ([second_task] if second_task else [])
        results = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True), timeout=30
        )
    for result in results:
        if isinstance(result, BaseException):
            raise result
    return waited, results[0]


# --- 신규 게시: DB 승인 이력 · fingerprint ---


def test_mysql_publish_uses_db_history_and_rejects_withdrawn_or_foreign_approvals():
    async def scenario(sessions):
        service, _ = stores(sessions)
        reviews = Reviews(sessions)
        await reviews.add(BEFORE)
        # 판정 전에 commit된 철회(hold)는 게시를 막는다.
        await reviews.add(BEFORE + timedelta(minutes=1), decision="hold", gates=("G3",))
        with pytest.raises(PublicationGateFailedError) as failed:
            await service.publish_new(BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS)
        assert failed.value.result.check("APPROVALS").reasons == ("G3:hold",)
        assert await publication_rows(sessions) == (0, 0, 0)

        # 같은 case · version이라도 다른 내용(fingerprint)에 대한 승인은 재사용할 수 없다.
        with pytest.raises(PublicationGateFailedError) as foreign:
            await service.publish_new(
                other_bundle(), reason="게시", actor=ACTOR, **GATE_INPUTS
            )
        assert foreign.value.result.check("APPROVALS").status == "FAIL"
        assert await publication_rows(sessions) == (0, 0, 0)

    mysql_run(scenario)


def test_mysql_other_version_approvals_and_json_claims_are_not_trusted():
    async def scenario(sessions):
        service, _ = stores(sessions)
        # v2 대상에 쌓인 같은 fingerprint의 승인은 v1 게시에 쓰이지 않는다.
        other_target = ApprovalTarget(
            target_type="case_content", target_id=CASE, content_version=2
        )
        async with sessions() as db:
            repository = ApprovalHistoryRepository(db)
            for gate in ("G1", "G2", "G3"):
                await repository.append(
                    other_target,
                    ReviewRecord(
                        review_id=str(uuid4()),
                        gate=gate,
                        target_hash=FP,
                        decision="approved",
                        reviewer="test-reviewer",
                        reviewed_at=(BEFORE).isoformat(timespec="milliseconds") + "Z",
                    ),
                )
            await db.commit()
        with pytest.raises(PublicationGateFailedError):
            await service.publish_new(BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS)

        # npc.json의 approvals[]로 승인을 주장해도 DB 이력이 없으면 게시되지 않는다.
        documents = base_documents(1)
        del documents["idmap"]
        files, fingerprint = seal(documents)
        documents["npc"]["approvals"] = [
            {
                "gate": g,
                "decision": "approved",
                "target_hash": fingerprint,
                "at": "2026-10-27T00:00:00Z",
            }
            for g in ("G1", "G2", "G3")
        ]
        claimed = BundleSnapshot(
            CASE, 1, MappingProxyType({**encode(documents), "idmap": None})
        )
        with pytest.raises(PublicationGateFailedError):
            await service.publish_new(
                claimed, reason="게시", actor=ACTOR, **GATE_INPUTS
            )
        assert await publication_rows(sessions) == (0, 0, 0)

    mysql_run(scenario)


def test_mysql_withdrawal_during_decision_waits_and_keeps_publication(monkeypatch):
    async def scenario(sessions):
        service, store = stores(sessions)
        reviews = Reviews(sessions)
        await reviews.add(BEFORE)
        entered, release = pause_method(
            monkeypatch, NpcPublicationRepository, "insert_state"
        )

        # 판정은 끝났고 상태 확정 직전에 멈춘 게시 도중 철회를 시도한다.
        waited, outcome = await race_while_paused(
            entered,
            release,
            service.publish_new(BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS),
            lambda: reviews.add(T0, decision="hold", gates=("G3",)),
        )
        monkeypatch.undo()
        # 철회는 같은 승인 대상 잠금을 기다린다(판정과 확정 사이에 끼어들지 못한다).
        assert waited

        assert outcome.snapshot.status == "published"
        assert (
            outcome.pinned is not None and outcome.pinned.pin.content_fingerprint == FP
        )
        # 게시 확정 뒤의 철회는 게시 상태를 바꾸지 않는다(PM).
        assert (await service.current(CASE, 1)).status == "published"
        assert await approval_rows(sessions) == 4
        key = turn_key(await new_play_session(sessions, V1), str(uuid4()))
        await store.complete(await store.claim(key, V1, REQUEST), response())

    mysql_run(scenario)


# --- 재개 ---


def test_mysql_resume_from_suspended_rejudges_with_current_history():
    async def scenario(sessions):
        service, _ = stores(sessions)
        reviews = Reviews(sessions)
        await publish(service, sessions, reviews=reviews)
        await service.suspend(CASE, 1, reason="일반 중단", actor=ACTOR)

        await reviews.add(T0, decision="hold", gates=("G2",))
        with pytest.raises(PublicationGateFailedError) as held:
            await resume(service)
        assert held.value.result.check("APPROVALS").reasons == ("G2:hold",)
        assert (await service.current(CASE, 1)).status == "suspended"

        await reviews.add(T0 + timedelta(minutes=1), gates=("G2",))
        before = await approval_rows(sessions)
        resumed = await resume(service)
        assert (resumed.status, resumed.content_version, resumed.revision) == (
            "published",
            1,
            3,
        )
        assert (
            await approval_rows(sessions) == before
        )  # 재개는 승인 기록을 바꾸지 않는다
        events = await service.events(CASE, 1)
        assert [(e.from_status, e.to_status) for e in events] == [
            (None, "published"),
            ("published", "suspended"),
            ("suspended", "published"),
        ]

    mysql_run(scenario)


def test_mysql_resume_from_blocked_requires_reapproval_after_the_block():
    async def scenario(sessions):
        service, store = stores(sessions)
        reviews = Reviews(sessions)
        await publish(service, sessions, reviews=reviews)
        session_id = await new_play_session(sessions, V1)
        old_turn = turn_key(session_id, str(uuid4()))
        await store.complete(await store.claim(old_turn, V1, REQUEST), response())
        await block(service)  # 차단 시각 = T0

        with pytest.raises(BlockedReapprovalRequiredError) as none:
            await resume(service)
        assert none.value.gate == "G1"
        await reviews.add(T0 + timedelta(minutes=1), gates=("G1", "G2"))
        with pytest.raises(BlockedReapprovalRequiredError) as partial:
            await resume(service)
        assert partial.value.gate == "G3"
        await reviews.add(T0 + timedelta(minutes=2), gates=("G3",))

        resumed = await resume(service)
        assert (resumed.status, resumed.content_version) == ("published", 1)
        events = await service.events(CASE, 1)
        assert [(e.from_status, e.to_status) for e in events] == [
            (None, "published"),
            ("published", "blocked"),
            ("blocked", "published"),
        ]
        assert await approval_rows(sessions) == 6  # 기존 3 + 재승인 3, 수정 · 삭제 없음
        # 차단 때 지운 저장 응답은 되살아나지 않는다. 새 턴은 다시 확정된다.
        assert isinstance(await store.claim(old_turn, V1, REQUEST), TurnWithdrawn)
        new_turn = turn_key(session_id, str(uuid4()))
        await store.complete(await store.claim(new_turn, V1, REQUEST), response())
        assert await count(sessions, NpcTurnResponseBody) == 1

    mysql_run(scenario)


def test_mysql_blocked_resume_and_new_withdrawal_are_serialized(monkeypatch):
    async def scenario(sessions):
        service, _ = stores(sessions)
        reviews = Reviews(sessions)
        await publish(service, sessions, reviews=reviews)
        await block(service)
        await reviews.add(T0 + timedelta(minutes=1))

        # (a) 재개 판정 뒤 · 확정 전에 들어온 철회는 재개 commit 뒤로 밀린다.
        entered, release = pause_method(
            monkeypatch, NpcPublicationRepository, "update_state"
        )
        waited, resumed = await race_while_paused(
            entered,
            release,
            resume(service),
            lambda: reviews.add(
                T0 + timedelta(minutes=2), decision="hold", gates=("G1",)
            ),
        )
        monkeypatch.undo()
        assert waited
        assert resumed.status == "published"
        assert (await service.current(CASE, 1)).status == "published"

        # (b) 철회가 먼저 commit되면 그 뒤의 재개는 거부된다.
        await block(service)
        await reviews.add(T0 + timedelta(minutes=3))  # 재승인
        await reviews.add(T0 + timedelta(minutes=4), decision="hold", gates=("G3",))
        with pytest.raises(PublicationGateFailedError) as held:
            await resume(service)
        assert held.value.result.check("APPROVALS").reasons == ("G3:hold",)
        assert (await service.current(CASE, 1)).status == "blocked"

    mysql_run(scenario)


def test_mysql_resume_and_idempotent_completions_run_concurrently():
    async def scenario(sessions):
        service, store = stores(sessions)
        reviews = Reviews(sessions)
        await publish(service, sessions, reviews=reviews)
        await block(service)
        await reviews.add(T0 + timedelta(minutes=1))
        session_id = await new_play_session(sessions, V1)
        claims = [
            await store.claim(turn_key(session_id, str(uuid4())), V1, REQUEST)
            for _ in range(5)
        ]

        async def finish(claim, delay):
            await asyncio.sleep(delay)
            try:
                await store.complete(
                    claim, response(), write_event=event_writer(session_id)
                )
                return "stored"
            except TurnWithdrawnError:
                return "withdrawn"

        results = await asyncio.gather(
            *(finish(c, 0.03 * i) for i, c in enumerate(claims)), resume(service)
        )
        outcomes = results[:-1]
        assert results[-1].status == "published"
        # 교착 없이 끝나고, 재개 전 확정은 거부 · 재개 뒤 확정은 저장된다(부분 저장 없음).
        assert set(outcomes) <= {"stored", "withdrawn"}
        assert await count(sessions, NpcTurnResponseBody) == outcomes.count("stored")

    mysql_run(scenario)


# --- 장애 · 트랜잭션 경계 ---


def test_mysql_lock_failure_or_mid_write_error_leaves_no_partial_publication(
    monkeypatch,
):
    async def scenario(sessions):
        await Reviews(sessions).add(BEFORE)

        # 승인 대상 잠금을 다른 트랜잭션이 잡고 있으면 잠금 대기 초과 오류(게시 아님)
        engine = isolated_engine(
            init_command="SET SESSION innodb_lock_wait_timeout = 1"
        )
        try:
            fast_service, _ = stores(async_sessionmaker(engine, expire_on_commit=False))
            async with sessions() as holder, holder.begin():
                await ApprovalHistoryRepository(holder).lock_target(TARGET)
                with pytest.raises(OperationalError) as timeout:
                    await fast_service.publish_new(
                        BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS
                    )
                assert timeout.value.orig.args[0] == 1205
        finally:
            await engine.dispose()
        assert await publication_rows(sessions) == (0, 0, 0)

        # 상태 · 버전을 쓴 뒤 이력 기록에서 실패해도 전부 rollback된다.
        service, _ = stores(sessions)

        async def broken(self, **kwargs):
            raise RuntimeError("이력 기록 실패")

        monkeypatch.setattr(NpcPublicationRepository, "append_event", broken)
        with pytest.raises(RuntimeError):
            await service.publish_new(BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS)
        monkeypatch.undo()
        assert await publication_rows(sessions) == (0, 0, 0)
        # 같은 묶음으로 다시 게시하면 정상 확정된다.
        assert (
            await service.publish_new(BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS)
        ).snapshot.status == "published"

    mysql_run(scenario)


def test_mysql_publication_never_touches_the_callers_transaction():
    async def scenario(sessions):
        service, _ = stores(sessions)
        await Reviews(sessions).add(BEFORE)
        side_target = ApprovalTarget(
            target_type="dialogue_pack", target_id="pack_side", content_version=1
        )
        async with sessions() as caller:
            await ApprovalHistoryRepository(caller).lock_target(side_target)
            await service.publish_new(BUNDLE, reason="게시", actor=ACTOR, **GATE_INPUTS)
            # 호출자 트랜잭션 · 미커밋 변경(잠금 행 upsert)은 그대로다.
            assert caller.in_transaction()
            await caller.rollback()
        assert await publication_rows(sessions) == (1, 1, 1)

    mysql_run(scenario)


def test_mysql_resume_with_different_content_is_rejected():
    async def scenario(sessions):
        service, _ = stores(sessions)
        await publish(service, sessions)
        await service.suspend(CASE, 1, reason="일반 중단", actor=ACTOR)

        with pytest.raises(ContentFingerprintMismatchError):
            await resume(service, other_bundle())
        assert (await service.current(CASE, 1)).status == "suspended"

    mysql_run(scenario)
