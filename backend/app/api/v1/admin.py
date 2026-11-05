"""관리자 조회. 비밀번호 해시와 세션 토큰은 어떤 응답에도 넣지 않는다. 열람은 기록으로 남긴다."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.api.v1.me import find_save, list_owned_items, to_save_response
from app.db.session import get_db
from app.models.account_data import AdminAuditLog, GamePlaySave, UserCharacter
from app.models.app_user import AppUser
from app.schemas.account_data import (
    AdminUserDetail,
    AdminUserList,
    AdminUserSummary,
    CharacterResponse,
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
