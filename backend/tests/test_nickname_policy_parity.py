"""화면과 서버가 같은 금칙어 목록을 보는지(11/18 M6).

shared/nickname-policy.json 의 낱말 전부를 서버 판정에 넣어 하나라도 통과하면 실패한다 — 화면이 막는 이름이
API 로 바로 가입되던 구멍이 다시 열리지 않게. 변형 표기까지 견주는 전체 비교는 `npm run check:nickname -- --parity`.
"""

import json
import re

import pytest

from app.services import nickname_policy
from app.services.nickname_policy import (
    POLICY_PATH,
    InvalidNicknameError,
    Judge,
    forbidden_terms_in,
    has_reserved_term,
    load_policy,
    validate_nickname,
)

POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
NICKNAME_SHAPE = re.compile(r"[가-힣A-Za-z0-9_]+")
JAMO = re.compile(r"[ㄱ-ㅣ]")


def nickname_like(word: str) -> bool:
    """닉네임 칸에 그대로 넣을 수 있는 모양(2~12자 · 한글/영문/숫자/밑줄)."""
    return (
        POLICY["minLength"] <= len(word) <= POLICY["maxLength"]
        and NICKNAME_SHAPE.fullmatch(word) is not None
    )


def compose_words() -> list[str]:
    alternates = POLICY["compose"]["alternates"]
    spell = lambda part: [part, *alternates.get(part, [])]  # noqa: E731
    return [
        p + s
        for rule in POLICY["compose"]["rules"]
        for prefix in rule["prefixes"]
        for p in spell(prefix)
        for stem in rule["stems"]
        for s in spell(stem)
    ]


FORBIDDEN_WORDS = [
    word
    for lists in POLICY["forbidden"]["categories"].values()
    for kind in ("contains", "strict", "word")
    for word in lists[kind]
] + compose_words()
RESERVED_WORDS = POLICY["reserved"]["word"] + POLICY["reserved"]["contains"]


def test_shared_policy_is_the_one_loaded():
    assert POLICY_PATH.exists()
    # 폴백 목록에는 없는 낱말이 막히면 공용 JSON 을 읽은 것이다
    assert nickname_policy.JUDGE.max_length == POLICY["maxLength"]
    with pytest.raises(InvalidNicknameError):
        validate_nickname("support")


def test_every_forbidden_word_is_rejected_as_a_nickname():
    passed = [
        word for word in FORBIDDEN_WORDS if nickname_like(word) and _accepts(word)
    ]
    assert passed == [], f"화면은 막는데 서버는 통과시키는 금칙어 {len(passed)}개"


def test_every_reserved_word_is_rejected_as_a_nickname():
    passed = [word for word in RESERVED_WORDS if nickname_like(word) and _accepts(word)]
    assert passed == [], f"화면은 막는데 서버는 통과시키는 예약어 {len(passed)}개"


def test_words_too_long_or_spaced_for_a_nickname_are_still_found_in_text():
    # 자모 축약(ㅅㅂ)은 자유 글 전용이라 서버 2차 방어에서는 보지 않는다
    long_words = [
        w for w in FORBIDDEN_WORDS if not nickname_like(w) and not JAMO.search(w)
    ]
    missed = [word for word in long_words if not forbidden_terms_in(word)]
    assert missed == [], f"목록에 있는데 글에서 못 찾는 낱말 {len(missed)}개"
    assert all(has_reserved_term(w) for w in RESERVED_WORDS if not nickname_like(w))


def test_allowed_words_pass():
    """정상 낱말(allow)은 그 자리에 든 금칙어를 없던 것으로 본다 — 시바견 · 불알친구 · 황보지은."""
    plain = [
        w for w in POLICY["forbidden"]["allow"] if "?" not in w and nickname_like(w)
    ]
    blocked = [word for word in plain if not _accepts(word)]
    assert blocked == [], f"화면은 통과시키는 정상 낱말을 서버가 막음 {len(blocked)}개"
    assert validate_nickname("황보지은") == "황보지은"
    for name in ("황보지", "황보지랄", "시발점시발"):
        with pytest.raises(InvalidNicknameError):
            validate_nickname(name)


@pytest.mark.parametrize(
    "nickname",
    # 11/18 점검 때 register 201 이 났던 이름들(화면은 모두 막았다)
    [
        "개돼지",
        "support",
        "운영팀장",
        "개돼지왕",
        "support9",
        "운영팀부장",
        "개돼지3",
        "gamemaster",
    ],
)
def test_audit_examples_are_rejected(nickname):
    with pytest.raises(InvalidNicknameError):
        validate_nickname(nickname)


@pytest.mark.parametrize(
    "nickname",
    # 뼈대(된소리·비슷한 모음) · leet · 밑줄 · 앞뒤 글자 — 화면과 같은 1·2·4단계(늘인 fuuuck 는 화면만 막는다)
    [
        "씨발",
        "쒸발",
        "씨빨",
        "sh1t",
        "f_u_c_k",
        "xxfuck99",
        "개쉐끼",
        "ADMIN_123",
        "admin7",
        "운영자김철수",
    ],
)
def test_variants_the_server_also_catches(nickname):
    with pytest.raises(InvalidNicknameError):
        validate_nickname(nickname)


@pytest.mark.parametrize(
    "nickname",
    # 한 끗 차이 정상 이름 — 뼈대 비교가 넓어지지 않았는지
    [
        "윤영자",
        "badminton",
        "administer",
        "classic",
        "시바견",
        "김철수18",
        "탐험가",
        "조사관",
        "미진",
        "병철",
    ],
)
def test_ordinary_names_pass(nickname):
    assert validate_nickname(nickname) == nickname


def test_fallback_list_is_used_when_the_shared_file_is_missing(tmp_path):
    judge = Judge(load_policy(tmp_path / "missing.json"))
    for nickname in ("시발", "admin", "sh1t", "ADMIN_123"):
        with pytest.raises(InvalidNicknameError):
            judge.validate_nickname(nickname)
    assert judge.validate_nickname("support") == "support"
    assert judge.validate_nickname("가나") == "가나"


def _accepts(nickname: str) -> bool:
    try:
        validate_nickname(nickname)
    except InvalidNicknameError:
        return False
    return True
