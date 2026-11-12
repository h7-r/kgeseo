"""관리자 API v0.2 1단계 응답 — `docs/contracts/admin_api_v0.2.md`(PR #119) §3.1 · §3.3 · §3.4.

시각은 지금처럼 시간대 표기 없는 UTC 문자열이다(§2.4). 이메일 원문 · 해시 · 토큰 · IP · User-Agent 는 싣지 않는다.
"""

from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.account_data import AdminUserSummary


class AdminUserListItem(AdminUserSummary):
    """회원 목록 한 줄 — 기존 `AdminUserSummary` 필드는 그대로, 아래는 추가만(§3.1).

    `email` 은 지금처럼 전체다 — 서버 가림(§2.5)은 베타 뒤 「베타 기록」 화면을 정확 검색으로 바꿀 때 함께(미르 11/12).
    """

    region: str | None = None
    # `auth_identities.provider` 중복 제거 · 알파벳순. 연결이 없으면 []
    providers: list[str] = []
    # 실제 로그인 시각 — 컬럼이 아직 없다(베타 이후, D4). 1단계는 키만 두고 늘 null
    last_login_at: datetime | None = None
    # MAX(user_sessions.created_at) — 로그인 · 가입 때만 생기는 세션의 시작 시각(추정값, D4)
    last_session_started_at: datetime | None = None


class AdminUserSearchList(BaseModel):
    users: list[AdminUserListItem]
    next_offset: int | None


class StatsRangeUtc(BaseModel):
    """집계에 쓴 UTC 범위 `[시작, 끝)` — KST 날짜를 바꾼 값(§2.4)."""

    day: tuple[datetime, datetime]
    month: tuple[datetime, datetime]
    last_30_days: tuple[datetime, datetime]


class StatsExcluded(BaseModel):
    # include_internal=false 일 때 뺀 관리자 수(조회 시점 role). true 면 0
    admins: int
    # 테스트 계정 표시(is_test)가 아직 없어 빼지 못한다 — 늘 null(D7-a, 베타 이후)
    test_accounts: int | None = None


class StatsMembers(BaseModel):
    total: int
    signups_on_date: int
    signups_in_month: int


class StatsActivity(BaseModel):
    members_dau: int
    members_mau: int
    guests_dau: int
    guests_mau: int


class StatsPlaySessions(BaseModel):
    created_on_date: int
    created_on_date_by_member: int
    created_on_date_by_guest: int


class AdminStatsSummary(BaseModel):
    generated_at: datetime
    timezone: str
    date: date
    include_internal: bool
    range_utc: StatsRangeUtc
    excluded: StatsExcluded
    members: StatsMembers
    activity: StatsActivity
    play_sessions: StatsPlaySessions
    # 아직 원천이 없는 지표 — 값 대신 이유 code(화면은 「준비 중」)
    unavailable: dict[str, str]


class AuditActor(BaseModel):
    user_id: str
    # 사용자가 사라졌으면 null(감사 기록에는 FK 가 없다)
    nickname: str | None


class AuditLogEntry(BaseModel):
    id: int
    created_at: datetime
    action: str
    admin: AuditActor
    target: AuditActor | None


class AuditLogList(BaseModel):
    logs: list[AuditLogEntry]
    next_offset: int | None
