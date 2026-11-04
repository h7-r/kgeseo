"""NPC 턴 멱등 저장소의 Async MySQL Repository.

commit · rollback을 하지 않는다. 트랜잭션 경계는 서비스(`app.services.npc_turn_idempotency`)가 정한다.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.npc_turn_idempotency import (
    TURN_STATUS_EXPIRED,
    TURN_STATUS_PROCESSING,
    TURN_STATUS_READY,
    NpcTurnRequest,
    NpcTurnResponseBody,
)


@dataclass(frozen=True)
class TurnKey:
    play_session_id: str
    turn_request_id: str


@dataclass(frozen=True)
class TurnContentRef:
    """세션이 고정한 콘텐츠 버전."""

    case_id: str
    content_version: int
    content_fingerprint: str


@dataclass(frozen=True)
class WithdrawalCounts:
    # 본문을 지운 READY 요청 수
    bodies_deleted: int
    # 확정을 막은 PROCESSING 요청 수
    processing_fenced: int


def _where_key(model: type, key: TurnKey) -> tuple:
    return (
        model.play_session_id == key.play_session_id,
        model.turn_request_id == key.turn_request_id,
    )


def _body_key():
    return tuple_(
        NpcTurnResponseBody.play_session_id, NpcTurnResponseBody.turn_request_id
    )


def _request_key():
    return tuple_(NpcTurnRequest.play_session_id, NpcTurnRequest.turn_request_id)


class NpcTurnIdempotencyRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def insert_processing(
        self,
        key: TurnKey,
        content: TurnContentRef,
        *,
        request_body_hash: str,
        owner_token: str,
        lease_expires_at: datetime,
        now: datetime,
    ) -> None:
        """새 키를 PROCESSING으로 넣는다. 이미 있으면 flush가 IntegrityError(1062)를 낸다."""

        self.db.add(
            NpcTurnRequest(
                play_session_id=key.play_session_id,
                turn_request_id=key.turn_request_id,
                request_body_hash=request_body_hash,
                status=TURN_STATUS_PROCESSING,
                case_id=content.case_id,
                content_version=content.content_version,
                content_fingerprint=content.content_fingerprint,
                owner_token=owner_token,
                lease_expires_at=lease_expires_at,
                created_at=now,
            )
        )
        await self.db.flush()

    async def lock(self, key: TurnKey) -> NpcTurnRequest | None:
        result = await self.db.execute(
            select(NpcTurnRequest)
            .where(*_where_key(NpcTurnRequest, key))
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def body(self, key: TurnKey) -> dict | None:
        result = await self.db.execute(
            select(NpcTurnResponseBody.response_json).where(
                *_where_key(NpcTurnResponseBody, key)
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    def take_over(
        row: NpcTurnRequest, *, owner_token: str, lease_expires_at: datetime
    ) -> None:
        row.owner_token = owner_token
        row.lease_expires_at = lease_expires_at

    @staticmethod
    def release(row: NpcTurnRequest, *, now: datetime) -> None:
        # owner_token은 남겨 두어 이전 작업자의 늦은 저장도 lease 만료로 거부된다.
        row.lease_expires_at = now

    @staticmethod
    def mark_withdrawn(row: NpcTurnRequest, *, now: datetime) -> None:
        # 게시 상태 guard가 차단을 확인한 PROCESSING 요청. 본문 없이 철회 표식만 남긴다.
        row.withdrawn_at = now

    async def mark_ready(
        self,
        row: NpcTurnRequest,
        *,
        response_json: dict,
        issued_at: datetime,
        expires_at: datetime,
    ) -> None:
        self.db.add(
            NpcTurnResponseBody(
                play_session_id=row.play_session_id,
                turn_request_id=row.turn_request_id,
                response_json=response_json,
                created_at=issued_at,
            )
        )
        row.status = TURN_STATUS_READY
        row.owner_token = None
        row.lease_expires_at = None
        row.issued_at = issued_at
        row.expires_at = expires_at
        await self.db.flush()

    async def purge_due(self, *, now: datetime, limit: int) -> int:
        """기한이 지난 READY 본문을 지우고 요청 행을 EXPIRED tombstone으로 남긴다."""

        result = await self.db.execute(
            select(NpcTurnRequest.play_session_id, NpcTurnRequest.turn_request_id)
            .where(
                NpcTurnRequest.status == TURN_STATUS_READY,
                NpcTurnRequest.expires_at <= now,
            )
            .order_by(NpcTurnRequest.expires_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        keys = [tuple(row) for row in result.all()]
        if not keys:
            return 0
        await self.db.execute(delete(NpcTurnResponseBody).where(_body_key().in_(keys)))
        await self.db.execute(
            update(NpcTurnRequest)
            .where(_request_key().in_(keys))
            .values(status=TURN_STATUS_EXPIRED, purged_at=now)
        )
        return len(keys)

    async def withdraw_content_version(
        self, case_id: str, content_version: int, *, now: datetime
    ) -> WithdrawalCounts:
        """해당 버전의 저장 응답 본문을 지우고 tombstone에 철회 표식을 남긴다.

        READY는 본문을 지운다. PROCESSING은 표식만 남겨 이후 확정을 막는다. EXPIRED는 이미 본문이 없어 그대로 둔다.
        긴급 차단 경로는 게시 상태 행을 배타 잠금으로 바꾼 같은 트랜잭션에서 이 메서드를 부른다(잠금 순서 계약).
        """

        result = await self.db.execute(
            select(
                NpcTurnRequest.play_session_id,
                NpcTurnRequest.turn_request_id,
                NpcTurnRequest.status,
            )
            .where(
                NpcTurnRequest.case_id == case_id,
                NpcTurnRequest.content_version == content_version,
                NpcTurnRequest.status.in_((TURN_STATUS_PROCESSING, TURN_STATUS_READY)),
                NpcTurnRequest.withdrawn_at.is_(None),
            )
            .with_for_update()
        )
        rows = result.all()
        ready = [(r[0], r[1]) for r in rows if r[2] == TURN_STATUS_READY]
        processing = [(r[0], r[1]) for r in rows if r[2] == TURN_STATUS_PROCESSING]
        if ready:
            await self.db.execute(
                delete(NpcTurnResponseBody).where(_body_key().in_(ready))
            )
        if rows:
            await self.db.execute(
                update(NpcTurnRequest)
                .where(_request_key().in_([(r[0], r[1]) for r in rows]))
                .values(withdrawn_at=now)
            )
        return WithdrawalCounts(len(ready), len(processing))

    async def shorten_session_deadline(
        self, play_session_id: str, *, deadline: datetime
    ) -> int:
        """세션의 READY 응답 기한을 `deadline` 이하로만 줄인다. 늘리지 않는다."""

        result = await self.db.execute(
            update(NpcTurnRequest)
            .where(
                NpcTurnRequest.play_session_id == play_session_id,
                NpcTurnRequest.status == TURN_STATUS_READY,
                NpcTurnRequest.expires_at > deadline,
            )
            .values(expires_at=deadline)
        )
        return result.rowcount

    async def delete_session_records(self, play_session_id: str) -> int:
        """세션의 본문과 요청 행(tombstone)을 모두 지운다."""

        await self.db.execute(
            delete(NpcTurnResponseBody).where(
                NpcTurnResponseBody.play_session_id == play_session_id
            )
        )
        result = await self.db.execute(
            delete(NpcTurnRequest).where(
                NpcTurnRequest.play_session_id == play_session_id
            )
        )
        return result.rowcount

    async def count_request_hash_key(self, prefix: str) -> int:
        """`hmac-sha256:<key id>:` 접두사를 쓰는 요청 행 수(키 폐기 가능 여부 확인용, 운영 조회)."""

        result = await self.db.execute(
            select(func.count())
            .select_from(NpcTurnRequest)
            .where(NpcTurnRequest.request_body_hash.startswith(prefix, autoescape=True))
        )
        return result.scalar_one()
