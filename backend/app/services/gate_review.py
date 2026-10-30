"""관리자 기록 서비스. 검증된 관리자 인증이 없어 HTTP 연결은 보류한다."""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.approval_history import ReviewRecord


class AdminAuthenticationRequired(PermissionError):
    pass


@dataclass(frozen=True)
class VerifiedAdmin:
    """향후 검증된 인증 의존성만 생성한다. 클라이언트 입력에서 만들지 않는다."""

    reviewer: str


async def create_gate_review(
    db: AsyncSession, request: GateReviewCreate, *, admin: VerifiedAdmin | None
) -> ReviewRecord:
    if not isinstance(admin, VerifiedAdmin):
        raise AdminAuthenticationRequired("verified administrator required")
    target = ApprovalTarget(
        **request.model_dump(include=set(ApprovalTarget.model_fields))
    )
    repository = ApprovalHistoryRepository(db)
    try:
        await repository.lock_target(target)
        history = await repository.records(target, current=True)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        now = now.replace(microsecond=now.microsecond // 1000 * 1000)
        # 동일 밀리초의 UUID 정렬 때문에 재승인이 과거로 배치되지 않게 한다.
        if history:
            latest = max(
                datetime.strptime(r.reviewed_at, "%Y-%m-%dT%H:%M:%S.%fZ")
                for r in history
            )
            now = max(now, latest + timedelta(milliseconds=1))
        record = ReviewRecord(
            **request.model_dump(exclude=set(ApprovalTarget.model_fields)),
            review_id=str(uuid4()),
            reviewed_at=now.isoformat(timespec="milliseconds") + "Z",
            reviewer=admin.reviewer,
        )
        await repository.append(target, record)
        await db.commit()
        return record
    except (Exception, asyncio.CancelledError):
        await db.rollback()
        raise
