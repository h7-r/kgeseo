"""NPC 케이스 대사의 승인 · 게시 상태 판정 v0.1 (PM v0.4.3 · v0.4.6, 팀 검토 대기).

세션이 고정한 `(case_id, content_version, content_fingerprint)` 하나만 본다(다른 케이스 · 버전의 기록을 쓰지 않는다).

- 승인: `npc_approval_reviews`의 `(case_content, case_id, content_version)` 기록. 대사 승인 여부는 기존처럼
  `gate_decisions()`가 정확한 fingerprint의 G1~G3로 판정한다(`PinnedContent.is_approved`).
- 게시 상태(PM v0.4.6 `PublicationPolicy.serves_case_npc_content`):
  - `published` · `suspended`: 케이스 대사 사용 가능(승인 판정은 그대로)
  - `blocked`: 케이스 대사 차단, `withdrawn`(응답 `fallback_reason=NPC_CONTENT_WITHDRAWN`)
  - 게시 기록 없음 · fingerprint 불일치 · 모르는 상태: 케이스 대사 차단(승인 출처 없음 → 기존 generic 경로)
- DB 오류 · 계약을 어긴 저장 행: 케이스 대사 차단(기본 차단, 예외를 올리지 않는다).

[읽기 방식] NPC 턴 계산 전에는 잠금 없이 읽는다(`lock=False`). 이벤트를 확정하는 트랜잭션에서는 공유 잠금으로 다시
읽는다(`lock=True`): 승인 대상 행 → 이력 → 게시 상태 행 순서다. 승인 기록 추가와 게시는 승인 대상 행을 배타 잠금으로,
긴급 차단은 게시 상태 행을 배타 잠금으로 잡으므로, 확정 중에는 철회 · 차단이 끼어들지 못하고 순서가 같아 교착하지 않는다.
배타 잠금은 잡지 않는다(NPC 턴끼리는 서로 기다리지 않는다).
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.npc_approval_review import NpcApprovalReview, NpcApprovalTarget
from app.models.npc_publication import (
    PUBLICATION_BLOCKED,
    NpcContentVersion,
    NpcPublicationState,
)
from app.repositories.approval_history import to_record
from app.repositories.npc_publication import NpcPublicationRepository
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import ApprovalSource
from app.services.npc_publication import PublicationPolicy
from app.services.pinned_content import ContentPin
from app.services.publication_approval import snapshot_source

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CaseNpcAccess:
    # 케이스 대사 승인 출처. None이면 케이스 대사는 모두 미승인(기존 generic 경로)
    approval_source: ApprovalSource | None
    # 긴급 차단(blocked): 케이스 콘텐츠 응답을 내지 않고 NPC_CONTENT_WITHDRAWN으로 답한다
    withdrawn: bool = False
    # 판정 근거(게시 상태 · 읽은 승인 기록 ID). 확정 때 다시 읽은 값과 다르면 다시 계산한다.
    basis: tuple = ()


NO_CASE_CONTENT = CaseNpcAccess(None, basis=("unavailable",))

CaseAccessReader = Callable[..., Awaitable[CaseNpcAccess]]


async def read_case_npc_access(
    db: AsyncSession, pin: ContentPin, *, lock: bool
) -> CaseNpcAccess:
    try:
        target = ApprovalTarget(
            target_type="case_content",
            target_id=pin.case_id,
            content_version=pin.content_version,
        )
    except ValidationError:
        return NO_CASE_CONTENT
    try:
        records = await _records(db, target, lock=lock)
        state = await _state(db, pin, lock=lock)
    except (SQLAlchemyError, ValidationError, ValueError):
        logger.warning(
            "case NPC access unavailable: case_id=%s content_version=%s",
            pin.case_id,
            pin.content_version,
        )
        return NO_CASE_CONTENT
    if state is None or state[1] != pin.content_fingerprint:
        return CaseNpcAccess(None, basis=("unpublished",))
    status = state[0]
    try:
        serves = PublicationPolicy(status).serves_case_npc_content
    except ValueError:
        return CaseNpcAccess(None, basis=("unknown_status",))
    if not serves:
        return CaseNpcAccess(
            None, withdrawn=status == PUBLICATION_BLOCKED, basis=(status,)
        )
    return CaseNpcAccess(
        snapshot_source(target, records),
        basis=(status, tuple(record.review_id for record in records)),
    )


async def _records(db: AsyncSession, target: ApprovalTarget, *, lock: bool):
    scope = (
        NpcApprovalReview.target_type == target.target_type,
        NpcApprovalReview.target_id == target.target_id,
        NpcApprovalReview.content_version == target.content_version,
    )
    if lock:
        # 승인 기록 추가와 같은 잠금 행(공유). 행이 없으면 그 범위를 잠근다(추가는 확정이 끝날 때까지 기다린다).
        await db.execute(
            select(NpcApprovalTarget.target_id)
            .where(
                NpcApprovalTarget.target_type == target.target_type,
                NpcApprovalTarget.target_id == target.target_id,
                NpcApprovalTarget.content_version == target.content_version,
            )
            .with_for_update(read=True)
        )
    statement = (
        select(NpcApprovalReview)
        .where(*scope)
        .order_by(NpcApprovalReview.reviewed_at, NpcApprovalReview.review_id)
    )
    if lock:
        statement = statement.with_for_update(read=True)
    rows = (await db.execute(statement)).scalars().all()
    return tuple(to_record(row) for row in rows)


async def _state(
    db: AsyncSession, pin: ContentPin, *, lock: bool
) -> tuple[str, str] | None:
    if lock:
        snapshot = await NpcPublicationRepository(db).lock_state(
            pin.case_id, pin.content_version, mode="share"
        )
        return (
            None
            if snapshot is None
            else (snapshot.status, snapshot.content_fingerprint)
        )
    status = await db.scalar(
        select(NpcPublicationState.status).where(
            NpcPublicationState.case_id == pin.case_id,
            NpcPublicationState.content_version == pin.content_version,
        )
    )
    if status is None:
        return None
    fingerprint = await db.scalar(
        select(NpcContentVersion.content_fingerprint).where(
            NpcContentVersion.case_id == pin.case_id,
            NpcContentVersion.content_version == pin.content_version,
        )
    )
    return None if fingerprint is None else (status, fingerprint)
