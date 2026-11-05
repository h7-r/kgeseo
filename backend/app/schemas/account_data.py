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


class AdminUserDetail(BaseModel):
    user: AdminUserSummary
    save: GameSaveResponse | None
    character: CharacterResponse | None
    items: list[OwnedItem]
