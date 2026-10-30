"""NPC 턴 멱등 응답 저장소 v0.1 (PM v0.4.4 · v0.4.6, 1차 · HTTP 미연결).

키 `(play_session_id, turn_request_id)`. 기존 NPC 턴 API와 `client_event_id` 계약은 바꾸지 않는다.

처리 단계(NPC 계산 중에는 DB 잠금을 잡지 않는다):
1. `claim()` — 짧은 트랜잭션으로 처리 권한(owner_token · lease)을 얻는다. 이미 있는 키면 아래 순서로 판정한다.
   1) 요청 본문 해시가 다름 → `IdempotencyMismatchError`(422 `idempotency_mismatch`). 만료 · 철회된 키도 같다.
   2) 긴급 차단으로 철회되었고 기한도 지남 → `TurnStatusUndecidedError`(PM 미정 · 우선순위를 정하지 않음)
   3) 긴급 차단으로 철회됨 → `TurnWithdrawn`(저장 대사를 돌려주지 않는다. generic 응답은 호출자 몫)
   4) 기한이 지났거나 EXPIRED → `TurnExpiredError`(410 `turn_expired`)
   5) READY → 저장된 최종 응답(`TurnReplay`). 일반 중단 · 승인 철회 뒤에도 저장된 그대로다.
   6) PROCESSING · lease 유효 → `TurnInProgressError`(HTTP 매핑 미정)
   7) PROCESSING · lease 만료 → 권한 회수(새 owner_token)
2. 호출자가 DB 잠금 없이 NPC 응답을 계산한다.
3. `complete()` — 짧은 트랜잭션에서 owner_token · lease · 철회 여부를 다시 확인하고, 최종 응답 본문과 호출자의
   이벤트(`write_event`)를 함께 확정한다. commit이 성공한 뒤에만 저장 응답을 돌려준다.

요청 본문 해시: `hmac-sha256:<key id>:<64 hex>`. 서버 키로 만든 HMAC이라 짧은 플레이어 문장도 사전 대입으로
되돌릴 수 없다. key id를 함께 저장해 키를 교체해도 이전 키로 만든 요청을 검증한다(모르는 key id는 422가 아니라
설정 오류 `RequestHashKeyUnavailableError`).

본문 기한: 최초 응답 발급(READY) 시 `issued_at + 24h`. 권위 있는 세션 종료 시각이 주어지면 `종료 + 24h`로만
줄인다(`complete(session_ended_at=)`, `shorten_for_session_end()`). 재전송으로 늘리지 않는다.
`completed_at`을 세션 종료로 쓰지 않는다. 기한이 지나면 정리 전이라도 410이다.

tombstone: 진행 중 세션에서는 유지한다. 세션 종료 후 24시간이 지나면 `delete_ended_session_records()`로 지우고,
게스트 기록 정리로 세션이 지워지면 FK cascade로 지워진다.

시각은 BE 저장 형식과 같이 timezone 없는 UTC다. 서버 간 시계 차이는 lease 회수 시점(진행성)에만 영향을 주고,
owner_token fencing 때문에 한 키에 확정되는 응답은 하나뿐이다(안전성).
"""

import hashlib
import hmac
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, TypeVar
from uuid import UUID, uuid4

from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.npc_turn_idempotency import (
    TURN_STATUS_EXPIRED,
    TURN_STATUS_PROCESSING,
    TURN_STATUS_READY,
    NpcTurnRequest,
)
from app.repositories.npc_turn_idempotency import (
    NpcTurnIdempotencyRepository,
    TurnContentRef,
    TurnKey,
    WithdrawalCounts,
)
from app.schemas.npc_turn import NpcTurnResponse
from app.services.content_fingerprint import jcs_canonicalize

REQUEST_HASH_ALGORITHM = "hmac-sha256"
REQUEST_HASH_DOMAIN = b"kgeseo/npc-turn-request/v1"
MIN_HMAC_KEY_BYTES = 32
KEY_ID_PATTERN = re.compile(r"^[a-z0-9]{1,16}$")
RESPONSE_TTL = timedelta(hours=24)
TOMBSTONE_TTL_AFTER_SESSION_END = timedelta(hours=24)
DEFAULT_LEASE = timedelta(seconds=30)
DEFAULT_DEADLOCK_RETRIES = 3

MYSQL_DUPLICATE_KEY = 1062
MYSQL_DEADLOCK = 1213

IDEMPOTENCY_MISMATCH = "idempotency_mismatch"
TURN_EXPIRED = "turn_expired"

EventWriter = Callable[[AsyncSession], Awaitable[None]]
T = TypeVar("T")


class NpcTurnIdempotencyError(Exception):
    """오류에는 키 정보 · 요청 내용을 싣지 않는다."""


class IdempotencyMismatchError(NpcTurnIdempotencyError):
    code = IDEMPOTENCY_MISMATCH


class TurnExpiredError(NpcTurnIdempotencyError):
    code = TURN_EXPIRED


class TurnInProgressError(NpcTurnIdempotencyError):
    """같은 키를 다른 작업자가 유효한 lease로 처리 중이다."""


class TurnLeaseLostError(NpcTurnIdempotencyError):
    """처리 권한(owner_token · lease)을 잃었다. 늦은 저장을 거부한다."""


class TurnWithdrawnError(NpcTurnIdempotencyError):
    """처리 중에 해당 콘텐츠 버전이 긴급 차단되어 확정하지 않는다."""


class TurnStatusUndecidedError(NpcTurnIdempotencyError):
    """긴급 차단과 기한 만료가 겹쳤다. PM 명세에 우선순위가 없어 판정하지 않는다."""


class RequestHashKeyUnavailableError(NpcTurnIdempotencyError):
    """저장된 요청 해시의 key id를 서버가 갖고 있지 않다(설정 오류)."""


class InconsistentTurnStateError(NpcTurnIdempotencyError):
    pass


@dataclass(frozen=True)
class RequestHashKeys:
    """요청 본문 HMAC 키. 새 해시는 `current_id`로 만들고, 검증은 저장된 key id로 한다."""

    current_id: str
    keys: Mapping[str, bytes]

    def __post_init__(self) -> None:
        if self.current_id not in self.keys:
            raise ValueError("current key id must be in keys")
        for key_id, secret in self.keys.items():
            if not KEY_ID_PATTERN.fullmatch(key_id):
                raise ValueError("key id must be 1-16 lowercase letters or digits")
            if not isinstance(secret, bytes) or len(secret) < MIN_HMAC_KEY_BYTES:
                raise ValueError("hmac key must be at least 32 bytes")


@dataclass(frozen=True)
class TurnClaim:
    key: TurnKey
    owner_token: str
    lease_expires_at: datetime
    # lease가 만료된 이전 작업자의 권한을 회수했는가
    reclaimed: bool


@dataclass(frozen=True)
class TurnReplay:
    key: TurnKey
    response: NpcTurnResponse


@dataclass(frozen=True)
class TurnWithdrawn:
    """긴급 차단으로 저장 대사를 돌려주지 않는다(PM v0.4.6: generic + NPC_CONTENT_WITHDRAWN)."""

    key: TurnKey
    content: TurnContentRef


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def turn_key(play_session_id: str, turn_request_id: str) -> TurnKey:
    """두 ID 모두 UUID여야 한다. 소문자 표준형으로 맞춘다."""

    return TurnKey(str(UUID(play_session_id)), str(UUID(turn_request_id)))


def _digest(secret: bytes, key: TurnKey, request: Mapping[str, Any]) -> str:
    message = b"\x00".join(
        (
            REQUEST_HASH_DOMAIN,
            key.play_session_id.encode("ascii"),
            key.turn_request_id.encode("ascii"),
            jcs_canonicalize(dict(request)),
        )
    )
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def request_body_hash(
    keys: RequestHashKeys, key: TurnKey, request: Mapping[str, Any]
) -> str:
    """키 · 세션 · 요청 ID에 묶인 요청 동등성 값. 요청은 RFC 8785로 정규화한다."""

    digest = _digest(keys.keys[keys.current_id], key, request)
    return f"{REQUEST_HASH_ALGORITHM}:{keys.current_id}:{digest}"


def matches_request_body_hash(
    keys: RequestHashKeys, stored: str, key: TurnKey, request: Mapping[str, Any]
) -> bool:
    algorithm, _, rest = stored.partition(":")
    key_id, _, digest = rest.partition(":")
    if algorithm != REQUEST_HASH_ALGORITHM or not digest:
        raise InconsistentTurnStateError("unknown request hash format")
    secret = keys.keys.get(key_id)
    if secret is None:
        raise RequestHashKeyUnavailableError()
    return hmac.compare_digest(digest, _digest(secret, key, request))


def _mysql_errno(error: DBAPIError) -> int | None:
    args = getattr(error.orig, "args", ())
    return args[0] if args and isinstance(args[0], int) else None


def _to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _is_expired(row: NpcTurnRequest, now: datetime) -> bool:
    return row.status == TURN_STATUS_EXPIRED or (
        row.status == TURN_STATUS_READY
        and row.expires_at is not None
        and row.expires_at <= now
    )


class NpcTurnIdempotencyStore:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        *,
        hash_keys: RequestHashKeys,
        lease: timedelta = DEFAULT_LEASE,
        response_ttl: timedelta = RESPONSE_TTL,
        clock: Callable[[], datetime] = utc_now,
        deadlock_retries: int = DEFAULT_DEADLOCK_RETRIES,
    ) -> None:
        if not isinstance(hash_keys, RequestHashKeys):
            raise TypeError("hash_keys must be RequestHashKeys")
        if lease <= timedelta(0) or response_ttl <= timedelta(0):
            raise ValueError("lease and response_ttl must be positive")
        self._sessions = sessions
        self._keys = hash_keys
        self._lease = lease
        self._ttl = response_ttl
        self._clock = clock
        self._retries = deadlock_retries

    # --- 1. 처리 권한 ---

    async def claim(
        self, key: TurnKey, content: TurnContentRef, request: Mapping[str, Any]
    ) -> TurnClaim | TurnReplay | TurnWithdrawn:
        body_hash = request_body_hash(self._keys, key, request)
        return await self._retry_deadlock(
            lambda: self._claim_once(key, content, request, body_hash)
        )

    async def _claim_once(
        self,
        key: TurnKey,
        content: TurnContentRef,
        request: Mapping[str, Any],
        body_hash: str,
    ) -> TurnClaim | TurnReplay | TurnWithdrawn:
        now = self._clock()
        owner = str(uuid4())
        lease_until = now + self._lease
        try:
            async with self._sessions() as db, db.begin():
                await NpcTurnIdempotencyRepository(db).insert_processing(
                    key,
                    content,
                    request_body_hash=body_hash,
                    owner_token=owner,
                    lease_expires_at=lease_until,
                    now=now,
                )
            return TurnClaim(key, owner, lease_until, reclaimed=False)
        except IntegrityError as error:
            if _mysql_errno(error) != MYSQL_DUPLICATE_KEY:
                raise

        async with self._sessions() as db, db.begin():
            repository = NpcTurnIdempotencyRepository(db)
            row = await repository.lock(key)
            if row is None:
                raise InconsistentTurnStateError("request row vanished after duplicate")
            if not matches_request_body_hash(
                self._keys, row.request_body_hash, key, request
            ):
                raise IdempotencyMismatchError()
            expired = _is_expired(row, now)
            if row.withdrawn_at is not None:
                if expired:
                    raise TurnStatusUndecidedError()
                return TurnWithdrawn(
                    key,
                    TurnContentRef(
                        row.case_id, row.content_version, row.content_fingerprint
                    ),
                )
            if expired:
                raise TurnExpiredError()
            if row.status == TURN_STATUS_READY:
                body = await repository.body(key)
                if body is None:
                    raise InconsistentTurnStateError("ready request without body")
                return TurnReplay(key, NpcTurnResponse.model_validate(body))
            if row.status != TURN_STATUS_PROCESSING:
                raise InconsistentTurnStateError("unknown request status")
            if row.lease_expires_at is not None and row.lease_expires_at > now:
                raise TurnInProgressError()
            repository.take_over(row, owner_token=owner, lease_expires_at=lease_until)
        return TurnClaim(key, owner, lease_until, reclaimed=True)

    # --- 3. 최종 응답 확정 ---

    async def complete(
        self,
        claim: TurnClaim,
        response: NpcTurnResponse,
        *,
        write_event: EventWriter | None = None,
        session_ended_at: datetime | None = None,
    ) -> NpcTurnResponse:
        """`write_event`는 같은 트랜잭션에서 실행된다. 교착 재시도 시 새 세션으로 다시 불릴 수 있다."""

        if not isinstance(response, NpcTurnResponse):
            raise TypeError("only the final NpcTurnResponse is stored")
        body = response.model_dump(mode="json")
        ended = _to_utc_naive(session_ended_at) if session_ended_at else None

        async def once() -> NpcTurnResponse:
            now = self._clock()
            async with self._sessions() as db, db.begin():
                repository = NpcTurnIdempotencyRepository(db)
                row = await repository.lock(claim.key)
                if (
                    row is None
                    or row.status != TURN_STATUS_PROCESSING
                    or row.owner_token != claim.owner_token
                    or row.lease_expires_at is None
                    or row.lease_expires_at <= now
                ):
                    raise TurnLeaseLostError()
                if row.withdrawn_at is not None:
                    raise TurnWithdrawnError()
                if write_event is not None:
                    await write_event(db)
                expires_at = now + self._ttl
                if ended is not None:
                    expires_at = min(expires_at, ended + self._ttl)
                await repository.mark_ready(
                    row, response_json=body, issued_at=now, expires_at=expires_at
                )
            # commit이 성공한 뒤에만 저장한 본문을 돌려준다.
            return NpcTurnResponse.model_validate(body)

        return await self._retry_deadlock(once)

    async def release(self, claim: TurnClaim) -> None:
        """계산 실패 시 권한을 바로 놓는다. 같은 요청은 즉시 다시 처리할 수 있다."""

        async def once() -> None:
            now = self._clock()
            async with self._sessions() as db, db.begin():
                row = await NpcTurnIdempotencyRepository(db).lock(claim.key)
                if (
                    row is not None
                    and row.status == TURN_STATUS_PROCESSING
                    and row.owner_token == claim.owner_token
                ):
                    NpcTurnIdempotencyRepository.release(row, now=now)

        await self._retry_deadlock(once)

    # --- 만료 · 철회 · 정리 ---

    async def purge_expired(self, *, limit: int = 500) -> int:
        if limit < 1:
            raise ValueError("limit must be positive")

        async def once() -> int:
            async with self._sessions() as db, db.begin():
                return await NpcTurnIdempotencyRepository(db).purge_due(
                    now=self._clock(), limit=limit
                )

        return await self._retry_deadlock(once)

    async def withdraw_content_version(
        self, case_id: str, content_version: int
    ) -> WithdrawalCounts:
        """긴급 차단용 저장 경계: 해당 버전의 저장 응답 본문을 지우고 tombstone을 남긴다.

        게시 상태 변경 · 차단 판단 · generic 응답 생성은 하지 않는다(작업 D).
        """

        async def once() -> WithdrawalCounts:
            async with self._sessions() as db, db.begin():
                return await NpcTurnIdempotencyRepository(db).withdraw_content_version(
                    case_id, content_version, now=self._clock()
                )

        return await self._retry_deadlock(once)

    async def shorten_for_session_end(
        self, play_session_id: str, ended_at: datetime
    ) -> int:
        """권위 있는 세션 종료 시각이 정해졌을 때 그 세션의 응답 기한을 줄인다(늘리지 않는다)."""

        deadline = _to_utc_naive(ended_at) + self._ttl
        session_id = str(UUID(play_session_id))

        async def once() -> int:
            async with self._sessions() as db, db.begin():
                return await NpcTurnIdempotencyRepository(db).shorten_session_deadline(
                    session_id, deadline=deadline
                )

        return await self._retry_deadlock(once)

    async def delete_ended_session_records(
        self, play_session_id: str, ended_at: datetime
    ) -> int:
        """세션 종료 후 24시간이 지났으면 그 세션의 tombstone · 본문을 지운다. 아직이면 지우지 않고 0."""

        if self._clock() < _to_utc_naive(ended_at) + TOMBSTONE_TTL_AFTER_SESSION_END:
            return 0
        session_id = str(UUID(play_session_id))

        async def once() -> int:
            async with self._sessions() as db, db.begin():
                return await NpcTurnIdempotencyRepository(db).delete_session_records(
                    session_id
                )

        return await self._retry_deadlock(once)

    async def _retry_deadlock(self, operation: Callable[[], Awaitable[T]]) -> T:
        # InnoDB는 교착 시 트랜잭션 전체를 rollback하므로 같은 짧은 트랜잭션을 다시 시도해도 안전하다.
        attempt = 0
        while True:
            try:
                return await operation()
            except DBAPIError as error:
                if _mysql_errno(error) != MYSQL_DEADLOCK or attempt >= self._retries:
                    raise
                attempt += 1
