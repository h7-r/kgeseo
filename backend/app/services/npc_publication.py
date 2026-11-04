"""NPC 콘텐츠 게시 상태 전이 · PUB-GATE 연결 · 멱등 저장소 guard (PM v0.4.6, 작업 D1 · D2 · 관리 경로 미연결).

상태 의미(PM v0.4.6):
- `published`: 게시 중. 신규 세션 · 진행 중 세션 모두 케이스 NPC 콘텐츠를 쓴다.
- `suspended`: 일반 중단. 신규 세션만 막는다. 진행 중 세션은 고정 게시본으로 계속한다.
- `blocked`: 긴급 중단. 진행 중 세션도 다음 NPC 요청부터 generic이다. 게임 진행 · Client Bundle · Hint API는 유지한다.

허용 전이(이 밖은 `PublicationTransitionError`):
- (없음) → published: `publish_new()`. PUB-GATE를 DB 승인 이력으로 판정한다.
- suspended → published: `resume()`. 현재 승인 이력으로 PUB-GATE를 다시 판정하고 fingerprint가 등록 버전과 같아야 한다.
- blocked → published: `resume()`. 위에 더해 G1 · G2 · G3의 최종 approved 기록이 모두 마지막 차단 시각 이후여야 한다.
- published → suspended (`suspend()`)
- published → blocked, suspended → blocked (`block()`). 이미 blocked면 상태 · 이력은 그대로 두고 철회만 다시 한다.
재개는 content_version을 늘리지 않고, 승인 기록 · 차단 이력을 고치거나 지우지 않는다(이력 추가만).

[PUB-GATE 연결] 게시 · 재개는 서버가 읽은 게시 파일 묶음(`BundleSnapshot`)만 받는다. 외부에서 만든
`PublicationResult`나 `npc.json`의 `approvals[]`는 받지 않는다. fingerprint는 그 바이트로 서버가 다시 계산하고,
판정에는 DB 승인 이력 중 `(case_content, case_id, content_version)` 범위의 기록만 쓴다(`gate_decisions()`는
target_hash가 그 fingerprint인 기록만 본다). 판정과 상태 확정은 한 트랜잭션이다:
「승인 대상 잠금 행 `FOR UPDATE`(승인 이력 append와 같은 잠금) → 케이스 버전 범위 `FOR SHARE`(VERSION_ORDER
직렬화) → 게시 상태 행 `FOR UPDATE` → 버전 등록 · 상태 · 이력」. 그래서 철회 commit 뒤에 시작한 게시는 그
철회를 보고, 판정 도중의 철회는 게시 확정 뒤로 밀린다(게시 뒤 철회는 게시본을 자동 중단하지 않는다 — PM).

트랜잭션 · 잠금 계약:
- 상태 변경은 한 트랜잭션에서 「게시 상태 행 `FOR UPDATE` → (차단이면) 멱등 요청 행 철회 → 응답 본문 삭제 → 이력 추가」 순서다.
- 멱등 저장소 확정은 guard로 「게시 상태 행 `FOR SHARE` → 멱등 요청 행 → 응답 본문 · 이벤트」 순서다. 순서가 같아 교착하지 않는다.
- 조회는 항상 새 트랜잭션의 잠금 읽기라 오래된 REPEATABLE READ snapshot을 재사용하지 않는다.
- DB 오류 · 잠금 실패 · 상태 없음은 그대로 전파한다(fail closed). 게시 중으로 가정하지 않는다.

관리용 CLI · 관리자 HTTP · NPC 라우터 연결은 이 모듈에 없다. `actor`는 호출자가 검증된 주체로 넘겨야 한다.
"""

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, TypeVar

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.npc_publication import (
    PUBLICATION_BLOCKED,
    PUBLICATION_PUBLISHED,
    PUBLICATION_STATUSES,
    PUBLICATION_SUSPENDED,
)
from app.repositories.npc_publication import (
    ContentFingerprintConflictError,
    NpcPublicationRepository,
    PublicationEventRecord,
    PublicationSnapshot,
)
from app.repositories.npc_turn_idempotency import (
    NpcTurnIdempotencyRepository,
    TurnContentRef,
    WithdrawalCounts,
)
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import GATES, ReviewRecord
from app.services.content_fingerprint import compute_content_fingerprint
from app.services.hint import HintSource
from app.services.npc_turn_idempotency import (
    ContentPublicationBlockedError,
    GenericLineCatalog,
    NpcTurnIdempotencyStore,
    PublicationStateUnavailableError,
    RequestHashKeys,
    no_generic_lines,
    utc_now,
)
from app.services.pinned_content import PinnedContent
from app.services.publication_approval import locked_approval_history, snapshot_source
from app.services.publication_gate import (
    NgChecker,
    PublicationResult,
    evaluate_publication,
)
from app.services.published_content_loader import BundleSnapshot

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


class PublicationGateFailedError(NpcPublicationError):
    """DB 승인 이력으로 다시 판정한 PUB-GATE가 통과하지 않았다. `result`에 검사 코드 · 이유만 있다."""

    def __init__(self, result: PublicationResult) -> None:
        super().__init__("publication gate failed")
        self.result = result


class ContentFingerprintMismatchError(NpcPublicationError):
    """재개하려는 파일 묶음의 fingerprint가 등록된(불변) 버전과 다르다."""


class BlockedReapprovalRequiredError(NpcPublicationError):
    """blocked 재개에는 G1 · G2 · G3 최종 approved 기록이 모두 마지막 차단 시각 이후여야 한다."""

    def __init__(self, gate: str) -> None:
        super().__init__(f"{gate} needs approval after the block")
        self.gate = gate


@dataclass(frozen=True)
class PublicationOutcome:
    snapshot: PublicationSnapshot
    gate: PublicationResult
    # 게이트가 검증한 고정 게시본(서버 시작 등록은 별도 작업)
    pinned: PinnedContent | None


@dataclass
class _VersionOrderView:
    """PUB-GATE의 VERSION_ORDER를 DB에 등록된 버전 기준으로 판정하게 하는 store 대역.

    `versions()`는 같은 케이스의 다른 등록 버전, `add()`는 게이트가 검증한 묶음을 받아 둘 뿐이다.
    """

    existing: tuple[int, ...]
    pinned: PinnedContent | None = field(default=None)

    def versions(self, case_id: str) -> tuple[int, ...]:
        return self.existing

    def add(self, content: PinnedContent) -> None:
        self.pinned = content


def _require_reapproval_after(
    records: Iterable[ReviewRecord], fingerprint: str, blocked_at: datetime
) -> None:
    """`gate_decisions()`와 같은 선택(같은 fingerprint · (reviewed_at, review_id) 최신)으로 고른 관문별 최종 기록이
    approved이고 차단 시각보다 뒤인지 본다."""

    items = list(records)
    for gate in GATES:
        current = sorted(
            (r for r in items if r.gate == gate and r.target_hash == fingerprint),
            key=lambda r: r.order_key,
        )
        if (
            not current
            or current[-1].decision != "approved"
            or current[-1].order_key[0] <= blocked_at
        ):
            raise BlockedReapprovalRequiredError(gate)


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

    async def publish_new(
        self,
        bundle: BundleSnapshot,
        *,
        hint_source: HintSource,
        ng_checker: NgChecker | None,
        local_ids: Mapping[str, Iterable[str]] | None,
        reason: str,
        actor: str,
    ) -> PublicationOutcome:
        """최초 게시(없음 → published). 서버가 읽은 파일 묶음과 DB 승인 이력으로 PUB-GATE를 판정한다."""

        return await self._publish(
            bundle,
            mode="new",
            hint_source=hint_source,
            ng_checker=ng_checker,
            local_ids=local_ids,
            reason=reason,
            actor=actor,
        )

    async def resume(
        self,
        bundle: BundleSnapshot,
        *,
        hint_source: HintSource,
        ng_checker: NgChecker | None,
        local_ids: Mapping[str, Iterable[str]] | None,
        reason: str,
        actor: str,
    ) -> PublicationOutcome:
        """재개(suspended · blocked → published). 같은 버전 · 같은 fingerprint를 현재 승인 이력으로 다시 판정한다."""

        return await self._publish(
            bundle,
            mode="resume",
            hint_source=hint_source,
            ng_checker=ng_checker,
            local_ids=local_ids,
            reason=reason,
            actor=actor,
        )

    async def _publish(
        self,
        bundle: BundleSnapshot,
        *,
        mode: Literal["new", "resume"],
        hint_source: HintSource,
        ng_checker: NgChecker | None,
        local_ids: Mapping[str, Iterable[str]] | None,
        reason: str,
        actor: str,
    ) -> PublicationOutcome:
        if not isinstance(bundle, BundleSnapshot):
            raise TypeError("bundle must be a server-read BundleSnapshot")
        reason = _require_text(reason, "reason", MAX_REASON_LENGTH)
        actor = _require_text(actor, "actor", MAX_ACTOR_LENGTH)
        case_id, version = bundle.case_id, bundle.content_version
        files = {
            role: bundle.files.get(role)
            for role in ("client", "server", "npc", "idmap")
        }
        # 서버가 읽은 바이트로 다시 계산한 값만 쓴다(파일 머리 · 외부 값을 믿지 않는다).
        fingerprint = compute_content_fingerprint(**files)
        target = ApprovalTarget(
            target_type="case_content", target_id=case_id, content_version=version
        )

        async def once() -> PublicationOutcome:
            now = self._clock()
            # 1. 승인 대상 잠금 행 + 최신 커밋 승인 이력(승인 append와 같은 잠금)
            async with locked_approval_history(self._sessions, target) as (db, records):
                repository = NpcPublicationRepository(db)
                # 2. 케이스 버전 범위 공유 잠금(VERSION_ORDER 직렬화)
                registered = await repository.lock_case_versions(case_id)
                # 3. 게시 상태 행
                state = await repository.lock_state(case_id, version, mode="update")
                if mode == "new":
                    if state is not None:
                        raise PublicationTransitionError()
                    if registered.get(version, fingerprint) != fingerprint:
                        raise ContentFingerprintConflictError()
                else:
                    if state is None:
                        raise PublicationStateNotFoundError()
                    if state.status not in (PUBLICATION_SUSPENDED, PUBLICATION_BLOCKED):
                        raise PublicationTransitionError()
                    if state.content_fingerprint != fingerprint:
                        raise ContentFingerprintMismatchError()
                view = _VersionOrderView(
                    tuple(sorted(v for v in registered if v != version))
                )
                result = evaluate_publication(
                    **files,
                    hint_source=hint_source,
                    approval_source=snapshot_source(target, records),
                    ng_checker=ng_checker,
                    local_ids=local_ids,
                    store=view,
                )
                if (
                    not result.approved
                    or result.case_id != case_id
                    or result.content_version != version
                ):
                    raise PublicationGateFailedError(result)
                if mode == "resume" and state.status == PUBLICATION_BLOCKED:
                    blocked_at = await repository.last_blocked_at(case_id, version)
                    if blocked_at is None:
                        raise PublicationTransitionError()
                    _require_reapproval_after(records, fingerprint, blocked_at)
                # 4. 버전 등록 · 상태 · 이력(같은 트랜잭션)
                if mode == "new":
                    await repository.register_version(
                        case_id, version, fingerprint, now=now
                    )
                    await repository.insert_state(
                        case_id, version, status=PUBLICATION_PUBLISHED, now=now
                    )
                    revision, from_status = 1, None
                else:
                    revision = await repository.update_state(
                        state, status=PUBLICATION_PUBLISHED, now=now
                    )
                    from_status = state.status
                await repository.append_event(
                    case_id=case_id,
                    content_version=version,
                    from_status=from_status,
                    to_status=PUBLICATION_PUBLISHED,
                    reason=reason,
                    actor=actor,
                    at=now,
                    state_revision=revision,
                )
                final = await repository.lock_state(case_id, version, mode="update")
            # 트랜잭션이 commit된 뒤에만 결과를 돌려준다.
            return PublicationOutcome(final, result, view.pinned)

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
