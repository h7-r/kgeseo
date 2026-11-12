"""관리자 조회. 비밀번호 해시와 세션 토큰은 어떤 응답에도 넣지 않는다. 열람은 기록으로 남긴다.

관리자 API v0.2 1단계(`docs/contracts/admin_api_v0.2.md`, PR #119 — 11/12 미르): 회원 목록 검색 · 추가 필드,
`/admin/stats/summary`, `/admin/audit-logs`. 기존 테이블 읽기만(감사 기록 쓰기는 기존 `admin_audit_logs` 그대로).
모든 경로는 매 요청 `current_admin`(role == "admin")을 거친다.
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Select, and_, func, select, union
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
    kst_days,
    month_firsts,
    next_month_first,
    person_key,
    previous_month_first,
)
from app.services.local_auth import utc_now
from app.services.user_session import current_admin

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


def _internal_excluded(include_internal: bool):
    """회원 통계에서 뺄 내부 계정 조건(D7) — 지금은 관리자(조회 시점 role)만. 테스트 계정 표시는 베타 이후."""

    return None if include_internal else AppUser.role != ADMIN_ROLE


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


async def _active_members(
    db: AsyncSession, include_internal: bool, start: datetime, end: datetime
) -> int:
    """기간 안에 로그인 세션 또는 플레이 세션을 만든 고유 회원 수(D8). 둘 다 있는 회원은 한 번."""

    logins = select(UserSession.app_user_id.label("user_id")).where(
        UserSession.created_at >= start, UserSession.created_at < end
    )
    plays = select(PlaySession.owner_user_id.label("user_id")).where(
        PlaySession.owner_user_id.is_not(None),
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


async def _active_guests(db: AsyncSession, start: datetime, end: datetime) -> int:
    """기간 안에 플레이 세션을 만든 게스트 — 회원 소유가 아닌 세션의 고유 익명 세션 수(브라우저 쿠키 단위, D8-a 제안)."""

    return await _count(
        db,
        select(func.count(func.distinct(PlaySession.owner_anonymous_session_id))).where(
            PlaySession.owner_user_id.is_(None),
            PlaySession.owner_anonymous_session_id.is_not(None),
            PlaySession.created_at >= start,
            PlaySession.created_at < end,
        ),
    )


async def _play_sessions_by_member(
    db: AsyncSession, include_internal: bool, start: datetime, end: datetime
) -> int:
    query = (
        select(func.count())
        .select_from(PlaySession)
        .join(AppUser, AppUser.id == PlaySession.owner_user_id)
        .where(PlaySession.created_at >= start, PlaySession.created_at < end)
    )
    condition = _internal_excluded(include_internal)
    if condition is not None:
        query = query.where(condition)
    return await _count(db, query)


async def _play_sessions_by_guest(
    db: AsyncSession, start: datetime, end: datetime
) -> int:
    """회원 소유가 아닌 세션(게스트 · 소유자 없는 옛 세션)."""

    return await _count(
        db,
        select(func.count())
        .select_from(PlaySession)
        .where(
            PlaySession.owner_user_id.is_(None),
            PlaySession.created_at >= start,
            PlaySession.created_at < end,
        ),
    )


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
        description="`true` 면 관리자 계정도 회원 통계에 넣는다. 기본 `false`",
    ),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsSummary:
    """대시보드 요약(§3.3) — 회원 수 · 가입 · DAU · MAU(D8) · 플레이 세션. 모든 날짜는 KST, 저장 시각은 UTC 로 비교한다.

    내부 계정(관리자)은 기본으로 회원 통계 전체에서 같은 규칙으로 뺀다(D7). 테스트 계정 표시는 아직 없어
    `excluded.test_accounts` 는 null 이다(D7-a). 통계 조회를 감사 기록에 남길지는 PM 미결(D5-b)이라 남기지 않는다.
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
    if not internal:
        admins = await _count(
            db,
            select(func.count()).select_from(AppUser).where(AppUser.role == ADMIN_ROLE),
        )
    by_member = await _play_sessions_by_member(db, internal, *day_range)
    by_guest = await _play_sessions_by_guest(db, *day_range)
    return AdminStatsSummary(
        generated_at=utc_now(),
        timezone=KST_NAME,
        date=day,
        include_internal=internal,
        range_utc=StatsRangeUtc(day=day_range, month=month_range, last_30_days=last_30),
        excluded=StatsExcluded(admins=admins, test_accounts=None),
        members=StatsMembers(
            total=await _count_members(db, internal),
            signups_on_date=await _count_members(db, internal, *day_range),
            signups_in_month=await _count_members(db, internal, *month_range),
        ),
        activity=StatsActivity(
            members_dau=await _active_members(db, internal, *day_range),
            members_mau=await _active_members(db, internal, *last_30),
            guests_dau=await _active_guests(db, *day_range),
            guests_mau=await _active_guests(db, *last_30),
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
        default=None, description="`true` 면 관리자 계정도 센다. 기본 `false`"
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
                guests_dau=await _active_guests(db, start, end),
                signups=await _count_members(db, internal, start, end),
                play_sessions_created=await _play_sessions_by_member(
                    db, internal, start, end
                )
                + await _play_sessions_by_guest(db, start, end),
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
        default=None, description="`true` 면 관리자 계정도 센다. 기본 `false`"
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
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsGame:
    """게임 진행 집계(§P2-3) — beta_events 를 사람 단위로. 깔때기 · 스테이지 진입/완료 · 퍼즐 시도/오답/힌트. 정답 값은 없다. 기록 안 남김."""

    response.headers["Cache-Control"] = "no-store"
    last = _stats_base(target_date)
    span = parse_int(days, "days", default=GAME_DEFAULT_DAYS, low=1, high=GAME_MAX_DAYS)
    start, end = kst_range(last - timedelta(days=span - 1), last)
    rows = (
        (
            await db.execute(
                select(BetaEvent)
                .where(
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
                .order_by(BetaEvent.id)
                .limit(GAME_EVENT_CAP)
            )
        )
        .scalars()
        .all()
    )
    aggregate = aggregate_game(
        GameEvent(
            event_type=row.event_type,
            phase=row.phase,
            objective_id=row.objective_id,
            person=person_key(row.app_user_id, row.guest_session_id, row.tab_id),
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
        unavailable["truncated"] = f"first_{GAME_EVENT_CAP}_events_only"
    return AdminStatsGame(
        generated_at=utc_now(),
        timezone=KST_NAME,
        date=last,
        days=span,
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
    failing = select(LoginThrottle).where(LoginThrottle.failed_count > 0).subquery()
    keys_with_failures = await _count(db, select(func.count()).select_from(failing))
    failures_in_window = int(
        (
            await db.execute(
                select(func.coalesce(func.sum(LoginThrottle.failed_count), 0))
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
