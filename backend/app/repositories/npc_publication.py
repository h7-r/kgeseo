"""NPC 콘텐츠 게시 상태 Async MySQL Repository.

commit · rollback을 하지 않는다. 트랜잭션 경계는 `app.services.npc_publication`이 정한다.
게시 판정에 쓰는 조회는 잠금 읽기(`FOR SHARE` / `FOR UPDATE`)로 최신 commit 값을 읽는다.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.npc_publication import (
    NpcContentVersion,
    NpcPublicationEvent,
    NpcPublicationState,
)

MYSQL_DUPLICATE_KEY = 1062


class ContentFingerprintConflictError(Exception):
    """같은 case_id · content_version이 다른 fingerprint로 이미 등록되어 있다."""


@dataclass(frozen=True)
class PublicationSnapshot:
    case_id: str
    content_version: int
    content_fingerprint: str
    status: str
    revision: int
    updated_at: datetime


@dataclass(frozen=True)
class PublicationEventRecord:
    case_id: str
    content_version: int
    from_status: str | None
    to_status: str
    reason: str
    actor: str
    at: datetime
    state_revision: int


def _errno(error: IntegrityError) -> int | None:
    args = getattr(error.orig, "args", ())
    return args[0] if args and isinstance(args[0], int) else None


class NpcPublicationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def register_version(
        self, case_id: str, content_version: int, fingerprint: str, *, now: datetime
    ) -> None:
        """불변 버전을 등록한다. 같은 fingerprint면 그대로 두고, 다르면 거부한다."""

        # 버전 행은 불변이라 일반 조회로 찾은 값도 정확하다. 없는 행을 잠그면 gap lock 교착이 생기므로 잠그지 않는다.
        existing = await self._version(case_id, content_version, lock=False)
        if existing is None:
            try:
                async with self.db.begin_nested():
                    self.db.add(
                        NpcContentVersion(
                            case_id=case_id,
                            content_version=content_version,
                            content_fingerprint=fingerprint,
                            registered_at=now,
                        )
                    )
                    await self.db.flush()
                return
            except IntegrityError as error:
                if _errno(error) != MYSQL_DUPLICATE_KEY:
                    raise
            # 동시에 다른 트랜잭션이 등록했다. 잠금 읽기로 commit된 값을 본다.
            existing = await self._version(case_id, content_version, lock=True)
        if existing is None or existing != fingerprint:
            raise ContentFingerprintConflictError()

    async def _version(
        self, case_id: str, content_version: int, *, lock: bool
    ) -> str | None:
        statement = select(NpcContentVersion.content_fingerprint).where(
            NpcContentVersion.case_id == case_id,
            NpcContentVersion.content_version == content_version,
        )
        if lock:
            statement = statement.with_for_update(read=True)
        return (await self.db.execute(statement)).scalar_one_or_none()

    async def lock_state(
        self,
        case_id: str,
        content_version: int,
        *,
        mode: Literal["share", "update"],
    ) -> PublicationSnapshot | None:
        """게시 상태 행을 먼저 잠그고(잠금 순서), 있으면 불변 버전 행의 fingerprint를 잠금 읽기로 읽는다.

        JOIN 한 번에 `FOR ... OF 상태 테이블`로 읽으면 MySQL은 버전 테이블을 snapshot으로 읽는다. 오래된
        snapshot에서는 다른 트랜잭션이 막 commit한 버전 행이 안 보여 상태가 「없음」으로 잘못 나오므로 나눠 읽는다.
        상태 행이 없으면 버전 행을 잠그지 않는다(신규 게시와의 잠금 순서 역전 방지).
        """

        state = (
            await self.db.execute(
                select(NpcPublicationState)
                .where(
                    NpcPublicationState.case_id == case_id,
                    NpcPublicationState.content_version == content_version,
                )
                .with_for_update(read=mode == "share")
            )
        ).scalar_one_or_none()
        if state is None:
            return None
        fingerprint = await self._version(case_id, content_version, lock=True)
        if fingerprint is None:
            return None
        return PublicationSnapshot(
            state.case_id,
            state.content_version,
            fingerprint,
            state.status,
            state.revision,
            state.updated_at,
        )

    async def insert_state(
        self, case_id: str, content_version: int, *, status: str, now: datetime
    ) -> None:
        self.db.add(
            NpcPublicationState(
                case_id=case_id,
                content_version=content_version,
                status=status,
                revision=1,
                updated_at=now,
            )
        )
        await self.db.flush()

    async def update_state(
        self, snapshot: PublicationSnapshot, *, status: str, now: datetime
    ) -> int:
        """잠근 행의 상태를 바꾸고 새 revision을 돌려준다."""

        state = await self.db.get(
            NpcPublicationState, (snapshot.case_id, snapshot.content_version)
        )
        state.status = status
        state.revision = snapshot.revision + 1
        state.updated_at = now
        await self.db.flush()
        return state.revision

    async def append_event(
        self,
        *,
        case_id: str,
        content_version: int,
        from_status: str | None,
        to_status: str,
        reason: str,
        actor: str,
        at: datetime,
        state_revision: int,
    ) -> None:
        self.db.add(
            NpcPublicationEvent(
                event_id=str(uuid4()),
                case_id=case_id,
                content_version=content_version,
                from_status=from_status,
                to_status=to_status,
                reason=reason,
                actor=actor,
                at=at,
                state_revision=state_revision,
            )
        )
        await self.db.flush()

    async def events(
        self, case_id: str, content_version: int
    ) -> tuple[PublicationEventRecord, ...]:
        result = await self.db.execute(
            select(NpcPublicationEvent)
            .where(
                NpcPublicationEvent.case_id == case_id,
                NpcPublicationEvent.content_version == content_version,
            )
            .order_by(NpcPublicationEvent.state_revision)
        )
        return tuple(
            PublicationEventRecord(
                e.case_id,
                e.content_version,
                e.from_status,
                e.to_status,
                e.reason,
                e.actor,
                e.at,
                e.state_revision,
            )
            for e in result.scalars().all()
        )

    async def all_states(self) -> tuple[PublicationSnapshot, ...]:
        """서버 시작 시 복원용. 새 트랜잭션에서 부르면 마지막 commit 값을 읽는다."""

        result = await self.db.execute(
            select(NpcPublicationState, NpcContentVersion.content_fingerprint)
            .join(
                NpcContentVersion,
                (NpcContentVersion.case_id == NpcPublicationState.case_id)
                & (
                    NpcContentVersion.content_version
                    == NpcPublicationState.content_version
                ),
            )
            .order_by(NpcPublicationState.case_id, NpcPublicationState.content_version)
        )
        return tuple(
            PublicationSnapshot(
                s.case_id, s.content_version, fp, s.status, s.revision, s.updated_at
            )
            for s, fp in result.all()
        )
