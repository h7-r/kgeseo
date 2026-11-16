from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MeResponse(BaseModel):
    user_id: str
    email: str
    nickname: str
    region: str | None
    role: str


class GameSaveWrite(BaseModel):
    # 마지막으로 받은 revision. 처음 저장이면 0.
    revision: int = Field(ge=0)
    schema_version: int = Field(ge=1, le=1000)
    stage: str = Field(pattern=r"^[a-z0-9_.-]{1,32}$")
    state: dict[str, Any]


class GameSaveResponse(BaseModel):
    revision: int
    schema_version: int
    stage: str
    state: dict[str, Any]
    updated_at: datetime


class CharacterWrite(BaseModel):
    display_name: str = Field(min_length=1, max_length=32)
    appearance: dict[str, Any]


class CharacterResponse(BaseModel):
    display_name: str
    appearance: dict[str, Any]
    updated_at: datetime


class OwnedItem(BaseModel):
    item_id: str
    kind: str
    name: str
    quantity: int
    source: str
    acquired_at: datetime


class AdminUserSummary(BaseModel):
    user_id: str
    email: str
    nickname: str
    role: str
    created_at: datetime
    stage: str | None
    save_updated_at: datetime | None


class AdminUserList(BaseModel):
    users: list[AdminUserSummary]
    next_offset: int | None


class AdminUserDetailUser(AdminUserSummary):
    """회원 상세의 `user` — 기존 필드는 그대로, 목록(`AdminUserListItem`)과 같은 정의의 네 값을 덧붙인다
    (해랑 요청 · 미르 11/16, 계약 docs/contracts/admin_last_login.md)."""

    # 회원이 가입 때 고른 지역(app_users.region). 없으면 null
    region: str | None = None
    # `auth_identities.provider` 중복 제거 · 알파벳순(local · google · naver). 연결이 없으면 []
    providers: list[str] = []
    # 마지막으로 새 로그인 세션을 발급한 시각(app_users.last_login_at). 기록이 없으면 null
    last_login_at: datetime | None = None
    # MAX(user_sessions.created_at) — 기존 추정값 그대로(목록과 같은 값)
    last_session_started_at: datetime | None = None


class AdminUserDetail(BaseModel):
    user: AdminUserDetailUser
    save: GameSaveResponse | None
    character: CharacterResponse | None
    items: list[OwnedItem]
