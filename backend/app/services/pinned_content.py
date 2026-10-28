"""버전 고정 콘텐츠 묶음 v0.1 (팀 검토 대기, 파일 · DB · HTTP · 서비스에 연결하지 않음).

한 케이스의 한 게시 버전(client · server · npc · idmap)을 묶고, 세션이 고정한
`(case_id, content_version, content_fingerprint)`와 정확히 같은 묶음만 돌려준다.

- 최신 버전으로 자동 전환하지 않는다. "최신"을 묻는 길이 없다.
- 한 번 넣은 `(case_id, content_version)`은 다시 넣을 수 없다(덮어쓰기 금지).
- `content_fingerprint`는 불투명한 식별자다. 여기서 계산 · 검증하지 않고 문자열로 비교만 한다
  (공식 정의는 미정).
- 넣을 때와 꺼낼 때 깊은 복사를 해서, 호출하는 쪽이 고쳐도 묶음은 바뀌지 않는다.
- 기존 서비스의 주입식 인터페이스(`runtime_loader` · `client_content_loader` · `hint_source` ·
  `line_source`)에 맞춘 함수를 만들어 준다. 서비스 코드는 바꾸지 않는다.
- NPC 대사의 승인 여부는 PM v0.4.3 승인 이력(`approval_source`)으로만 정한다. 승인 정보가 없으면
  늘 미승인이다(기본 차단). 콘텐츠 안의 `status` · `approvals`는 쓰지 않는다.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from app.models.play_session import check_content_pin_columns
from app.schemas.case_content import CaseClientContent
from app.schemas.npc import ApprovedNpcLine
from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.approval_history import ApprovalSource, gate_decisions


class PinnedContentError(Exception):
    """오류에는 case_id · 버전만 싣는다(콘텐츠 · fingerprint 값은 싣지 않는다)."""


class InvalidContentPinError(PinnedContentError):
    pass


class ContentBundleMismatchError(PinnedContentError):
    """묶음 안 콘텐츠의 case_id · 버전 · fingerprint가 고정 값과 다르다."""


class ContentVersionExistsError(PinnedContentError):
    pass


class ContentVersionNotFoundError(PinnedContentError):
    pass


class ContentFingerprintMismatchError(PinnedContentError):
    pass


class ContentCaseMismatchError(PinnedContentError):
    """묶음에 묶인 로더를 다른 case_id로 불렀다."""


class PinnedContentRequiredError(PinnedContentError):
    """버전이 고정된 세션에 그 버전의 묶음 로더가 아닌 로더(기본 로더 등)를 썼다."""


class LegacySessionLoaderError(PinnedContentError):
    """버전이 없는 레거시 세션에 고정 묶음 로더를 썼다."""


@dataclass(frozen=True)
class ContentPin:
    case_id: str
    content_version: int
    content_fingerprint: str

    def __post_init__(self) -> None:
        if not isinstance(self.case_id, str) or not self.case_id.strip():
            raise InvalidContentPinError("case_id")
        if (
            isinstance(self.content_version, bool)
            or not isinstance(self.content_version, int)
            or self.content_version < 1
        ):
            raise InvalidContentPinError(self.case_id)
        if (
            not isinstance(self.content_fingerprint, str)
            or not self.content_fingerprint.strip()
        ):
            raise InvalidContentPinError(self.case_id)

    def label(self) -> str:
        return f"{self.case_id}@v{self.content_version}"


# (Server Runtime, puzzle_id, level) -> 힌트 원문. 공식 구현은 app.services.hint.server_hint_text
# (server.json `puzzles[].hints[]`)이고, 테스트 등은 다른 resolver를 넘길 수 있다.
HintTextResolver = Callable[[PuzzleRuntimeDefinition, str, int], str | None]


class PinnedContent:
    """한 게시 버전의 콘텐츠 묶음. 만들 때 case_id · 버전 일치를 검사한다."""

    def __init__(
        self,
        pin: ContentPin,
        *,
        client: CaseClientContent,
        server: PuzzleRuntimeDefinition,
        npc: NpcContentPack | None,
        idmap: Mapping[str, Any] | None,
    ) -> None:
        if client.case_id != pin.case_id or server.case_id != pin.case_id:
            raise ContentBundleMismatchError(pin.label())
        if npc is not None and (
            npc.case_id != pin.case_id
            or npc.content_version != pin.content_version
            or npc.content_fingerprint != pin.content_fingerprint
        ):
            raise ContentBundleMismatchError(pin.label())
        if idmap is not None and (
            idmap.get("case_id") != pin.case_id
            or idmap.get("content_version") != pin.content_version
        ):
            raise ContentBundleMismatchError(pin.label())

        self._pin = pin
        self._client = client.model_copy(deep=True)
        self._server = server.model_copy(deep=True)
        self._npc = npc.model_copy(deep=True) if npc is not None else None
        # idmap은 스키마가 아직 없어 JSON으로 고정해 둔다(JSON으로 못 바꾸는 값은 거부).
        self._idmap_json = (
            json.dumps(idmap, sort_keys=True, ensure_ascii=False)
            if idmap is not None
            else None
        )

    @property
    def pin(self) -> ContentPin:
        return self._pin

    def client(self) -> CaseClientContent:
        return self._client.model_copy(deep=True)

    def server(self) -> PuzzleRuntimeDefinition:
        return self._server.model_copy(deep=True)

    def npc(self) -> NpcContentPack | None:
        return self._npc.model_copy(deep=True) if self._npc is not None else None

    def idmap(self) -> dict[str, Any] | None:
        return json.loads(self._idmap_json) if self._idmap_json is not None else None

    # --- 기존 서비스의 주입식 인터페이스 ---

    def _ensure_case(self, case_id: str) -> None:
        if case_id != self._pin.case_id:
            raise ContentCaseMismatchError(self._pin.label())

    def runtime_loader(self) -> Callable[[str], PuzzleRuntimeDefinition]:
        def load(case_id: str) -> PuzzleRuntimeDefinition:
            self._ensure_case(case_id)
            return self.server()

        return self._tag(load)

    def client_content_loader(self) -> Callable[[str], CaseClientContent]:
        def load(case_id: str) -> CaseClientContent:
            self._ensure_case(case_id)
            return self.client()

        return self._tag(load)

    def hint_source(
        self, resolver: HintTextResolver
    ) -> Callable[[str, str, int], str | None]:
        def source(case_id: str, puzzle_id: str, level: int) -> str | None:
            self._ensure_case(case_id)
            return resolver(self.server(), puzzle_id, level)

        return self._tag(source)

    def is_approved(self, approval_source: ApprovalSource | None) -> bool:
        """이 고정 버전이 G1~G3 승인 이력으로 승인됐는가. 승인 정보가 없으면 False(기본 차단)."""

        if approval_source is None:
            return False
        records = approval_source(self._pin.case_id, self._pin.content_version)
        return gate_decisions(records, self._pin.content_fingerprint) == ()

    def line_source(
        self, approval_source: ApprovalSource | None = None
    ) -> Callable[[str, str, str], ApprovedNpcLine | None]:
        """npc.json nudge 공급. 승인은 콘텐츠 안 값이 아니라 `approval_source`(승인 이력)로만 정한다.

        `approval_source`가 없거나 이 버전의 세 관문이 모두 최종 승인이 아니면 늘 미승인이다.
        공개 조건(`reveal_when`)을 함께 넘겨, 서비스가 세션 상태로 판정하게 한다.
        """

        def source(case_id: str, npc_id: str, line_id: str) -> ApprovedNpcLine | None:
            self._ensure_case(case_id)
            pack = self._npc
            if pack is None or npc_id != pack.npc_id:
                return None
            located = [(None, nudge) for nudge in pack.general_nudges] + [
                (entry.puzzle_id, nudge)
                for entry in pack.puzzles
                for nudge in entry.nudges
            ]
            for puzzle_id, nudge in located:
                if nudge.line_id == line_id:
                    return ApprovedNpcLine(
                        line_id=nudge.line_id,
                        kind="nudge",
                        text=nudge.text,
                        # 부를 때마다 이력을 다시 본다(나중에 반려 기록이 붙으면 바로 막힌다).
                        approved=self.is_approved(approval_source),
                        puzzle_id=puzzle_id,
                        reveal_when=nudge.reveal_when,
                    )
            return None

        return self._tag(source)

    def _tag(self, function: Any) -> Any:
        # 이 로더가 어느 고정 버전의 것인지 표시한다(세션과 맞는지 서비스가 확인한다).
        function.content_pin = self._pin
        return function


class PinnedContentStore:
    """메모리 저장소. 고정 값과 정확히 같은 묶음만 돌려준다."""

    def __init__(self) -> None:
        self._bundles: dict[tuple[str, int], PinnedContent] = {}

    def add(self, bundle: PinnedContent) -> None:
        key = (bundle.pin.case_id, bundle.pin.content_version)
        if key in self._bundles:
            # fingerprint가 같아도 다시 넣지 않는다(값을 계산하지 않으므로 내용이 같다고 확신할 수 없다).
            raise ContentVersionExistsError(bundle.pin.label())
        self._bundles[key] = bundle

    def get(self, pin: ContentPin) -> PinnedContent:
        bundle = self._bundles.get((pin.case_id, pin.content_version))
        if bundle is None:
            raise ContentVersionNotFoundError(pin.label())
        if bundle.pin.content_fingerprint != pin.content_fingerprint:
            raise ContentFingerprintMismatchError(pin.label())
        return bundle

    def versions(self, case_id: str) -> tuple[int, ...]:
        return tuple(sorted(v for c, v in self._bundles if c == case_id))


def session_content_pin(play_session: Any) -> ContentPin | None:
    """세션 행의 고정 값. 둘 다 NULL이면 None(레거시), 하나만 있으면 ContentPinColumnsError."""

    version = getattr(play_session, "content_version", None)
    fingerprint = getattr(play_session, "content_fingerprint", None)
    check_content_pin_columns(version, fingerprint)
    if version is None:
        return None
    return ContentPin(play_session.case_id, version, fingerprint)


def resolve_session_content(
    play_session: Any, store: PinnedContentStore
) -> PinnedContent | None:
    """세션이 고정한 묶음을 돌려준다. 레거시 세션은 None. 최신 버전으로 바꾸지 않는다."""

    pin = session_content_pin(play_session)
    return None if pin is None else store.get(pin)


def ensure_loaders_match_session(play_session: Any, *loaders: Any) -> None:
    """고정 세션은 그 버전 묶음의 로더만, 레거시 세션은 고정 묶음이 아닌 로더만 쓴다.

    기본 로더(`load_case_runtime` 등)는 고정 표시가 없으므로 고정 세션에서 거부된다.
    """

    pin = session_content_pin(play_session)
    for loader in loaders:
        loader_pin = getattr(loader, "content_pin", None)
        if pin is None:
            if loader_pin is not None:
                raise LegacySessionLoaderError(loader_pin.label())
        elif loader_pin != pin:
            raise PinnedContentRequiredError(pin.label())
