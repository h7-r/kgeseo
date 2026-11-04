"""관리자 기록 서비스. 검증된 관리자 인증이 없어 HTTP 연결은 보류한다.

기록 경로는 둘이다. 둘 다 같은 append-only 저장소 · 같은 잠금 · 같은 시각 규칙을 쓴다.

- `create_gate_review`: 검증된 관리자(`VerifiedAdmin`, 향후 인증 의존성). 판정자 본인이 실행하므로
  reviewer = actor = 검증된 신원이다.
- `record_delegated_gate_review`: 인증 운영 전 서버 안 관리 명령(CLI, PM v0.4.6 §7 · v0.4.13 §3).
  실행자(`actor`)와 판정자(`reviewer`)를 따로 받아 그대로 남긴다. 실행자를 판정자로 기록하지 않는다.
  근거(`reason`)는 필수다(위임 근거 · 승인 출처).
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.approval_history import MAX_REVIEWER_LENGTH, ReviewRecord


class AdminAuthenticationRequired(PermissionError):
    pass


class DelegatedReviewInputError(ValueError):
    """CLI 기록 입력이 계약을 어겼다(실행자 · 판정자 · 근거)."""


@dataclass(frozen=True)
class VerifiedAdmin:
    """향후 검증된 인증 의존성만 생성한다. 클라이언트 입력에서 만들지 않는다."""

    reviewer: str


@dataclass(frozen=True)
class InternalCliOperator:
    """서버 안 관리 명령의 실행자(PM v0.4.6 §7: 필수 인자). `scripts.record_gate_review`만 만든다.

    인증된 신원이 아니다. 그래서 판정자(reviewer)로 쓰지 않고 `actor`로만 남긴다.
    """

    actor: str


async def create_gate_review(
    db: AsyncSession, request: GateReviewCreate, *, admin: VerifiedAdmin | None
) -> ReviewRecord:
    if not isinstance(admin, VerifiedAdmin):
        raise AdminAuthenticationRequired("verified administrator required")
    return await _record_review(
        db, request, reviewer=admin.reviewer, actor=admin.reviewer
    )


async def record_delegated_gate_review(
    db: AsyncSession,
    request: GateReviewCreate,
    *,
    operator: InternalCliOperator | None,
    reviewer: str,
) -> ReviewRecord:
    if not isinstance(operator, InternalCliOperator):
        raise AdminAuthenticationRequired("internal CLI operator required")
    for name, value in (("actor", operator.actor), ("reviewer", reviewer)):
        if (
            not isinstance(value, str)
            or not value.strip()
            or value != value.strip()
            or len(value) > MAX_REVIEWER_LENGTH
        ):
            raise DelegatedReviewInputError(f"invalid {name}")
    if request.reason is None or not request.reason.strip():
        raise DelegatedReviewInputError("reason is required for a delegated review")
    return await _record_review(db, request, reviewer=reviewer, actor=operator.actor)


async def _record_review(
    db: AsyncSession, request: GateReviewCreate, *, reviewer: str, actor: str
) -> ReviewRecord:
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
            reviewer=reviewer,
            actor=actor,
        )
        await repository.append(target, record)
        await db.commit()
        return record
    except (Exception, asyncio.CancelledError):
        await db.rollback()
        raise
