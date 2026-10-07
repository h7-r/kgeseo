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
    # Exact comparison avoids blocking innocent words containing short terms.
    candidates = {key, translated, key.rstrip("0123456789")}
    if candidates & (RESERVED | FORBIDDEN):
        raise InvalidNicknameError
    return nickname
