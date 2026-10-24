"""ScenarioPack v0.1 (초안) — NPC 가 사건 하나를 이해하는 데 쓰는 공통 데이터.

[어디서 만들어지나]
  사람이 만든 Case 든 게임 생성 에이전트가 만든 Case 든, 승인된 콘텐츠를
  **오프라인에서** 이 모양으로 변환한다(변환기는 P2). NPC 모델 코드는 이 모양만 읽으므로,
  새 시나리오가 들어와도 모델 코드를 고치지 않는다.

[들어가지 않는 것]
  · accepted_answers, 정답 판정 규칙, clue_combinations 의 정답 쌍 — 서버 전용(Server Runtime)
  · 정적 힌트의 「정답 보기」(backend hint_level 2) 문구 — 정답과 같다
  모델에 그런 필드가 없고 extra="forbid" 라서, 섞여 들어오면 검증에서 거부된다.
"""

from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import (
    CONTRACT_VERSION,
    AwareDatetime,
    CaseId,
    ContractModel,
    Id,
    InteractionAction,
    PuzzleType,
    SpoilerTier,
    find_duplicates,
)

PublicationStatus = Literal["draft", "approved", "published", "withdrawn"]
ProducerKind = Literal["human", "agent", "mixed"]
ProvenanceMode = Literal["direct", "inherited", "mechanical"]
FactGrade = Literal["F", "U", "GF", "NG"]
KnowledgeKind = Literal[
    "premise", "lore", "zone", "object", "clue", "puzzle", "hint", "persona"
]


class Provenance(ContractModel):
    """출처 — origin/dev 파이프라인 설계요청 v2.1 §9.3 형식을 따른다."""

    provenance_mode: ProvenanceMode
    source_refs: list[str] = Field(default_factory=list)
    fact_grade: FactGrade | None = None
    inherited_from: list[str] = Field(default_factory=list)
    rationale: str | None = None


class PackSource(ContractModel):
    """이 팩을 무엇으로부터 만들었나 (제안)."""

    producer: ProducerKind
    client_content_ref: str  # 예: "backend/app/content/cases/case_001.client.json"
    # 서버 전용 파일은 내용 대신 해시만 적는다 — 판이 바뀌었는지만 알면 된다.
    server_runtime_sha256: str | None = None
    # 생성 에이전트 산출물 ID (파이프라인 §9.2 artifact_id). GameSpec 확정 전까지 비어 있을 수 있다.
    artifact_ids: list[str] = Field(default_factory=list)


class Publication(ContractModel):
    """공개 상태 — 미공개 사건을 RAG 단계에서 막는 첫 관문."""

    status: PublicationStatus
    approved_by: str | None = None
    approved_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _approval_recorded(self) -> "Publication":
        if self.status in ("approved", "published") and not (
            self.approved_by and self.approved_at
        ):
            raise ValueError(
                "approved/published pack must record approved_by and approved_at"
            )
        return self


class Premise(ContractModel):
    title: str = Field(min_length=1)
    # 브리핑 수준까지만. 반전·진실은 knowledge 에 등급과 공개 조건을 붙여 넣는다.
    public_synopsis: str = Field(min_length=1)


class NpcPersona(ContractModel):
    """동행 NPC 의 말투·역할 (제안). 시나리오마다 바뀔 수 있어 팩에 둔다."""

    npc_id: Id
    display_name: str = Field(min_length=1)
    role: str = Field(min_length=1)
    speech_style: str = Field(min_length=1)
    forbidden_topics: list[str] = Field(default_factory=list)


class PackZone(ContractModel):
    """CaseClientContent.zones[] 에서 그대로 옮긴다."""

    zone_id: Id
    zone_name: str = Field(min_length=1)
    zone_type: str = Field(min_length=1)
    description: str


class PackObject(ContractModel):
    """CaseClientContent.zones[].objects[] 에서 옮긴다."""

    object_id: Id
    zone_id: Id
    object_name: str = Field(min_length=1)
    object_type: str = Field(min_length=1)
    interaction_type: InteractionAction | None = None
    # interaction.target_id. Case Bundle 은 이 값을 FE 에 숨기지만 팩은 서버 쪽 데이터라 둔다.
    puzzle_id: Id | None = None


class PackPuzzle(ContractModel):
    """퍼즐의 '구조'만. 정답과 판정 규칙은 없다."""

    puzzle_id: Id
    title: str = Field(min_length=1)
    puzzle_type: PuzzleType | None = None  # 제안 — backend server.json 에는 아직 없다
    zone_id: Id | None = None
    host_object_ids: list[Id] = Field(default_factory=list)
    prerequisite_puzzle_ids: list[Id] = Field(default_factory=list)  # 제안
    required_clue_ids: list[Id] = Field(default_factory=list)  # 제안
    # on_correct.grant_clue_ids 와 같다. ID 만이라 정답을 드러내지 않는다.
    grants_clue_ids: list[Id] = Field(default_factory=list)
    required_discovery_ref: str | None = None  # 제안 — ADM-081 필수 발견


class PackClue(ContractModel):
    clue_id: Id
    title: str = Field(min_length=1)
    description: str
    source_object_id: Id | None = None


class ApprovedHint(ContractModel):
    """사람이 승인한 NPC 힌트. NPC 는 이 목록 밖의 힌트를 근거로 삼지 않는다."""

    hint_id: Id
    puzzle_id: Id
    npc_hint_level: Literal[1, 2]
    text: str = Field(min_length=1, max_length=300)
    approved_by: str = Field(min_length=1)
    approved_at: AwareDatetime
    provenance: Provenance


class KnowledgeGate(ContractModel):
    """이 지식을 꺼내도 되는 조건. 적힌 조건을 **모두** 만족해야 한다(빈 조건 = 항상)."""

    requires_zone_ids: list[Id] = Field(default_factory=list)  # 현재 zone 이 이 중 하나
    requires_clue_ids: list[Id] = Field(default_factory=list)
    requires_completed_puzzle_ids: list[Id] = Field(default_factory=list)
    requires_flags: dict[str, bool] = Field(default_factory=dict)


class KnowledgeChunk(ContractModel):
    """RAG 검색 단위."""

    chunk_id: Id
    kind: KnowledgeKind
    text: str = Field(min_length=1, max_length=1200)
    spoiler_tier: SpoilerTier
    gate: KnowledgeGate = Field(default_factory=KnowledgeGate)
    puzzle_id: Id | None = None
    hint_id: Id | None = None  # kind == "hint" 이면 필수
    provenance: Provenance


class SafetyAudit(ContractModel):
    """팩을 만들 때 서버 쪽에서 돌린 정답 누설 검사 기록 (제안).

    검사에는 accepted_answers 가 필요하지만, 그 값은 팩에 남기지 않고 결과만 적는다.
    """

    answer_leak_check: Literal["passed", "failed"]
    checked_at: AwareDatetime
    checker_version: str = Field(min_length=1)


class ScenarioPack(ContractModel):
    contract: Literal["scenario_pack"] = "scenario_pack"
    contract_version: Literal["0.1"] = CONTRACT_VERSION
    pack_id: Id
    case_id: CaseId
    case_version: str | None = None  # 제안 — ADM-090 case_version
    locale: str = "ko-KR"
    source: PackSource
    publication: Publication
    premise: Premise
    persona: NpcPersona | None = None
    entry_zone_id: Id
    zones: list[PackZone] = Field(min_length=1)
    objects: list[PackObject] = Field(default_factory=list)
    puzzles: list[PackPuzzle] = Field(default_factory=list)
    clues: list[PackClue] = Field(default_factory=list)
    hints: list[ApprovedHint] = Field(default_factory=list)
    knowledge: list[KnowledgeChunk] = Field(default_factory=list)
    safety_audit: SafetyAudit | None = None

    @model_validator(mode="after")
    def _ids_are_consistent(self) -> "ScenarioPack":
        groups = {
            "zone_id": [z.zone_id for z in self.zones],
            "object_id": [o.object_id for o in self.objects],
            "puzzle_id": [p.puzzle_id for p in self.puzzles],
            "clue_id": [c.clue_id for c in self.clues],
            "hint_id": [h.hint_id for h in self.hints],
            "chunk_id": [k.chunk_id for k in self.knowledge],
        }
        for name, values in groups.items():
            if duplicates := find_duplicates(values):
                raise ValueError(f"duplicate {name}: {duplicates}")

        zones = set(groups["zone_id"])
        objects = set(groups["object_id"])
        puzzles = set(groups["puzzle_id"])
        clues = set(groups["clue_id"])
        hints = set(groups["hint_id"])

        def missing(refs: list[str], known: set[str], label: str) -> None:
            if unknown := [r for r in refs if r not in known]:
                raise ValueError(f"unknown {label}: {unknown}")

        missing([self.entry_zone_id], zones, "entry_zone_id")
        for o in self.objects:
            missing([o.zone_id], zones, f"zone_id in object {o.object_id}")
            if o.puzzle_id is not None:
                missing([o.puzzle_id], puzzles, f"puzzle_id in object {o.object_id}")
        for p in self.puzzles:
            missing(
                [p.zone_id] if p.zone_id else [],
                zones,
                f"zone_id in puzzle {p.puzzle_id}",
            )
            missing(
                p.host_object_ids, objects, f"host_object_ids in puzzle {p.puzzle_id}"
            )
            missing(
                p.prerequisite_puzzle_ids,
                puzzles,
                f"prerequisites in puzzle {p.puzzle_id}",
            )
            missing(
                p.required_clue_ids + p.grants_clue_ids,
                clues,
                f"clue ids in puzzle {p.puzzle_id}",
            )
        for c in self.clues:
            if c.source_object_id is not None:
                missing(
                    [c.source_object_id],
                    objects,
                    f"source_object_id in clue {c.clue_id}",
                )
        for h in self.hints:
            missing([h.puzzle_id], puzzles, f"puzzle_id in hint {h.hint_id}")
        for k in self.knowledge:
            g = k.gate
            missing(g.requires_zone_ids, zones, f"gate zones in chunk {k.chunk_id}")
            missing(g.requires_clue_ids, clues, f"gate clues in chunk {k.chunk_id}")
            missing(
                g.requires_completed_puzzle_ids,
                puzzles,
                f"gate puzzles in chunk {k.chunk_id}",
            )
            if k.puzzle_id is not None:
                missing([k.puzzle_id], puzzles, f"puzzle_id in chunk {k.chunk_id}")
            if k.kind == "hint":
                if k.hint_id is None:
                    raise ValueError(f"hint chunk {k.chunk_id} must reference hint_id")
                missing([k.hint_id], hints, f"hint_id in chunk {k.chunk_id}")
                hint = next(h for h in self.hints if h.hint_id == k.hint_id)
                # 힌트를 RAG 에 넣을 때 등급을 낮춰 적으면 이른 시점에 꺼내질 수 있다.
                if k.spoiler_tier != hint.npc_hint_level:
                    raise ValueError(
                        f"hint chunk {k.chunk_id} spoiler_tier must equal npc_hint_level"
                    )
        return self

    @model_validator(mode="after")
    def _published_pack_passed_audit(self) -> "ScenarioPack":
        # 공개하려면 정답 누설 검사를 통과한 기록이 있어야 한다.
        if self.publication.status == "published" and (
            self.safety_audit is None or self.safety_audit.answer_leak_check != "passed"
        ):
            raise ValueError("published pack requires a passed safety_audit")
        return self
