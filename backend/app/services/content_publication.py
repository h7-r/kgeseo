"""콘텐츠 게시 경로 v0.1 (팀 검토 대기, HTTP 경로 · 자동 실행 없음).

게시 전용 입력(한 버전의 client · server · npc · idmap? 원본 바이트)을 게시 게이트
(`app.services.publication_gate.evaluate_publication`)로 판정하고, 통과한 묶음만 세션이 쓰는 저장소
(`app.services.session_content.get_pinned_content_store()`)에 등록한다.

[입력과 로딩 경로 분리]
- 게시 입력은 이 모듈만 읽는다. 플레이 세션은 게시 입력 파일을 읽지 않는다.
  고정 세션은 저장소의 묶음만, 레거시 세션(`case_001` 등)은 기존처럼 `app/content/cases`만 읽는다.
- 레거시 콘텐츠 디렉터리(`app/content/cases`)는 게시 입력으로 받지 않는다(개발용 콘텐츠를 게시본으로 섞지 않는다).

[승인] 승인은 호출하는 쪽이 넘기는 `approval_source`(승인 이력 저장소)로만 정한다. 넘기지 않으면 게이트가
APPROVALS FAIL로 막는다. 이 모듈은 승인 기록을 만들지 않는다. 영속 승인 이력(`content_reviews`)으로 게시할
때는 `publish_with_stored_approvals`를 쓴다. NG 판정기 · 나주 로컬 ID 목록도 같다
(없으면 UNVERIFIED로 막힌다).

[버전 정책] 같은 `(case_id, content_version)`은 한 번만 등록한다(덮어쓰기 · 최신 자동 전환 없음).
- `published`: 게이트를 모두 통과해 새로 등록했다.
- `already_published`: 같은 버전이 이미 있고 다시 계산한 fingerprint도 같다. 아무것도 바꾸지 않는다.
- `version_conflict`: 같은 버전이 이미 있는데 fingerprint가 다르다. 등록된 묶음은 그대로다.
- `rejected`: 그 밖의 게이트 FAIL · UNVERIFIED(더 낮은 버전 포함). 등록하지 않는다.

[동시성 · 부분 등록] 게이트 판정부터 등록까지 저장소의 `publication_lock` 안에서 한 번에 하나씩 한다.
게이트는 모든 검사가 끝난 뒤 묶음을 다 만든 다음 저장소에 한 번만 넣으므로, 도중에 실패하면 아무것도 남지 않는다.

[결과] 게이트 결과처럼 검사 코드 · 이유 코드 · ID만 담는다. 콘텐츠 원문 · 정답 · 승인 기록 · fingerprint 값은 없다.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.approval_history import ApprovalSource
from app.services.approval_store import load_approval_source
from app.services.content_fingerprint import (
    FingerprintError,
    compute_content_fingerprint,
    parse_i_json,
)
from app.services.hint import HintSource
from app.services.pinned_content import PinnedContentStore
from app.services.publication_gate import (
    GateCheck,
    NgChecker,
    evaluate_publication,
)
from app.services.puzzle_runtime import CASES_DIRECTORY

# 게시 입력 디렉터리 안의 파일 이름. idmap은 없어도 된다(나주가 아닌 케이스).
PUBLICATION_FILES = {
    "client": "client.json",
    "server": "server.json",
    "npc": "npc.json",
    "idmap": "idmap.json",
}

PublishOutcome = Literal[
    "published", "already_published", "version_conflict", "rejected"
]


class PublicationInputError(Exception):
    """게시 입력을 읽을 수 없다. 오류에는 파일 역할 이름만 싣는다."""


@dataclass(frozen=True)
class PublicationBundle:
    """게시 전용 입력. fingerprint가 원본 바이트로 정해지므로 바이트 그대로 받는다."""

    client: bytes
    server: bytes
    npc: bytes
    idmap: bytes | None = None


@dataclass(frozen=True)
class PublishReport:
    outcome: PublishOutcome
    case_id: str | None
    content_version: int | None
    checks: tuple[GateCheck, ...] = ()

    @property
    def registered(self) -> bool:
        return self.outcome == "published"


def read_publication_bundle(directory: Path) -> PublicationBundle:
    directory = directory.resolve()
    cases_directory = CASES_DIRECTORY.resolve()
    if directory == cases_directory or cases_directory in directory.parents:
        raise PublicationInputError("legacy content directory")

    contents: dict[str, bytes | None] = {}
    for role, file_name in PUBLICATION_FILES.items():
        path = directory / file_name
        if role == "idmap" and not path.exists():
            contents[role] = None
            continue
        try:
            contents[role] = path.read_bytes()
        except OSError as error:
            raise PublicationInputError(role) from error
    return PublicationBundle(**contents)


class ContentPublisher:
    def __init__(
        self,
        store: PinnedContentStore,
        *,
        approval_source: ApprovalSource | None = None,
        ng_checker: NgChecker | None = None,
        local_ids: Mapping[str, Iterable[str]] | None = None,
        hint_source: HintSource | None = None,
    ) -> None:
        self._store = store
        self._approval_source = approval_source
        self._ng_checker = ng_checker
        self._local_ids = local_ids
        # 없으면 게이트가 게시하려는 server.json의 힌트 원문으로 검사한다.
        self._hint_source = hint_source

    def publish(self, bundle: PublicationBundle) -> PublishReport:
        with self._store.publication_lock:
            result = evaluate_publication(
                client=bundle.client,
                server=bundle.server,
                npc=bundle.npc,
                idmap=bundle.idmap,
                hint_source=self._hint_source,
                approval_source=self._approval_source,
                ng_checker=self._ng_checker,
                local_ids=self._local_ids,
                store=self._store,
            )
            if result.registered:
                outcome: PublishOutcome = "published"
            else:
                outcome = self._existing_version_outcome(
                    bundle, result.case_id, result.content_version
                )
        return PublishReport(
            outcome, result.case_id, result.content_version, result.checks
        )

    def _existing_version_outcome(
        self, bundle: PublicationBundle, case_id: str | None, version: int | None
    ) -> PublishOutcome:
        if case_id is None or version not in self._store.versions(case_id):
            return "rejected"
        # 파일 머리의 값이 아니라 다시 계산한 값으로 비교한다(게이트가 파싱을 통과시킨 입력이다).
        fingerprint = compute_content_fingerprint(
            client=bundle.client,
            server=bundle.server,
            npc=bundle.npc,
            idmap=bundle.idmap,
        )
        existing = self._store.get_version(case_id, version)
        if existing.pin.content_fingerprint == fingerprint:
            return "already_published"
        return "version_conflict"


async def publish_with_stored_approvals(
    db: AsyncSession,
    store: PinnedContentStore,
    bundle: PublicationBundle,
    *,
    ng_checker: NgChecker | None = None,
    local_ids: Mapping[str, Iterable[str]] | None = None,
    hint_source: HintSource | None = None,
) -> PublishReport:
    """영속 승인 이력으로 게시한다. 승인 기록은 server.json 머리의 (case_id, content_version)으로 읽는다.

    기록을 읽을 때 잡은 공유 잠금은 게시 판정 · 등록이 끝난 뒤 트랜잭션을 끝내며 푼다(그 사이 철회 기록이
    끼어들지 않는다). 머리를 읽을 수 없으면 승인 출처 없이 판정한다(게이트가 PARSE · HEADER에서 막는다).
    """

    key = _server_header_key(bundle.server)
    try:
        approval_source = (
            await load_approval_source(db, *key) if key is not None else None
        )
        return ContentPublisher(
            store,
            approval_source=approval_source,
            ng_checker=ng_checker,
            local_ids=local_ids,
            hint_source=hint_source,
        ).publish(bundle)
    finally:
        await db.rollback()


def _server_header_key(server: bytes) -> tuple[str, int] | None:
    try:
        document = parse_i_json(server)
    except FingerprintError:
        return None
    if not isinstance(document, dict):
        return None
    case_id = document.get("case_id")
    version = document.get("content_version")
    if (
        not isinstance(case_id, str)
        or isinstance(version, bool)
        or not isinstance(version, int)
    ):
        return None
    return case_id, version
