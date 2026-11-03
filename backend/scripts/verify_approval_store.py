"""승인 이력 영속 저장소(content_reviews)를 실제 MySQL에서 확인한다(격리 DB에서만 실행).

    $env:DB_NAME = "waegok_test"
    .\\.venv\\Scripts\\python.exe -m alembic upgrade head
    .\\.venv\\Scripts\\python.exe -m scripts.verify_approval_store

승인 기록 · 콘텐츠는 이 스크립트 안의 가상 데이터다(실제 승인자 · 실제 PM 콘텐츠가 아니다).
이 실행만 쓰는 subject_id로 기록을 만들고, 끝나면 그 기록만 지운다(검증 정리용 삭제이며 앱에는 삭제 경로가 없다).
"""

import asyncio
import sys
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.models.content_review import ContentReview
from app.services.approval_history import (
    ApprovalSourceUnavailableError,
    DuplicateReviewError,
    ReviewRecord,
    gate_decisions,
)
from app.services.approval_store import append_review, load_approval_source
from app.services.content_publication import publish_with_stored_approvals
from app.services.pinned_content import PinnedContentStore
from scripts.verify_content_publication import _documents, _seal


def _record(gate: str, decision: str, fingerprint: str, at: str, **extra):
    if decision != "approved":
        extra.setdefault("reason", "(가상) 사유")
    return ReviewRecord(
        review_id=str(uuid.uuid4()),
        gate=gate,
        target_hash=fingerprint,
        decision=decision,
        reviewer="reviewer-verification",
        reviewed_at=at,
        **extra,
    )


async def _append(subject_id: str, record: ReviewRecord) -> None:
    async with AsyncSessionLocal() as db:
        await append_review(db, subject_id, 1, record)


async def _decisions(subject_id: str, fingerprint: str) -> tuple[str, ...]:
    async with AsyncSessionLocal() as db:
        source = await load_approval_source(db, subject_id, 1)
        await db.rollback()
    return gate_decisions(source(subject_id, 1), fingerprint)


async def _count(subject_id: str) -> int:
    async with AsyncSessionLocal() as db:
        return await db.scalar(
            select(func.count()).where(ContentReview.subject_id == subject_id)
        )


async def _cleanup(subject_id: str) -> None:
    # supersedes(자기 참조 FK)가 가리키는 기록은 가리키는 기록을 먼저 지운 뒤 지운다.
    async with AsyncSessionLocal() as db:
        while True:
            referenced = select(ContentReview.supersedes).where(
                ContentReview.supersedes.is_not(None)
            )
            rows = (
                (
                    await db.execute(
                        select(ContentReview.review_id).where(
                            ContentReview.subject_id == subject_id,
                            ContentReview.review_id.not_in(
                                referenced.scalar_subquery()
                            ),
                        )
                    )
                )
                .scalars()
                .all()
            )
            if not rows:
                break
            await db.execute(
                delete(ContentReview).where(ContentReview.review_id.in_(rows))
            )
            await db.commit()
        left = await db.scalar(
            select(func.count()).where(ContentReview.subject_id == subject_id)
        )
    if left:
        raise AssertionError(f"{left} verification rows were left behind.")


async def _verify() -> None:
    subject_id = f"approval-verification-{uuid.uuid4().hex[:12]}"
    bundle, fingerprint = _seal(_documents(subject_id, 1, "first"))
    try:
        # 1. 승인 없음 → 세 관문 모두 missing
        if await _decisions(subject_id, fingerprint) != (
            "G1:missing",
            "G2:missing",
            "G3:missing",
        ):
            raise AssertionError("Empty history was not missing.")
        print("[OK] No stored approvals means every gate is missing.")

        # 2. 세 관문 승인 저장 → 정확한 fingerprint만 PASS, 결정 시각 밀리초 보존
        approvals = [
            _record(gate, "approved", fingerprint, f"2026-11-03T01:00:0{n}.12{n}Z")
            for n, gate in enumerate(("G1", "G2", "G3"))
        ]
        for record in approvals:
            await _append(subject_id, record)
        async with AsyncSessionLocal() as db:
            loaded = (await load_approval_source(db, subject_id, 1))(subject_id, 1)
        if sorted(loaded, key=lambda r: r.gate) != approvals:
            raise AssertionError("Stored records did not round-trip.")
        if await _decisions(subject_id, fingerprint) != ():
            raise AssertionError("Exact fingerprint approvals did not pass.")
        if await _decisions(subject_id, "sha256:" + "0" * 64) != tuple(
            f"{gate}:stale target_hash" for gate in ("G1", "G2", "G3")
        ):
            raise AssertionError("Approvals were reused for another fingerprint.")
        print("[OK] Approvals pass only for their exact fingerprint and round-trip.")

        # 3. 같은 review_id 동시 저장 → 한 건만 저장
        racing = _record(
            "G1",
            "hold",
            fingerprint,
            "2026-11-03T02:00:00.000Z",
            supersedes=approvals[0].review_id,
        )
        outcomes = await asyncio.gather(
            *(_append(subject_id, racing) for _ in range(5)), return_exceptions=True
        )
        errors = [o for o in outcomes if o is not None]
        if len(errors) != 4 or not all(
            isinstance(e, DuplicateReviewError) for e in errors
        ):
            raise AssertionError(f"Concurrent duplicate outcomes {outcomes!r}")
        if await _count(subject_id) != 4:
            raise AssertionError("Concurrent duplicates stored more than one row.")
        print("[OK] Five concurrent appends of one review_id stored it once.")

        # 4. 위 기록은 G1 철회(hold)다 → 차단, 이력은 남는다. 재승인(사유 · supersedes)으로 복구
        if await _decisions(subject_id, fingerprint) != ("G1:hold",):
            raise AssertionError("Withdrawn approval still passed.")
        await _append(
            subject_id,
            _record(
                "G1",
                "approved",
                fingerprint,
                "2026-11-03T03:00:00.000Z",
                reason="(가상) 보완 확인",
                supersedes=racing.review_id,
            ),
        )
        if (
            await _decisions(subject_id, fingerprint) != ()
            or await _count(subject_id) != 5
        ):
            raise AssertionError("Re-approval did not restore or history was lost.")
        print("[OK] Withdrawal blocked, re-approval restored, history kept all rows.")

        # 5. 게시 판정 중(공유 잠금)에는 같은 key의 새 기록(철회)이 기다린다
        async with AsyncSessionLocal() as reader:
            await load_approval_source(reader, subject_id, 1)
            withdrawal = asyncio.create_task(
                _append(
                    subject_id,
                    _record(
                        "G2",
                        "rejected",
                        fingerprint,
                        "2026-11-03T04:00:00.000Z",
                        supersedes=approvals[1].review_id,
                    ),
                )
            )
            await asyncio.sleep(1.0)
            if withdrawal.done():
                raise AssertionError("Withdrawal was not held by the reading lock.")
            await reader.rollback()
        await asyncio.wait_for(withdrawal, timeout=30)
        if await _decisions(subject_id, fingerprint) != ("G2:rejected",):
            raise AssertionError("Withdrawal after the lock was not applied.")
        print(
            "[OK] A withdrawal waited for the in-flight publication read, then applied."
        )

        # 6. 게시 경로 연동: 철회된 상태 → 거부, 재승인 뒤 → 등록
        store = PinnedContentStore()

        async def publish() -> str:
            async with AsyncSessionLocal() as db:
                report = await publish_with_stored_approvals(
                    db, store, bundle, ng_checker=lambda text: False
                )
            return report.outcome

        if await publish() != "rejected":
            raise AssertionError("Withdrawn content was published.")
        async with AsyncSessionLocal() as db:
            latest_g2 = await db.scalar(
                select(ContentReview.review_id).where(
                    ContentReview.subject_id == subject_id,
                    ContentReview.gate == "G2",
                    ContentReview.decision == "rejected",
                )
            )
        await _append(
            subject_id,
            _record(
                "G2",
                "approved",
                fingerprint,
                "2026-11-03T05:00:00.000Z",
                reason="(가상) 보완 확인",
                supersedes=latest_g2,
            ),
        )
        if await publish() != "published" or store.versions(subject_id) != (1,):
            raise AssertionError("Approved content was not published.")
        print("[OK] Publication used stored approvals: blocked, then published.")

        # 7. DB에 닿지 못하면 승인 처리 실패(미승인)
        broken = create_async_engine(
            settings.database_url.set(port=1), pool_pre_ping=False
        )
        try:
            async with async_sessionmaker(broken)() as db:
                source = await load_approval_source(db, subject_id, 1)
            try:
                source(subject_id, 1)
            except ApprovalSourceUnavailableError:
                pass
            else:
                raise AssertionError("Unreachable DB still produced approvals.")
        finally:
            await broken.dispose()
        print("[OK] An unreachable database was treated as not approved.")
    finally:
        await _cleanup(subject_id)
        print("[OK] Verification rows were cleaned up.")


async def _run() -> None:
    try:
        await _verify()
    finally:
        await engine.dispose()


def main() -> int:
    try:
        asyncio.run(_run())
    except Exception as error:
        print(f"[FAIL] {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
