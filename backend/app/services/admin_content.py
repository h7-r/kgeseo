"""콘텐츠 읽기 전용 목록(관리자 API v0.3 3단계 P3-3, 해랑 11/13 · 세진 11/13 기준).

- 사건 id · 버전 · fingerprint 는 DB 등록값(`npc_content_versions`)을 쓴다. fingerprint 는 재계산하지 않는다.
- 게시 상태 · 이력은 각각 `npc_publication_states` · `npc_publication_events` 에서 읽는다.
- 존 · 오브젝트 · 상호작용 수는 **그 버전의 client 콘텐츠**에서만 센다. 못 불러오면 추측하지 않고 null 이다.
  게시 저장소(`PinnedContentStore`)는 메모리라 운영에서 비어 있을 수 있다 — 그러면 등록 사건의 개수는 null 로 나온다.
- 정답 · 서버 런타임 · NPC 대사 원문은 읽지도 돌려주지도 않는다.
- 레거시 사건(`app/content/cases/<id>.client.json`, 예 `case_001`)은 버전 없이 `legacy` 로 나오고 폴더의 client 파일에서 센다.
"""

from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.npc_publication import (
    NpcContentVersion,
    NpcPublicationEvent,
    NpcPublicationState,
)
from app.schemas.admin_content import (
    ContentCase,
    ContentCaseDetail,
    ContentCounts,
    ContentEvent,
    ContentVersion,
    ContentZone,
)
from app.schemas.case_content import CaseClientContent
from app.services.case_content import load_case_client_content
from app.services.puzzle_runtime import CASE_ID_PATTERN, CASES_DIRECTORY
from app.services.session_content import get_pinned_content_store

EVENT_LIMIT = 20
SOURCE_PUBLISHED = "published"
SOURCE_LEGACY = "legacy"


@dataclass(frozen=True)
class _VersionRow:
    content_version: int
    content_fingerprint: str
    registered_at: object
    status: str | None
    state_updated_at: object | None


def count_content(content: CaseClientContent) -> ContentCounts:
    objects = [obj for zone in content.zones for obj in zone.objects]
    return ContentCounts(
        zones=len(content.zones),
        objects=len(objects),
        interactions=sum(1 for obj in objects if obj.interaction is not None),
    )


def _published_client(case_id: str, version: int) -> CaseClientContent | None:
    """게시 저장소에 그 버전이 올라와 있을 때만 client 콘텐츠. 없으면 None(추측하지 않는다)."""

    try:
        return get_pinned_content_store().get_version(case_id, version).client()
    except Exception:
        return None


def _legacy_client(case_id: str) -> CaseClientContent | None:
    try:
        return load_case_client_content(case_id)
    except Exception:
        return None


def legacy_case_ids() -> list[str]:
    """콘텐츠 폴더의 `*.client.json` 이름. 폴더가 없으면 빈 목록."""

    if not CASES_DIRECTORY.is_dir():
        return []
    found = []
    for path in sorted(CASES_DIRECTORY.glob("*.client.json")):
        case_id = path.name[: -len(".client.json")]
        if CASE_ID_PATTERN.fullmatch(case_id):
            found.append(case_id)
    return found


async def _registered_versions(
    db: AsyncSession, case_id: str | None = None
) -> dict[str, list[_VersionRow]]:
    query = (
        select(NpcContentVersion, NpcPublicationState)
        .outerjoin(
            NpcPublicationState,
            (NpcPublicationState.case_id == NpcContentVersion.case_id)
            & (
                NpcPublicationState.content_version == NpcContentVersion.content_version
            ),
        )
        .order_by(
            NpcContentVersion.case_id.asc(), NpcContentVersion.content_version.desc()
        )
    )
    if case_id is not None:
        query = query.where(NpcContentVersion.case_id == case_id)
    grouped: dict[str, list[_VersionRow]] = {}
    for version, state in (await db.execute(query)).all():
        grouped.setdefault(version.case_id, []).append(
            _VersionRow(
                content_version=version.content_version,
                content_fingerprint=version.content_fingerprint,
                registered_at=version.registered_at,
                status=state.status if state is not None else None,
                state_updated_at=state.updated_at if state is not None else None,
            )
        )
    return grouped


def _versions_out(case_id: str, rows: list[_VersionRow]) -> list[ContentVersion]:
    out = []
    for row in rows:
        client = _published_client(case_id, row.content_version)
        out.append(
            ContentVersion(
                content_version=row.content_version,
                content_fingerprint=row.content_fingerprint,
                publication_status=row.status,
                registered_at=row.registered_at,  # type: ignore[arg-type]
                state_updated_at=row.state_updated_at,  # type: ignore[arg-type]
                counts=count_content(client) if client is not None else None,
            )
        )
    return out


async def list_cases(db: AsyncSession) -> list[ContentCase]:
    registered = await _registered_versions(db)
    cases: list[ContentCase] = []
    for case_id, rows in registered.items():
        versions = _versions_out(case_id, rows)
        cases.append(
            ContentCase(
                case_id=case_id,
                source=SOURCE_PUBLISHED,
                legacy=False,
                versions=versions,
                counts=versions[0].counts if versions else None,
            )
        )
    for case_id in legacy_case_ids():
        if case_id in registered:
            continue
        client = _legacy_client(case_id)
        cases.append(
            ContentCase(
                case_id=case_id,
                source=SOURCE_LEGACY,
                legacy=True,
                versions=[],
                counts=count_content(client) if client is not None else None,
            )
        )
    return cases


def _zones_out(
    content: CaseClientContent | None,
) -> tuple[list[ContentZone], dict[str, int]]:
    if content is None:
        return [], {}
    zones = [
        ContentZone(
            zone_id=zone.zone_id,
            zone_name=zone.zone_name,
            zone_type=zone.zone_type,
            objects=len(zone.objects),
            interactions=sum(1 for obj in zone.objects if obj.interaction is not None),
        )
        for zone in content.zones
    ]
    kinds = Counter(
        obj.interaction.type
        for zone in content.zones
        for obj in zone.objects
        if obj.interaction is not None
    )
    return zones, dict(sorted(kinds.items()))


async def case_detail(db: AsyncSession, case_id: str) -> ContentCaseDetail | None:
    """없는 사건이면 None. 식별자 모양이 아니면 None(404 로 답한다)."""

    if CASE_ID_PATTERN.fullmatch(case_id) is None:
        return None
    registered = (await _registered_versions(db, case_id)).get(case_id, [])
    is_legacy = not registered and case_id in legacy_case_ids()
    if not registered and not is_legacy:
        return None
    versions = _versions_out(case_id, registered)
    client = (
        _legacy_client(case_id)
        if is_legacy
        else (
            _published_client(case_id, registered[0].content_version)
            if registered
            else None
        )
    )
    zones, by_type = _zones_out(client)
    events = (
        await db.execute(
            select(NpcPublicationEvent)
            .where(NpcPublicationEvent.case_id == case_id)
            .order_by(
                NpcPublicationEvent.at.desc(), NpcPublicationEvent.state_revision.desc()
            )
            .limit(EVENT_LIMIT)
        )
    ).scalars()
    return ContentCaseDetail(
        case_id=case_id,
        source=SOURCE_LEGACY if is_legacy else SOURCE_PUBLISHED,
        legacy=is_legacy,
        zones=zones,
        interactions_by_type=by_type,
        counts=count_content(client) if client is not None else None,
        versions=versions,
        events=[
            ContentEvent(
                content_version=event.content_version,
                from_status=event.from_status,
                to_status=event.to_status,
                reason=event.reason,
                actor=event.actor,
                at=event.at,
            )
            for event in events
        ],
    )
