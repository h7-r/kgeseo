"""게시 시점 DB 승인 snapshot을 기존 PUB-GATE에 전달하는 내부 경계.

공개 게시 API·파일 로더·시작 등록·NPC 턴 경로는 연결하지 않는다.
두 대상 모두 기존 G1~G3 정책을 사용하며 G3 전용 예외를 만들지 않는다.

[트랜잭션 소유권] 게시 판정은 호출자의 세션을 쓰지 않는다. 세션 팩토리를 받아 판정마다 새 세션·
새 트랜잭션을 열고, 대상 잠금 행을 잠근 뒤 잠금 읽기로 최신 커밋 이력을 읽는다.
- 오래된 REPEATABLE READ snapshot을 재사용하지 않는다. 철회 commit 뒤에 시작한 판정은 그 철회를 본다.
- 호출자 세션의 미커밋 변경을 commit·rollback하지 않는다.
- 이력 append와 같은 대상 잠금을 쓰므로 잠금을 잡은 동안 이력이 고정된다. 향후 게시 확정은
  `locked_approval_history()` 블록 안에서 같은 세션으로 기록해야 판정과 확정 사이에 철회가 끼어들지
  않는다(게시 확정 자체는 아직 없다).
- 잠금 대기 초과·교착·연결 오류·취소는 그대로 전파하며 승인 결과로 바꾸지 않는다.
- 같은 대상 잠금을 다른 트랜잭션에서 잡은 채 호출하면 잠금 대기 끝에 오류가 난다.
"""

from collections.abc import AsyncIterator, Iterable, Mapping
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import (
    REQUIRED_GATES,
    ApprovalSource,
    ReviewRecord,
    gate_decisions,
)
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


@asynccontextmanager
async def locked_approval_history(
    sessions: async_sessionmaker[AsyncSession], target: ApprovalTarget
) -> AsyncIterator[tuple[AsyncSession, tuple[ReviewRecord, ...]]]:
    """새 트랜잭션에서 대상을 잠그고 최신 커밋 이력을 읽는다.

    블록이 정상 종료하면 commit(잠금 해제)하고, 예외·취소면 rollback한다. commit 실패는 블록 밖으로 전파한다.
    """

    async with sessions() as db, db.begin():
        repository = ApprovalHistoryRepository(db)
        await repository.lock_target(target)
        records = tuple(await repository.records(target, current=True))
        yield db, records


async def check_target_approval(
    sessions: async_sessionmaker[AsyncSession],
    target: ApprovalTarget,
    fingerprint: str,
) -> tuple[str, ...]:
    """대상 종류별 필수 관문(PM v0.4.13) 판정. 일반 팩의 정책 검사는 포함하지 않는다(`general_pack_approved`)."""

    async with locked_approval_history(sessions, target) as (_, records):
        pass
    # 이력 트랜잭션이 commit된 뒤에만 판정한다.
    return gate_decisions(
        records, fingerprint, required=REQUIRED_GATES[target.target_type]
    )


async def evaluate_publication_with_db_reviews(
    sessions: async_sessionmaker[AsyncSession],
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
    async with locked_approval_history(sessions, target) as (_, records):
        pass
    # 이력 트랜잭션이 commit된 뒤에 기존 게이트를 실행하므로 DB 오류 뒤에는 store(메모리) 등록이 없다.
    # 잠금 해제 뒤의 철회는 게시 뒤 철회와 같다(PM: 철회만으로 기존 게시본을 자동 중단하지 않는다).
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
