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


# --- 관리자 API v0.2 2단계(11/12 해랑): 접속 통계 · 회원 통계 · 게임 데이터 · 보안 집계 — 전부 기존 테이블 읽기만 ---


class TrafficDay(BaseModel):
    """KST 하루의 집계. `date` 는 그날, 값은 §3.3 과 같은 정의(DAU = 로그인 세션 또는 플레이 세션을 만든 고유 회원)."""

    date: date
    members_dau: int
    guests_dau: int
    signups: int
    play_sessions_created: int


class TrafficLive(BaseModel):
    # 최근 5분 안에 갱신된 플레이 세션 수 — 「지금 플레이 중」의 근사값(play_sessions.updated_at)
    active_play_sessions_5m: int
    basis: str = "play_sessions.updated_at"


class AdminStatsTraffic(BaseModel):
    generated_at: datetime
    timezone: str
    date: date
    days: int
    include_internal: bool
    daily: list[TrafficDay]
    live: TrafficLive
    unavailable: dict[str, str]


class ActiveSession(BaseModel):
    """지금 플레이 중인 세션 한 줄. 세션 id · 토큰 · IP 는 싣지 않는다(§5)."""

    # 회원이면 닉네임, 게스트면 null
    nickname: str | None
    user_id: str | None
    case_id: str
    started_at: datetime
    last_seen_at: datetime


class ActiveSessionList(BaseModel):
    generated_at: datetime
    window_minutes: int
    sessions: list[ActiveSession]


class CountBucket(BaseModel):
    label: str
    count: int


class MonthSignups(BaseModel):
    # "2026-11"
    month: str
    signups: int


class RecentSignup(BaseModel):
    """최근 가입자 한 줄. 이메일은 목록 규칙대로 전체(화면이 가린다, §2.5) — 상세는 회원 상세로."""

    user_id: str
    nickname: str
    email: str
    region: str | None
    created_at: datetime
    stage: str | None


class MembersTotals(BaseModel):
    total: int
    # 지난달 말(이번 달 1일 00:00 KST 전) 기준 누적
    total_at_prev_month_end: int
    signups_this_month: int
    signups_prev_month: int
    mau: int
    mau_prev_30_days: int


class AdminStatsMembers(BaseModel):
    generated_at: datetime
    timezone: str
    date: date
    include_internal: bool
    months: int
    totals: MembersTotals
    monthly_signups: list[MonthSignups]
    # region 이 null 인 회원은 label "(미입력)"
    by_region: list[CountBucket]
    by_provider: list[CountBucket]
    signups_on_date: list[RecentSignup]
    recent_signups: list[RecentSignup]
    unavailable: dict[str, str]


class FunnelStep(BaseModel):
    # stage_reached 의 phase 값 그대로
    phase: str
    people: int


class StageStats(BaseModel):
    # 1 = 나루터 · 2 = 바위 아래 · 물굴 · 3 = 증언 능선
    stage: int
    entered: int
    completed: int


class PuzzleStats(BaseModel):
    objective_id: str
    judge: str
    attempts: int
    wrong: int
    hint_requests: int
    completed_people: int


class AdminStatsGame(BaseModel):
    generated_at: datetime
    timezone: str
    date: date
    days: int
    # 집계에 든 사람(회원 · 게스트 · 탭) 수
    people: int
    funnel: list[FunnelStep]
    stages: list[StageStats]
    puzzles: list[PuzzleStats]
    # 새벽(dawn)까지 간 회차의 평균 분 — 한 회차도 없으면 null
    avg_completion_minutes: float | None
    completed_runs: int
    unavailable: dict[str, str]


class LoginThrottleSummary(BaseModel):
    # 지금 잠긴 키 수 · 현재 창에 실패가 쌓인 키 수 · 그 실패 합. 키 자체(해시)는 싣지 않는다
    locked_now: int
    keys_with_failures: int
    failures_in_window: int


class AdminLoginEntry(BaseModel):
    user_id: str
    nickname: str | None
    at: datetime


class AdminSecuritySummary(BaseModel):
    generated_at: datetime
    timezone: str
    login_throttle: LoginThrottleSummary
    admin_logins_7d: list[AdminLoginEntry]
    audit_actions_24h: list[CountBucket]
    unavailable: dict[str, str]
