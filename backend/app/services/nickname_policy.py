import re
import unicodedata

MAX_NICKNAME_LENGTH = 12
RESERVED = frozenset(
    {
        "admin",
        "administrator",
        "root",
        "system",
        "gm",
        "관리자",
        "운영자",
        "운영팀",
        "왜곡",
    }
)
FORBIDDEN = frozenset(
    {"시발", "씨발", "병신", "개새끼", "좆", "보지", "자지", "fuck", "shit", "bitch"}
)
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t"})
FORBIDDEN_EXACT_EXCEPTIONS = frozenset({"shitake"})


class InvalidNicknameError(Exception):
    pass


def normalize_nickname(value: str) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip()


def validate_nickname(value: str) -> str:
    # Reject controls before trim so trailing tabs cannot silently disappear.
    if any(unicodedata.category(c).startswith("C") for c in value):
        raise InvalidNicknameError
    nickname = normalize_nickname(value)
    if not 2 <= len(nickname) <= MAX_NICKNAME_LENGTH:
        raise InvalidNicknameError
    if re.fullmatch(r"[가-힣A-Za-z0-9_]+", nickname) is None:
        raise InvalidNicknameError
    key = nickname.casefold().replace("_", "")
    translated = key.translate(LEET)
    candidates = {key, translated, key.rstrip("0123456789")}
    if candidates & RESERVED:
        raise InvalidNicknameError
    if forbidden_terms_in(nickname):
        raise InvalidNicknameError
    return nickname


def forbidden_terms_in(value: str) -> tuple[str, ...]:
    """FORBIDDEN terms contained in the value (NFKC, casefold, "_" removed, leet, substring).

    Same rule as the nickname check; the general pack policy (GEN-WORD) reuses it as is.
    """

    key = normalize_nickname(value).casefold().replace("_", "")
    # Exceptions cover whole normalized names, never arbitrary containing names.
    if key in FORBIDDEN_EXACT_EXCEPTIONS:
        return ()
    candidates = {key, key.translate(LEET), key.rstrip("0123456789")}
    return tuple(
        sorted(term for term in FORBIDDEN if any(term in c for c in candidates))
    )
