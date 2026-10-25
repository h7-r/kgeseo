"""공통 출력 안전 검증 — 유형·생성기와 관계없이 같은 검사를 같은 순서로.

[검사 범위]  ★ 실제 발화 문장(Draft.text)만 본다.
  구조화된 메타데이터(ID 필드 · 지표 · 해시 · 시각)는 이 검사의 대상이 아니다 — 숫자 정답이 지표값
  안에서 우연히 잡히는 오탐(docs/06 §9.4)을 범위를 나눠 피한다. 발화 문장 안의 숫자는 그대로 검사한다.

[검사]
  answer_leak         정답 · 별칭 · (숫자 정답이면) 한글 숫자 읽기
  internal_id         팩의 ID 전체(정규화) · 퍼즐·단서·flag ID 의 연속 두 조각 (예: keeper truth)
  undisclosed_content 지금 꺼낼 수 없는 조각(다른 등급 · 닫힌 공개 조건 · 반전)의 문구가 8자 이상 겹침
  kind:<유형>          check_in 에 사건 이름·지식 문구 · clarify 에 허용 안 된 이름 · 길이
  ungrounded          nudge · hint 전체가 승인 힌트·허용 조각에 근거하지 않음 (4-gram 지지율 < 0.5)
  unsupported_sentence nudge · hint 의 **문장·절마다** 근거로 덮이지 않은 연속 글자가 9자 이상이면 실패 (P4-A 보완)
                      — 근거와 같은 4-gram 이 덮는 글자를 표시하고, 덮이지 않은 가장 긴 연속 구간을 잰다.
                      승인 힌트 뒤에 새 사실 · 사건 주장 · 해결 지시를 덧붙이면 그 구간이 길어져 걸린다.
                      전체 일치율이 높아도 한 절이 걸리면 실패한다. SAFE_PHRASES(인사·격려)는 덮인 것으로 본다.
                      (쉼표로는 절을 나누지 않는다 — 짧은 조각이 생겨 정당한 바꿔 말하기를 막았다)

[한계] 글자 비교다. 돌려 말하기 · 번역 · 자모 분해 · 철자 읽기("브이 에이 …")는 별칭이 없으면 못 잡는다.
       문장·절 단위 검사도 근거 문장 **안에** 짧게 끼워 넣은 표현은 못 잡을 수 있다(평가 semantic_limit).
       반대로 정당하게 바꿔 말한 한국어 문장을 막을 수 있다(평가 legit_paraphrase 에서 오탐을 잰다).
       의미 수준 검사와 사람의 레드팀 검토는 P4-B 평가 항목이다.
"""

import re
from dataclasses import dataclass

from companion_npc.contracts.scenario_pack import KnowledgeChunk, ScenarioPack
from companion_npc.contracts.spoiler import find_answer_leaks, normalize
from companion_npc.speech.payload import PromptPayload

MAX_SPEECH = 280
WINDOW = 8  # 비공개 조각 문구 겹침 판정 길이 (정규화 글자 수)
GROUNDING_NGRAM = 4
GROUNDING_MIN = 0.5
# 문장·절 안에서 근거로 덮이지 않은 연속 글자(정규화)가 이 길이 이상이면 실패.
#   테스트 견본에서 잰 값: 표현이 가까운 정당한 바꿔 말하기 2~10 · 덧붙인 공격 문장 9~27 · 문장 안 끼워 넣기 6.
#   두 분포가 겹쳐(10 대 9) 깨끗한 경계가 없다 — 안전 쪽(9)을 골랐다. 견본이 작아 일반화된 값이 아니다.
UNSUPPORTED_RUN = 9
# 근거가 없어도 되는 짧은 인사·격려 (정규화해서 비교). 사건 정보를 담을 수 없는 표현만 둔다.
SAFE_PHRASES = frozenset(
    {
        "좋아요",
        "괜찮아요",
        "같이봐요",
        "같이살펴봐요",
        "천천히해보세요",
        "천천히해봐요",
        "힘내세요",
        "잘하고있어요",
        "거의다왔어요",
        "제가옆에있을게요",
    }
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?。…])\s+|[\r\n]+")
_CLAUSE_SPLIT = re.compile(
    r"\s*;\s*|\s+(?:그리고|그런데|하지만|그러면|그러니까|그다음에|그다음|또한|그래서)\s+"
)
GENERIC_ID_PARTS = frozenset(
    {
        "puzzle",
        "clue",
        "zone",
        "obj",
        "object",
        "case",
        "fixture",
        "hint",
        "pack",
        "flag",
        "k",
        "h",
        "npc",
    }
)
_SINO = {"0": ("공", "영"), "1": ("일",), "2": ("이",), "3": ("삼",), "4": ("사",), "5": ("오",),
         "6": ("육", "륙"), "7": ("칠",), "8": ("팔",), "9": ("구",)}  # fmt: skip


def korean_digit_readings(answer: str, limit: int = 8) -> list[str]:
    """숫자 정답의 한글 읽기 (예: 1204 → 일이공사 · 일이영사). 조합이 많으면 limit 개까지만."""

    if not answer.isdigit():
        return []
    readings = [""]
    for digit in answer:
        readings = [r + s for r in readings for s in _SINO[digit]][:limit]
    return readings


def _windows(text: str, size: int) -> set[str]:
    """정규화한 글자 size 개짜리 조각 전부 (텍스트가 짧으면 빈 집합)."""

    norm = normalize(text)
    return {norm[i : i + size] for i in range(len(norm) - size + 1)}


def segments(text: str) -> list[str]:
    """문장 → 절. 빈 조각은 버린다."""

    out = []
    for sentence in _SENTENCE_SPLIT.split(text.strip()):
        out += [c.strip() for c in _CLAUSE_SPLIT.split(sentence) if c and c.strip()]
    return out


def longest_uncovered_run(segment: str, base: set[str]) -> int:
    """근거 4-gram 이 덮지 못한 가장 긴 연속 글자 수 (정규화 기준). 안전 문구는 덮인 것으로 본다."""

    norm = normalize(segment)
    covered = [False] * len(norm)
    for i in range(len(norm) - GROUNDING_NGRAM + 1):
        if norm[i : i + GROUNDING_NGRAM] in base:
            covered[i : i + GROUNDING_NGRAM] = [True] * GROUNDING_NGRAM
    for phrase in SAFE_PHRASES:
        start = norm.find(phrase)
        while start != -1:
            covered[start : start + len(phrase)] = [True] * len(phrase)
            start = norm.find(phrase, start + 1)
    best = run = 0
    for c in covered:
        run = 0 if c else run + 1
        best = max(best, run)
    return best


def unsupported_segments(text: str, support_texts: list[str]) -> list[str]:
    """근거로 덮이지 않은 구간이 UNSUPPORTED_RUN 이상인 문장·절."""

    base = (
        set().union(*(_windows(t, GROUNDING_NGRAM) for t in support_texts))
        if support_texts
        else set()
    )
    return [
        s for s in segments(text) if longest_uncovered_run(s, base) >= UNSUPPORTED_RUN
    ]


def _id_parts(identifier: str) -> list[str]:
    return [
        p
        for p in re.split(r"[^0-9a-z]+", identifier.casefold())
        if p and p not in GENERIC_ID_PARTS
    ]


@dataclass(frozen=True)
class GuardResult:
    passed: bool
    failures: tuple[str, ...]


class SpeechGuard:
    def __init__(self, pack: ScenarioPack, forbidden_terms: list[str]) -> None:
        self._pack = pack
        terms = list(forbidden_terms)
        for term in forbidden_terms:
            terms += korean_digit_readings(normalize(term))
        self._terms = terms
        ids = (
            [pack.case_id, pack.pack_id]
            + [z.zone_id for z in pack.zones]
            + [o.object_id for o in pack.objects]
            + [p.puzzle_id for p in pack.puzzles]
            + [c.clue_id for c in pack.clues]
            + [h.hint_id for h in pack.hints]
            + [k.chunk_id for k in pack.knowledge]
        )
        flags = {f for p in pack.puzzles for f in p.sets_flags} | {
            f for k in pack.knowledge for f in k.gate.requires_flags
        }
        self._full_ids = {
            normalize(i) for i in ids + sorted(flags) if len(normalize(i)) >= 4
        }
        pairs = set()
        for identifier in (
            [p.puzzle_id for p in pack.puzzles]
            + [c.clue_id for c in pack.clues]
            + sorted(flags)
        ):
            parts = _id_parts(identifier)
            pairs |= {a + b for a, b in zip(parts, parts[1:]) if len(a + b) >= 6}
        self._names = {normalize(o.object_name) for o in pack.objects} | {
            normalize(z.zone_name) for z in pack.zones
        }
        # 공개된 이름 안에 이미 있는 조각 쌍은 비밀이 아니다 (예: fire+cabinet ⊂ "Fire Cabinet Letter Lock")
        self._id_pairs = {p for p in pairs if not any(p in n for n in self._names)}
        self._all_knowledge_windows = (
            set().union(*(_windows(k.text, WINDOW) for k in pack.knowledge))
            if pack.knowledge
            else set()
        )

    def check(
        self, text: str, payload: PromptPayload, allowed: list[KnowledgeChunk]
    ) -> GuardResult:
        failures: list[str] = []
        norm = normalize(text)
        if not norm:
            return GuardResult(False, ("empty",))
        if len(text) > MAX_SPEECH:
            failures.append("too_long")
        if find_answer_leaks({"speech": text}, self._terms):
            failures.append("answer_leak")
        if any(i in norm for i in self._full_ids) or any(
            p in norm for p in self._id_pairs
        ):
            failures.append("internal_id")

        allowed_texts = [c.text for c in allowed]
        if payload.approved_hint:
            allowed_texts.append(payload.approved_hint.text)
        safe_windows = (
            set().union(*(_windows(t, WINDOW) for t in allowed_texts))
            if allowed_texts
            else set()
        )
        for group in (
            payload.templates.check_in,
            payload.templates.clarify_general,
            payload.templates.clarify_with_object,
        ):
            for t in group:
                safe_windows |= _windows(t.text, WINDOW)
        allowed_ids = {c.chunk_id for c in allowed}
        hidden = [k for k in self._pack.knowledge if k.chunk_id not in allowed_ids]
        text_windows = _windows(text, WINDOW)
        if any(
            (_windows(k.text, WINDOW) - safe_windows) & text_windows for k in hidden
        ):
            failures.append("undisclosed_content")

        if payload.kind == "check_in":
            if any(n and n in norm for n in self._names) or (
                text_windows & self._all_knowledge_windows - safe_windows
            ):
                failures.append("kind:check_in_mentions_case_content")
        elif payload.kind == "clarify":
            allowed_name = (
                normalize(payload.object_name) if payload.object_name else None
            )
            if any(n and n in norm and n != allowed_name for n in self._names):
                failures.append("kind:clarify_unapproved_name")
        else:
            grams = _windows(text, GROUNDING_NGRAM)
            base = (
                set().union(*(_windows(t, GROUNDING_NGRAM) for t in allowed_texts))
                if allowed_texts
                else set()
            )
            if not grams or len(grams & base) / len(grams) < GROUNDING_MIN:
                failures.append("ungrounded")
            if unsupported_segments(text, allowed_texts):
                failures.append("unsupported_sentence")
        return GuardResult(not failures, tuple(dict.fromkeys(failures)))
