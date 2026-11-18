import json
import logging
import re
import unicodedata
from pathlib import Path

logger = logging.getLogger(__name__)

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


# 가입 지역(광역 17개). 화면(website/src/data/regions.ts)과 같은 파일을 읽어 두 쪽 판정이 어긋나지 않게 한다.
REGIONS_PATH = Path(__file__).resolve().parents[3] / "shared" / "regions.json"
_FALLBACK_REGIONS = (
    "서울", "인천", "경기", "강원", "대전", "세종", "충북", "충남",
    "광주", "전북", "전남", "부산", "대구", "울산", "경북", "경남", "제주",
)  # fmt: skip


class InvalidEmailError(Exception):
    pass


class InvalidPasswordError(Exception):
    pass


class InvalidRegionError(Exception):
    pass


def load_regions(path: Path = REGIONS_PATH) -> frozenset[str]:
    """공용 JSON 의 지역 이름 전부. 파일이 없으면 같은 17개를 내장 목록으로 쓴다."""
    try:
        groups = json.loads(path.read_text(encoding="utf-8"))["groups"]
    except FileNotFoundError:
        logger.warning("지역 목록 %s 가 없어 내장 목록으로 판정한다", path)
        return frozenset(_FALLBACK_REGIONS)
    return frozenset(region for group in groups for region in group["regions"])


REGIONS = load_regions()


def validate_registration_email(value: str) -> None:
    if len(value) > MAX_EMAIL_LENGTH or EMAIL_PATTERN.fullmatch(value) is None:
        raise InvalidEmailError


def validate_registration_region(value: str | None) -> str | None:
    """비우면 「미입력」(None). 적었으면 목록에 있는 이름이어야 한다 — 「화성시」같은 떠돌이 값이 통계에 남지 않게."""
    region = unicodedata.normalize("NFC", value or "").strip()
    if not region:
        return None
    if region not in REGIONS:
        raise InvalidRegionError
    return region


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
