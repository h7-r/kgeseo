"""NpcContent v0.1 (초안) — `<case_id>.npc.json` · 승인된 NPC 전용 콘텐츠.

[세 파일의 역할]
  .client.json  클라이언트용 게임 콘텐츠 (FE 공개)
  .server.json  정답 · 서버 판정 정보 (비공개)
  .npc.json     사람이 승인한 NPC 전용 콘텐츠 (이 계약) — 페르소나 · 승인 힌트 · 지식 조각 · 템플릿

[이것은 초안이다]
  팀 저장소에 공식 게시 계약이 없어, 테스트 fixture 를 기준으로 설계했다.
  backend 의 공식 게시 계약으로 확정한 것이 아니다. 최종 게시 권한은 서버와 팀 콘텐츠 승인 절차에 있다.

[들어가지 않는 것]
  정답 · 정답 별칭 · 판정 규칙 · 조합의 짝 — 서버 비공개 정보다. 별칭은 서버 쪽 누설 검사에만 쓴다.
  extra="forbid" 라서 그런 필드를 넣으면 검증에서 거부된다.

[버전 고정]
  client · server 파일의 정규화 해시를 적는다. 사건 콘텐츠가 바뀌면 이 NPC 콘텐츠는 결합되지 않는다.
"""

import re
from typing import Literal

from pydantic import Field, model_validator

from companion_npc.contracts.common import (
    AwareDatetime,
    CaseId,
    ContractModel,
    Id,
    find_duplicates,
)
from companion_npc.contracts.scenario_pack import (
    ApprovedHint,
    KnowledgeChunk,
    NpcPersona,
    Premise,
    PublicationStatus,
)

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
# 템플릿 종류마다 허용하는 자리표시. clarify_with_object 만 오브젝트 이름을 받는다.
TEMPLATE_PLACEHOLDERS: dict[str, frozenset[str]] = {
    "check_in": frozenset(),
    "clarify_general": frozenset(),
    "clarify_with_object": frozenset({"object"}),
}


class ApprovalRecord(ContractModel):
    status: PublicationStatus
    by: str = Field(min_length=1)
    at: AwareDatetime
    note: str | None = Field(default=None, max_length=300)


class NpcPublication(ContractModel):
    status: PublicationStatus
    approved_by: str | None = None
    approved_at: AwareDatetime | None = None
    history: list[ApprovalRecord] = Field(default_factory=list)

    @model_validator(mode="after")
    def _recorded(self) -> "NpcPublication":
        if self.status in ("approved", "published"):
            if not (self.approved_by and self.approved_at):
                raise ValueError(
                    "approved/published content must record approver and time"
                )
            if not any(r.status == "approved" for r in self.history):
                raise ValueError("approved/published content needs an approval record")
        times = [r.at for r in self.history]
        if times != sorted(times):
            raise ValueError("history must be in time order")
        if self.history and self.history[-1].status != self.status:
            raise ValueError("last history record must match current status")
        return self


class TemplateText(ContractModel):
    template_id: Id
    text: str = Field(min_length=1, max_length=200)


class NpcTemplates(ContractModel):
    check_in: list[TemplateText] = Field(min_length=1)
    clarify_general: list[TemplateText] = Field(min_length=1)
    clarify_with_object: list[TemplateText] = Field(default_factory=list)

    @model_validator(mode="after")
    def _placeholders(self) -> "NpcTemplates":
        ids = [
            t.template_id
            for group in (self.check_in, self.clarify_general, self.clarify_with_object)
            for t in group
        ]
        if dups := find_duplicates(ids):
            raise ValueError(f"duplicate template_id: {dups}")
        for name, allowed in TEMPLATE_PLACEHOLDERS.items():
            for t in getattr(self, name):
                used = set(_PLACEHOLDER.findall(t.text))
                if used - allowed:
                    raise ValueError(
                        f"{t.template_id}: placeholder not allowed in {name}"
                    )
                if name == "clarify_with_object" and "object" not in used:
                    raise ValueError(
                        f"{t.template_id}: clarify_with_object needs {{object}}"
                    )
        return self


class CaseContentPin(ContractModel):
    """이 NPC 콘텐츠가 승인될 때의 사건 콘텐츠 판 (P2-A 정규화 해시)."""

    client_content_sha256: str = Field(min_length=64, max_length=64)
    server_runtime_sha256: str = Field(min_length=64, max_length=64)


class NpcContent(ContractModel):
    contract: Literal["npc_content"] = "npc_content"
    contract_version: Literal["0.1"] = "0.1"
    content_id: Id
    content_version: str = Field(min_length=1, max_length=32)
    case_id: CaseId
    case_content: CaseContentPin
    publication: NpcPublication
    premise: Premise | None = None
    persona: NpcPersona
    hints: list[ApprovedHint] = Field(default_factory=list)
    knowledge: list[KnowledgeChunk] = Field(default_factory=list)
    templates: NpcTemplates

    @model_validator(mode="after")
    def _consistent(self) -> "NpcContent":
        if (
            self.publication.status in ("approved", "published")
            and self.premise is None
        ):
            raise ValueError("approved/published content requires premise")
        for name, values in (
            ("hint_id", [h.hint_id for h in self.hints]),
            ("chunk_id", [k.chunk_id for k in self.knowledge]),
        ):
            if dups := find_duplicates(values):
                raise ValueError(f"duplicate {name}: {dups}")
        return self
