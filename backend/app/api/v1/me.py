"""로그인한 사용자 자신의 데이터. 모든 조회·저장의 대상은 세션의 사용자로만 정해진다."""

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.db.session import get_db
from app.models.account_data import GamePlaySave, ItemCatalog, UserCharacter, UserItem
from app.models.app_user import AppUser
from app.schemas.account_data import (
    CharacterResponse,
    CharacterWrite,
    GameSaveResponse,
    GameSaveWrite,
    MeResponse,
    OwnedItem,
)
from app.services.local_auth import utc_now
from app.services.user_session import (
    current_user,
    end_session,
    require_same_origin,
)

router = APIRouter(
    prefix="/me", tags=["Me"], dependencies=[Depends(require_same_origin)]
)

DEFAULT_SLOT = 0
MAX_STATE_BYTES = 512 * 1024
MAX_APPEARANCE_BYTES = 32 * 1024
MAX_JSON_DEPTH = 24


def _check_json(value: object, limit: int) -> None:
    """크기·깊이를 막아 저장 칸을 공격 통로로 쓰지 못하게 한다."""
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > limit:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, detail="Save data too large."
        )
    stack = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > MAX_JSON_DEPTH:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Save data too deep."
            )
        children = (
            node.values()
            if isinstance(node, dict)
            else node
            if isinstance(node, list)
            else ()
        )
        stack.extend((child, depth + 1) for child in children)


def to_save_response(save: GamePlaySave) -> GameSaveResponse:
    return GameSaveResponse(
        revision=save.revision,
        schema_version=save.schema_version,
        stage=save.stage,
        state=save.state_json,
        updated_at=save.updated_at,
    )


async def find_save(db: AsyncSession, user_id: str) -> GamePlaySave | None:
    return await db.scalar(
        select(GamePlaySave).where(
            GamePlaySave.app_user_id == user_id, GamePlaySave.slot == DEFAULT_SLOT
        )
    )


async def list_owned_items(db: AsyncSession, user_id: str) -> list[OwnedItem]:
    rows = await db.execute(
        select(UserItem, ItemCatalog)
        .join(ItemCatalog, ItemCatalog.id == UserItem.item_id)
        .where(UserItem.app_user_id == user_id)
    )
    return [
        OwnedItem(
            item_id=item.item_id,
            kind=catalog.kind,
            name=catalog.name,
            quantity=item.quantity,
            source=item.source,
            acquired_at=item.acquired_at,
        )
        for item, catalog in rows.all()
    ]


@router.get("", response_model=MeResponse, responses=error_responses.ME_READ)
async def read_me(user: AppUser = Depends(current_user)) -> MeResponse:
    return MeResponse(
        user_id=user.id,
        email=user.email,
        nickname=user.nickname,
        region=user.region,
        role=user.role,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses.ME_LOGOUT,
)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> None:
    await end_session(db, request, response)


@router.get(
    "/game-save",
    response_model=GameSaveResponse | None,
    responses=error_responses.ME_READ,
)
async def read_game_save(
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> GameSaveResponse | None:
    save = await find_save(db, user.id)
    return to_save_response(save) if save else None


@router.put(
    "/game-save",
    response_model=GameSaveResponse,
    responses=error_responses.GAME_SAVE_WRITE,
)
async def write_game_save(
    body: GameSaveWrite,
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> GameSaveResponse:
    _check_json(body.state, MAX_STATE_BYTES)
    now = utc_now()
    save = await find_save(db, user.id)
    # 다른 창이 먼저 저장했으면 덮어쓰지 않고 최신값을 알려 준다.
    if (save.revision if save else 0) != body.revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "save_conflict", "revision": save.revision if save else 0},
        )
    if save is None:
        save = GamePlaySave(
            id=str(uuid4()),
            app_user_id=user.id,
            slot=DEFAULT_SLOT,
            revision=1,
            schema_version=body.schema_version,
            stage=body.stage,
            state_json=body.state,
            created_at=now,
            updated_at=now,
        )
        db.add(save)
    else:
        save.revision += 1
        save.schema_version = body.schema_version
        save.stage = body.stage
        save.state_json = body.state
        save.updated_at = now
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "save_conflict", "revision": 0}
        ) from error
    return to_save_response(save)


@router.delete(
    "/game-save",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses.GAME_SAVE_DELETE,
)
async def delete_game_save(
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await db.execute(delete(GamePlaySave).where(GamePlaySave.app_user_id == user.id))
    await db.commit()


@router.get(
    "/character",
    response_model=CharacterResponse | None,
    responses=error_responses.ME_READ,
)
async def read_character(
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> CharacterResponse | None:
    character = await db.get(UserCharacter, user.id)
    if character is None:
        return None
    return CharacterResponse(
        display_name=character.display_name,
        appearance=character.appearance_json,
        updated_at=character.updated_at,
    )


@router.put(
    "/character",
    response_model=CharacterResponse,
    responses=error_responses.CHARACTER_WRITE,
)
async def write_character(
    body: CharacterWrite,
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> CharacterResponse:
    _check_json(body.appearance, MAX_APPEARANCE_BYTES)
    now = utc_now()
    character = await db.get(UserCharacter, user.id)
    if character is None:
        character = UserCharacter(
            app_user_id=user.id,
            display_name=body.display_name,
            appearance_json=body.appearance,
            updated_at=now,
        )
        db.add(character)
    else:
        character.display_name = body.display_name
        character.appearance_json = body.appearance
        character.updated_at = now
    await db.commit()
    return CharacterResponse(
        display_name=character.display_name,
        appearance=character.appearance_json,
        updated_at=character.updated_at,
    )


@router.get("/items", response_model=list[OwnedItem], responses=error_responses.ME_READ)
async def read_items(
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OwnedItem]:
    return await list_owned_items(db, user.id)
