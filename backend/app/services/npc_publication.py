"""NPC 콘텐츠 게시 상태 전이 · 멱등 저장소 guard (PM v0.4.6, 작업 D1 · 관리 경로 미연결).

상태 의미(PM v0.4.6):
- `published`: 게시 중. 신규 세션 · 진행 중 세션 모두 케이스 NPC 콘텐츠를 쓴다.
- `suspended`: 일반 중단. 신규 세션만 막는다. 진행 중 세션은 고정 게시본으로 계속한다.
- `blocked`: 긴급 중단. 진행 중 세션도 다음 NPC 요청부터 generic이다. 게임 진행 · Client Bundle · Hint API는 유지한다.

허용 전이(이 밖은 `PublicationTransitionError`):
- (없음) → published, suspended → published: PUB-GATE 승인 결과가 필요하다(`publish()`).
- published → suspended (`suspend()`)
- published → blocked, suspended → blocked (`block()`). 이미 blocked면 상태 · 이력은 그대로 두고 철회만 다시 한다.
- blocked에서 벗어나는 전이는 PM 미정이라 막는다.

트랜잭션 · 잠금 계약:
- 상태 변경은 한 트랜잭션에서 「게시 상태 행 `FOR UPDATE` → (차단이면) 멱등 요청 행 철회 → 응답 본문 삭제 → 이력 추가」 순서다.
- 멱등 저장소 확정은 guard로 「게시 상태 행 `FOR SHARE` → 멱등 요청 행 → 응답 본문 · 이벤트」 순서다. 순서가 같아 교착하지 않는다.
- 조회는 항상 새 트랜잭션의 잠금 읽기라 오래된 REPEATABLE READ snapshot을 재사용하지 않는다.
- DB 오류 · 잠금 실패 · 상태 없음은 그대로 전파한다(fail closed). 게시 중으로 가정하지 않는다.

관리용 CLI · 관리자 HTTP · NPC 라우터 연결은 이 모듈에 없다. `actor`는 호출자가 검증된 주체로 넘겨야 한다.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import TypeVar

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.npc_publication import (
    PUBLICATION_BLOCKED,
    PUBLICATION_PUBLISHED,
    PUBLICATION_STATUSES,
    PUBLICATION_SUSPENDED,
)
from app.repositories.npc_publication import (
    NpcPublicationRepository,
    PublicationEventRecord,
    PublicationSnapshot,
)
from app.repositories.npc_turn_idempotency import (
    NpcTurnIdempotencyRepository,
    TurnContentRef,
    WithdrawalCounts,
)
from app.services.npc_turn_idempotency import (
    ContentPublicationBlockedError,
    GenericLineCatalog,
    NpcTurnIdempotencyStore,
    PublicationStateUnavailableError,
    RequestHashKeys,
    no_generic_lines,
    utc_now,
)
from app.services.publication_gate import PublicationResult

MAX_REASON_LENGTH = 500
MAX_ACTOR_LENGTH = 100
MYSQL_DEADLOCK = 1213
DEFAULT_DEADLOCK_RETRIES = 3

T = TypeVar("T")


class NpcPublicationError(Exception):
    pass


class PublicationTransitionError(NpcPublicationError):
    """허용되지 않은 상태 전이."""


class PublicationStateConflictError(NpcPublicationError):
    """잠근 뒤 확인한 현재 상태가 호출자가 기대한 상태와 다르다(동시 변경)."""


class PublicationStateNotFoundError(NpcPublicationError):
    pass


class PublicationGateRequiredError(NpcPublicationError):
    """게시 · 재개에는 같은 case · version의 승인된 PUB-GATE 결과가 필요하다."""


@dataclass(frozen=True)
class PublicationPolicy:
    """상태별 서비스 범위(PM v0.4.6)."""

    status: str

    def __post_init__(self) -> None:
        if self.status not in PUBLICATION_STATUSES:
            raise ValueError("unknown publication status")

    @property
    def accepts_new_sessions(self) -> bool:
        return self.status == PUBLICATION_PUBLISHED

    @property
    def serves_case_npc_content(self) -> bool:
        return self.status in (PUBLICATION_PUBLISHED, PUBLICATION_SUSPENDED)

    @property
    def serves_game_content(self) -> bool:
        # 긴급 중단에도 진행 중 세션의 게임 진행 · Client Bundle · Hint API는 유지한다.
        return True


@dataclass(frozen=True)
class BlockResult:
    snapshot: PublicationSnapshot
    withdrawal: WithdrawalCounts
    # 이번 호출로 blocked가 되었는가(이미 blocked였으면 False)
    changed: bool


def _require_text(value: str, name: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{name} must be 1-{limit} non-blank characters")
    return value


def _require_gate(gate: PublicationResult, case_id: str, content_version: int) -> None:
    if (
        not isinstance(gate, PublicationResult)
        or gate.approved is not True
        or gate.case_id != case_id
        or gate.content_version != content_version
    ):
        raise PublicationGateRequiredError()


async def publication_state_guard(db: AsyncSession, content: TurnContentRef) -> None:
    """멱등 저장소 `complete()`의 게시 상태 guard. 확정 트랜잭션 안에서 게시 상태 행을 공유 잠금으로 읽는다.

    - 상태 없음 · fingerprint 불일치 → `PublicationStateUnavailableError`(확정 안 함)
    - blocked → `ContentPublicationBlockedError`
    - published · suspended → 통과
    """

    snapshot = await NpcPublicationRepository(db).lock_state(
        content.case_id, content.content_version, mode="share"
    )
    if snapshot is None or snapshot.content_fingerprint != content.content_fingerprint:
        raise PublicationStateUnavailableError()
    if snapshot.status == PUBLICATION_BLOCKED:
        raise ContentPublicationBlockedError()


def build_npc_turn_idempotency_store(
    sessions: async_sessionmaker[AsyncSession],
    *,
    hash_keys: RequestHashKeys,
    generic_lines: GenericLineCatalog = no_generic_lines,
    **options,
) -> NpcTurnIdempotencyStore:
    """게시 상태 guard를 연결한 멱등 저장소."""

    return NpcTurnIdempotencyStore(
        sessions,
        hash_keys=hash_keys,
        publication_guard=publication_state_guard,
        generic_lines=generic_lines,
        **options,
    )


class NpcPublicationService:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        *,
        clock: Callable[[], datetime] = utc_now,
        deadlock_retries: int = DEFAULT_DEADLOCK_RETRIES,
    ) -> None:
        self._sessions = sessions
        self._clock = clock
        self._retries = deadlock_retries

    # --- 조회 (항상 새 트랜잭션의 잠금 읽기) ---

    async def current(
        self, case_id: str, content_version: int
    ) -> PublicationSnapshot | None:
        async def once() -> PublicationSnapshot | None:
            async with self._sessions() as db, db.begin():
                return await NpcPublicationRepository(db).lock_state(
                    case_id, content_version, mode="share"
                )

        return await self._retry(once)

    async def restorable_versions(self) -> tuple[PublicationSnapshot, ...]:
        """서버 시작 시 복원할 게시본 목록(마지막 commit 상태). blocked도 게임 콘텐츠용으로 포함한다."""

        async def once() -> tuple[PublicationSnapshot, ...]:
            async with self._sessions() as db, db.begin():
                return await NpcPublicationRepository(db).all_states()

        return await self._retry(once)

    async def events(
        self, case_id: str, content_version: int
    ) -> tuple[PublicationEventRecord, ...]:
        async def once() -> tuple[PublicationEventRecord, ...]:
            async with self._sessions() as db, db.begin():
                return await NpcPublicationRepository(db).events(
                    case_id, content_version
                )

        return await self._retry(once)

    # --- 전이 ---

    async def publish(
        self,
        case_id: str,
        content_version: int,
        content_fingerprint: str,
        *,
        gate: PublicationResult,
        reason: str,
        actor: str,
    ) -> PublicationSnapshot:
        """최초 게시(없음 → published) 또는 재개(suspended → published). PUB-GATE 승인 결과가 필요하다."""

        _require_gate(gate, case_id, content_version)
        reason = _require_text(reason, "reason", MAX_REASON_LENGTH)
        actor = _require_text(actor, "actor", MAX_ACTOR_LENGTH)

        async def once() -> PublicationSnapshot:
            now = self._clock()
            async with self._sessions() as db, db.begin():
                repository = NpcPublicationRepository(db)
                await repository.register_version(
                    case_id, content_version, content_fingerprint, now=now
                )
                snapshot = await repository.lock_state(
                    case_id, content_version, mode="update"
                )
                if snapshot is None:
                    await repository.insert_state(
                        case_id, content_version, status=PUBLICATION_PUBLISHED, now=now
                    )
                    revision, from_status = 1, None
                elif snapshot.status == PUBLICATION_SUSPENDED:
                    revision = await repository.update_state(
                        snapshot, status=PUBLICATION_PUBLISHED, now=now
                    )
                    from_status = snapshot.status
                else:
                    raise PublicationTransitionError()
                await repository.append_event(
                    case_id=case_id,
                    content_version=content_version,
                    from_status=from_status,
                    to_status=PUBLICATION_PUBLISHED,
                    reason=reason,
                    actor=actor,
                    at=now,
                    state_revision=revision,
                )
                return await repository.lock_state(
                    case_id, content_version, mode="update"
                )

        return await self._retry(once)

    async def suspend(
        self,
        case_id: str,
        content_version: int,
        *,
        reason: str,
        actor: str,
    ) -> PublicationSnapshot:
        """일반 중단(published → suspended). 진행 중 세션의 저장 응답 · NPC 응답은 그대로다."""

        return await self._transition(
            case_id,
            content_version,
            to_status=PUBLICATION_SUSPENDED,
            allowed_from=(PUBLICATION_PUBLISHED,),
            reason=reason,
            actor=actor,
        )

    async def block(
        self,
        case_id: str,
        content_version: int,
        *,
        reason: str,
        actor: str,
        expected_status: str | None = None,
    ) -> BlockResult:
        """긴급 중단(published · suspended → blocked)과 그 버전의 저장 응답 본문 삭제를 한 트랜잭션에서 한다."""

        reason = _require_text(reason, "reason", MAX_REASON_LENGTH)
        actor = _require_text(actor, "actor", MAX_ACTOR_LENGTH)

        async def once() -> BlockResult:
            now = self._clock()
            async with self._sessions() as db, db.begin():
                repository = NpcPublicationRepository(db)
                # 1. 게시 상태 행
                snapshot = await repository.lock_state(
                    case_id, content_version, mode="update"
                )
                if snapshot is None:
                    raise PublicationStateNotFoundError()
                if expected_status is not None and snapshot.status != expected_status:
                    raise PublicationStateConflictError()
                changed = snapshot.status != PUBLICATION_BLOCKED
                if changed:
                    revision = await repository.update_state(
                        snapshot, status=PUBLICATION_BLOCKED, now=now
                    )
                # 2 · 3. 멱등 요청 행 철회와 응답 본문 삭제
                withdrawal = await NpcTurnIdempotencyRepository(
                    db
                ).withdraw_content_version(case_id, content_version, now=now)
                if changed:
                    await repository.append_event(
                        case_id=case_id,
                        content_version=content_version,
                        from_status=snapshot.status,
                        to_status=PUBLICATION_BLOCKED,
                        reason=reason,
                        actor=actor,
                        at=now,
                        state_revision=revision,
                    )
                final = await repository.lock_state(
                    case_id, content_version, mode="update"
                )
            return BlockResult(final, withdrawal, changed)

        return await self._retry(once)

    async def _transition(
        self,
        case_id: str,
        content_version: int,
        *,
        to_status: str,
        allowed_from: tuple[str, ...],
        reason: str,
        actor: str,
    ) -> PublicationSnapshot:
        reason = _require_text(reason, "reason", MAX_REASON_LENGTH)
        actor = _require_text(actor, "actor", MAX_ACTOR_LENGTH)

        async def once() -> PublicationSnapshot:
            now = self._clock()
            async with self._sessions() as db, db.begin():
                repository = NpcPublicationRepository(db)
                snapshot = await repository.lock_state(
                    case_id, content_version, mode="update"
                )
                if snapshot is None:
                    raise PublicationStateNotFoundError()
                if snapshot.status not in allowed_from:
                    raise PublicationTransitionError()
                revision = await repository.update_state(
                    snapshot, status=to_status, now=now
                )
                await repository.append_event(
                    case_id=case_id,
                    content_version=content_version,
                    from_status=snapshot.status,
                    to_status=to_status,
                    reason=reason,
                    actor=actor,
                    at=now,
                    state_revision=revision,
                )
                return await repository.lock_state(
                    case_id, content_version, mode="update"
                )

        return await self._retry(once)

    async def _retry(self, operation: Callable[[], Awaitable[T]]) -> T:
        # 교착(1213)은 InnoDB가 트랜잭션 전체를 rollback하므로 같은 짧은 트랜잭션을 다시 시도한다.
        attempt = 0
        while True:
            try:
                return await operation()
            except DBAPIError as error:
                args = getattr(error.orig, "args", ())
                errno = args[0] if args and isinstance(args[0], int) else None
                if errno != MYSQL_DEADLOCK or attempt >= self._retries:
                    raise
                attempt += 1
