"""관리자 조회 공통 부품 — `docs/contracts/admin_api_v0.2.md` §2(PR #119).

- KST 날짜 → UTC 범위(§2.4): 저장 시각은 모두 시간대 없는 UTC `DATETIME(6)` 이다. KST 날짜 `d` 하루는
  `[d 00:00 KST, d+1 00:00 KST)` = `[d−1 15:00 UTC, d 15:00 UTC)`. KST 는 일광절약시간이 없어 +9시간 고정이고,
  DB 의 `CONVERT_TZ` · 세션 time_zone 에 기대지 않는다(RDS 시간대 테이블 의존 회피).
- 목록 이메일 가림(§2.5): 관리자 화면 `maskEmail()` 과 같은 결과.
- 새 쿼리 값 오류는 `{"detail": {"code": "invalid_query", "message": ...}}` 422(§2.2). 입력값을 되돌려 보내지 않는다
  (검색어에 이메일이 들어 있을 수 있다 — FastAPI 기본 422 는 입력을 그대로 싣는다).
"""

import re
from datetime import date, datetime, timedelta

from fastapi import HTTPException

from app.services.local_auth import normalize_email, normalize_nickname, utc_now

KST_OFFSET = timedelta(hours=9)
KST_NAME = "Asia/Seoul"
INVALID_QUERY = "invalid_query"

_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_INT_PATTERN = re.compile(r"^\d{1,9}$")

SEARCH_MAX_LENGTH = 64


def invalid_query(message: str) -> HTTPException:
    return HTTPException(
        422,
        detail={"code": INVALID_QUERY, "message": message},
        headers={"Cache-Control": "no-store"},
    )


def kst_today(now: datetime | None = None) -> date:
    """지금(UTC naive) 의 KST 날짜."""

    return ((now or utc_now()) + KST_OFFSET).date()


def kst_day_start_utc(day: date) -> datetime:
    """KST 날짜의 00:00 을 UTC naive 로."""

    return datetime(day.year, day.month, day.day) - KST_OFFSET


def kst_range(first: date, last: date) -> tuple[datetime, datetime]:
    """KST 날짜 `first` ~ `last`(양 끝 포함)를 UTC naive 반열린 범위 `[start, end)` 로."""

    return kst_day_start_utc(first), kst_day_start_utc(last + timedelta(days=1))


def parse_kst_date(value: str | None, name: str) -> date | None:
    if value is None:
        return None
    if not _DATE_PATTERN.match(value):
        raise invalid_query(f"{name} must be a KST date (YYYY-MM-DD).")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise invalid_query(f"{name} must be a KST date (YYYY-MM-DD).") from error


def parse_int(
    value: str | None, name: str, *, default: int, low: int, high: int
) -> int:
    if value is None:
        return default
    if not _INT_PATTERN.match(value):
        raise invalid_query(f"{name} must be an integer between {low} and {high}.")
    number = int(value)
    if number < low or number > high:
        raise invalid_query(f"{name} must be an integer between {low} and {high}.")
    return number


def parse_bool(value: str | None, name: str, *, default: bool) -> bool:
    if value is None:
        return default
    if value == "true":
        return True
    if value == "false":
        return False
    raise invalid_query(f"{name} must be true or false.")


def parse_uuid(value: str | None, name: str) -> str | None:
    if value is None:
        return None
    if not _UUID_PATTERN.match(value):
        raise invalid_query(f"{name} must be a user id.")
    return value.lower()


class UserSearch:
    """회원 검색어(§3.1 `q`). `@` 가 있으면 정규화한 이메일의 완전 일치만, 없으면 닉네임 부분 일치(대소문자 무시).

    이메일은 부분 검색을 하지 않는다 — 부분 검색으로 이메일을 알아내지 못하게(§5.3). 닉네임 검색은 이메일 칸을 보지 않는다.
    """

    def __init__(
        self, *, email: str | None = None, nickname: str | None = None
    ) -> None:
        self.email = email
        self.nickname = nickname


def parse_user_search(value: str | None) -> UserSearch | None:
    if value is None:
        return None
    term = value.strip()
    if not term or len(term) > SEARCH_MAX_LENGTH:
        raise invalid_query(f"q must be 1 to {SEARCH_MAX_LENGTH} characters.")
    if "@" in term:
        return UserSearch(email=normalize_email(term))
    return UserSearch(nickname=normalize_nickname(term))


def like_contains(term: str) -> str:
    """LIKE 부분 일치 패턴 — 검색어의 `%` `_` `\\` 는 글자 그대로(이스케이프 `\\`)."""

    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def mask_email(email: str) -> str:
    """목록 이메일 가림(§2.5) — 로컬 부분 3자 이상이면 앞 2자, 2자 이하면 앞 1자 + `***` + `@도메인`.
    `@` 가 없거나 맨 앞이면 `***`. 예 `minsoo@example.com → mi***@example.com`, `ab@example.org → a***@example.org`.
    """

    # 화면(`website/src/admin/lib/format.ts` maskEmail)처럼 마지막 `@` 를 기준으로
    at = email.rfind("@")
    if at <= 0:
        return "***"
    local, domain = email[:at], email[at:]
    keep = 2 if len(local) >= 3 else 1
    return f"{local[:keep]}***{domain}"
