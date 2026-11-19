"""닉네임·자유 글 금칙어 판정. 목록은 저장소 공용 shared/nickname-policy.json 이다.

화면(website/src/lib/nicknamePolicy.ts)이 같은 파일로 1차 판정하고(10/13 합의), 여기서는 같은 목록으로 2차 방어를 한다.
판정은 JSON matching.$steps 가운데 글 모양 바꾸기(1·2 일부)·뼈대 비교(4·6)·word 경계(8)·정상 낱말 예외(9)·
compose 펼치기(10)·예약어 먼저(11)만 둔다. 늘임 줄이기(3)·소리 나는 대로 나눔(5)·두벌식 자판·숫자 읽기는 화면만 본다.
그래서 서버가 막으면 화면도 막지만(반대는 아니다), 늘인 표기 같은 변형 일부는 화면만 막는다.

앱이 뜰 때(모듈을 처음 불러올 때) 한 번 읽는다. 파일이 없으면 옛 자체 목록(_FALLBACK_POLICY)으로 돈다.
"""

# tools/nickname-policy/backend.py 가 이 파일만 따로 불러 돌린다(Python 3.9, sys.modules 등록 없음).
# 그래서 `from __future__ import annotations` 와 `X | None` 표기를 쓰지 않는다 — dataclass 가 주석을 풀지 못한다.
import json
import logging
import re
import unicodedata
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

POLICY_PATH = Path(__file__).resolve().parents[3] / "shared" / "nickname-policy.json"

# shared JSON 이 없을 때 쓰는 옛 자체 목록(10/6 판). 모양은 JSON 과 같게 맞춰 두어 판정기는 하나다.
_FALLBACK_POLICY: dict[str, Any] = {
    "minLength": 2,
    "maxLength": 12,
    "matching": {
        "leet": {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t"},
        "leetAlternatives": {},
        "consonantGroups": [],
        "vowelGroups": [],
    },
    "reserved": {
        "word": [
            "admin",
            "administrator",
            "root",
            "system",
            "gm",
            "관리자",
            "운영자",
            "운영팀",
            "왜곡",
        ],
        "contains": [],
    },
    "forbidden": {
        "categories": {
            "abuse": {
                "message": "abusive",
                "contains": [
                    "시발",
                    "씨발",
                    "병신",
                    "개새끼",
                    "좆",
                    "보지",
                    "자지",
                    "fuck",
                    "shit",
                    "bitch",
                ],
                "strict": [],
                "word": [],
            }
        },
        "allow": [],
    },
    "compose": {"alternates": {}, "rules": []},
}

# 이름 전체가 이 말이면 금칙어 검사를 건너뛴다(들어 있는 다른 이름은 그대로 본다). 화면은 이 말을 막는다 — 화면만 막는 쪽이라 둔다.
FORBIDDEN_EXACT_EXCEPTIONS = frozenset({"shitake"})
NICKNAME_SHAPE = re.compile(r"[가-힣A-Za-z0-9_]+")

# ── 한글 음절을 비교용 부호로 ──────────────────────────────────
CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
# 0번은 받침 없음
JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"
# 음절은 초·중·종성 세 부호로 편다. 자리마다 다른 사용자 영역 글자를 써서 초성은 초성끼리만 맞는다(화면과 같은 배치).
CHO_BASE, JUNG_BASE, JONG_BASE = 0xE000, 0xE020, 0xE040
HANGUL_FIRST, HANGUL_COUNT = 0xAC00, 11172
COMPAT_JAMO = re.compile(r"[ㄱ-ㅣ]")

KINDS = ("contains", "strict", "word")


class InvalidNicknameError(Exception):
    pass


def load_policy(path: Path = POLICY_PATH) -> dict[str, Any]:
    """공용 JSON 을 읽는다. 없으면 옛 목록으로 — 깨진 파일은 기동을 멈춰야 하므로 그대로 던진다."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("닉네임 정책 %s 가 없어 내장 목록으로 판정한다", path)
        return _FALLBACK_POLICY


def normalize_nickname(value: str) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip()


def _group_table(alphabet: str, groups: Sequence[str]) -> list[int]:
    """자모마다 묶음 대표의 자리. 어느 묶음에도 없으면 제 자리."""
    table: list[int] = []
    for index, jamo in enumerate(alphabet):
        group = next((members for members in groups if jamo in members), None)
        table.append(alphabet.index(group[0]) if group else index)
    return table


# (글자, 원래 글의 자리). 밑줄을 빼거나 leet 로 바꿔도 자리는 남겨 정상 낱말 자리와 견준다.
Traced = tuple[str, int]


@dataclass(frozen=True)
class Encoded:
    codes: str
    ats: tuple[int, ...]
    scripts: tuple[str, ...]


class Encoder:
    def __init__(self, matching: dict[str, Any]) -> None:
        self.cho_group = _group_table(CHO, matching["consonantGroups"])
        self.jung_group = _group_table(JUNG, matching["vowelGroups"])
        # 받침도 초성과 같은 묶음을 쓴다. 묶음 대표(ㄱㄷㅂㅅㅈ)는 모두 받침이 될 수 있다.
        self.jong_group = _group_table(JONG, matching["consonantGroups"])

    def encode(self, text: Iterable[Traced], grouped: bool) -> Encoded:
        codes: list[str] = []
        ats: list[int] = []
        scripts: list[str] = []
        for char, at in text:
            syllable = ord(char) - HANGUL_FIRST
            if 0 <= syllable < HANGUL_COUNT:
                cho, jung, jong = syllable // 588, syllable % 588 // 28, syllable % 28
                if grouped:
                    cho, jung, jong = (
                        self.cho_group[cho],
                        self.jung_group[jung],
                        self.jong_group[jong],
                    )
                codes += [
                    chr(CHO_BASE + cho),
                    chr(JUNG_BASE + jung),
                    chr(JONG_BASE + jong),
                ]
                ats += [at, at, at]
                scripts += ["hangul", "hangul", "hangul"]
                continue
            script = (
                "latin"
                if "a" <= char <= "z"
                else "digit"
                if "0" <= char <= "9"
                else "other"
            )
            # 글자가 아닌 것(띄어쓰기·기호)만 한 부호로 모은다. 그 밖의 글자는 제 모양 그대로.
            codes.append(char if script != "other" or char.isalpha() else " ")
            ats.append(at)
            scripts.append(script)
        return Encoded("".join(codes), tuple(ats), tuple(scripts))


@dataclass(frozen=True)
class Pattern:
    code: str
    word: str
    kind: str
    category: str


# 첫 부호로 나눠 둔 목록. 글의 자리마다 그 부호로 시작하는 낱말만 맞춰 본다.
Index = dict[str, list[Pattern]]


@dataclass(frozen=True)
class Match:
    word: str
    category: str
    # NFKC 로 다듬은 글에서 걸린 자리 [start, end)
    start: int
    end: int


@dataclass(frozen=True)
class Prepared:
    # (적힌 그대로, 뼈대) 쌍. strict·word·예약어는 그대로에서, contains 는 뼈대에서 찾는다.
    forms: tuple[tuple[Encoded, Encoded], ...]
    # 정상 낱말이 차지한 자리 [start, end). 이 안에 통째로 든 금칙어는 없던 것으로 본다.
    allowed: tuple[tuple[int, int], ...]


def _compose_words(compose: dict[str, Any]) -> Iterator[tuple[str, str, list[str]]]:
    """조합 규칙을 펼친다: 앞말 × 바탕, 각 조각은 alternates 의 틀린 표기까지(걸레 → 걸래)."""
    alternates: dict[str, list[str]] = compose["alternates"]

    def spellings(part: str) -> list[str]:
        return [part, *alternates.get(part, [])]

    for rule in compose["rules"]:
        words = [
            prefix + stem
            for head in rule["prefixes"]
            for prefix in spellings(head)
            for tail in rule["stems"]
            for stem in spellings(tail)
        ]
        yield rule["category"], rule["kind"], words


def _forbidden_lists(policy: dict[str, Any]) -> Iterator[tuple[str, str, list[str]]]:
    for category, lists in policy["forbidden"]["categories"].items():
        for kind in KINDS:
            yield category, kind, lists[kind]
    yield from _compose_words(policy["compose"])


class Judge:
    """목록을 한 번 부호로 바꿔 두고 판정한다. 모듈의 JUDGE 하나를 앱 전체가 쓴다."""

    def __init__(self, policy: dict[str, Any]) -> None:
        self.min_length: int = policy["minLength"]
        self.max_length: int = policy["maxLength"]
        matching = policy["matching"]
        self.encoder = Encoder(matching)
        self.leet: dict[str, str] = matching["leet"]
        self.leet_alt: dict[str, str] = {**self.leet, **matching["leetAlternatives"]}
        # 사칭어는 뼈대로 묶지 않는다. 묶으면 윤영자(이름)가 운영자로 읽힌다.
        self.reserved: Index = {}
        for kind in ("word", "contains"):
            self._add_words(
                self.reserved, policy["reserved"][kind], kind, "reserved", grouped=False
            )
        # contains 만 뼈대로. strict·word 는 적힌 그대로(씹 ≠ 십, 애자 ≠ 에자).
        self.forbidden_raw: Index = {}
        self.forbidden_grouped: Index = {}
        for category, kind, words in _forbidden_lists(policy):
            if kind == "contains":
                self._add_words(
                    self.forbidden_grouped, words, kind, category, grouped=True
                )
            else:
                self._add_words(
                    self.forbidden_raw, words, kind, category, grouped=False
                )
        # 정상 낱말. '?' 는 한글 한 음절 자리 — 황보지? 는 황보지은(성 황보 + 이름)만 살리고 황보지 단독은 막는다.
        allow: list[str] = policy["forbidden"]["allow"]
        self.allow: Index = {}
        self._add_words(
            self.allow,
            [w for w in allow if "?" not in w],
            "contains",
            "allow",
            grouped=False,
        )
        self.allow_shapes = [
            (re.compile(re.escape(word).replace(r"\?", "[가-힣]")), word.index("?"))
            for word in allow
            if "?" in word
        ]

    def _add_words(
        self,
        index: Index,
        words: Iterable[str],
        kind: str,
        category: str,
        *,
        grouped: bool,
    ) -> None:
        for word in words:
            # ㅅㅂ 같은 자모 축약은 자유 글용이고 닉네임에는 들어올 수 없다. 여기서는 보지 않는다.
            if COMPAT_JAMO.search(word):
                continue
            normalized = unicodedata.normalize("NFKC", word).lower()
            code = self.encoder.encode(enumerate_chars(normalized), grouped).codes
            index.setdefault(code[0], []).append(Pattern(code, word, kind, category))

    # ── 글을 여러 모양으로 ──
    def prepare(self, source: str) -> Prepared:
        """비교할 모양들: 그대로 / 글자만(숫자 뺌) / 셋 이상 겹친 영문을 둘로 / leet / leet 다른 읽기.

        밑줄만 건너뛴다(닉네임 규칙). 띄어쓰기·기호는 한 부호로 남겨 낱말을 넘어 붙여 읽지 않는다 — 화면보다 좁은 쪽이다.
        """
        lower = [
            (char, at)
            for at, raw in enumerate(source)
            if raw != "_"
            for char in raw.lower()
        ]
        letters = [(char, at) for char, at in lower if not "0" <= char <= "9"]
        squeezed = [
            unit
            for index, unit in enumerate(letters)
            if not (
                "a" <= unit[0] <= "z"
                and index >= 2
                and letters[index - 1][0] == letters[index - 2][0] == unit[0]
            )
        ]
        texts = [
            lower,
            letters,
            squeezed,
            self._map(lower, self.leet),
            self._map(lower, self.leet_alt),
        ]
        forms = tuple(
            (self.encoder.encode(t, False), self.encoder.encode(t, True)) for t in texts
        )
        return Prepared(forms, self._allowed_spans(lower, letters))

    @staticmethod
    def _map(text: Sequence[Traced], table: dict[str, str]) -> list[Traced]:
        return [(table.get(char, char), at) for char, at in text]

    def _allowed_spans(self, *texts: Sequence[Traced]) -> tuple[tuple[int, int], ...]:
        """정상 낱말 자리는 원래 글(숫자 포함·숫자 뺀 것)에서 그대로 찾는다. 뼈대로 찾으면 씨발점도 시발점이 된다."""
        spans: list[tuple[int, int]] = []
        for text in texts:
            spans += [
                (hit.start, hit.end)
                for hit in self._scan(self.encoder.encode(text, False), self.allow)
            ]
            joined = "".join(char for char, _ in text)
            for pattern, literal in self.allow_shapes:
                for found in pattern.finditer(joined):
                    # '?' 앞의 글자까지만 정상 낱말 자리다 — 황보지랄의 '지랄'이 예외로 덮이지 않게.
                    start = found.start()
                    spans.append((text[start][1], text[start + literal - 1][1] + 1))
        return tuple(spans)

    # ── 찾기 ──
    @staticmethod
    def _scan(encoded: Encoded, index: Index) -> Iterator[Match]:
        codes = encoded.codes
        for start, first in enumerate(codes):
            for pattern in index.get(first, ()):
                end = start + len(pattern.code)
                if not codes.startswith(pattern.code, start):
                    continue
                if pattern.kind == "word" and not _is_word_edge(encoded, start, end):
                    continue
                yield Match(
                    pattern.word,
                    pattern.category,
                    encoded.ats[start],
                    encoded.ats[end - 1] + 1,
                )

    def _hits(
        self, prepared: Prepared, raw: Index, grouped: Optional[Index] = None
    ) -> Iterator[Match]:
        for raw_form, grouped_form in prepared.forms:
            passes = [(raw_form, raw)] + ([(grouped_form, grouped)] if grouped else [])
            for encoded, index in passes:
                for hit in self._scan(encoded, index):
                    if any(
                        start <= hit.start and hit.end <= end
                        for start, end in prepared.allowed
                    ):
                        continue
                    yield hit

    # ── 판정 ──
    def validate_nickname(self, value: str) -> str:
        # 끝에 붙은 탭 같은 제어 문자가 trim 으로 몰래 사라지지 않게 다듬기 전에 본다.
        if any(unicodedata.category(c).startswith("C") for c in value):
            raise InvalidNicknameError
        nickname = normalize_nickname(value)
        if not self.min_length <= len(nickname) <= self.max_length:
            raise InvalidNicknameError
        if NICKNAME_SHAPE.fullmatch(nickname) is None:
            raise InvalidNicknameError
        prepared = self.prepare(nickname)
        if next(self._hits(prepared, self.reserved), None) is not None:
            raise InvalidNicknameError
        if self._is_exact_exception(nickname):
            return nickname
        if (
            next(self._hits(prepared, self.forbidden_raw, self.forbidden_grouped), None)
            is not None
        ):
            raise InvalidNicknameError
        return nickname

    def forbidden_terms_in(self, value: str) -> tuple[str, ...]:
        """글에 든 금칙어(목록에 적힌 낱말). 예외는 이름 전체가 그 말일 때만이고, 들어 있기만 한 이름은 그대로 본다."""
        text = normalize_nickname(value)
        if self._is_exact_exception(text):
            return ()
        hits = self._hits(
            self.prepare(text), self.forbidden_raw, self.forbidden_grouped
        )
        return tuple(sorted({hit.word for hit in hits}))

    def has_reserved_term(self, value: str) -> bool:
        """운영·서비스 사칭어가 들었나(조사관명처럼 닉네임 밖 이름도 같은 기준으로 본다)."""
        return (
            next(
                self._hits(self.prepare(normalize_nickname(value)), self.reserved), None
            )
            is not None
        )

    @staticmethod
    def _is_exact_exception(text: str) -> bool:
        return text.lower().replace("_", "") in FORBIDDEN_EXACT_EXCEPTIONS


def enumerate_chars(text: str) -> list[Traced]:
    return [(char, at) for at, char in enumerate(text)]


def _is_word_edge(encoded: Encoded, start: int, end: int) -> bool:
    """word 낱말은 앞뒤 글자가 같은 종류(한글/영문/숫자)가 아닐 때만(ass ≠ class, admin7 은 걸림)."""
    scripts = encoded.scripts
    before_ok = start == 0 or scripts[start - 1] != scripts[start]
    after_ok = end == len(scripts) or scripts[end] != scripts[end - 1]
    return before_ok and after_ok


JUDGE = Judge(load_policy())
MAX_NICKNAME_LENGTH = JUDGE.max_length


def validate_nickname(value: str) -> str:
    return JUDGE.validate_nickname(value)


def forbidden_terms_in(value: str) -> tuple[str, ...]:
    """글에 든 금칙어. 일반 대사 팩 정책(GEN-WORD)·로비 조사관명이 닉네임과 같은 기준으로 다시 쓴다."""
    return JUDGE.forbidden_terms_in(value)


def has_reserved_term(value: str) -> bool:
    return JUDGE.has_reserved_term(value)
