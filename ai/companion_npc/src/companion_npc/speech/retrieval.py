"""검색 — 거른 뒤에 순위를 매긴다.

[거르기] (순서대로)
  1. 공개(published) 팩 · 같은 사건 — 아니면 아무것도 없다 (visible_chunks)
  2. 공개 조건 — 현재 구역 · 획득 단서 · 완료 퍼즐 · flag (visible_chunks)
  3. 유형·단계
     check_in  검색하지 않는다
     clarify   현재 구역에서 보이는 오브젝트의 **이름 조각**(등급 0)만 — 그리고 FE 가
               「지금 플레이어에게 보인다」고 확인한 오브젝트만(confirmed_visible). 확인이 없으면 비운다
               (정적 initially_visible 만으로는 가시성을 확정할 수 없다)
     nudge · hint — 근거 정책(policy)에 따라
       tier_le    (P4-A ~ P4-B2 판 3) 대상 퍼즐의 조각 중 등급 ≤ 단계(1 · 2) + 등급 0 의 공개 배경(구역·오브젝트·브리핑).
                  hint 에 1단계 힌트 조각이 함께 들어가, 모델이 단계를 합쳐 완결된 풀이 절차를 만들 수 있었다.
       same_level (P4-B2 판 4 · 기본) 대상 퍼즐의 조각 중 **등급 = 단계** 인 보조 지식만 + 등급 0 의 공개 배경.
                  힌트 조각(kind=hint)은 근거에서 뺀다 — 승인 힌트는 approved_hint 로 따로 들어가고,
                  다른 단계의 힌트를 합칠 수 없게 한다. 공개 조건(visible_chunks)은 그대로 먼저 적용된다.
                  공개 배경(등급 0 · 풀이 지시 없음)은 남긴다.
[순위] TF-IDF (글자 2~4-gram) — 한국어 띄어쓰기에 덜 흔들린다. 결과가 비어도 정상이다.
"""

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from companion_npc.contracts.common import PlaySessionStateSnapshot
from companion_npc.contracts.npc_utterance import UtteranceKind
from companion_npc.contracts.scenario_pack import KnowledgeChunk, ScenarioPack
from companion_npc.contracts.visibility import visible_chunks

KIND_MAX_TIER = {"check_in": None, "clarify": 0, "nudge": 1, "hint": 2}
EVIDENCE_POLICIES = ("tier_le", "same_level")
BACKGROUND_KINDS = ("zone", "object", "premise")


def allowed_chunks(
    pack: ScenarioPack,
    case_id: str,
    state: PlaySessionStateSnapshot,
    kind: UtteranceKind,
    target_puzzle_id: str | None,
    confirmed_visible: frozenset[str] = frozenset(),
    policy: str = "tier_le",
) -> list[KnowledgeChunk]:
    if policy not in EVIDENCE_POLICIES:
        raise ValueError(f"unknown evidence policy: {policy}")
    tier = KIND_MAX_TIER[kind]
    if tier is None:
        return []
    chunks = visible_chunks(pack, case_id, state, max_tier=tier)
    if kind == "clarify":
        visible_objects = {
            o.object_id
            for o in pack.objects
            if o.initially_visible
            and o.zone_id == state.current_zone_id
            and o.object_id in confirmed_visible
        }
        return [
            c
            for c in chunks
            if c.kind == "object"
            and c.spoiler_tier == 0
            and _object_of(c) in visible_objects
        ]
    background = [
        c for c in chunks if c.kind in BACKGROUND_KINDS and c.spoiler_tier == 0
    ]
    target = [
        c for c in chunks if c.puzzle_id is not None and c.puzzle_id == target_puzzle_id
    ]
    if policy == "same_level":
        target = [c for c in target if c.spoiler_tier == tier and c.kind != "hint"]
    keep = {id(c) for c in background + target}
    return [c for c in chunks if id(c) in keep]  # 원래 순서 유지


def _object_of(chunk: KnowledgeChunk) -> str | None:
    # P2-A 변환기가 만든 오브젝트 조각의 출처 경로에서 오브젝트를 찾지 않고, ID 규칙(object:<id>)을 쓴다
    return (
        chunk.chunk_id.split(":", 1)[1]
        if chunk.chunk_id.startswith("object:")
        else None
    )


def rank(
    chunks: list[KnowledgeChunk], query: str | None, top_k: int = 3
) -> list[tuple[KnowledgeChunk, float]]:
    if not chunks:
        return []
    if not query or not query.strip():
        return [(c, 0.0) for c in chunks[:top_k]]
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
    matrix = vectorizer.fit_transform([c.text for c in chunks] + [query])
    scores = (matrix[:-1] @ matrix[-1].T).toarray().ravel()
    order = np.argsort(-scores, kind="stable")[:top_k]
    return [(chunks[i], float(scores[i])) for i in order]
