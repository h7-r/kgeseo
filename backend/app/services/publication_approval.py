"""게시 시점 DB 승인 snapshot을 기존 PUB-GATE에 전달하는 내부 경계.

공개 게시 API·파일 로더·시작 등록·NPC 턴 경로는 연결하지 않는다.
두 대상 모두 기존 G1~G3 정책을 사용하며 G3 전용 예외를 만들지 않는다.
"""

import asyncio
from collections.abc import Iterable, Mapping

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import ApprovalSource, ReviewRecord, gate_decisions
from app.services.hint import HintSource
from app.services.pinned_content import PinnedContentStore
from app.services.publication_gate import (
    NgChecker,
    PublicationResult,
    evaluate_publication,
)


def snapshot_source(
    target: ApprovalTarget, records: tuple[ReviewRecord, ...]
) -> ApprovalSource:
    def source(target_id: str, version: int) -> tuple[ReviewRecord, ...]:
        if (target_id, version) == (target.target_id, target.content_version):
            return records
        return ()

    return source


async def check_target_approval(
    db: AsyncSession, target: ApprovalTarget, fingerprint: str
) -> tuple[str, ...]:
    try:
        records = await ApprovalHistoryRepository(db).records(target)
        return gate_decisions(records, fingerprint)
    except (Exception, asyncio.CancelledError):
        await db.rollback()
        raise  # DB 장애는 승인 결과로 변환하지 않는다.


async def evaluate_publication_with_db_reviews(
    db: AsyncSession,
    *,
    case_id: str,
    content_version: int,
    client: bytes,
    server: bytes,
    npc: bytes,
    idmap: bytes | None,
    hint_source: HintSource,
    ng_checker: NgChecker | None = None,
    local_ids: Mapping[str, Iterable[str]] | None = None,
    store: PinnedContentStore | None = None,
) -> PublicationResult:
    target = ApprovalTarget(
        target_type="case_content", target_id=case_id, content_version=content_version
    )
    try:
        records = tuple(await ApprovalHistoryRepository(db).records(target))
        return evaluate_publication(
            client=client,
            server=server,
            npc=npc,
            idmap=idmap,
            hint_source=hint_source,
            approval_source=snapshot_source(target, records),
            ng_checker=ng_checker,
            local_ids=local_ids,
            store=store,
        )
    except (Exception, asyncio.CancelledError):
        await db.rollback()
        raise
