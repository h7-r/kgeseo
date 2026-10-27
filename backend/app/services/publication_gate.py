"""콘텐츠 게시 승인 게이트 v0.1 (팀 검토 대기, 파일 로더 · HTTP 게시 경로에 연결하지 않음).

기존 검증기(공식 fingerprint · Client/Server 교차 검증 · NPC 콘텐츠 · idmap)를 조합해 한 게시 묶음
(client · server · npc · idmap?)을 판정하고, 모두 통과할 때만 `PinnedContentStore`에 등록한다.

[승인 기록의 신뢰 경계]
- 콘텐츠 JSON 안의 `status` · `approvals` · `target_hash`는 승인 판정에 쓰지 않는다(파일은 누구나 고칠 수 있다).
- 승인은 호출하는 쪽이 넘기는 `approval_source(case_id, content_version)`의 기록만 본다. 이 함수는
  검증된 게시 절차(승인 기록 저장소)에서 와야 한다. 그 저장 매체가 아직 없으므로 `approval_source`가
  없으면 승인 검사는 FAIL이다(기본 거부).
- G1 · G2 · G3 각각 `target_hash`가 **지금 다시 계산한** content_fingerprint와 같은 `approved` 기록이 있어야
  하고, 같은 해시에 `rejected` 기록이 있으면 실패다. 다른 해시를 가리키는 기록(이전 내용 승인)은 무시한다
  — 내용이 바뀌면 재승인이 필요하다(PM v0.4.1).

[장면] 장면 완료(`clear_when`) 검증 엔진이 아직 없다. Server Runtime에 `scenes`가 있거나, 장면 완료가 필수인
케이스(`SCENE_REQUIRED_CASES` 또는 idmap에 장면 대응이 있는 케이스)는 SCENES가 UNVERIFIED라 게시되지 않는다.
장면이 없는 케이스만 NOT_APPLICABLE이다.

[실행 가능] idmap에서 `status="placed"`이고, 물건은 상호작용이 있고 · 퍼즐 · 단서는 로컬 호스트가 있으며,
나주 로컬 ID 목록이 주어지면 그 목록에 실제로 있을 때만 실행 가능이다(PM v0.4.1).

[판정] 각 검사는 PASS · FAIL · NOT_APPLICABLE(검사 대상이 없음) · UNVERIFIED(검증 수단이 없음)이다.
FAIL이나 UNVERIFIED가 하나라도 있으면 승인하지 않고 등록하지 않는다.
결과에는 검사 코드 · 이유 코드 · ID만 담고 콘텐츠 원문 · 정답 · fingerprint 값은 담지 않는다.
"""

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from pydantic import ValidationError

from app.schemas.case_content import CaseClientContent
from app.schemas.naju_idmap import NajuIdmap
from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.case_content_validation import (
    CaseContentLinkValidationError,
    validate_case_content_links,
)
from app.services.content_fingerprint import (
    EXCLUDED_HEADER_FIELDS,
    FingerprintError,
    compute_content_fingerprint,
    header_mismatches,
    parse_i_json,
)
from app.services.hint import HintSource
from app.services.idmap_validation import validate_idmap
from app.services.npc_content_validation import (
    _leaf_conditions,
    _located_nudges,
    assess_npc_content,
)
from app.services.pinned_content import ContentPin, PinnedContent, PinnedContentStore
from app.services.puzzle_runtime import normalize_answer

GATES = ("G1", "G2", "G3")
# 장면 완료 판정이 필수인 케이스(PM v0.4 §12: 나주 씬 완료는 BE clear_when으로 판정)
SCENE_REQUIRED_CASES = frozenset({"naju-angam-01"})
# idmap에서 실행 가능한 상태(PM v0.4.1). 그 밖(unplaced · placed_no_interaction · 상태 없음)은 실행 불가.
EXECUTABLE_STATUS = "placed"
# Client · Server 스키마는 파일 머리를 모르므로 스키마 검증 전에 뗀다(fingerprint 계산과는 별개).
_SCHEMA_HEADER_FIELDS = EXCLUDED_HEADER_FIELDS | {"content_version"}
# 같은 이유로 NPC · idmap 스키마가 모르는 머리
_NPC_EXTRA_HEADERS = frozenset({"generated_at", "published_at"})
_IDMAP_EXTRA_HEADERS = frozenset({"approvals", "generated_at", "published_at"})
# 이보다 짧은 정답은 일반 글자와 구별할 수 없어 누출 검사에서 뺀다(NPC 서비스와 같은 기준).
MIN_ANSWER_LENGTH = 2

CheckStatus = Literal["PASS", "FAIL", "NOT_APPLICABLE", "UNVERIFIED"]
CheckCode = Literal[
    "PARSE",
    "FINGERPRINT",
    "HEADER",
    "VERSION_ORDER",
    "CLIENT_SERVER",
    "NPC",
    "IDMAP",
    "EXECUTABLE_REFS",
    "SCENES",
    "LEAK_CLIENT",
    "NG",
    "LOCAL_IDS",
    "APPROVALS",
]


@dataclass(frozen=True)
class ApprovalRecord:
    """검증된 게시 절차가 넘기는 승인 기록 한 건."""

    gate: Literal["G1", "G2", "G3"]
    decision: Literal["approved", "rejected"]
    target_hash: str
    approver: str
    decided_at: datetime


ApprovalSource = Callable[[str, int], Sequence[ApprovalRecord]]
# 문장이 NG(금지 왜곡) · U(해석 유보 단정)에 걸리면 True. 판정 기준이 아직 없어 주입식이다.
NgChecker = Callable[[str], bool]


@dataclass(frozen=True)
class GateCheck:
    code: CheckCode
    status: CheckStatus
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class PublicationResult:
    approved: bool
    registered: bool
    case_id: str | None
    content_version: int | None
    checks: tuple[GateCheck, ...] = field(default_factory=tuple)

    def check(self, code: CheckCode) -> GateCheck:
        return next(item for item in self.checks if item.code == code)


def evaluate_publication(
    *,
    client: bytes,
    server: bytes,
    npc: bytes,
    idmap: bytes | None,
    hint_source: HintSource,
    approval_source: ApprovalSource | None = None,
    ng_checker: NgChecker | None = None,
    local_ids: Mapping[str, Iterable[str]] | None = None,
    store: PinnedContentStore | None = None,
) -> PublicationResult:
    checks: list[GateCheck] = []

    def add(code: CheckCode, status: CheckStatus, *reasons: str) -> None:
        checks.append(GateCheck(code, status, tuple(reasons)))

    def finish(
        case_id: str | None = None, version: int | None = None
    ) -> PublicationResult:
        return PublicationResult(False, False, case_id, version, tuple(checks))

    # 1. I-JSON 파싱
    raw_parts = {"client": client, "server": server, "npc": npc}
    if idmap is not None:
        raw_parts["idmap"] = idmap
    documents: dict[str, Any] = {}
    for role, content in raw_parts.items():
        try:
            documents[role] = parse_i_json(content)
        except FingerprintError as error:
            add("PARSE", "FAIL", f"{role}:{error}")
            return finish()
        if not isinstance(documents[role], dict):
            add("PARSE", "FAIL", f"{role}:top level must be an object")
            return finish()
    add("PARSE", "PASS")

    # 2. 공식 fingerprint 재계산(v0.4.1)
    fingerprint = compute_content_fingerprint(
        client=client, server=server, npc=npc, idmap=idmap
    )
    add("FINGERPRINT", "PASS")

    # 3. 파일 머리 일치(case_id · content_version · content_fingerprint = 다시 계산한 값)
    case_id = documents["server"].get("case_id")
    version = documents["server"].get("content_version")
    if (
        not isinstance(case_id, str)
        or not case_id.strip()
        or isinstance(version, bool)
        or not isinstance(version, int)
        or version < 1
    ):
        add("HEADER", "FAIL", "server:case_id/content_version")
        return finish()
    mismatches = header_mismatches(
        documents, case_id=case_id, content_version=version, fingerprint=fingerprint
    )
    if mismatches:
        add("HEADER", "FAIL", *(f"{role}:{name}" for role, name in mismatches))
        return finish(case_id, version)
    add("HEADER", "PASS")

    # 4. 버전 순서(PUB-VER: 이전 게시본보다 커야 한다)
    if store is None:
        add("VERSION_ORDER", "UNVERIFIED", "no store")
    else:
        existing = store.versions(case_id)
        if existing and version <= max(existing):
            add("VERSION_ORDER", "FAIL", f"not greater than v{max(existing)}")
        else:
            add("VERSION_ORDER", "PASS")

    # 5. Client · Server 스키마 · 교차 참조
    # `scenes`는 현재 Server Runtime 스키마에 없다. 있으면 떼고 검증하되 SCENES를 UNVERIFIED로 둔다(아래 7-1).
    declares_scenes = "scenes" in documents["server"]
    try:
        client_model = CaseClientContent.model_validate(
            _without(documents["client"], _SCHEMA_HEADER_FIELDS)
        )
        server_model = PuzzleRuntimeDefinition.model_validate(
            _without(documents["server"], _SCHEMA_HEADER_FIELDS | {"scenes"})
        )
        validate_case_content_links(client_model, server_model)
    except ValidationError as error:
        add("CLIENT_SERVER", "FAIL", *_validation_reasons(error))
        return finish(case_id, version)
    except CaseContentLinkValidationError:
        add("CLIENT_SERVER", "FAIL", "links")
        return finish(case_id, version)
    add("CLIENT_SERVER", "PASS")

    # 6. NPC 콘텐츠(스키마 · 힌트 단계 참조 · 교차 참조 · 정답/원문 보호). 승인 판정은 여기서 하지 않는다.
    npc_body = _without(documents["npc"], _NPC_EXTRA_HEADERS)
    npc_readiness = assess_npc_content(npc_body, server_model, hint_source=hint_source)
    npc_failures = [
        f"{issue.code}:{issue.reference or issue.location}"
        for issue in npc_readiness.issues
        if issue.code != "APPROVAL_UNVERIFIED"
    ]
    if not npc_readiness.schema_valid or not npc_readiness.links_valid:
        add("NPC", "FAIL", *npc_failures)
        return finish(case_id, version)
    add("NPC", "PASS")
    npc_model = NpcContentPack.model_validate(npc_body)

    # 7. idmap(내부 참조 · Server/Client 교차) · 실행 불가 항목 참조 · 로컬 ID
    idmap_model: NajuIdmap | None = None
    if idmap is None:
        add("IDMAP", "NOT_APPLICABLE")
        add("EXECUTABLE_REFS", "NOT_APPLICABLE")
        add("LOCAL_IDS", "NOT_APPLICABLE")
    else:
        idmap_body = _without(documents["idmap"], _IDMAP_EXTRA_HEADERS)
        report = validate_idmap(
            idmap_body, client=client_model, server=server_model, local_ids=local_ids
        )
        errors = [
            f"{issue.code}:{issue.reference}"
            for issue in report.issues
            if issue.severity == "error" and issue.code != "LOCAL_ID_NOT_IN_GAME"
        ]
        if not report.schema_valid or not report.internal_valid or errors:
            add("IDMAP", "FAIL", *(errors or ["schema"]))
            return finish(case_id, version)
        add("IDMAP", "PASS")
        idmap_model = NajuIdmap.model_validate(idmap_body)
        game_objects = (
            set(local_ids.get("objects", ())) if local_ids is not None else None
        )
        refs = _non_executable_references(
            idmap_model, client_model, server_model, npc_model, game_objects
        )
        add("EXECUTABLE_REFS", "FAIL" if refs else "PASS", *refs)
        if local_ids is None:
            add("LOCAL_IDS", "UNVERIFIED", "no local id list")
        else:
            missing = [
                f"LOCAL_ID_NOT_IN_GAME:{issue.reference}"
                for issue in report.issues
                if issue.code == "LOCAL_ID_NOT_IN_GAME"
            ]
            add("LOCAL_IDS", "FAIL" if missing else "PASS", *missing)

    # 7-1. 장면 완료(clear_when) — 판정 엔진이 없어 있으면 검증할 수 없다
    scene_required = case_id in SCENE_REQUIRED_CASES or bool(
        idmap_model and idmap_model.scenes
    )
    if declares_scenes:
        add("SCENES", "UNVERIFIED", "clear_when not verifiable")
    elif scene_required:
        add("SCENES", "UNVERIFIED", "scene completion required but no clear_when")
    else:
        add("SCENES", "NOT_APPLICABLE")

    # 8. Client 공개 파일 누출(PUB-LEAK): 정답 · 정식 힌트 원문
    leaks = _client_leaks(documents["client"], case_id, server_model, hint_source)
    add("LEAK_CLIENT", "FAIL" if leaks else "PASS", *leaks)

    # 9. NG · U(PUB-NG): 판정 기준이 주입되지 않으면 미검증
    if ng_checker is None:
        add("NG", "UNVERIFIED", "no NG checker")
    else:
        flagged = [
            nudge.line_id
            for _, nudge in _located_nudges(npc_model)
            if ng_checker(nudge.text)
        ]
        add("NG", "FAIL" if flagged else "PASS", *flagged)

    # 10. 승인(신뢰할 수 있는 승인 기록만)
    approval = _approval_check(approval_source, case_id, version, fingerprint)
    checks.append(approval)

    approved = all(item.status in ("PASS", "NOT_APPLICABLE") for item in checks)
    registered = False
    if approved and store is not None:
        store.add(
            PinnedContent(
                ContentPin(case_id, version, fingerprint),
                client=client_model,
                server=server_model,
                npc=NpcContentPack.model_validate(npc_body),
                idmap=documents.get("idmap"),
            )
        )
        registered = True
    return PublicationResult(approved, registered, case_id, version, tuple(checks))


def _without(document: Mapping[str, Any], fields: Iterable[str]) -> dict[str, Any]:
    excluded = frozenset(fields)
    return {key: value for key, value in document.items() if key not in excluded}


def _validation_reasons(error: ValidationError) -> list[str]:
    return [
        ".".join(str(part) for part in item["loc"]) + ":" + item["type"]
        for item in error.errors(include_input=False, include_url=False)
    ]


def _approval_check(
    source: ApprovalSource | None, case_id: str, version: int, fingerprint: str
) -> GateCheck:
    if source is None:
        return GateCheck("APPROVALS", "FAIL", ("no trusted approval source",))
    records = list(source(case_id, version))
    reasons: list[str] = []
    for gate in GATES:
        current = [
            r for r in records if r.gate == gate and r.target_hash == fingerprint
        ]
        decisions = {r.decision for r in current}
        # 같은 fingerprint에 승인 · 반려가 함께 있으면 어느 쪽이 최종인지 추측하지 않고 거부한다.
        if decisions == {"approved", "rejected"}:
            reasons.append(f"{gate}:conflicting decisions")
        elif "rejected" in decisions:
            reasons.append(f"{gate}:rejected")
        elif not any(r.decision == "approved" for r in current):
            stale = any(r.gate == gate for r in records)
            reasons.append(f"{gate}:{'stale target_hash' if stale else 'missing'}")
    return GateCheck("APPROVALS", "FAIL" if reasons else "PASS", tuple(reasons))


def _non_executable_references(
    idmap: NajuIdmap,
    client: CaseClientContent,
    server: PuzzleRuntimeDefinition,
    npc: NpcContentPack,
    game_objects: set[str] | None,
) -> list[str]:
    """실행 불가 항목을 Interaction 대상 · reveal_when이 참조하는지(PUB-REF)."""

    placed_objects = {
        (o.zone_id, o.object_id)
        for o in idmap.objects
        if o.status == EXECUTABLE_STATUS
        and o.interaction is not None
        and (game_objects is None or o.local in game_objects)
    }
    puzzle_status = {
        p.puzzle_id: p.status if p.local is not None else "no_local_host"
        for p in idmap.puzzles
    }
    clue_status = {
        c.clue_id: c.status if c.local is not None else "no_local_host"
        for c in idmap.clues
    }
    defined_puzzles = {p.puzzle_id for p in server.puzzles}
    reasons: list[str] = []

    for zone in client.zones:
        for obj in zone.objects:
            # 차단물 · 상태 없는 대응도 placed가 아니므로 실행 불가로 본다(PM 확인 필요).
            if (zone.zone_id, obj.object_id) not in placed_objects:
                reasons.append(f"interaction_object:{obj.object_id}")
            target = obj.interaction.target_id
            if (
                obj.interaction.type == "input"
                and puzzle_status.get(target) != EXECUTABLE_STATUS
            ):
                reasons.append(f"interaction_puzzle:{target}")

    for _, nudge in _located_nudges(npc):
        for kind, value in _leaf_conditions(nudge.reveal_when):
            if kind in ("puzzle_completed", "hint_level"):
                puzzle_id = value if kind == "puzzle_completed" else value["puzzle"]
                # 완료 마커(정의 없는 complete_puzzle_ids)는 퍼즐이 아니라 대응 대상이 아니다.
                if (
                    puzzle_id in defined_puzzles
                    and puzzle_status.get(puzzle_id) != EXECUTABLE_STATUS
                ):
                    reasons.append(f"reveal_when_puzzle:{nudge.line_id}:{puzzle_id}")
            elif (
                kind == "clue_acquired" and clue_status.get(value) != EXECUTABLE_STATUS
            ):
                reasons.append(f"reveal_when_clue:{nudge.line_id}:{value}")
    # clear_when: Server Runtime에 장면 정의가 없어 참조할 대상 자체가 없다.
    return reasons


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _client_leaks(
    client_document: Mapping[str, Any],
    case_id: str,
    server: PuzzleRuntimeDefinition,
    hint_source: HintSource,
) -> list[str]:
    text = normalize_answer(
        json.dumps(list(_strings(client_document)), ensure_ascii=False)
    )
    reasons: list[str] = []
    for puzzle in server.puzzles:
        if any(
            len(normalize_answer(a)) >= MIN_ANSWER_LENGTH
            and normalize_answer(a) in text
            for a in puzzle.accepted_answers
        ):
            reasons.append(f"answer:{puzzle.puzzle_id}")
        for level in (1, 2):
            hint = hint_source(case_id, puzzle.puzzle_id, level)
            if hint and hint.strip() and normalize_answer(hint) in text:
                reasons.append(f"hint:{puzzle.puzzle_id}:{level}")
    return reasons
