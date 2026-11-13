"""관리자 조회. 비밀번호 해시와 세션 토큰은 어떤 응답에도 넣지 않는다. 열람은 기록으로 남긴다.

관리자 API v0.2 1단계(`docs/contracts/admin_api_v0.2.md`, PR #119 — 11/12 미르): 회원 목록 검색 · 추가 필드,
`/admin/stats/summary`, `/admin/audit-logs`. 기존 테이블 읽기만(감사 기록 쓰기는 기존 `admin_audit_logs` 그대로).
모든 경로는 매 요청 `current_admin`(role == "admin")을 거친다.
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Select, and_, exists, false, func, or_, select, true, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.v1 import error_responses
from app.api.v1.me import find_save, list_owned_items, to_save_response
from app.db.session import get_db
from app.models.account_data import (
    AdminAuditLog,
    GamePlaySave,
    LoginThrottle,
    UserCharacter,
    UserSession,
)
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.beta_event import BetaEvent
from app.models.guest_session import GuestSessionTransfer
from app.models.play_session import PlaySession
from app.schemas.account_data import (
    AdminUserDetail,
    AdminUserSummary,
    CharacterResponse,
)
from app.schemas.admin import (
    ActiveSession,
    ActiveSessionList,
    AdminLoginEntry,
    AdminSecuritySummary,
    AdminStatsGame,
    AdminStatsMembers,
    AdminStatsSummary,
    AdminStatsTraffic,
    AdminUserListItem,
    AdminUserSearchList,
    AuditActor,
    AuditLogEntry,
    AuditLogList,
    CountBucket,
    FunnelStep,
    LoginThrottleSummary,
    MembersTotals,
    MonthSignups,
    PuzzleStats,
    RecentSignup,
    StageStats,
    StatsActivity,
    StatsExcluded,
    StatsMembers,
    StatsPlaySessions,
    StatsRangeUtc,
    TrafficDay,
    TrafficLive,
)
from app.schemas.beta_event import (
    PARTICIPANT_CODE_PATTERN,
    BetaEventExport,
    BetaEventOut,
)
from app.services.admin_query import (
    KST_NAME,
    invalid_query,
    kst_range,
    kst_today,
    like_contains,
    parse_bool,
    parse_int,
    parse_kst_date,
    parse_user_search,
    parse_uuid,
)
from app.services.admin_stats import (
    GameEvent,
    aggregate_game,
    guest_links,
    kst_days,
    month_firsts,
    next_month_first,
    person_key,
    previous_month_first,
)
from app.services.local_auth import utc_now
from app.services.user_session import THROTTLE_WINDOW, current_admin

router = APIRouter(prefix="/admin", tags=["Admin"])

PAGE_SIZE = 50
ADMIN_ROLE = "admin"
# 통계 기준일은 오늘(KST)부터 이만큼 전까지(§3.3)
STATS_MAX_DAYS_BACK = 400
MAU_DAYS = 30
# 감사 기록 조회 기간 — 기본 최근 30일, 최대 92일(양 끝 포함, §3.4)
AUDIT_DEFAULT_DAYS = 30
AUDIT_MAX_DAYS = 92
# 2단계 — 접속 · 게임 통계 기간(일) · 회원 통계 달 수 · 활성 세션 창(분) · 보안 창
TRAFFIC_DEFAULT_DAYS = 7
TRAFFIC_MAX_DAYS = 92
MEMBERS_DEFAULT_MONTHS = 6
MEMBERS_MAX_MONTHS = 24
GAME_DEFAULT_DAYS = 30
GAME_MAX_DAYS = 92
GAME_EVENT_CAP = 200_000
ACTIVE_WINDOW_MINUTES = 5
ACTIVE_LIST_LIMIT = 50
RECENT_SIGNUPS_LIMIT = 20
SIGNUPS_ON_DATE_LIMIT = 50
ADMIN_LOGIN_DAYS = 7
# 감사 기록에 남는 action 값(§3.4 + 베타 기록 내보내기 11/11). 필터에 모르는 값은 422
AUDIT_ACTIONS = frozenset(
    {
        "list_users",
        "read_user",
        "list_audit_logs",
        "view_stats_summary",
        "export_beta_events",
        # 2단계(11/12) — 사람이 보이는 조회만 남긴다. 집계뿐인 traffic · game 은 남기지 않는다(summary 와 같게)
        "view_member_stats",
        "view_active_sessions",
        "view_security_summary",
    }
)


def _summary(user: AppUser, save: GamePlaySave | None) -> AdminUserSummary:
    return AdminUserSummary(
        user_id=user.id,
        email=user.email,
        nickname=user.nickname,
        role=user.role,
        created_at=user.created_at,
        stage=save.stage if save else None,
        save_updated_at=save.updated_at if save else None,
    )


async def _audit(
    db: AsyncSession, admin: AppUser, action: str, target_user_id: str | None
) -> None:
    db.add(
        AdminAuditLog(
            admin_user_id=admin.id,
            action=action,
            target_user_id=target_user_id,
            created_at=utc_now(),
        )
    )
    await db.commit()


@router.get(
    "/users",
    response_model=AdminUserSearchList,
    responses=error_responses.ADMIN_USER_SEARCH,
)
async def list_users(
    offset: int = Query(default=0, ge=0),
    limit: str | None = Query(default=None, description="1~50, 기본 50"),
    q: str | None = Query(
        default=None,
        description="닉네임 부분 일치(대소문자 무시) · `@` 가 있으면 정규화한 이메일 완전 일치만. 1~64자",
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserSearchList:
    """회원 목록(§3.1). 기존 필드 · 기본 50 · `next_offset` 은 그대로, 필드를 더한다.

    목록 이메일은 아직 가리지 않는다(지금처럼 전체) — 「베타 기록」 화면(BetaLogPage)이 이 목록의 전체 이메일로 시험 계정을
    거르므로, 서버 가림(§2.5 · `mask_email`)은 베타 뒤 그 화면을 정확 검색(`q=이메일`)으로 바꿀 때 함께 한다(미르 11/12).

    검색어는 감사 기록에 남기지 않는다(이메일 원문이 기록에 남지 않게) — 한 번 부를 때마다 `list_users` 한 행.
    """
    page_size = parse_int(limit, "limit", default=PAGE_SIZE, low=1, high=PAGE_SIZE)
    search = parse_user_search(q)
    query = select(AppUser, GamePlaySave).outerjoin(
        GamePlaySave,
        and_(GamePlaySave.app_user_id == AppUser.id, GamePlaySave.slot == 0),
    )
    if search is not None and search.email is not None:
        # 이메일은 완전 일치만 — 부분 검색으로 이메일을 알아내지 못하게(§5.3)
        query = query.where(AppUser.email == search.email)
    elif search is not None and search.nickname is not None:
        query = query.where(
            func.lower(AppUser.nickname).like(
                like_contains(search.nickname.lower()), escape="\\"
            )
        )
    rows = await db.execute(
        query.order_by(AppUser.created_at.desc(), AppUser.id.desc())
        .offset(offset)
        .limit(page_size + 1)
    )
    pairs = rows.all()
    page = pairs[:page_size]
    user_ids = [user.id for user, _ in page]
    providers = await _providers_by_user(db, user_ids)
    last_sessions = await _last_session_by_user(db, user_ids)
    users = [
        AdminUserListItem(
            **_summary(user, save).model_dump(),
            region=user.region,
            providers=providers.get(user.id, []),
            last_login_at=None,
            last_session_started_at=last_sessions.get(user.id),
        )
        for user, save in page
    ]
    await _audit(db, admin, "list_users", None)
    return AdminUserSearchList(
        users=users,
        next_offset=offset + page_size if len(pairs) > page_size else None,
    )


async def _providers_by_user(
    db: AsyncSession, user_ids: list[str]
) -> dict[str, list[str]]:
    if not user_ids:
        return {}
    rows = await db.execute(
        select(AuthIdentity.app_user_id, AuthIdentity.provider)
        .where(AuthIdentity.app_user_id.in_(user_ids))
        .distinct()
    )
    found: dict[str, set[str]] = {}
    for user_id, provider in rows.all():
        found.setdefault(user_id, set()).add(provider)
    return {user_id: sorted(names) for user_id, names in found.items()}


async def _last_session_by_user(
    db: AsyncSession, user_ids: list[str]
) -> dict[str, datetime]:
    if not user_ids:
        return {}
    rows = await db.execute(
        select(UserSession.app_user_id, func.max(UserSession.created_at))
        .where(UserSession.app_user_id.in_(user_ids))
        .group_by(UserSession.app_user_id)
    )
    return {user_id: started for user_id, started in rows.all()}


@router.get(
    "/users/{user_id}",
    response_model=AdminUserDetail,
    responses=error_responses.ADMIN_DETAIL,
)
async def read_user(
    user_id: str,
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserDetail:
    user = await db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found.")
    save = await find_save(db, user.id)
    character = await db.get(UserCharacter, user.id)
    items = await list_owned_items(db, user.id)
    await _audit(db, admin, "read_user", user.id)
    return AdminUserDetail(
        user=_summary(user, save),
        save=to_save_response(save) if save else None,
        character=(
            CharacterResponse(
                display_name=character.display_name,
                appearance=character.appearance_json,
                updated_at=character.updated_at,
            )
            if character
            else None
        ),
        items=items,
    )


@router.get(
    "/beta-events",
    response_model=BetaEventExport,
    responses=error_responses.ADMIN_LIST,
)
async def export_beta_events(
    response: Response,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=5000, ge=1, le=10000),
    pc: str | None = Query(default=None, pattern=PARTICIPANT_CODE_PATTERN),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> BetaEventExport:
    """베타 분석 기록 내보내기(11/11). id 오름차순으로 `after_id` 다음부터 `limit` 개.

    이메일 · 닉네임은 싣지 않는다 — 참여 코드와 계정의 대응은 운영자가 `app_user_id` 로 따로 맞춘다.
    """
    response.headers["Cache-Control"] = "no-store"
    query = select(BetaEvent).where(BetaEvent.id > after_id)
    if pc is not None:
        query = query.where(BetaEvent.participant_code == pc)
    rows = (
        (await db.execute(query.order_by(BetaEvent.id).limit(limit + 1)))
        .scalars()
        .all()
    )
    page = rows[:limit]
    events = [
        BetaEventOut(
            id=row.id,
            event_id=row.event_id,
            received_at=row.received_at,
            client_ts=row.client_ts,
            event_type=row.event_type,
            phase=row.phase,
            participant_code=row.participant_code,
            run_id=row.run_id,
            run_index=row.run_index,
            tab_id=row.tab_id,
            seq=row.seq,
            objective_id=row.objective_id,
            page=row.page,
            build=row.build,
            app_user_id=row.app_user_id,
            guest_session_id=row.guest_session_id,
            data=row.data,
        )
        for row in page
    ]
    await _audit(db, admin, "export_beta_events", None)
    return BetaEventExport(
        events=events,
        next_after_id=page[-1].id if len(rows) > limit else None,
    )


# --- 관리자 API v0.2 1단계(11/12): 통계 요약 · 감사 기록 조회 ---


def _internal_account(account):
    """내부 계정 = 관리자(role) 또는 팀 테스트 계정(is_test) — 미르 11/13 최종 정책. 둘 다 **조회 시점의 현재 값**이다.
    `account` 는 AppUser 또는 그 별칭 — EXISTS 안에서 바깥 쿼리의 AppUser 와 섞이지 않게 별칭으로 넘긴다."""

    return or_(account.role == ADMIN_ROLE, account.is_test.is_(true()))


def _internal_excluded(include_internal: bool):
    """회원 통계에서 뺄 내부 계정 조건(D7) — `_internal_account` 의 반대(관리자도 테스트 계정도 아닌 회원만 남긴다).
    과거 날짜 통계도 지금 값으로 다시 센다(표시를 바꾸면 과거 숫자도 바뀐다)."""

    if include_internal:
        return None
    return and_(AppUser.role != ADMIN_ROLE, AppUser.is_test.is_(false()))


def _transferred_to_internal_account():
    """이 플레이 세션의 익명 세션(게스트)이 내부 계정(관리자 · 테스트 계정)으로 승계됐다(미르 11/13 — 게스트 통계에서도 뺀다).

    `_transferred_after_creation()`(생성 당시 소유자 판정 다섯 조건)과는 따로 둔다 — 그 판정은 그대로 두고, 게스트로 센 세션 중
    승계 받은 계정이 지금 내부 계정인 것만 다시 뺀다. 게스트 하나는 한 번만 승계되므로(guest_session_id 유일, 게스트 1명 = 익명
    세션 1개) 익명 세션 id 로 이으면 그 게스트의 승계 기록은 많아야 하나다. 승계되지 않은 게스트 · 일반 회원에게 승계된 게스트는 남는다."""

    account = aliased(AppUser, name="transfer_account")
    return exists().where(
        GuestSessionTransfer.anonymous_session_id == PlaySession.anonymous_session_id,
        GuestSessionTransfer.app_user_id == account.id,
        _internal_account(account),
    )


def _guest_internal_excluded(include_internal: bool):
    """게스트 통계에서 뺄 조건 — 내부 계정으로 승계된 게스트. include_internal=true 면 없음."""

    return None if include_internal else ~_transferred_to_internal_account()


async def _count(db: AsyncSession, query: Select) -> int:
    return int((await db.execute(query)).scalar_one())


async def _count_members(
    db: AsyncSession,
    include_internal: bool,
    start: datetime | None = None,
    end: datetime | None = None,
) -> int:
    query = select(func.count()).select_from(AppUser)
    condition = _internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    if start is not None and end is not None:
        query = query.where(AppUser.created_at >= start, AppUser.created_at < end)
    return await _count(db, query)


def _transferred_after_creation():
    """이 플레이 세션이 게스트 때 만들어졌다가 뒤에 로그인으로 계정에 승계된 것 — `guest_session_transfers` 에
    같은 익명 세션의 승계 기록이 있고, 세션 생성이 승계보다 앞선다. 게스트 세션은 본문 익명 id = 쿠키 익명 id 를 강제하므로
    (`owner_for_new_play_session`) `play_sessions.anonymous_session_id` 로 이어도 된다.
    로그인한 채로 게스트가 발급될 수 있다(게스트 발급 창구는 로그인 쿠키가 있어도 새 게스트를 내준다) — 그때 회원이 만든 세션은
    소유자가 처음부터 계정이라 승계가 옮기지 않고(`play_session_count` 0), 다음 로그인의 승계 기록만 남는다. 그 기록으로 회원 세션을
    게스트 것으로 읽지 않게 옮긴 세션이 하나라도 있는 승계만 본다(세진 11/13 M1).
    승계(`_transfer`)는 옮긴 세션의 `owner_user_id` 를 승계 계정으로, `updated_at` 을 승계 시각(같은 `now`)으로 쓴다 — 그래서 옮겨진
    세션은 반드시 소유자 = 승계 계정이고 `updated_at >= transferred_at` 이다(세진 G안). 이 둘을 더해 한 게스트에 회원 세션과 게스트 세션이
    섞인 경우(로그인 → 게스트 발급 → 로그아웃 → 게스트로 플레이 → 로그인)도 승계 뒤 안 건드린 회원 세션은 회원으로 남는다.
    남는 한계: 승계 뒤에 이어 한 회원 세션(`updated_at` 이 승계 뒤로 밀림)은 열만으로 못 가른다 — 미르 11/13 「이번 베타는 알려진 제한으로
    수용, 베타 뒤 세진이 DB 보완」. 계약서 P2-1."""

    return exists().where(
        GuestSessionTransfer.anonymous_session_id == PlaySession.anonymous_session_id,
        PlaySession.created_at < GuestSessionTransfer.transferred_at,
        GuestSessionTransfer.play_session_count > 0,
        PlaySession.owner_user_id == GuestSessionTransfer.app_user_id,
        PlaySession.updated_at >= GuestSessionTransfer.transferred_at,
    )


def _guest_at_play_time():
    """만든 순간 소유자가 게스트였던 세션(미르 11/12 — DAU 는 「세션을 만든 날 누구였나」로 센다, 승계로 소유자가 바뀌어도 과거 날짜는 안 움직인다.
    플레이 중 모든 활동 시점이 아니라 생성 당시 소유자를 복원하는 것 — 세진 11/12):
    지금도 게스트 소유이거나, 게스트 때 만들고 뒤에 승계된 것. 소유자가 아예 없는 옛 세션(11/6 전)은 전처럼 어디에도 안 든다."""

    return or_(
        and_(
            PlaySession.owner_user_id.is_(None),
            PlaySession.owner_anonymous_session_id.is_not(None),
        ),
        _transferred_after_creation(),
    )


def _member_at_play_time():
    """만든 순간 소유자가 회원이었던 세션 — 회원 소유이고, 게스트 때 만들어 승계된 것이 아니다."""

    return and_(PlaySession.owner_user_id.is_not(None), ~_transferred_after_creation())


async def _active_members(
    db: AsyncSession, include_internal: bool, start: datetime, end: datetime
) -> int:
    """기간 안에 로그인 세션을 만들었거나 「회원으로서」 플레이 세션을 만든 고유 회원 수(D8). 둘 다 있는 회원은 한 번.
    게스트 때 만들고 뒤에 승계된 세션은 그날의 회원 활동이 아니다(생성 당시 소유자 기준, 미르 11/12)."""

    logins = select(UserSession.app_user_id.label("user_id")).where(
        UserSession.created_at >= start, UserSession.created_at < end
    )
    plays = select(PlaySession.owner_user_id.label("user_id")).where(
        _member_at_play_time(),
        PlaySession.created_at >= start,
        PlaySession.created_at < end,
    )
    active = union(logins, plays).subquery()
    query = select(func.count(func.distinct(active.c.user_id))).select_from(
        active.join(AppUser, AppUser.id == active.c.user_id)
    )
    condition = _internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    return await _count(db, query)


async def _active_guests(
    db: AsyncSession, include_internal: bool, start: datetime, end: datetime
) -> int:
    """기간 안에 「게스트로서」 플레이 세션을 만든 고유 익명 세션 수(브라우저 쿠키 단위, D8-a).
    뒤에 로그인해 승계됐어도 그날은 게스트로 센다(생성 당시 소유자 기준, 미르 11/12).
    기본(include_internal=false)은 내부 계정(관리자 · 테스트 계정)으로 승계된 게스트를 뺀다(미르 11/13)."""

    query = select(func.count(func.distinct(PlaySession.anonymous_session_id))).where(
        _guest_at_play_time(),
        PlaySession.created_at >= start,
        PlaySession.created_at < end,
    )
    condition = _guest_internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    return await _count(db, query)


async def _play_sessions_by_member(
    db: AsyncSession, include_internal: bool, start: datetime, end: datetime
) -> int:
    """회원으로서 만든 플레이 세션 수(승계된 게스트 세션은 게스트 쪽)."""

    query = (
        select(func.count())
        .select_from(PlaySession)
        .join(AppUser, AppUser.id == PlaySession.owner_user_id)
        .where(
            _member_at_play_time(),
            PlaySession.created_at >= start,
            PlaySession.created_at < end,
        )
    )
    condition = _internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    return await _count(db, query)


async def _play_sessions_by_guest(
    db: AsyncSession, include_internal: bool, start: datetime, end: datetime
) -> int:
    """회원으로서 만든 것이 아닌 세션 — 게스트 · 승계된 게스트 세션 · 소유자 없는 옛 세션.
    기본(include_internal=false)은 내부 계정(관리자 · 테스트 계정)으로 승계된 게스트의 세션을 뺀다(미르 11/13)."""

    query = (
        select(func.count())
        .select_from(PlaySession)
        .where(
            or_(PlaySession.owner_user_id.is_(None), _transferred_after_creation()),
            PlaySession.created_at >= start,
            PlaySession.created_at < end,
        )
    )
    condition = _guest_internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    return await _count(db, query)


@router.get(
    "/stats/summary",
    response_model=AdminStatsSummary,
    responses=error_responses.ADMIN_QUERY,
)
async def stats_summary(
    response: Response,
    target_date: str | None = Query(
        default=None,
        alias="date",
        description="KST YYYY-MM-DD, 기본 오늘(KST). 미래 · 400일 넘게 지난 날은 422",
    ),
    include_internal: str | None = Query(
        default=None,
        description="`true` 면 내부 계정(관리자 · 테스트 계정)도 통계에 넣는다. 기본 `false`",
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsSummary:
    """대시보드 요약(§3.3) — 회원 수 · 가입 · DAU · MAU(D8) · 플레이 세션. 모든 날짜는 KST, 저장 시각은 UTC 로 비교한다.

    내부 계정(관리자 · 테스트 계정 is_test)은 기본으로 회원 통계 전체에서 같은 규칙으로 뺀다(D7, 미르 11/13).
    내부 계정으로 승계된 게스트는 게스트 통계에서도 뺀다. 모두 조회 시점의 현재 값 기준이다.
    `excluded.admins` 는 뺀 관리자 수, `excluded.test_accounts` 는 관리자가 아닌 테스트 계정 수(겹치면 관리자 쪽에만 센다).
    통계 조회를 감사 기록에 남길지는 PM 미결(D5-b)이라 남기지 않는다.
    """
    response.headers["Cache-Control"] = "no-store"
    today = kst_today()
    day = parse_kst_date(target_date, "date") or today
    if day > today:
        raise invalid_query("date must not be in the future.")
    if (today - day).days > STATS_MAX_DAYS_BACK:
        raise invalid_query(f"date must be within {STATS_MAX_DAYS_BACK} days.")
    internal = parse_bool(include_internal, "include_internal", default=False)

    day_range = kst_range(day, day)
    month_range = kst_range(day.replace(day=1), day)
    last_30 = kst_range(day - timedelta(days=MAU_DAYS - 1), day)

    admins = 0
    test_accounts = 0
    if not internal:
        admins = await _count(
            db,
            select(func.count()).select_from(AppUser).where(AppUser.role == ADMIN_ROLE),
        )
        test_accounts = await _count(
            db,
            select(func.count())
            .select_from(AppUser)
            .where(AppUser.role != ADMIN_ROLE, AppUser.is_test.is_(true())),
        )
    by_member = await _play_sessions_by_member(db, internal, *day_range)
    by_guest = await _play_sessions_by_guest(db, internal, *day_range)
    return AdminStatsSummary(
        generated_at=utc_now(),
        timezone=KST_NAME,
        date=day,
        include_internal=internal,
        range_utc=StatsRangeUtc(day=day_range, month=month_range, last_30_days=last_30),
        excluded=StatsExcluded(admins=admins, test_accounts=test_accounts),
        members=StatsMembers(
            total=await _count_members(db, internal),
            signups_on_date=await _count_members(db, internal, *day_range),
            signups_in_month=await _count_members(db, internal, *month_range),
        ),
        activity=StatsActivity(
            members_dau=await _active_members(db, internal, *day_range),
            members_mau=await _active_members(db, internal, *last_30),
            guests_dau=await _active_guests(db, internal, *day_range),
            guests_mau=await _active_guests(db, internal, *last_30),
        ),
        play_sessions=StatsPlaySessions(
            created_on_date=by_member + by_guest,
            created_on_date_by_member=by_member,
            created_on_date_by_guest=by_guest,
        ),
        unavailable={"lobby_concurrent": "lobby_metrics_not_connected"},
    )


def _audit_period(start_value: str | None, end_value: str | None) -> tuple[date, date]:
    """감사 기록 조회 기간(KST, 양 끝 포함). 기본 오늘까지 최근 30일, 한쪽만 주면 다른 쪽을 30일로 채운다. 최대 92일."""

    start = parse_kst_date(start_value, "from")
    end = parse_kst_date(end_value, "to")
    if end is None:
        end = (
            start + timedelta(days=AUDIT_DEFAULT_DAYS - 1)
            if start is not None
            else kst_today()
        )
    if start is None:
        start = end - timedelta(days=AUDIT_DEFAULT_DAYS - 1)
    if start > end:
        raise invalid_query("from must not be after to.")
    if (end - start).days + 1 > AUDIT_MAX_DAYS:
        raise invalid_query(f"the period must be at most {AUDIT_MAX_DAYS} days.")
    return start, end


@router.get(
    "/audit-logs",
    response_model=AuditLogList,
    responses=error_responses.ADMIN_QUERY,
)
async def list_audit_logs(
    response: Response,
    offset: str | None = Query(default=None, description="0 이상, 기본 0"),
    limit: str | None = Query(default=None, description="1~50, 기본 50"),
    admin_user_id: str | None = Query(default=None, description="행위한 관리자 id"),
    target_user_id: str | None = Query(default=None, description="대상 회원 id"),
    action: str | None = Query(
        default=None, description="list_users · read_user · list_audit_logs · …"
    ),
    period_from: str | None = Query(
        default=None, alias="from", description="KST YYYY-MM-DD"
    ),
    period_to: str | None = Query(
        default=None, alias="to", description="KST YYYY-MM-DD"
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AuditLogList:
    """관리자 감사 기록 조회(§3.4). 저장된 다섯 컬럼과 닉네임만 — 이메일 · IP · User-Agent 는 없다(컬럼도 없다).

    이 조회도 기록한다(D5): 결과를 만든 뒤 `list_audit_logs` 한 행(대상 = 필터의 `target_user_id`). 그래서 방금 한 조회는
    다음 조회부터 보인다. 필터 값은 저장하지 않는다. 기록 쓰기가 실패하면 기존 관리자 조회처럼 응답도 실패한다(D5-a 미결 — 현행과 같게).
    """
    response.headers["Cache-Control"] = "no-store"
    start_at = parse_int(offset, "offset", default=0, low=0, high=10_000_000)
    page_size = parse_int(limit, "limit", default=PAGE_SIZE, low=1, high=PAGE_SIZE)
    admin_filter = parse_uuid(admin_user_id, "admin_user_id")
    target_filter = parse_uuid(target_user_id, "target_user_id")
    if action is not None and action not in AUDIT_ACTIONS:
        raise invalid_query("action is not a known value.")
    first, last = _audit_period(period_from, period_to)
    start, end = kst_range(first, last)

    actor = aliased(AppUser)
    target = aliased(AppUser)
    query = (
        select(AdminAuditLog, actor.nickname, target.nickname)
        .outerjoin(actor, actor.id == AdminAuditLog.admin_user_id)
        .outerjoin(target, target.id == AdminAuditLog.target_user_id)
        .where(AdminAuditLog.created_at >= start, AdminAuditLog.created_at < end)
    )
    if admin_filter is not None:
        query = query.where(AdminAuditLog.admin_user_id == admin_filter)
    if target_filter is not None:
        query = query.where(AdminAuditLog.target_user_id == target_filter)
    if action is not None:
        query = query.where(AdminAuditLog.action == action)
    rows = (
        await db.execute(
            query.order_by(AdminAuditLog.id.desc())
            .offset(start_at)
            .limit(page_size + 1)
        )
    ).all()
    logs = [
        AuditLogEntry(
            id=log.id,
            created_at=log.created_at,
            action=log.action,
            admin=AuditActor(user_id=log.admin_user_id, nickname=admin_nickname),
            target=(
                AuditActor(user_id=log.target_user_id, nickname=target_nickname)
                if log.target_user_id is not None
                else None
            ),
        )
        for log, admin_nickname, target_nickname in rows[:page_size]
    ]
    await _audit(db, admin, "list_audit_logs", target_filter)
    # 방금 쓴 조회 기록이 같은 조건의 다음 쪽 맨 앞에 끼어든다 — 그만큼 다음 시작을 밀어 같은 기록이 되풀이되지 않게(Codex 리뷰).
    # 다른 관리자의 동시 기록으로 밀리는 것은 offset 방식의 알려진 한계 그대로(§2.3)
    shift = int(
        _matches_own_record(admin.id, admin_filter, target_filter, action, last)
    )
    return AuditLogList(
        logs=logs,
        next_offset=start_at + page_size + shift if len(rows) > page_size else None,
    )


def _matches_own_record(
    admin_id: str,
    admin_filter: str | None,
    target_filter: str | None,
    action: str | None,
    last: date,
) -> bool:
    """이 조회가 남긴 `list_audit_logs` 행이 같은 필터의 다음 조회에 잡히나(대상은 필터의 target 그대로 기록한다)."""

    return (
        (action is None or action == "list_audit_logs")
        and (admin_filter is None or admin_filter == admin_id)
        and last >= kst_today()
    )


# --- 관리자 API v0.2 2단계(11/12 해랑): 접속 통계 · 회원 통계 · 게임 데이터 · 보안 집계 ---
# 전부 기존 테이블 읽기만. 규칙은 1단계와 같다 — KST 날짜 · 관리자 제외 기본 · 422 invalid_query · 시각 UTC naive.


async def _guest_transfers(
    db: AsyncSession, rows: list[BetaEvent]
) -> list[tuple[str, str]]:
    """읽은 기록에 보이는 게스트(회원 id 없는 줄) 중 로그인으로 계정에 옮겨진 것 — `guest_session_transfers` 에서.
    기록 20만 행 상한과 무관하게 표 전체에서 찾으므로, 전환 자체가 있었으면 연결은 빠지지 않는다."""

    guests = {
        row.guest_session_id
        for row in rows
        if row.app_user_id is None and row.guest_session_id
    }
    if not guests:
        return []
    result = await db.execute(
        select(
            GuestSessionTransfer.guest_session_id, GuestSessionTransfer.app_user_id
        ).where(GuestSessionTransfer.guest_session_id.in_(sorted(guests)))
    )
    return [(guest, user) for guest, user in result.all()]


def _beta_event_internal_excluded():
    """게임 집계에서 남길 beta_events 조건 — 내부 계정(관리자 · 테스트 계정)에 이어진 기록을 뺀다(미르 11/13 최종).
    기록 자체는 고치거나 지우지 않는다(`/admin/beta-events` 내보내기는 원본 그대로).

    - `app_user_id` 가 있으면 그 회원이 지금 내부 계정인지로 판단한다.
    - `app_user_id` 가 없고 `guest_session_id` 가 있으면, 그 게스트가 내부 계정으로 승계됐을 때 뺀다(게스트 통계와 같은 기준 ·
      게임 집계는 그 게스트를 승계 받은 회원으로 합쳐 세므로 `person_key` 와도 맞는다).
    - 계정에 이어지지 않는 기록(참여 코드 · 탭만, 승계 안 된 게스트)은 내부 계정인지 정할 수 없다 — 추측해 빼지 않고 그대로 센다
      (계약서 P2-3 한계)."""

    member = aliased(AppUser, name="event_account")
    linked = aliased(AppUser, name="linked_account")
    return and_(
        ~exists().where(member.id == BetaEvent.app_user_id, _internal_account(member)),
        or_(
            BetaEvent.app_user_id.is_not(None),
            ~exists().where(
                GuestSessionTransfer.guest_session_id == BetaEvent.guest_session_id,
                GuestSessionTransfer.app_user_id == linked.id,
                _internal_account(linked),
            ),
        ),
    )


def _stats_base(target_date: str | None) -> date:
    today = kst_today()
    day = parse_kst_date(target_date, "date") or today
    if day > today:
        raise invalid_query("date must not be in the future.")
    if (today - day).days > STATS_MAX_DAYS_BACK:
        raise invalid_query(f"date must be within {STATS_MAX_DAYS_BACK} days.")
    return day


@router.get(
    "/stats/traffic",
    response_model=AdminStatsTraffic,
    responses=error_responses.ADMIN_QUERY,
)
async def stats_traffic(
    response: Response,
    target_date: str | None = Query(
        default=None, alias="date", description="끝 날짜(KST), 기본 오늘"
    ),
    days: str | None = Query(
        default=None, description=f"1~{TRAFFIC_MAX_DAYS}, 기본 {TRAFFIC_DEFAULT_DAYS}"
    ),
    include_internal: str | None = Query(
        default=None,
        description="`true` 면 내부 계정(관리자 · 테스트 계정)도 센다. 기본 `false`",
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsTraffic:
    """날짜별 접속 집계(§P2-1). 하루마다 DAU(회원 · 게스트) · 가입 · 플레이 세션 수. 사람은 안 보이므로 감사 기록은 남기지 않는다."""

    response.headers["Cache-Control"] = "no-store"
    last = _stats_base(target_date)
    span = parse_int(
        days, "days", default=TRAFFIC_DEFAULT_DAYS, low=1, high=TRAFFIC_MAX_DAYS
    )
    internal = parse_bool(include_internal, "include_internal", default=False)
    daily: list[TrafficDay] = []
    for day in kst_days(last, span):
        start, end = kst_range(day, day)
        daily.append(
            TrafficDay(
                date=day,
                members_dau=await _active_members(db, internal, start, end),
                guests_dau=await _active_guests(db, internal, start, end),
                signups=await _count_members(db, internal, start, end),
                play_sessions_created=await _play_sessions_by_member(
                    db, internal, start, end
                )
                + await _play_sessions_by_guest(db, internal, start, end),
            )
        )
    since = utc_now() - timedelta(minutes=ACTIVE_WINDOW_MINUTES)
    active = await _count(
        db,
        select(func.count())
        .select_from(PlaySession)
        .where(PlaySession.updated_at >= since),
    )
    return AdminStatsTraffic(
        generated_at=utc_now(),
        timezone=KST_NAME,
        date=last,
        days=span,
        include_internal=internal,
        daily=daily,
        live=TrafficLive(active_play_sessions_5m=active),
        unavailable={
            "lobby_concurrent": "lobby_metrics_not_connected",
            "peak_concurrent": "lobby_metrics_not_connected",
            "per_minute": "no_time_series_source",
        },
    )


@router.get(
    "/stats/active-sessions",
    response_model=ActiveSessionList,
    responses=error_responses.ADMIN_LIST,
)
async def active_sessions(
    response: Response,
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> ActiveSessionList:
    """최근 5분 안에 갱신된 플레이 세션(§P2-1). 닉네임이 보이므로 `view_active_sessions` 로 기록한다. IP · 세션 id 는 없다."""

    response.headers["Cache-Control"] = "no-store"
    since = utc_now() - timedelta(minutes=ACTIVE_WINDOW_MINUTES)
    rows = (
        await db.execute(
            select(PlaySession, AppUser.nickname)
            .outerjoin(AppUser, AppUser.id == PlaySession.owner_user_id)
            .where(PlaySession.updated_at >= since)
            .order_by(PlaySession.updated_at.desc())
            .limit(ACTIVE_LIST_LIMIT)
        )
    ).all()
    sessions = [
        ActiveSession(
            nickname=nickname,
            user_id=session.owner_user_id,
            case_id=session.case_id,
            started_at=session.created_at,
            last_seen_at=session.updated_at,
        )
        for session, nickname in rows
    ]
    await _audit(db, admin, "view_active_sessions", None)
    return ActiveSessionList(
        generated_at=utc_now(), window_minutes=ACTIVE_WINDOW_MINUTES, sessions=sessions
    )


def _signup_row(user: AppUser, stage: str | None) -> RecentSignup:
    return RecentSignup(
        user_id=user.id,
        nickname=user.nickname,
        email=user.email,
        region=user.region,
        created_at=user.created_at,
        stage=stage,
    )


async def _signups_between(
    db: AsyncSession,
    include_internal: bool,
    start: datetime | None,
    end: datetime | None,
    limit: int,
) -> list[RecentSignup]:
    """가입 최신순 회원과 저장 단계(slot 0). 이메일 가림은 화면 몫(§2.5)."""

    query = (
        select(AppUser, GamePlaySave.stage)
        .outerjoin(
            GamePlaySave,
            and_(GamePlaySave.app_user_id == AppUser.id, GamePlaySave.slot == 0),
        )
        .order_by(AppUser.created_at.desc())
        .limit(limit)
    )
    condition = _internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    if start is not None and end is not None:
        query = query.where(AppUser.created_at >= start, AppUser.created_at < end)
    rows = (await db.execute(query)).all()
    return [_signup_row(user, stage) for user, stage in rows]


async def _buckets(
    db: AsyncSession, query: Select, empty_label: str
) -> list[CountBucket]:
    rows = (await db.execute(query)).all()
    buckets = [
        CountBucket(label=label or empty_label, count=int(count))
        for label, count in rows
    ]
    return sorted(buckets, key=lambda b: (-b.count, b.label))


@router.get(
    "/stats/members",
    response_model=AdminStatsMembers,
    responses=error_responses.ADMIN_QUERY,
)
async def stats_members(
    response: Response,
    target_date: str | None = Query(
        default=None, alias="date", description="기준 날짜(KST), 기본 오늘"
    ),
    months: str | None = Query(
        default=None,
        description=f"1~{MEMBERS_MAX_MONTHS}, 기본 {MEMBERS_DEFAULT_MONTHS}",
    ),
    include_internal: str | None = Query(
        default=None,
        description="`true` 면 내부 계정(관리자 · 테스트 계정)도 센다. 기본 `false`",
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsMembers:
    """회원 통계(§P2-2) — 누적 · 달별 가입 · 지역 · 로그인 수단 · 최근 가입자. 가입자 목록이 보이므로 `view_member_stats` 로 기록한다."""

    response.headers["Cache-Control"] = "no-store"
    day = _stats_base(target_date)
    span = parse_int(
        months, "months", default=MEMBERS_DEFAULT_MONTHS, low=1, high=MEMBERS_MAX_MONTHS
    )
    internal = parse_bool(include_internal, "include_internal", default=False)
    condition = _internal_excluded(internal)

    this_month = kst_range(day.replace(day=1), day)
    prev_first = previous_month_first(day)
    prev_month = kst_range(prev_first, day.replace(day=1) - timedelta(days=1))
    last_30 = kst_range(day - timedelta(days=MAU_DAYS - 1), day)
    prev_30 = kst_range(
        day - timedelta(days=MAU_DAYS * 2 - 1), day - timedelta(days=MAU_DAYS)
    )
    month_end_cut = kst_range(day.replace(day=1), day.replace(day=1))[0]

    total_query = select(func.count()).select_from(AppUser)
    if condition is not None:
        total_query = total_query.where(condition)
    totals = MembersTotals(
        total=await _count_members(db, internal),
        total_at_prev_month_end=await _count(
            db, total_query.where(AppUser.created_at < month_end_cut)
        ),
        signups_this_month=await _count_members(db, internal, *this_month),
        signups_prev_month=await _count_members(db, internal, *prev_month),
        mau=await _active_members(db, internal, *last_30),
        mau_prev_30_days=await _active_members(db, internal, *prev_30),
    )
    monthly: list[MonthSignups] = []
    for first in month_firsts(day, span):
        last_day = min(day, next_month_first(first) - timedelta(days=1))
        monthly.append(
            MonthSignups(
                month=first.strftime("%Y-%m"),
                signups=await _count_members(db, internal, *kst_range(first, last_day)),
            )
        )

    region_query = select(AppUser.region, func.count()).group_by(AppUser.region)
    provider_query = (
        select(
            AuthIdentity.provider, func.count(func.distinct(AuthIdentity.app_user_id))
        )
        .join(AppUser, AppUser.id == AuthIdentity.app_user_id)
        .group_by(AuthIdentity.provider)
    )
    if condition is not None:
        region_query = region_query.where(condition)
        provider_query = provider_query.where(condition)

    result = AdminStatsMembers(
        generated_at=utc_now(),
        timezone=KST_NAME,
        date=day,
        include_internal=internal,
        months=span,
        totals=totals,
        monthly_signups=monthly,
        by_region=await _buckets(db, region_query, "(미입력)"),
        by_provider=await _buckets(db, provider_query, "(없음)"),
        signups_on_date=await _signups_between(
            db, internal, *kst_range(day, day), SIGNUPS_ON_DATE_LIMIT
        ),
        recent_signups=await _signups_between(
            db, internal, None, None, RECENT_SIGNUPS_LIMIT
        ),
        unavailable={
            "withdrawals": "withdrawal_not_implemented",
            "churn_rate": "withdrawal_not_implemented",
            "suspended": "suspension_not_implemented",
        },
    )
    await _audit(db, admin, "view_member_stats", None)
    return result


@router.get(
    "/stats/game",
    response_model=AdminStatsGame,
    responses=error_responses.ADMIN_QUERY,
)
async def stats_game(
    response: Response,
    target_date: str | None = Query(
        default=None, alias="date", description="끝 날짜(KST), 기본 오늘"
    ),
    days: str | None = Query(
        default=None, description=f"1~{GAME_MAX_DAYS}, 기본 {GAME_DEFAULT_DAYS}"
    ),
    include_internal: str | None = Query(
        default=None,
        description="`true` 면 내부 계정(관리자 · 테스트 계정)의 기록도 센다. 기본 `false`",
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsGame:
    """게임 진행 집계(§P2-3) — beta_events 를 사람 단위로. 깔때기 · 스테이지 진입/완료 · 퍼즐 시도/오답/힌트. 정답 값은 없다. 기록 안 남김.
    기본(include_internal=false)은 내부 계정에 이어진 기록을 뺀다(`_beta_event_internal_excluded`, 미르 11/13)."""

    response.headers["Cache-Control"] = "no-store"
    last = _stats_base(target_date)
    span = parse_int(days, "days", default=GAME_DEFAULT_DAYS, low=1, high=GAME_MAX_DAYS)
    internal = parse_bool(include_internal, "include_internal", default=False)
    start, end = kst_range(last - timedelta(days=span - 1), last)
    query = select(BetaEvent).where(
        BetaEvent.received_at >= start,
        BetaEvent.received_at < end,
        BetaEvent.event_type.in_(
            (
                "stage_reached",
                "objective_state",
                "puzzle_attempt",
                "help_event",
                "run_state",
            )
        ),
    )
    if not internal:
        # 상한(20만 행)보다 먼저 뺀다 — 내부 계정 기록이 상한 자리를 차지하지 않게
        query = query.where(_beta_event_internal_excluded())
    rows = (
        (await db.execute(query.order_by(BetaEvent.id).limit(GAME_EVENT_CAP)))
        .scalars()
        .all()
    )
    links = guest_links(await _guest_transfers(db, rows))
    aggregate = aggregate_game(
        GameEvent(
            event_type=row.event_type,
            phase=row.phase,
            objective_id=row.objective_id,
            person=person_key(row.app_user_id, row.guest_session_id, row.tab_id, links),
            run_id=row.run_id,
            at=row.client_ts or row.received_at,
            data=row.data if isinstance(row.data, dict) else {},
        )
        for row in rows
    )
    unavailable = (
        {"avg_completion_minutes": "no_completed_run"}
        if aggregate.avg_completion_minutes is None
        else {}
    )
    if len(rows) >= GAME_EVENT_CAP:
        # id 오름차순으로 앞 20만 건만 읽었으니 기간 뒤쪽(최근)이 빠진다 — 깔때기 · 스테이지 · 퍼즐 · 평균 시간 전부
        unavailable["truncated"] = f"first_{GAME_EVENT_CAP}_events_only"
    return AdminStatsGame(
        generated_at=utc_now(),
        timezone=KST_NAME,
        date=last,
        days=span,
        include_internal=internal,
        people=aggregate.people,
        funnel=[
            FunnelStep(phase=phase, people=count) for phase, count in aggregate.funnel
        ],
        stages=[
            StageStats(stage=s, entered=e, completed=c) for s, e, c in aggregate.stages
        ],
        puzzles=[PuzzleStats(**puzzle) for puzzle in aggregate.puzzles],
        avg_completion_minutes=aggregate.avg_completion_minutes,
        completed_runs=aggregate.completed_runs,
        unavailable=unavailable,
    )


@router.get(
    "/security/summary",
    response_model=AdminSecuritySummary,
    responses=error_responses.ADMIN_LIST,
)
async def security_summary(
    response: Response,
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminSecuritySummary:
    """보안 집계(§P2-4) — 로그인 잠김 창 · 관리자 로그인 7일 · 관리자 기록 24시간. 키 해시 · IP 는 없다. 관리자 이름이 보이므로 기록한다."""

    response.headers["Cache-Control"] = "no-store"
    now = utc_now()
    locked = await _count(
        db,
        select(func.count())
        .select_from(LoginThrottle)
        .where(LoginThrottle.locked_until > now),
    )
    # 현재 창에 든 줄만 센다(세진 11/13) — record_login_failure 는 window_started_at 이 THROTTLE_WINDOW(15분)보다 오래된 줄을
    # 다음 실패 때 새 창으로 바꾼다(옛 실패 수는 버린다). 그 규칙 그대로 창이 지난 줄은 빼고, 아직 잠긴 줄은 창이 지났어도 센다
    # (잠김이 유효한 동안은 그 실패 수가 살아 있다 — 잠긴 키가 keys_with_failures 에서 빠지면 안 맞는다).
    in_window = or_(
        LoginThrottle.window_started_at >= now - THROTTLE_WINDOW,
        LoginThrottle.locked_until > now,
    )
    keys_with_failures = await _count(
        db,
        select(func.count())
        .select_from(LoginThrottle)
        .where(LoginThrottle.failed_count > 0, in_window),
    )
    failures_in_window = int(
        (
            await db.execute(
                select(func.coalesce(func.sum(LoginThrottle.failed_count), 0)).where(
                    in_window
                )
            )
        ).scalar_one()
    )
    login_rows = (
        await db.execute(
            select(UserSession.app_user_id, AppUser.nickname, UserSession.created_at)
            .join(AppUser, AppUser.id == UserSession.app_user_id)
            .where(
                AppUser.role == ADMIN_ROLE,
                UserSession.created_at >= now - timedelta(days=ADMIN_LOGIN_DAYS),
            )
            .order_by(UserSession.created_at.desc())
            .limit(ACTIVE_LIST_LIMIT)
        )
    ).all()
    action_rows = (
        await db.execute(
            select(AdminAuditLog.action, func.count())
            .where(AdminAuditLog.created_at >= now - timedelta(hours=24))
            .group_by(AdminAuditLog.action)
        )
    ).all()
    result = AdminSecuritySummary(
        generated_at=now,
        timezone=KST_NAME,
        login_throttle=LoginThrottleSummary(
            locked_now=locked,
            keys_with_failures=keys_with_failures,
            failures_in_window=failures_in_window,
        ),
        admin_logins_7d=[
            AdminLoginEntry(user_id=uid, nickname=nick, at=at)
            for uid, nick, at in login_rows
        ],
        audit_actions_24h=sorted(
            (
                CountBucket(label=action, count=int(count))
                for action, count in action_rows
            ),
            key=lambda b: (-b.count, b.label),
        ),
        unavailable={
            "rate_limited_429": "memory_only",
            "request_errors": "not_stored",
            "chat_rejections": "not_stored",
            "hot_ips": "ip_not_stored",
            "admin_login_ip": "ip_not_stored",
        },
    )
    await _audit(db, admin, "view_security_summary", None)
    return result
