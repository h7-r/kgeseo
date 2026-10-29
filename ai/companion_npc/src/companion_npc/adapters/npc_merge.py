"""ScenarioPack(P2-A draft) + NpcContent(.npc.json) → 발화층이 쓰는 팩.

[지키는 것]
  · 사건 콘텐츠 판(client·server 해시)이 다르면 결합하지 않는다 — 오래된 NPC 콘텐츠를 막는다.
  · 팩의 공개 상태는 NPC 콘텐츠의 승인 상태를 따른다. 결합이 상태를 스스로 올리지 않는다.
  · 서버 비공개 정보(정답 · 별칭)는 팩에 넣지 않는다. 누설 검사의 기준으로만 받는다.
  · NPC 콘텐츠의 모든 문장(페르소나 · 브리핑 · 힌트 · 지식 · 템플릿)을 정답 · 별칭과 대조한다.
    하나라도 걸리면 팩을 만들지 않는다. 오류에는 위치만 적는다.
"""

from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from companion_npc.adapters.case_content import convert_case
from companion_npc.adapters.errors import AdapterError, error_locations
from companion_npc.adapters.loader import _read_json, _resolve, load_case_sources
from companion_npc.contracts.npc_content import NpcContent, NpcTemplates
from companion_npc.contracts.scenario_pack import ScenarioPack
from companion_npc.contracts.spoiler import find_answer_leaks

MERGE_VERSION = "npc_merge/0.1"


class NpcMergeError(AdapterError):
    pass


@dataclass(frozen=True)
class MergedPack:
    pack: ScenarioPack
    templates: NpcTemplates
    npc_content_id: str
    npc_content_version: str


def load_npc_content(npc_dir: Path, case_id: str) -> NpcContent:
    path = _resolve(npc_dir, case_id, "npc")
    try:
        return NpcContent.model_validate(_read_json(path))
    except ValidationError as error:
        raise NpcMergeError(
            "npc content invalid: " + "; ".join(error_locations(error))
        ) from None


def _npc_texts(npc: NpcContent) -> dict[str, str]:
    texts = {
        "persona.display_name": npc.persona.display_name,
        "persona.role": npc.persona.role,
        "persona.speech_style": npc.persona.speech_style,
    }
    if npc.premise:
        texts |= {
            "premise.title": npc.premise.title,
            "premise.public_synopsis": npc.premise.public_synopsis,
        }
    texts |= {f"hints[{i}].text": h.text for i, h in enumerate(npc.hints)}
    texts |= {f"knowledge[{i}].text": k.text for i, k in enumerate(npc.knowledge)}
    for group in ("check_in", "clarify_general", "clarify_with_object"):
        texts |= {
            f"templates.{group}[{i}]": t.text
            for i, t in enumerate(getattr(npc.templates, group))
        }
    return texts


def merge_npc_content(
    pack: ScenarioPack, npc: NpcContent, *, forbidden_terms: list[str]
) -> MergedPack:
    """forbidden_terms = 서버의 accepted_answers + 사람이 정한 별칭 (서버 쪽에서만 넘긴다)."""

    if pack.case_id != npc.case_id:
        raise NpcMergeError("npc content belongs to another case")
    if pack.publication.status != "draft":
        raise NpcMergeError("merge expects the draft pack produced from case files")
    pin = npc.case_content
    if (pin.client_content_sha256, pin.server_runtime_sha256) != (
        pack.source.client_content_sha256,
        pack.source.server_runtime_sha256,
    ):
        raise NpcMergeError(
            "npc content was approved for a different case content version"
        )

    leaks = find_answer_leaks(_npc_texts(npc), forbidden_terms)
    if leaks:
        raise NpcMergeError(
            "npc content contains forbidden terms at: " + ", ".join(leaks)
        )

    status = npc.publication.status
    data = pack.model_dump(mode="json")
    data["publication"] = {
        "status": status,
        "approved_by": npc.publication.approved_by,
        "approved_at": npc.publication.approved_at.isoformat()
        if npc.publication.approved_at
        else None,
    }
    data["premise"] = npc.premise.model_dump(mode="json") if npc.premise else None
    data["persona"] = npc.persona.model_dump(mode="json")
    data["hints"] = [h.model_dump(mode="json") for h in npc.hints]
    data["knowledge"] = data["knowledge"] + [
        k.model_dump(mode="json") for k in npc.knowledge
    ]
    # 공개(published)에는 누설 검사 통과 기록이 필요하다. 시각은 승인 시각으로 고정한다(재현성).
    data["safety_audit"] = (
        {
            "answer_leak_check": "passed",
            "checked_at": npc.publication.approved_at.isoformat(),
            "checker_version": MERGE_VERSION,
        }
        if status == "published"
        else None
    )
    try:
        merged = ScenarioPack.model_validate(data)
    except ValidationError as error:
        raise NpcMergeError(
            "merged pack invalid: " + "; ".join(error_locations(error))
        ) from None
    return MergedPack(
        pack=merged,
        templates=npc.templates,
        npc_content_id=npc.content_id,
        npc_content_version=npc.content_version,
    )


def build_speech_pack(
    cases_dir: Path, npc_dir: Path, case_id: str, *, aliases: tuple[str, ...] = ()
) -> MergedPack:
    """서버 쪽 조립: Case 파일 → draft 팩 → NPC 콘텐츠 결합. 정답은 검사에만 쓰고 버린다."""

    sources = load_case_sources(cases_dir, case_id)
    draft = convert_case(
        sources.client,
        sources.server,
        client_ref=f"{case_id}.client.json",
        forbidden_aliases=aliases,
    ).pack
    answers = [a for p in sources.server["puzzles"] for a in p["accepted_answers"]]
    return merge_npc_content(
        draft,
        load_npc_content(npc_dir, case_id),
        forbidden_terms=answers + list(aliases),
    )


def forbidden_terms_for(
    cases_dir: Path, case_id: str, aliases: tuple[str, ...] = ()
) -> list[str]:
    """서버 쪽 발화 검증기에 넘길 금지어. 이 목록은 팩·프롬프트·로그에 넣지 않는다."""

    sources = load_case_sources(cases_dir, case_id)
    return [a for p in sources.server["puzzles"] for a in p["accepted_answers"]] + list(
        aliases
    )
