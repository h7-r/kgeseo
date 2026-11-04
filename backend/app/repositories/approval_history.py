"""기존 ApprovalLog의 append/records 의미를 보존하는 Async MySQL 저장소."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.npc_approval_review import NpcApprovalReview, NpcApprovalTarget
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import (
    DuplicateReviewError,
    ReviewRecord,
    UnknownSupersedesError,
)


def _scope(model: type, target: ApprovalTarget) -> tuple:
    return (
        model.target_type == target.target_type,
        model.target_id == target.target_id,
        model.content_version == target.content_version,
    )


def to_record(row: NpcApprovalReview) -> ReviewRecord:
    return ReviewRecord(
        review_id=row.review_id,
        gate=row.gate,
        target_hash=row.target_hash,
        decision=row.decision,
        reviewer=row.reviewer,
        reviewed_at=row.reviewed_at.isoformat(timespec="milliseconds") + "Z",
        reason=row.reason,
        supersedes=row.supersedes,
        actor=row.actor,
    )


class ApprovalHistoryRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def lock_target(self, target: ApprovalTarget) -> None:
        # 기록이 0건인 대상도 잠근다. 이 upsert는 승인 이력이 아닌 잠금 행에만 적용한다.
        statement = insert(NpcApprovalTarget).values(**target.model_dump())
        await self.db.execute(
            statement.on_duplicate_key_update(target_id=statement.inserted.target_id)
        )
        await self.db.execute(
            select(NpcApprovalTarget)
            .where(*_scope(NpcApprovalTarget, target))
            .with_for_update()
        )

    async def records(
        self, target: ApprovalTarget, *, current: bool = False
    ) -> Sequence[ReviewRecord]:
        statement = (
            select(NpcApprovalReview)
            .where(*_scope(NpcApprovalReview, target))
            .order_by(NpcApprovalReview.reviewed_at, NpcApprovalReview.review_id)
        )
        # 쓰기는 대상 잠금 후 최신 커밋 이력을 읽는다(MySQL snapshot read와 구분).
        # current=False는 트랜잭션의 snapshot을 읽으므로 게시 판정에 쓰지 않는다(publication_approval).
        if current:
            statement = statement.with_for_update()
        result = await self.db.execute(statement)
        return tuple(to_record(row) for row in result.scalars().all())

    async def append(self, target: ApprovalTarget, record: ReviewRecord) -> None:
        if not isinstance(record, ReviewRecord):
            raise TypeError("approval repository only accepts ReviewRecord")
        await self.lock_target(target)
        if await self.db.get(NpcApprovalReview, record.review_id) is not None:
            raise DuplicateReviewError(record.review_id)
        if record.supersedes is not None:
            # 기존 ApprovalLog처럼 전역 존재만 검사한다. 참조 범위 강화는 별도 정책이다.
            if await self.db.get(NpcApprovalReview, record.supersedes) is None:
                raise UnknownSupersedesError(record.supersedes)
        self.db.add(
            NpcApprovalReview(
                **target.model_dump(),
                **record.model_dump(exclude={"reviewed_at"}),
                reviewed_at=datetime.strptime(
                    record.reviewed_at, "%Y-%m-%dT%H:%M:%S.%fZ"
                ),
            )
        )
        try:
            await self.db.flush()
        except IntegrityError as error:
            # 다른 대상이 같은 UUID를 동시에 쓰는 경우도 PK가 최종 차단한다.
            args = getattr(error.orig, "args", ())
            if args and args[0] == 1062:
                raise DuplicateReviewError(record.review_id) from error
            raise
