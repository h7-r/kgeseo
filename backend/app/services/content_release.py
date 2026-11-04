"""게시 상태(DB) · 콘텐츠 원본(파일) · 세션 콘텐츠 저장소(메모리) 연결 v0.1 (팀 검토 대기, HTTP 게시 경로 없음).

[무엇이 무엇을 정하는가]
- 게시 판정과 상태: `NpcPublicationService`(DB). G1~G3는 `npc_approval_reviews`의 `case_content` 기록만 쓰고,
  판정 · 버전 등록 · 상태 · 이력은 한 트랜잭션이다. 이 모듈은 그 판정을 다시 하지 않는다.
- 콘텐츠 원본: 게시 루트 `<root>/<case_id>/v<content_version>/{client,server,npc,idmap}.json`
  (`published_content_loader`). 앱은 이 파일을 쓰지 않는다. 등록 fingerprint(`npc_content_versions`, 불변)와
  다시 계산한 값이 같은 파일만 쓴다.
- 세션 콘텐츠: `PinnedContentStore`(메모리). 프로세스마다 비어서 시작하므로 DB 상태와 원본 파일로 다시 채운다.

[신규 세션] `require_published_for_new_session`이 세션 INSERT 트랜잭션 안에서 게시 상태 행을 공유 잠금으로 읽는다.
`published`이고 fingerprint가 같을 때만 허용한다(PM v0.4.6 `accepts_new_sessions`). `suspend()` · `block()`은 같은
행을 `FOR UPDATE`로 잡으므로, 중단과 신규 세션 생성은 둘 중 하나가 먼저 commit된 순서로 직렬화된다.

[진행 중 세션] 이 모듈은 바꾸지 않는다. 고정 세션은 저장소의 고정 묶음을 그대로 쓴다(일반 · 긴급 중단에도 게임 진행 ·
Client Bundle · Hint 유지, PM v0.4.6). 그래서 중단된 버전도 저장소에 다시 채운다.

[두 트랜잭션 사이] 게시 DB commit과 메모리 등록은 따로 일어난다.
- DB commit 전 실패: 메모리에 아무것도 넣지 않는다(게시 · 등록 모두 없음).
- DB commit 뒤 메모리 등록 실패: DB는 게시 상태다. 결과에 `registration_failed`를 돌려주고,
  `sync_published_content()`를 다시 부르면 DB 상태와 원본 파일로 빠진 버전을 채운다(이미 있는 버전은 건드리지 않는다).
- 그 사이 신규 세션은 저장소에 묶음이 없어 `CASE_VERSION_UNAVAILABLE`(409)이다(유령 게시본을 쓰지 않는다).
- 메모리에만 있고 DB 게시 상태가 없는 묶음(예: `ContentPublisher`로만 넣은 것)은 신규 세션 guard가 막는다.
"""

import logging
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.npc_publication import (
    NpcPublicationRepository,
    PublicationSnapshot,
)
from app.services.content_fingerprint import compute_content_fingerprint
from app.services.hint import HintSource
from app.services.npc_publication import (
    NpcPublicationService,
    PublicationOutcome,
    PublicationPolicy,
    PublicationTransitionError,
)
from app.services.pinned_content import (
    ContentPin,
    PinnedContent,
    PinnedContentError,
    PinnedContentStore,
)
from app.services.publication_gate import (
    NgChecker,
    PublishedContentRebuildError,
    rebuild_published_content,
)
from app.services.published_content_loader import (
    BundleFileMissingError,
    BundleSnapshot,
    InvalidBundleLocationError,
    read_bundle_snapshot,
)

logger = logging.getLogger(__name__)

RegistrationStatus = Literal[
    "registered",
    "already_registered",
    "files_missing",
    "invalid_location",
    "rebuild_failed",
    "store_conflict",
    "registration_failed",
]


class ContentNotPublishedError(PinnedContentError):
    """신규 세션을 받는 게시 상태가 아니다(게시 기록 없음 · 중단 · fingerprint 불일치)."""


@dataclass(frozen=True)
class RegistrationEntry:
    case_id: str
    content_version: int
    status: RegistrationStatus
    # DB 게시 상태(published · suspended · blocked). 상태를 읽지 못했으면 None
    publication_status: str | None = None
    # 실패 이유 코드(파일 역할 · 재구성 이유 등). 경로 · 내용 · fingerprint 값은 싣지 않는다.
    reason: str | None = None

    @property
    def available(self) -> bool:
        return self.status in ("registered", "already_registered")


@dataclass(frozen=True)
class ReleaseResult:
    outcome: Literal["published", "already_published"]
    publication: PublicationSnapshot
    registration: RegistrationEntry


# --- 신규 세션 guard ---


async def require_published_for_new_session(db: AsyncSession, pin: ContentPin) -> None:
    """세션 INSERT와 같은 트랜잭션에서 부른다. 게시 상태 행 공유 잠금은 그 트랜잭션이 끝날 때 풀린다."""

    snapshot = await NpcPublicationRepository(db).lock_state(
        pin.case_id, pin.content_version, mode="share"
    )
    if snapshot is None or snapshot.content_fingerprint != pin.content_fingerprint:
        raise ContentNotPublishedError(pin.label())
    try:
        accepts = PublicationPolicy(snapshot.status).accepts_new_sessions
    except ValueError:
        accepts = False
    if not accepts:
        raise ContentNotPublishedError(pin.label())


# --- 메모리 등록 ---


def register_pinned_content(
    store: PinnedContentStore, content: PinnedContent, *, publication_status: str
) -> RegistrationEntry:
    """같은 버전이 이미 있으면 fingerprint가 같을 때만 그대로 둔다(덮어쓰지 않는다)."""

    pin = content.pin

    def entry(status: RegistrationStatus, reason: str | None = None):
        return RegistrationEntry(
            pin.case_id, pin.content_version, status, publication_status, reason
        )

    try:
        with store.publication_lock:
            if pin.content_version in store.versions(pin.case_id):
                existing = store.get_version(pin.case_id, pin.content_version)
                if existing.pin.content_fingerprint == pin.content_fingerprint:
                    return entry("already_registered")
                return entry("store_conflict")
            store.add(content)
    except Exception as error:  # DB는 이미 게시 상태다. 재조정할 수 있게 결과로 알린다.
        return entry("registration_failed", type(error).__name__)
    return entry("registered")


def register_snapshot(
    store: PinnedContentStore,
    snapshot: BundleSnapshot,
    publication: PublicationSnapshot,
) -> RegistrationEntry:
    """원본 바이트를 DB에 등록된 fingerprint로 다시 확인해 저장소에 넣는다."""

    pin = ContentPin(
        publication.case_id,
        publication.content_version,
        publication.content_fingerprint,
    )
    try:
        content = rebuild_published_content(
            client=snapshot.files["client"],
            server=snapshot.files["server"],
            npc=snapshot.files["npc"],
            idmap=snapshot.files["idmap"],
            expected=pin,
        )
    except PublishedContentRebuildError as error:
        return RegistrationEntry(
            pin.case_id,
            pin.content_version,
            "rebuild_failed",
            publication.status,
            str(error),
        )
    return register_pinned_content(
        store, content, publication_status=publication.status
    )


# --- 재시작 복구 · 재조정 ---


async def sync_published_content(
    service: NpcPublicationService, store: PinnedContentStore, root: Path
) -> tuple[RegistrationEntry, ...]:
    """DB에 게시 기록이 있는 모든 버전(published · suspended · blocked)을 원본 파일로 저장소에 채운다.

    여러 번 불러도 된다. 버전마다 따로 판정하며, 실패한 버전은 등록하지 않고(그 버전의 고정 · 신규 세션은 409)
    결과에 이유를 남긴다. DB 상태를 읽지 못하면 예외를 그대로 알린다(아무것도 등록하지 않는다).
    """

    entries = []
    for publication in await service.restorable_versions():
        entries.append(_sync_one(store, root, publication))
    for entry in entries:
        if not entry.available:
            logger.error(
                "published content unavailable: case_id=%s content_version=%s "
                "status=%s reason=%s",
                entry.case_id,
                entry.content_version,
                entry.status,
                entry.reason,
            )
    return tuple(entries)


def _sync_one(
    store: PinnedContentStore, root: Path, publication: PublicationSnapshot
) -> RegistrationEntry:
    case_id, version = publication.case_id, publication.content_version
    try:
        snapshot = read_bundle_snapshot(root, case_id, version)
    except BundleFileMissingError as error:
        return RegistrationEntry(
            case_id, version, "files_missing", publication.status, _role(error)
        )
    except (InvalidBundleLocationError, OSError) as error:
        return RegistrationEntry(
            case_id, version, "invalid_location", publication.status, _role(error)
        )
    return register_snapshot(store, snapshot, publication)


def _role(error: Exception) -> str | None:
    # 로더 오류 메시지는 "<case>@v<n>:<role>" 형식이다. 역할만 남긴다.
    text = str(error)
    return text.rsplit(":", 1)[-1] if ":" in text else None


# --- 게시 + 등록 ---


async def publish_and_register(
    service: NpcPublicationService,
    store: PinnedContentStore,
    root: Path,
    case_id: str,
    content_version: int,
    *,
    reason: str,
    actor: str,
    ng_checker: NgChecker | None,
    local_ids: Mapping[str, Iterable[str]] | None,
    hint_source: HintSource | None = None,
    snapshot: BundleSnapshot | None = None,
) -> ReleaseResult:
    """게시 루트의 원본으로 최초 게시하고(DB), commit 뒤 저장소에 등록한다(메모리).

    - 원본 파일이 없거나 위치가 잘못되면 DB · 메모리 모두 건드리지 않고 오류를 알린다.
    - 게이트 실패 · 승인 부족 · DB 오류는 `NpcPublicationService`의 예외 그대로다(DB rollback, 메모리 등록 없음).
    - 이미 게시 기록이 있는 같은 fingerprint의 버전이면 다시 게시하지 않고 등록만 맞춘다(`already_published`).
    - 등록 실패는 예외가 아니라 `registration.status`로 알린다(DB는 이미 게시 상태 → `sync_published_content`).
    `actor`는 호출하는 관리 절차가 검증한 주체여야 한다(이 함수는 검증하지 않는다).
    `snapshot`을 넘기면 다시 읽지 않는다. 호출자가 그 스냅샷에서 만든 NG 규칙과 검사 대상이 같아야 한다.
    스냅샷의 케이스·버전은 요청과 같아야 하며, 최종 게이트·승인·fingerprint 검증은 그대로 수행한다.
    """

    if snapshot is None:
        snapshot = read_bundle_snapshot(root, case_id, content_version)
    elif snapshot.case_id != case_id or snapshot.content_version != content_version:
        raise InvalidBundleLocationError("snapshot target mismatch")
    try:
        outcome: PublicationOutcome = await service.publish_new(
            snapshot,
            hint_source=hint_source,
            ng_checker=ng_checker,
            local_ids=local_ids,
            reason=reason,
            actor=actor,
        )
    except PublicationTransitionError:
        current = await service.current(case_id, content_version)
        fingerprint = compute_content_fingerprint(
            **{role: snapshot.files[role] for role in ("client", "server", "npc")},
            idmap=snapshot.files["idmap"],
        )
        if current is None or current.content_fingerprint != fingerprint:
            raise
        return ReleaseResult(
            "already_published", current, register_snapshot(store, snapshot, current)
        )

    if outcome.pinned is None:
        registration = register_snapshot(store, snapshot, outcome.snapshot)
    else:
        registration = register_pinned_content(
            store, outcome.pinned, publication_status=outcome.snapshot.status
        )
    return ReleaseResult("published", outcome.snapshot, registration)


async def restore_on_startup(
    root_setting: str,
    sessions: async_sessionmaker[AsyncSession],
    store: PinnedContentStore,
) -> tuple[RegistrationEntry, ...] | None:
    """서버 시작 때 한 번 부른다. 실패해도 서버 시작은 막지 않는다(그 버전들만 쓸 수 없다 — 기본 차단).

    - 게시 루트가 설정되지 않으면 복구하지 않는다(DB도 읽지 않는다). 고정 세션은 모두 409다.
    - DB 상태를 읽지 못하면 아무것도 등록하지 않는다. 나중에 `sync_published_content`로 다시 채울 수 있다.
    """

    if not root_setting.strip():
        logger.info("PUBLISHED_CONTENT_ROOT is not set; published content not restored")
        return None
    try:
        return await sync_published_content(
            NpcPublicationService(sessions), store, Path(root_setting)
        )
    except (SQLAlchemyError, OSError):
        logger.exception("published content restore failed; nothing was registered")
        return None
