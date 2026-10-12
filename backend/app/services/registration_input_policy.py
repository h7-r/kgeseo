import re
import unicodedata

MAX_EMAIL_LENGTH = 254
MAX_PASSWORD_LENGTH = 128
COMMON_PASSWORDS = (
    "password",
    "qwerty",
    "qwer1234",
    "asdf1234",
    "abcd1234",
    "iloveyou",
    "letmein",
    "welcome",
    "admin123",
    "12345678",
    "11111111",
    "1q2w3e4r",
    "zxcv1234",
    "passw0rd",
)
EMAIL_PATTERN = re.compile(
    r"(?!\.)(?!.*\.\.)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}(?<!\.)"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}"
)


class InvalidEmailError(Exception):
    pass


class InvalidPasswordError(Exception):
    pass


def validate_registration_email(value: str) -> None:
    if len(value) > MAX_EMAIL_LENGTH or EMAIL_PATTERN.fullmatch(value) is None:
        raise InvalidEmailError


def validate_registration_password(
    value: str, *, email: str = "", nickname: str = ""
) -> None:
    if (
        not 8 <= len(value) <= MAX_PASSWORD_LENGTH
        or re.fullmatch(r"[!-~]+", value) is None
        or re.search(r"[A-Z]", value) is None
        or re.search(r"[a-z]", value) is None
        or re.search(r"[0-9]", value) is None
        or re.search(r"(.)\1\1", value) is not None
    ):
        raise InvalidPasswordError
    lowered = value.lower()
    local_part = unicodedata.normalize("NFC", email).strip().lower().split("@")[0]
    name = unicodedata.normalize("NFKC", nickname).strip().lower()
    if (
        any(word in lowered for word in COMMON_PASSWORDS)
        or (len(local_part) >= 3 and local_part in lowered)
        or (len(name) >= 3 and name in lowered)
    ):
        raise InvalidPasswordError
