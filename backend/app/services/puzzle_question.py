"""퍼즐 풀이 질문 판별기 v0.1 (PM v0.4.3, 규칙 기반 · LLM 분류 없음 · 라우터 미연결).

플레이어가 NPC에게 보낸 문장이 퍼즐 풀이 질문인지 서버 규칙으로 가른다. 퍼즐 질문이면 일반 대화
생성을 하지 않는다(`app.services.npc_dialogue`).

[판정]
- 신호 A(풀이 요청 표현)가 있으면 퍼즐 질문.
- 신호 B(현재 세션에서 공개된 퍼즐 맥락의 낱말)가 있으면 문장 형태로 가른다.
  물음 → 퍼즐 질문 · 평서 → 일반 대화 · 어느 쪽인지 애매 → 퍼즐 질문(보수적).
- 둘 다 없으면 일반 대화.

[신호 B의 출처] 전역 목록이 아니다. `public_puzzle_contexts()`가 세션 상태에서 지금 공개된 것만 모은다.
- 현재 Zone에서 보이는 호스트 Object(퍼즐로 이어지는 상호작용을 가진 Object)의 이름
- 그 퍼즐의 `requires_clue_ids` 중 **이미 획득한** 단서의 제목
- 퍼즐 제목: 공개 콘텐츠에 제목 필드가 없어 호출하는 쪽이 넘길 때만 쓴다(출처 미정)
완료한 퍼즐 · 다른 Zone · 숨은 Object · 미획득 단서는 넣지 않는다.

[기록] 판별 결과에는 신호의 **종류**만 담는다. 플레이어 원문 · 맞은 낱말 · 퍼즐 이름 · 단서 제목은 담지 않는다.

[한계] 글자 비교다. 신호 A는 부분 문자열이라 일상 표현(예: "어디 있었어?")도 퍼즐 질문으로 본다 — 의도한
보수적 방향이다. "답"은 일상 낱말(대답 · 답답 등)을 따로 뺀다. 신호 B는 2글자 이상 낱말만 쓴다.
"""

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.object_state import resolve_effective_object_states

# 퍼즐로 이어지는 상호작용 종류(target_id가 puzzle_id)
PUZZLE_INTERACTION_TYPES = frozenset({"input", "select"})
# 이보다 짧은 신호 B 낱말은 일상 글자와 구별할 수 없어 쓰지 않는다.
MIN_TERM_LENGTH = 2

SignalACategory = Literal["answer_request", "procedure", "location", "stuck", "hint"]
SignalBKind = Literal["puzzle_title", "host_object", "clue_keyword"]
SentenceForm = Literal["question", "statement", "ambiguous"]
DecisionReason = Literal[
    "signal_a",
    "signal_b_question",
    "signal_b_ambiguous",
    "signal_b_statement",
    "no_signal",
]

# 신호 A — PM v0.4.3 목록. 띄어쓰기를 지운 형태로 비교한다(normalize_compact).
SIGNAL_A: tuple[tuple[str, SignalACategory], ...] = (
    ("정답", "answer_request"),
    ("답", "answer_request"),
    ("비밀번호", "answer_request"),
    ("암호", "answer_request"),
    ("순서", "procedure"),
    ("몇번", "procedure"),
    ("뭐넣", "procedure"),
    ("어떻게열", "procedure"),
    ("어떻게풀", "procedure"),
    ("뭘해야", "procedure"),
    ("어디있", "location"),
    ("막혔", "stuck"),
    ("모르겠", "stuck"),
    ("힌트", "hint"),
)
# "답"이 들어 있지만 풀이 요청이 아닌 일상 낱말. 이 낱말 안의 "답"은 신호로 세지 않는다.
ANSWER_WORD_EXCEPTIONS = ("대답", "답답", "답장", "보답", "응답", "답례", "회답")

_QUESTION_MARKS = ("?", "？")
_INTERROGATIVE_WORDS = (
    "뭐",
    "뭘",
    "무엇",
    "무슨",
    "어디",
    "어떻게",
    "왜",
    "언제",
    "누가",
    "몇",
)
_QUESTION_ENDINGS = ("까", "까요", "냐", "니", "나요", "가요", "는지", "을까", "죠")
_STATEMENT_ENDINGS = (
    "다",
    "네",
    "네요",
    "군",
    "군요",
    "구나",
    "더라",
    "더라고",
    "더라고요",
    "거든",
    "거든요",
    "는걸",
)
_SENTENCE_END_MARKS = (".", "!", "。", "！")
_NON_WORD = re.compile(r"[\W_]+")
_ZERO_WIDTH = re.compile(r"[​-‍﻿]")


@dataclass(frozen=True)
class PublicPuzzleContext:
    """한 퍼즐의 공개된 맥락 낱말. 서버 안에서만 쓰고 응답 · 기록에 싣지 않는다."""

    puzzle_id: str
    terms: tuple[tuple[str, SignalBKind], ...]


@dataclass(frozen=True)
class PuzzleQuestionDiagnosis:
    """판별 결과. 원문 · 맞은 낱말은 담지 않는다."""

    is_puzzle_question: bool
    reason: DecisionReason
    sentence_form: SentenceForm
    signal_a: tuple[SignalACategory, ...]
    signal_b: tuple[SignalBKind, ...]
    # 신호 B가 맞은 퍼즐 수. 1개일 때만 puzzle_id를 정한다(임의로 고르지 않는다).
    matched_puzzle_count: int
    puzzle_id: str | None


# --- 한국어 정규화 ---


def normalize_text(text: str) -> str:
    """NFKC · 소문자 · 폭 없는 문자 제거 · 공백 하나로. 문장 부호는 남긴다."""

    value = _ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", text)).casefold()
    return " ".join(value.split())


def normalize_compact(text: str) -> str:
    """신호 비교용 — 정규화 뒤 공백 · 문장 부호를 모두 지운다("뭐 넣어?" → "뭐넣어")."""

    return _NON_WORD.sub("", normalize_text(text))


def sentence_form(text: str) -> SentenceForm:
    normalized = normalize_text(text)
    compact = normalize_compact(text)
    if any(mark in normalized for mark in _QUESTION_MARKS):
        return "question"
    if any(word in compact for word in _INTERROGATIVE_WORDS):
        return "question"
    if compact.endswith(_QUESTION_ENDINGS):
        return "question"
    if compact.endswith(_STATEMENT_ENDINGS) or normalized.endswith(_SENTENCE_END_MARKS):
        return "statement"
    return "ambiguous"


# --- 신호 ---


def signal_a_categories(text: str) -> tuple[SignalACategory, ...]:
    compact = normalize_compact(text)
    found: list[SignalACategory] = []
    for pattern, category in SIGNAL_A:
        hit = _has_answer_word(compact) if pattern == "답" else pattern in compact
        if hit and category not in found:
            found.append(category)
    return tuple(found)


def _has_answer_word(compact: str) -> bool:
    masked = compact
    for word in ANSWER_WORD_EXCEPTIONS:
        masked = masked.replace(word, " " * len(word))
    return "답" in masked


def signal_b_matches(
    text: str, contexts: Iterable[PublicPuzzleContext]
) -> dict[str, tuple[SignalBKind, ...]]:
    """퍼즐별로 맞은 신호 B 종류. 낱말 자체는 돌려주지 않는다."""

    compact = normalize_compact(text)
    matches: dict[str, tuple[SignalBKind, ...]] = {}
    for context in contexts:
        kinds: list[SignalBKind] = []
        for term, kind in context.terms:
            if term in compact and kind not in kinds:
                kinds.append(kind)
        if kinds:
            matches[context.puzzle_id] = tuple(kinds)
    return matches


def classify_puzzle_question(
    text: str, contexts: Iterable[PublicPuzzleContext]
) -> PuzzleQuestionDiagnosis:
    form = sentence_form(text)
    a = signal_a_categories(text)
    b_matches = signal_b_matches(text, contexts)
    b_kinds = tuple(
        dict.fromkeys(kind for kinds in b_matches.values() for kind in kinds)
    )
    puzzle_id = next(iter(b_matches)) if len(b_matches) == 1 else None

    if a:
        reason: DecisionReason = "signal_a"
    elif b_matches:
        reason = {
            "question": "signal_b_question",
            "statement": "signal_b_statement",
            "ambiguous": "signal_b_ambiguous",
        }[form]
    else:
        reason = "no_signal"
    return PuzzleQuestionDiagnosis(
        is_puzzle_question=reason
        in ("signal_a", "signal_b_question", "signal_b_ambiguous"),
        reason=reason,
        sentence_form=form,
        signal_a=a,
        signal_b=b_kinds,
        matched_puzzle_count=len(b_matches),
        puzzle_id=puzzle_id,
    )


# --- 공개 맥락 ---


def public_puzzle_contexts(
    client: CaseClientContent,
    runtime: PuzzleRuntimeDefinition,
    state: Mapping[str, Any],
    *,
    puzzle_titles: Mapping[str, str] | None = None,
) -> tuple[PublicPuzzleContext, ...]:
    """세션에서 지금 공개된 퍼즐 맥락만 모은다(서버 상태 기준, 클라이언트 값 없음)."""

    current_zone_id = state.get("current_zone_id")
    completed = set(state.get("completed_puzzle_ids") or [])
    acquired = set(state.get("acquired_clue_ids") or [])
    effective = resolve_effective_object_states(client, state.get("object_states", {}))
    clue_titles = {clue.clue_id: clue.title for clue in runtime.clues}
    runtime_puzzles = {puzzle.puzzle_id: puzzle for puzzle in runtime.puzzles}

    hosts: dict[str, list[str]] = {}
    for zone in client.zones:
        if zone.zone_id != current_zone_id:
            continue
        for obj in zone.objects:
            interaction = obj.interaction
            if (
                interaction is None
                or interaction.type not in PUZZLE_INTERACTION_TYPES
                or interaction.target_id not in runtime_puzzles
                or interaction.target_id in completed
                or not effective[(zone.zone_id, obj.object_id)].visible
            ):
                continue
            hosts.setdefault(interaction.target_id, []).append(obj.object_name)

    contexts = []
    for puzzle_id, names in hosts.items():
        terms: list[tuple[str, SignalBKind]] = []
        if puzzle_titles and puzzle_titles.get(puzzle_id):
            terms += _terms(puzzle_titles[puzzle_id], "puzzle_title")
        for name in names:
            terms += _terms(name, "host_object")
        for clue_id in runtime_puzzles[puzzle_id].requires_clue_ids:
            if clue_id in acquired and clue_id in clue_titles:
                terms += _terms(clue_titles[clue_id], "clue_keyword")
        contexts.append(PublicPuzzleContext(puzzle_id, tuple(dict.fromkeys(terms))))
    return tuple(contexts)


def _terms(text: str, kind: SignalBKind) -> list[tuple[str, SignalBKind]]:
    words = [normalize_compact(word) for word in normalize_text(text).split()]
    whole = normalize_compact(text)
    candidates = [whole, *words]
    return [(word, kind) for word in candidates if len(word) >= MIN_TERM_LENGTH]
