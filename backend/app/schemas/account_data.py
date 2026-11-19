from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MeResponse(BaseModel):
    user_id: str
    email: str
    nickname: str
    region: str | None
    role: str


class WithdrawalRequest(BaseModel):
    """회원 탈퇴 요청(계약 account_withdrawal_v0.2 §2). 이메일 비밀번호 수단이 있는 회원은 비밀번호가 필수다(소셜도 연결돼 있어도).
    소셜 전용 회원은 보내도 쓰지 않는다(`reauth_required`). 형식 오류는 입력을 되돌려 보내지 않는다(`main.SENSITIVE_INPUT_FIELDS`)."""

    model_config = ConfigDict(extra="forbid")

    password: str | None = Field(default=None, min_length=1, max_length=128)


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
    # 회원 탈퇴 시각(app_users.deleted_at, 11/17 미르). 회원이면 null. 탈퇴 회원은 목록에 없지만 id 로 직접 열면 이 값으로
    # 탈퇴를 알 수 있다(그때 이메일 · 닉네임은 비식별화된 값, region · last_login_at 은 null, providers 는 [])
    deleted_at: datetime | None = None


class AdminUserDetail(BaseModel):
    user: AdminUserDetailUser
    save: GameSaveResponse | None
    character: CharacterResponse | None
    items: list[OwnedItem]
