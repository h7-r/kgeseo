"""게시 콘텐츠 파일 로더 v0.1 (팀 검토 대기, HTTP · 세션 생성 경로에 연결하지 않음).

`<root>/<case_id>/v<content_version>/{client,server,npc,idmap}.json`을 읽어 기존 게시 게이트
(`evaluate_publication`)에 넘기고, 게이트가 PASS일 때만 `PinnedContentStore`에 등록한다.

- 기존 저장 규칙이 없어 위 구조를 쓴다(제안). `root`에는 기본값이 없다 — 호출하는 게시 절차가 정한다.
- `case_id`(`CASE_ID_PATTERN`) · `content_version`(1 이상 정수)을 정확히 지정해 읽는다. "최신"을 찾지 않는다.
- 해석한 경로가 `root` 밖이면(상대 경로 · 링크 등) 거부한다.
- 파일은 한 번만 읽어 바이트 스냅샷으로 둔다. 게이트 검증과 등록 모두 이 스냅샷만 쓴다 — 검증 뒤 디스크
  파일이 바뀌어도 등록 내용은 바뀌지 않는다.
- I-JSON 검사 · fingerprint · 승인 · 버전 순서(같은 버전 재등록 거부)는 게이트가 한다. 이 모듈은 다시 구현하지 않는다.
- 승인 출처 · NG 검사 · 로컬 ID 목록 · 저장소는 호출하는 쪽이 반드시 넘긴다(기본값 없음, 운영용 승인 출처 없음).
- 이 모듈은 파일을 쓰지 않는다.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from app.services.content_fingerprint import FingerprintError, parse_i_json
from app.services.hint import HintSource
from app.services.pinned_content import PinnedContentStore
from app.services.publication_gate import (
    ApprovalSource,
    NgChecker,
    PublicationResult,
    evaluate_publication,
)
from app.services.puzzle_runtime import CASE_ID_PATTERN

REQUIRED_FILES = ("client", "server", "npc")
OPTIONAL_FILES = ("idmap",)


class PublishedContentLoadError(Exception):
    """오류에는 case_id · 버전 · 파일 역할만 싣는다(경로 · 내용은 싣지 않는다)."""


class InvalidBundleLocationError(PublishedContentLoadError):
    pass


class BundleFileMissingError(PublishedContentLoadError):
    pass


@dataclass(frozen=True)
class BundleSnapshot:
    case_id: str
    content_version: int
    # 역할 → 읽은 바이트(없는 선택 파일은 None). 읽기 전용 매핑이다.
    files: Mapping[str, bytes | None]


@dataclass(frozen=True)
class LoadOutcome:
    snapshot: BundleSnapshot
    # 디렉터리와 파일 머리가 다르면 게이트를 돌리지 않고 이 값만 채운다.
    location_mismatch: str | None
    publication: PublicationResult | None

    @property
    def registered(self) -> bool:
        return self.publication is not None and self.publication.registered


def bundle_directory(root: Path, case_id: str, content_version: int) -> Path:
    if not isinstance(case_id, str) or CASE_ID_PATTERN.fullmatch(case_id) is None:
        raise InvalidBundleLocationError("case_id")
    if (
        isinstance(content_version, bool)
        or not isinstance(content_version, int)
        or content_version < 1
    ):
        raise InvalidBundleLocationError(f"{case_id}:content_version")
    base = root.resolve()
    directory = (base / case_id / f"v{content_version}").resolve()
    if not directory.is_relative_to(base):
        raise InvalidBundleLocationError(f"{case_id}@v{content_version}")
    return directory


def read_bundle_snapshot(
    root: Path, case_id: str, content_version: int
) -> BundleSnapshot:
    directory = bundle_directory(root, case_id, content_version)
    label = f"{case_id}@v{content_version}"
    files: dict[str, bytes | None] = {}
    for role in (*REQUIRED_FILES, *OPTIONAL_FILES):
        path = (directory / f"{role}.json").resolve()
        if not path.is_relative_to(directory):
            raise InvalidBundleLocationError(f"{label}:{role}")
        if not path.is_file():
            if role in REQUIRED_FILES:
                raise BundleFileMissingError(f"{label}:{role}")
            files[role] = None
            continue
        files[role] = path.read_bytes()
    return BundleSnapshot(case_id, content_version, MappingProxyType(files))


def _location_mismatch(snapshot: BundleSnapshot) -> str | None:
    """디렉터리의 case_id · 버전과 server.json 머리가 같은지(다르면 게이트 전에 거부)."""

    try:
        server = parse_i_json(snapshot.files["server"])
    except FingerprintError:
        return None  # 파싱 오류는 게이트의 PARSE 검사가 보고한다
    if not isinstance(server, dict):
        return None
    if server.get("case_id") != snapshot.case_id:
        return "case_id"
    version = server.get("content_version")
    if isinstance(version, bool) or version != snapshot.content_version:
        return "content_version"
    return None


def load_and_publish(
    root: Path,
    case_id: str,
    content_version: int,
    *,
    hint_source: HintSource,
    approval_source: ApprovalSource | None,
    ng_checker: NgChecker | None,
    local_ids: Mapping[str, Iterable[str]] | None,
    store: PinnedContentStore,
) -> LoadOutcome:
    snapshot = read_bundle_snapshot(root, case_id, content_version)
    mismatch = _location_mismatch(snapshot)
    if mismatch is not None:
        return LoadOutcome(snapshot, mismatch, None)
    publication = evaluate_publication(
        client=snapshot.files["client"],
        server=snapshot.files["server"],
        npc=snapshot.files["npc"],
        idmap=snapshot.files["idmap"],
        hint_source=hint_source,
        approval_source=approval_source,
        ng_checker=ng_checker,
        local_ids=local_ids,
        store=store,
    )
    return LoadOutcome(snapshot, None, publication)
