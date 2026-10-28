"""AI 생성 일반 대화의 정책 검사 v0.1 (PM v0.4.3, 서버 내부 전용 · 라우터 미연결).

생성 문장 하나를 PM 지정 순서대로 검사한다. 위반이 하나라도 있으면 통과하지 않는다.

    1. ANSWER      열린(완료하지 않은) 퍼즐의 모든 정답 문자열
    2. LEAK_CLUE   미획득 단서 문장(title · summary · body)
       LEAK_HINT   아직 해금하지 않은 단계의 정식 힌트 원문(server.json)
                   — 정규화 뒤 8자 이상 연속 일치, 또는 공개되지 않은 핵심어 2개 이상 겹침
    3. NG          NG 규칙의 patterns 일치(patterns 가 없으면 text)
    4. U_ASSERT    U 규칙(open)의 patterns 가 맞으면 유보 표현이 있는지 확인

[검증할 수 없으면 통과가 아니다] 규칙 데이터가 없거나(`rules=None`) 규칙이 비어 판정할 수 없거나 힌트 원문을
읽지 못하면 `UNVERIFIED` 위반으로 남긴다. 명시적으로 빈 목록(NG 규칙 0개)은 「검사했고 해당 없음」이다.

[규칙 데이터] NG · U 규칙은 NPC 콘텐츠 계약(`npc.json` 의 `ng[]` · `open[]`)에 있지만 지금 BE 스키마
(`npc-pack 0.1`)에는 없다. 그래서 검증된 게시 절차가 넘겨 주는 `PolicyRules` 로만 받는다. 이 데이터는
model_context 에 넣지 않는다(U 의 공개 주제 이름만 예외 — `npc_model_context`).

[결과] `code` 와 `rule_id` 만 담는다. 생성 문장 · 정답 · 미공개 문장 · 패턴은 담지 않는다.
rule_id: ANSWER → puzzle_id · LEAK_CLUE → clue_id · LEAK_HINT → "puzzle_id:level" · NG / U_ASSERT → 규칙 ID.

[U 유보 표현] 규칙에 `hedges` 가 없으면 유보 여부를 확인할 수 없으므로, 패턴이 맞는 순간 위반으로 본다(보수적).

[한계] 글자 비교다. 바꿔 말하기 · 번역 · 숫자를 글자로 쓰기 · 철자 나누기는 못 잡을 수 있다.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import HintSource
from app.services.puzzle_question import normalize_compact, normalize_text

PolicyCode = Literal["ANSWER", "LEAK_CLUE", "LEAK_HINT", "NG", "U_ASSERT", "UNVERIFIED"]

# 미공개 문장과 이 길이 이상 연속으로 같으면 누출로 본다(정규화 글자 수).
LEAK_RUN_LENGTH = 8
# 공개되지 않은 핵심어가 이만큼 겹치면 누출로 본다.
LEAK_KEYWORD_OVERLAP = 2
MIN_KEYWORD_LENGTH = 2
MAX_HINT_LEVEL = 2

# 낱말 끝에서 떼는 조사(긴 것부터). 떼고 남는 글자가 MIN_STEM_LENGTH 보다 짧으면 떼지 않는다.
PARTICLES = (
    "에게서",
    "으로써",
    "으로서",
    "에서",
    "에게",
    "한테",
    "까지",
    "부터",
    "으로",
    "처럼",
    "보다",
    "마저",
    "조차",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "에",
    "의",
    "도",
    "와",
    "과",
    "로",
    "만",
)
MIN_STEM_LENGTH = 2
_TOKEN_SPLIT = re.compile(r"[\W_]+")


@dataclass(frozen=True)
class NgRule:
    rule_id: str
    text: str
    patterns: tuple[str, ...] = ()


@dataclass(frozen=True)
class OpenTopicRule:
    """U(해석 유보) 주제. `topic` 은 공개 가능한 주제 이름, `patterns` · `hedges` 는 서버 내부 전용."""

    rule_id: str
    topic: str
    patterns: tuple[str, ...]
    hedges: tuple[str, ...] = ()


@dataclass(frozen=True)
class PolicyRules:
    ng: tuple[NgRule, ...]
    open_topics: tuple[OpenTopicRule, ...]


@dataclass(frozen=True)
class PolicyViolation:
    code: PolicyCode
    rule_id: str


@dataclass(frozen=True)
class PolicyCheckResult:
    violations: tuple[PolicyViolation, ...]

    @property
    def passed(self) -> bool:
        return not self.violations


# --- 정규화 (조사 · 공백 · 구두점) ---


def strip_particle(token: str) -> str:
    for particle in PARTICLES:
        if token.endswith(particle) and len(token) - len(particle) >= MIN_STEM_LENGTH:
            return token[: -len(particle)]
    return token


def policy_tokens(text: str) -> list[str]:
    """정규화 → 공백 · 구두점으로 나눔 → 낱말마다 조사 하나를 뗀다."""

    return [
        strip_particle(token)
        for token in _TOKEN_SPLIT.split(normalize_text(text))
        if token
    ]


def policy_normalize(text: str) -> str:
    """조사를 뗀 낱말을 붙인 비교용 문자열("소화전을 열어 봐." → "소화전열어봐")."""

    return "".join(policy_tokens(text))


def policy_keywords(text: str) -> set[str]:
    return {token for token in policy_tokens(text) if len(token) >= MIN_KEYWORD_LENGTH}


def _forms(text: str) -> tuple[str, str]:
    # 조사를 뗀 형태와 떼지 않은 형태 둘 다 본다(떼기로 놓치는 일을 막는다).
    return policy_normalize(text), normalize_compact(text)


def _contains(haystack: tuple[str, str], needle: str) -> bool:
    forms = {form for form in _forms(needle) if form}
    return any(form in hay for form in forms for hay in haystack)


def _shares_run(text_forms: tuple[str, str], secret: str, run: int) -> bool:
    for secret_form in _forms(secret):
        if len(secret_form) < run:
            continue
        windows = {secret_form[i : i + run] for i in range(len(secret_form) - run + 1)}
        if any(window in form for window in windows for form in text_forms):
            return True
    return False


# --- 검사 ---


def check_generated_line(
    text: str,
    *,
    case_id: str,
    runtime: PuzzleRuntimeDefinition,
    state: Mapping[str, Any],
    hint_source: HintSource,
    rules: PolicyRules | None,
    public_texts: Iterable[str] = (),
) -> PolicyCheckResult:
    """`public_texts`: model_context 에 이미 들어간 공개 문자열. 핵심어 겹침에서 이 낱말은 빼고 센다."""

    forms = _forms(text)
    keywords = policy_keywords(text)
    public_keywords = set().union(*(policy_keywords(t) for t in public_texts))
    violations: list[PolicyViolation] = []

    completed = set(state.get("completed_puzzle_ids") or [])
    acquired = set(state.get("acquired_clue_ids") or [])
    hint_levels = state.get("hint_levels") or {}

    # 1. ANSWER — 짧은 정답도 빼지 않는다(생성 문장은 보수적으로 막는다).
    for puzzle in runtime.puzzles:
        if puzzle.puzzle_id in completed:
            continue
        if any(not any(_forms(answer)) for answer in puzzle.accepted_answers):
            # 정규화하면 비는 정답(구두점뿐 등)은 비교할 수 없다.
            violations.append(PolicyViolation("UNVERIFIED", puzzle.puzzle_id))
        elif any(_contains(forms, answer) for answer in puzzle.accepted_answers):
            violations.append(PolicyViolation("ANSWER", puzzle.puzzle_id))

    def leaked(secret: str) -> bool:
        if _shares_run(forms, secret, LEAK_RUN_LENGTH):
            return True
        hidden = policy_keywords(secret) - public_keywords
        return len(hidden & keywords) >= LEAK_KEYWORD_OVERLAP

    # 2. LEAK_CLUE · LEAK_HINT
    for clue in runtime.clues:
        if clue.clue_id in acquired:
            continue
        if any(t and leaked(t) for t in (clue.title, clue.summary, clue.body)):
            violations.append(PolicyViolation("LEAK_CLUE", clue.clue_id))
    for puzzle in runtime.puzzles:
        unlocked = hint_levels.get(puzzle.puzzle_id, 0)
        if not isinstance(unlocked, int) or isinstance(unlocked, bool):
            violations.append(
                PolicyViolation("UNVERIFIED", f"hint_level:{puzzle.puzzle_id}")
            )
            continue
        for level in range(unlocked + 1, MAX_HINT_LEVEL + 1):
            try:
                secret = hint_source(case_id, puzzle.puzzle_id, level)
            except Exception:
                violations.append(
                    PolicyViolation("UNVERIFIED", f"{puzzle.puzzle_id}:{level}")
                )
                continue
            if secret and secret.strip() and leaked(secret):
                violations.append(
                    PolicyViolation("LEAK_HINT", f"{puzzle.puzzle_id}:{level}")
                )

    if rules is None:
        violations.append(PolicyViolation("UNVERIFIED", "ng_rules"))
        violations.append(PolicyViolation("UNVERIFIED", "open_rules"))
        return PolicyCheckResult(tuple(violations))

    # 3. NG
    for rule in rules.ng:
        needles = [p for p in rule.patterns if p.strip()] or [rule.text]
        if not any(_forms(n)[0] for n in needles):
            violations.append(PolicyViolation("UNVERIFIED", rule.rule_id))
        elif any(_contains(forms, needle) for needle in needles):
            violations.append(PolicyViolation("NG", rule.rule_id))

    # 4. U_ASSERT
    for rule in rules.open_topics:
        patterns = [p for p in rule.patterns if _forms(p)[0]]
        if not patterns:
            violations.append(PolicyViolation("UNVERIFIED", rule.rule_id))
            continue
        if not any(_contains(forms, pattern) for pattern in patterns):
            continue
        # 유보 표현은 어미 · 조사가 뜻을 만든다("일지도"의 "도"). 조사를 떼지 않은 형태로만 비교한다.
        compact = normalize_compact(text)
        hedges = [normalize_compact(h) for h in rule.hedges]
        if not any(h and h in compact for h in hedges):
            violations.append(PolicyViolation("U_ASSERT", rule.rule_id))

    return PolicyCheckResult(tuple(violations))
