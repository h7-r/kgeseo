"""로그인한 사용자 자신의 데이터. 모든 조회·저장의 대상은 세션의 사용자로만 정해진다."""

import json
from datetime import timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import error_responses
from app.db.session import get_db
from app.models.account_data import GamePlaySave, ItemCatalog, UserCharacter, UserItem
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.inquiry import Inquiry
from app.schemas.account_data import (
    CharacterResponse,
    CharacterWrite,
    GameSaveResponse,
    GameSaveWrite,
    MeResponse,
    OwnedItem,
    PasswordChangeRequest,
    WithdrawalRequest,
)
from app.schemas.inquiry import MyInquiry, MyInquiryList, MyInquiryReply
from app.services.account_withdrawal import WithdrawalRefused, withdraw_member
from app.services.guest_session import GUEST_COOKIE, clear_guest_cookie
from app.services.inquiry import replies_of
from app.services.local_auth import utc_now
from app.services.password_reset import (
    InvalidCurrentPasswordError,
    NoLocalPasswordError,
    SamePasswordError,
    change_password,
)
from app.services.registration_input_policy import InvalidPasswordError
from app.services.user_session import (
    SESSION_COOKIE,
    SESSION_COOKIE_OPTIONS,
    WithdrawnAccountError,
    clear_login_failures,
    current_user,
    end_session,
    ensure_member_for_write,
    hash_session_token,
    login_lock_remaining_seconds,
    record_login_failure,
    require_same_origin,
    wait_phrase,
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


def login_required() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail="Login required.",
        headers={"Cache-Control": "no-store"},
    )


async def ensure_member(db: AsyncSession, user_id: str) -> None:
    """쓰기 직전 — 세션 확인 뒤 탈퇴가 끝났으면 쓰지 않고 401(회원 행 공유 잠금, `ensure_member_for_write`)."""

    try:
        await ensure_member_for_write(db, user_id)
    except WithdrawnAccountError as error:
        await db.rollback()
        raise login_required() from error


async def find_save(db: AsyncSession, user_id: str) -> GamePlaySave | None:
    return await db.scalar(
        select(GamePlaySave).where(
            GamePlaySave.app_user_id == user_id, GamePlaySave.slot == DEFAULT_SLOT
        )
    )


async def stored_revision(db: AsyncSession, user_id: str) -> int:
    """지금 DB 에 있는 저장본의 번호. 없으면 0(첫 저장으로 다시 시도하면 된다)."""
    stored = await find_save(db, user_id)
    return stored.revision if stored else 0


async def list_providers(db: AsyncSession, user_id: str) -> list[str]:
    """회원의 로그인 수단 이름을 연결한 순서로. 같은 수단이 둘이어도 한 번만(관리자 상세는 알파벳순 — 여기는 가입 순)."""
    rows = await db.scalars(
        select(AuthIdentity.provider)
        .where(AuthIdentity.app_user_id == user_id)
        .order_by(AuthIdentity.created_at, AuthIdentity.id)
    )
    return list(dict.fromkeys(rows.all()))


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
async def read_me(
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    return MeResponse(
        user_id=user.id,
        email=user.email,
        nickname=user.nickname,
        region=user.region,
        role=user.role,
        # DB 는 UTC naive — 표시를 붙여야 응답이 `Z` 로 끝난다
        created_at=user.created_at.replace(tzinfo=timezone.utc),
        providers=await list_providers(db, user.id),
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


def _locked_error(retry_after: int) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "code": "login_locked",
            "message": f"비밀번호 실패가 많아 잠시 막혔습니다. {wait_phrase(retry_after)} 다시 시도해 주세요.",
        },
        headers={"Cache-Control": "no-store", "Retry-After": str(retry_after)},
    )


def _coded(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code,
        detail={"code": code, "message": message},
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses.ME_PASSWORD,
)
async def change_my_password(
    body: PasswordChangeRequest,
    request: Request,
    response: Response,
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """비밀번호 변경(계약 password_reset_v0.1 §4). 지금 비밀번호를 확인하고, 이 창의 세션만 남긴 채 다른 기기는 로그아웃한다.

    지금 비밀번호 실패는 로그인 · 탈퇴와 같은 이메일 집계에 더한다(이 창구로 비밀번호를 대입해 보지 못하게).
    """
    response.headers["Cache-Control"] = "no-store"
    email = user.email
    retry_after = await login_lock_remaining_seconds(db, request, email)
    if retry_after is not None:
        raise _locked_error(retry_after)
    token = request.cookies.get(SESSION_COOKIE)
    try:
        await change_password(
            db,
            user,
            body.current_password,
            body.new_password,
            keep_session_token_hash=hash_session_token(token) if token else None,
        )
    except WithdrawnAccountError as error:
        # 같은 계정의 탈퇴가 먼저 끝났다(다른 창) — 세션이 끝난 것과 같다
        raise login_required() from error
    except NoLocalPasswordError as error:
        raise _coded(
            status.HTTP_403_FORBIDDEN,
            "no_local_password",
            "소셜 로그인으로 가입한 계정은 비밀번호가 없습니다.",
        ) from error
    except InvalidCurrentPasswordError as error:
        await db.rollback()
        await record_login_failure(db, request, email)
        raise _coded(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_password",
            "현재 비밀번호가 맞지 않습니다.",
        ) from error
    except SamePasswordError as error:
        raise _coded(
            422, "same_password", "현재와 다른 비밀번호를 써 주세요."
        ) from error
    except InvalidPasswordError as error:
        raise _coded(
            422, "invalid_password", "비밀번호 형식을 확인해 주세요."
        ) from error
    await clear_login_failures(db, request, email)


_WITHDRAWAL_REFUSALS = {
    "admin_cannot_withdraw": "관리자 계정은 탈퇴할 수 없습니다.",
    "reauth_required": "소셜 로그인 계정 탈퇴는 아직 지원하지 않습니다. 다시 로그인 확인이 필요합니다.",
}


@router.post(
    "/withdrawal",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses.ME_WITHDRAWAL,
)
async def withdraw(
    body: WithdrawalRequest,
    request: Request,
    response: Response,
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """회원 탈퇴(계약 account_withdrawal_v0.2). 성공하면 204 와 로그인 · 게스트 쿠키 만료 — 커밋이 끝난 뒤에만 쿠키를 지운다.

    요청의 게스트 쿠키가 유효하면 그 게스트 세션도 같은 트랜잭션에서 폐기한다(쿠키만 지우지 않고 서버에서도 막는다).

    비밀번호 실패는 로그인과 같은 이메일 집계에 더한다(탈퇴 창구로 비밀번호를 대입해 보지 못하게). 거절 · 실패면 바뀌는 것이 없다.
    """
    response.headers["Cache-Control"] = "no-store"
    email = user.email
    retry_after = await login_lock_remaining_seconds(db, request, email)
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "login_locked",
                # 남은 시간은 Retry-After 와 같은 숫자로 말한다(11/18)
                "message": f"비밀번호 실패가 많아 잠시 막혔습니다. {wait_phrase(retry_after)} 다시 시도해 주세요.",
            },
            headers={"Cache-Control": "no-store", "Retry-After": str(retry_after)},
        )
    try:
        await withdraw_member(
            db, user.id, body.password, guest_token=request.cookies.get(GUEST_COOKIE)
        )
    except WithdrawalRefused as refusal:
        if refusal.code == "invalid_password":
            await record_login_failure(db, request, email)
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "invalid_password",
                    "message": "비밀번호가 맞지 않습니다.",
                },
                headers={"Cache-Control": "no-store"},
            ) from refusal
        if refusal.code == "already_withdrawn":
            # 같은 계정의 탈퇴가 먼저 끝났다(동시 요청)
            raise login_required() from refusal
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": refusal.code,
                "message": _WITHDRAWAL_REFUSALS[refusal.code],
            },
            headers={"Cache-Control": "no-store"},
        ) from refusal
    response.delete_cookie(SESSION_COOKIE, **SESSION_COOKIE_OPTIONS)
    clear_guest_cookie(response)


@router.get(
    "/inquiries", response_model=MyInquiryList, responses=error_responses.ME_READ
)
async def read_my_inquiries(
    user: AppUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MyInquiryList:
    """내가 로그인한 채 접수한 1:1 문의 전부(최신순)와 답변(관리자 API v0.3 P3-1). 답변에 관리자 이름은 싣지 않는다 — 「운영팀」."""
    rows = (
        (
            await db.execute(
                select(Inquiry)
                .where(Inquiry.app_user_id == user.id)
                .order_by(Inquiry.created_at.desc(), Inquiry.seq.desc())
            )
        )
        .scalars()
        .all()
    )
    replies = await replies_of(db, [row.id for row in rows])
    return MyInquiryList(
        items=[
            MyInquiry(
                id=row.id,
                number=row.number or "",
                category=row.category,
                title=row.title,
                body=row.body,
                status=row.status,
                created_at=row.created_at,
                answered_at=row.answered_at,
                replies=[
                    MyInquiryReply(body=reply.body, created_at=reply.created_at)
                    for reply in replies.get(row.id, [])
                ],
            )
            for row in rows
        ]
    )


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
    # 다른 계정의 진행이 이 계정 저장에 들어가지 않게(11/20) — 게임이 불러올 때의 계정과 지금 쿠키의 회원이 다르면 쓰지 않는다.
    # revision 이 우연히 같아도(둘 다 0 등) 막힌다. DB 를 읽기 전에 거절해 아무것도 바뀌지 않는다
    if body.account_id is not None and body.account_id.lower() != user.id.lower():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "account_changed",
                "message": "로그인한 계정이 바뀌어 저장하지 않았습니다.",
            },
            headers={"Cache-Control": "no-store"},
        )
    _check_json(body.state, MAX_STATE_BYTES)
    # rollback 뒤에는 회원 행 속성을 읽을 수 없다(만료 재조회) — 번호를 먼저 떼어 둔다
    user_id = user.id
    await ensure_member(db, user_id)
    now = utc_now()
    save = await find_save(db, user_id)
    # 다른 창이 먼저 저장했으면 덮어쓰지 않고 최신값을 알려 준다.
    if (save.revision if save else 0) != body.revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "save_conflict", "revision": save.revision if save else 0},
        )
    if save is None:
        save = GamePlaySave(
            id=str(uuid4()),
            app_user_id=user_id,
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
        # 두 창이 저장본 없는 상태에서 동시에 첫 저장 — 먼저 들어간 쪽의 번호를 알려 줘야 재시도가 한 번에 된다
        await db.rollback()
        revision = await stored_revision(db, user_id)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "save_conflict", "revision": revision},
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
    await ensure_member(db, user.id)
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
