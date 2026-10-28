"""backend Case 파일 한 쌍 → ScenarioPack (+ 변환 보고서).

[지키는 것]
  · 원본에 없는 것은 만들지 않는다 — 제목·소개·NPC 설정·힌트·설화는 비워 두고 보고서에 적는다.
  · 결과는 언제나 **draft** 다. 승인·공개는 사람이 한다(이 함수에는 그런 인자가 없다).
  · accepted_answers 와 단서 조합의 짝·효과는 옮기지 않는다.
  · 다 만든 뒤 팩 전체의 문자열(ID·flag 이름 포함)에서 정답과 별칭을 찾는다.
    하나라도 걸리면 팩을 돌려주지 않는다(AnswerLeakError).
  · 같은 입력이면 같은 출력 — 시각·절대 경로·난수를 넣지 않는다.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Literal, get_args

from pydantic import BaseModel, Field, ValidationError

from companion_npc.adapters import source_models as src
from companion_npc.adapters.errors import (
    AnswerLeakError,
    CaseLinkError,
    ClientContentInvalidError,
    PackContractError,
    ServerRuntimeInvalidError,
    error_locations,
)
from companion_npc.contracts.common import (
    CASE_ID_PATTERN,
    ContractModel,
    InteractionAction,
)
from companion_npc.contracts.scenario_pack import (
    KnowledgeChunk,
    KnowledgeGate,
    PackClue,
    PackNavigation,
    PackObject,
    PackPuzzle,
    PackSource,
    PackZone,
    Provenance,
    Publication,
    ScenarioPack,
)
from companion_npc.contracts.spoiler import find_answer_leaks, is_short_term, normalize

ADAPTER_VERSION = "case_content/0.1"
_ACTIONS = set(get_args(InteractionAction))
_ID_MAX = 64


# ── 보고서 ─────────────────────────────────────────────────────
class FieldPolicy(ContractModel):
    """원본 필드 하나를 어떻게 다루나. client_public = Case Bundle 로 FE 에 나가는가."""

    source_path: str
    client_public: bool
    npc_referable: bool
    handling: Literal["copied", "derived", "excluded", "hashed"]
    note: str


FIELD_POLICY: tuple[FieldPolicy, ...] = tuple(
    FieldPolicy(source_path=p, client_public=c, npc_referable=n, handling=h, note=t)
    for p, c, n, h, t in [
        ("client.case_id", True, True, "copied", "case_id"),
        ("client.entry_zone_id", True, True, "copied", "entry_zone_id"),
        (
            "client.zones[].zone_id|zone_name|zone_type|description",
            True,
            True,
            "copied",
            "zones[]",
        ),
        ("client.zones[].navigation[]", True, True, "copied", "zones[].navigation[]"),
        (
            "client.zones[].objects[].object_id|object_name|object_type",
            True,
            True,
            "copied",
            "objects[]",
        ),
        (
            "client.zones[].objects[].visible|enabled",
            True,
            True,
            "copied",
            "initially_visible|initially_enabled",
        ),
        (
            "client.zones[].objects[].interaction.type",
            True,
            True,
            "copied",
            "interaction_type (5종 밖이면 비움)",
        ),
        (
            "client.zones[].objects[].interaction.target_id",
            False,
            True,
            "derived",
            "input 일 때만 puzzle_id. Bundle 은 숨김",
        ),
        ("client.zones[].objects[].asset_key", True, False, "excluded", "FE 표현 전용"),
        ("client.zones[].metadata", True, False, "excluded", "현재 빈 객체"),
        ("server.schema_version", False, False, "excluded", "보고서에만 적음"),
        ("server.puzzles[].puzzle_id", False, True, "copied", "puzzles[].puzzle_id"),
        (
            "server.puzzles[].accepted_answers",
            False,
            False,
            "excluded",
            "정답 — 누설 검사에만 씀",
        ),
        (
            "server.puzzles[].on_correct.grant_clue_ids",
            False,
            True,
            "copied",
            "grants_clue_ids · clues[]",
        ),
        (
            "server.puzzles[].on_correct.complete_puzzle_ids",
            False,
            True,
            "copied",
            "completes_puzzle_ids",
        ),
        ("server.puzzles[].on_correct.set_flags", False, True, "copied", "sets_flags"),
        (
            "server.clue_combinations[].clue_ids (짝)",
            False,
            False,
            "excluded",
            "조합 퍼즐의 정답. 각 ID 만 clues[] 에 따로 등록",
        ),
        (
            "server.clue_combinations[].on_success",
            False,
            False,
            "excluded",
            "조합 결과. 나오는 ID 만 clues[]·puzzles[] 에 따로 등록",
        ),
        (
            "server.clue_combinations[].combination_id",
            False,
            False,
            "excluded",
            "NPC 에 필요 없음",
        ),
        (
            "server.<알 수 없는 key>",
            False,
            False,
            "excluded",
            "값은 읽지 않고 위치만 보고",
        ),
        (
            "client+server 전체",
            False,
            False,
            "hashed",
            "source.*_sha256 (정규화 JSON 기준)",
        ),
    ]
)

OmissionCategory = Literal[
    "server_only_answer",
    "server_only_linkage",
    "frontend_only",
    "unmapped_semantics",
    "unknown_field",
]
MissingNeed = Literal[
    "human_authoring",
    "human_approval",
    "generation_agent_spec",
    "backend_contract",
]


class Omission(ContractModel):
    source_path: str
    category: OmissionCategory
    count: int = Field(ge=0)


class MissingField(ContractModel):
    pack_path: str
    needs: MissingNeed
    reason: str


class LeakCheck(ContractModel):
    status: Literal["passed", "failed"]
    terms_checked: int
    short_terms: (
        int  # 영문·숫자 3자 미만이라 낱말 단위로만 비교한 것 (spoiler.is_short_term)
    )
    strings_scanned: int
    matched_paths: list[str] = Field(default_factory=list)


class ConversionReport(ContractModel):
    adapter_version: str
    case_id: str
    pack_id: str
    client_content_sha256: str
    server_runtime_sha256: str
    server_schema_version: str
    counts: dict[str, int]
    omissions: list[Omission]
    missing: list[MissingField]
    warnings: list[str]
    leak_check: LeakCheck
    field_policy: list[FieldPolicy]


@dataclass(frozen=True)
class ConversionResult:
    pack: ScenarioPack
    report: ConversionReport


# ── 공용 ───────────────────────────────────────────────────────
def canonical_sha256(data: Any) -> str:
    """줄바꿈(CRLF/LF)·들여쓰기·key 순서와 무관한 해시. 윈도우·맥에서 같은 값이 나온다."""

    text = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_json(model: BaseModel) -> str:
    return (
        json.dumps(
            model.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, indent=2
        )
        + "\n"
    )


def _short_id(prefix: str, raw: str) -> str:
    candidate = f"{prefix}{raw}"
    if len(candidate) <= _ID_MAX:
        return candidate
    return f"{prefix}#{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _field_names(model: type[BaseModel], seen: set[type] | None = None) -> set[str]:
    seen = seen if seen is not None else set()
    if model in seen:
        return set()
    seen.add(model)
    names = set(model.model_fields)
    for field in model.model_fields.values():
        stack = [field.annotation]
        while stack:
            tp = stack.pop()
            if isinstance(tp, type) and issubclass(tp, BaseModel):
                names |= _field_names(tp, seen)
            stack.extend(get_args(tp))
    return names


# 누설 검사에서 빼는 칸 — 변환기가 스스로 만든 값이라 원본 콘텐츠가 아니다.
#   해시(16진수)는 "0412" 같은 숫자 정답과 우연히 겹칠 수 있고, 버전 "0.1" 과
#   source_refs 의 순번은 짧은 숫자 정답 "1" 에 걸린다.
_LEAK_SCAN_SKIP = frozenset(
    {
        "contract",
        "contract_version",
        "adapter_version",
        "server_schema_version",
        "client_content_sha256",
        "server_runtime_sha256",
        "source_refs",
    }
)


def _string_leaves(value: Any, known_keys: set[str], path: str = "$") -> dict[str, str]:
    """모든 문자열 — 값뿐 아니라 dict key(flag 이름 등)도.

    ★ 위치(path)에 자유 key 를 그대로 쓰지 않는다. flag 이름에 정답이 들어 있으면
      「어디서 걸렸나」를 알려 주는 순간 정답을 다시 말하게 된다. 그래서 모델 필드
      이름이 아닌 key 는 순번(<key#n>)으로만 적는다.
    """

    found: dict[str, str] = {}
    if isinstance(value, str):
        found[path] = value
    elif isinstance(value, dict):
        for index, (key, item) in enumerate(value.items()):
            if key in _LEAK_SCAN_SKIP:
                continue
            step = key if key in known_keys else f"<key#{index}>"
            if key not in known_keys:
                found[f"{path}.{step}(key)"] = str(key)
            found |= _string_leaves(item, known_keys, f"{path}.{step}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found |= _string_leaves(item, known_keys, f"{path}[{index}]")
    return found


def _all_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for item in value.values() for k in _all_keys(item)}
    if isinstance(value, list):
        return {k for item in value for k in _all_keys(item)}
    return set()


# 팩 어디에도 나오면 안 되는 key — 모델이 이미 막지만 한 번 더 본다.
FORBIDDEN_KEYS = frozenset(
    {
        "accepted_answers",
        "on_correct",
        "on_success",
        "clue_combinations",
        "combination_id",
    }
)
_PACK_KEYS = _field_names(ScenarioPack)
_REPORT_KEYS = _field_names(ConversionReport)


# ── 변환 ───────────────────────────────────────────────────────
def convert_case(
    client_raw: dict,
    server_raw: dict,
    *,
    client_ref: str,
    producer: Literal["human", "agent", "mixed", "unknown"] = "unknown",
    forbidden_aliases: tuple[str, ...] = (),
) -> ConversionResult:
    """
    client_ref        팩에 남길 원본 위치. 절대 경로 대신 저장소 기준 상대 경로를 준다.
    forbidden_aliases 정답과 같은 뜻의 말(예: VALVE ↔ 밸브). 누설 검사에만 쓰고 어디에도 남기지 않는다.
    """

    client = _parse(src.CaseClientContent, client_raw, ClientContentInvalidError)
    server = _parse(src.PuzzleRuntimeDefinition, server_raw, ServerRuntimeInvalidError)
    _check_links(client, server)

    warnings: list[str] = []
    omissions: list[Omission] = []
    defined_puzzles = {p.puzzle_id: p for p in server.puzzles}

    # ① 공간 · 물건 ───────────────────────────────────────────
    zones: list[PackZone] = []
    objects: list[PackObject] = []
    knowledge: list[KnowledgeChunk] = []
    asset_keys = non_input_targets = 0
    hidden: list[str] = []
    for zi, zone in enumerate(client.zones):
        zones.append(
            PackZone(
                zone_id=zone.zone_id,
                zone_name=zone.zone_name,
                zone_type=zone.zone_type,
                description=zone.description,
                navigation=[
                    PackNavigation(
                        door_object_id=n.door_object_id, target_zone_id=n.target_zone_id
                    )
                    for n in zone.navigation
                ],
            )
        )
        # zone 설명은 **그 zone 에 있을 때만** 꺼낸다 — 아직 못 간 곳의 설명이 스포일러일 수 있다.
        if zone.description.strip():
            knowledge.append(
                KnowledgeChunk(
                    chunk_id=_short_id("zone:", zone.zone_id),
                    kind="zone",
                    text=zone.description,
                    spoiler_tier=0,
                    gate=KnowledgeGate(requires_zone_ids=[zone.zone_id]),
                    provenance=Provenance(
                        provenance_mode="direct",
                        source_refs=[f"{client_ref}#/zones/{zi}/description"],
                    ),
                )
            )
        for oi, obj in enumerate(zone.objects):
            interaction = obj.interaction
            interaction_type = None
            puzzle_id = None
            if interaction is not None:
                if interaction.type in _ACTIONS:
                    interaction_type = interaction.type
                else:
                    warnings.append(
                        f"object {obj.object_id}: interaction.type is not one of the 5 actions"
                    )
                if interaction.type == "input":
                    puzzle_id = interaction.target_id
                else:
                    # input 이외의 target_id 가 무엇을 가리키는지는 아직 계약이 없다
                    non_input_targets += 1
            if obj.asset_key is not None:
                asset_keys += 1
            objects.append(
                PackObject(
                    object_id=obj.object_id,
                    zone_id=zone.zone_id,
                    object_name=obj.object_name,
                    object_type=obj.object_type,
                    interaction_type=interaction_type,
                    puzzle_id=puzzle_id,
                    initially_visible=obj.visible,
                    initially_enabled=obj.enabled,
                )
            )
            # 처음에 숨은 물건은 지식 조각을 만들지 않는다. 드러나는 조건이 아직 계약에 없다.
            if not obj.visible:
                hidden.append(obj.object_id)
                continue
            knowledge.append(
                KnowledgeChunk(
                    chunk_id=_short_id("object:", obj.object_id),
                    kind="object",
                    text=obj.object_name,
                    spoiler_tier=0,
                    gate=KnowledgeGate(requires_zone_ids=[zone.zone_id]),
                    puzzle_id=puzzle_id,
                    provenance=Provenance(
                        provenance_mode="direct",
                        source_refs=[
                            f"{client_ref}#/zones/{zi}/objects/{oi}/object_name"
                        ],
                    ),
                )
            )

    # ② 퍼즐 ──────────────────────────────────────────────────
    #   server.puzzles 순서대로, 그다음 효과에서만 이름이 나오는 퍼즐을 처음 나온 순서대로.
    referenced = _dedupe(
        [pid for p in server.puzzles for pid in p.on_correct.complete_puzzle_ids]
        + [
            pid
            for c in server.clue_combinations
            for pid in c.on_success.complete_puzzle_ids
        ]
    )
    effect_only = [pid for pid in referenced if pid not in defined_puzzles]
    for pid in effect_only:
        warnings.append(
            f"puzzle {pid}: referenced by an effect but not defined in server.puzzles"
        )

    hosts: dict[str, list[PackObject]] = {}
    for o in objects:
        if o.puzzle_id is not None:
            hosts.setdefault(o.puzzle_id, []).append(o)

    puzzles: list[PackPuzzle] = []
    for pid in [*defined_puzzles, *effect_only]:
        host_objects = hosts.get(pid, [])
        host_zones = _dedupe([o.zone_id for o in host_objects])
        effect = defined_puzzles[pid].on_correct if pid in defined_puzzles else None
        puzzles.append(
            PackPuzzle(
                puzzle_id=pid,
                zone_id=host_zones[0] if len(host_zones) == 1 else None,
                host_object_ids=[o.object_id for o in host_objects],
                grants_clue_ids=list(effect.grant_clue_ids) if effect else [],
                completes_puzzle_ids=list(effect.complete_puzzle_ids) if effect else [],
                sets_flags=dict(effect.set_flags) if effect else {},
            )
        )

    # ③ 단서 — ID 만 등록한다. 조합의 짝·결과는 서로 잇지 않는다.
    clue_ids = _dedupe(
        [cid for p in server.puzzles for cid in p.on_correct.grant_clue_ids]
        + [cid for c in server.clue_combinations for cid in c.clue_ids]
        + [cid for c in server.clue_combinations for cid in c.on_success.grant_clue_ids]
    )
    clues = [PackClue(clue_id=cid) for cid in clue_ids]

    # ④ 팩 ────────────────────────────────────────────────────
    client_sha = canonical_sha256(client_raw)
    server_sha = canonical_sha256(server_raw)
    pack_id = _short_id("pack_", client.case_id)
    try:
        pack = ScenarioPack(
            pack_id=pack_id,
            case_id=client.case_id,
            source=PackSource(
                producer=producer,
                client_content_ref=client_ref,
                client_content_sha256=client_sha,
                server_runtime_sha256=server_sha,
            ),
            publication=Publication(status="draft"),
            entry_zone_id=client.entry_zone_id,
            zones=zones,
            objects=objects,
            puzzles=puzzles,
            clues=clues,
            knowledge=knowledge,
        )
    except ValidationError as error:
        raise PackContractError(error_locations(error)) from None

    # ⑤ 빠진 것 · 옮기지 않은 것 ────────────────────────────────
    answers = [a for p in server.puzzles for a in p.accepted_answers]
    combos = len(server.clue_combinations)
    omissions += [
        Omission(
            source_path="server.puzzles[].accepted_answers",
            category="server_only_answer",
            count=len(answers),
        ),
        Omission(
            source_path="server.clue_combinations[].clue_ids",
            category="server_only_linkage",
            count=combos,
        ),
        Omission(
            source_path="server.clue_combinations[].on_success",
            category="server_only_linkage",
            count=combos,
        ),
        Omission(
            source_path="client.zones[].objects[].asset_key",
            category="frontend_only",
            count=asset_keys,
        ),
        Omission(
            source_path="client.zones[].objects[].interaction.target_id (input 외)",
            category="unmapped_semantics",
            count=non_input_targets,
        ),
    ]
    # 개수 대신 ID 를 적는다 — 숫자가 섞이면 짧은 숫자 정답 검사에 걸린다.
    warnings += [
        f"object {oid}: initially hidden — no knowledge chunk until reveal conditions exist"
        for oid in hidden
    ]

    report_base = dict(
        adapter_version=ADAPTER_VERSION,
        case_id=pack.case_id,
        pack_id=pack.pack_id,
        client_content_sha256=client_sha,
        server_runtime_sha256=server_sha,
        server_schema_version=server.schema_version,
        counts={
            "zones": len(zones),
            "navigation": sum(len(z.navigation) for z in zones),
            "objects": len(objects),
            "puzzles": len(puzzles),
            "clues": len(clues),
            "hints": 0,
            "knowledge": len(knowledge),
            "hidden_objects": len(hidden),
        },
        omissions=omissions,
        missing=_missing_fields(pack),
        warnings=warnings,
        field_policy=list(FIELD_POLICY),
    )

    # ⑥ 누설 검사 — 팩 전체 + 보고서의 문자열 대 정답 + 별칭 ──────
    #   보고서도 본다: 경고 문구의 ID, 모르는 server key 이름에 정답이 섞일 수 있다.
    terms = answers + list(forbidden_aliases)
    dumped = pack.model_dump(mode="json")
    leaves = {f"pack{p[1:]}": v for p, v in _string_leaves(dumped, _PACK_KEYS).items()}
    leaves |= {
        f"report{p[1:]}": v
        for p, v in _string_leaves(
            {k: v for k, v in report_base.items() if k != "field_policy"}
            | {"omissions": [o.model_dump() for o in omissions]},
            _REPORT_KEYS,
        ).items()
    }
    matched = find_answer_leaks(leaves, terms)
    bad_keys = sorted(_all_keys(dumped) & FORBIDDEN_KEYS)
    matched += [f"pack..{key} (forbidden key)" for key in bad_keys]
    normalized_terms = [t for t in (normalize(x) for x in terms) if t]
    leak_check = LeakCheck(
        status="failed" if matched else "passed",
        terms_checked=len(normalized_terms),
        short_terms=sum(is_short_term(t) for t in normalized_terms),
        strings_scanned=len(leaves),
        matched_paths=matched,
    )
    if matched:
        # 걸렸을 때는 ID·key 이름이 든 칸을 비운 보고서만 내보낸다. 팩은 돌려주지 않는다.
        redacted = report_base | {
            "warnings": ["<redacted: answer leak detected>"],
            "omissions": [o for o in omissions if o.category != "unknown_field"],
            "missing": [],
        }
        raise AnswerLeakError(ConversionReport(**redacted, leak_check=leak_check))
    return ConversionResult(
        pack=pack, report=ConversionReport(**report_base, leak_check=leak_check)
    )


def _parse(model: type[BaseModel], raw: dict, error_type: type[Exception]) -> Any:
    try:
        return model.model_validate(raw)
    except ValidationError as error:
        raise error_type(error_locations(error)) from None


def _check_links(
    client: src.CaseClientContent, server: src.PuzzleRuntimeDefinition
) -> None:
    """backend services/case_content_validation.py 와 같은 규칙 + case_id 형식."""

    if client.case_id != server.case_id:
        raise CaseLinkError("client case_id does not match server case_id")
    if (
        CASE_ID_PATTERN.fullmatch(client.case_id) is None
        or len(client.case_id) > _ID_MAX
    ):
        raise CaseLinkError("case_id must match ^[A-Za-z0-9_-]+$ (≤64)")
    puzzle_ids = {p.puzzle_id for p in server.puzzles}
    for zone in client.zones:
        for obj in zone.objects:
            if obj.interaction and obj.interaction.type == "input":
                if obj.interaction.target_id not in puzzle_ids:
                    raise CaseLinkError(
                        f"object {obj.object_id} references a puzzle missing from server"
                    )


def _missing_fields(pack: ScenarioPack) -> list[MissingField]:
    """원본에 없어 비워 둔 칸. 채울 주체(needs)를 함께 적는다."""

    rows: list[tuple[str, MissingNeed, str]] = [
        (
            "premise",
            "human_authoring",
            "브리핑 문구가 Case 파일에 없다. approved/published 전 필수",
        ),
        ("persona", "human_authoring", "동행 NPC 설정이 Case 파일에 없다"),
        ("locale", "human_authoring", "Case 파일에 언어 표시가 없다"),
        ("case_version", "backend_contract", "ADM-090 case_version 형식 미정"),
        ("hints[]", "human_approval", "승인 힌트는 변환기가 만들지 않는다"),
        (
            "knowledge[] (spoiler_tier ≥ 1, lore)",
            "human_authoring",
            "설화·진실·반전 정보가 Case 파일에 없다",
        ),
        ("puzzles[].title", "human_authoring", "server.json 에 퍼즐 이름이 없다"),
        (
            "puzzles[].puzzle_type",
            "generation_agent_spec",
            "Puzzle Type 7종이 Case 파일에 없다",
        ),
        (
            "puzzles[].prerequisite_puzzle_ids",
            "backend_contract",
            "퍼즐·zone 해금 조건이 계약에 없다",
        ),
        (
            "puzzles[].required_clue_ids",
            "generation_agent_spec",
            "필요 단서가 정의되지 않았다. 조합 짝은 정답이라 쓰지 않는다",
        ),
        (
            "puzzles[].required_discovery_ref",
            "generation_agent_spec",
            "ADM-081 필수 발견 연결이 없다",
        ),
        (
            "objects[] 드러남 조건",
            "backend_contract",
            "visible·enabled 를 바꾸는 규칙이 없다 (Contract Gap)",
        ),
        (
            "safety_audit",
            "human_approval",
            "공개 직전에 승인 데이터까지 포함해 다시 검사한다",
        ),
    ]
    if pack.clues:
        rows.append(
            (
                "clues[].title|description|source_object_id",
                "backend_contract",
                "단서 registry 가 없어 ID 만 안다",
            )
        )
    return [MissingField(pack_path=p, needs=n, reason=r) for p, n, r in rows]
