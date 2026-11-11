"""관리자 조회. 비밀번호 해시와 세션 토큰은 어떤 응답에도 넣지 않는다. 열람은 기록으로 남긴다."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.api.v1.me import find_save, list_owned_items, to_save_response
from app.db.session import get_db
from app.models.account_data import AdminAuditLog, GamePlaySave, UserCharacter
from app.models.app_user import AppUser
from app.models.beta_event import BetaEvent
from app.schemas.account_data import (
    AdminUserDetail,
    AdminUserList,
    AdminUserSummary,
    CharacterResponse,
)
from app.schemas.beta_event import (
    PARTICIPANT_CODE_PATTERN,
    BetaEventExport,
    BetaEventOut,
)
from app.services.local_auth import utc_now
from app.services.user_session import current_admin

router = APIRouter(prefix="/admin", tags=["Admin"])

PAGE_SIZE = 50


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
    "/users", response_model=AdminUserList, responses=error_responses.ADMIN_LIST
)
async def list_users(
    offset: int = Query(default=0, ge=0),
    admin: AppUser = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserList:
    rows = await db.execute(
        select(AppUser, GamePlaySave)
        .outerjoin(GamePlaySave, GamePlaySave.app_user_id == AppUser.id)
        .order_by(AppUser.created_at.desc())
        .offset(offset)
        .limit(PAGE_SIZE + 1)
    )
    pairs = rows.all()
    await _audit(db, admin, "list_users", None)
    return AdminUserList(
        users=[_summary(user, save) for user, save in pairs[:PAGE_SIZE]],
        next_offset=offset + PAGE_SIZE if len(pairs) > PAGE_SIZE else None,
    )


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
