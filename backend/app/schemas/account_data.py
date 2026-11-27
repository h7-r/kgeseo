from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MeResponse(BaseModel):
    """`GET /me`(계약 docs/contracts/account_me_v0.1.md). 새 탭에서 쿠키로 복원할 때 웹사이트가 이것만으로 프로필을 다시 그린다."""

    user_id: str
    email: str
    nickname: str
    region: str | None
    role: str
    # 가입 시각. 다른 API 와 달리 UTC 표시(`Z`)를 붙여 낸다 — 웹이 Z 없는 값도 UTC 로 읽지만 복원 경로는 명시한다(11/18)
    created_at: datetime
    # 로그인 수단(auth_identities.provider 그대로: local · google · naver). 연결한 순서, 중복 없음. 소셜 전용 회원이면 local 이 없다
    providers: list[str]


class PasswordChangeRequest(BaseModel):
    """로그인한 회원의 비밀번호 변경(계약 password_reset_v0.1 §4). 지금 비밀번호를 다시 확인한다."""

    current_password: str = Field(min_length=1, max_length=128, repr=False)
    new_password: str = Field(min_length=1, max_length=128, repr=False)


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
    # (선택, 11/20) 게임이 저장을 처음 불러올 때의 계정 id(`/me` 의 user_id). 있으면 지금 로그인 쿠키의 회원과 같을 때만 쓴다 —
    # 다르면 409 `account_changed`(아무것도 바꾸지 않는다). **인증이 아니다**: 쓰는 대상은 늘 쿠키의 회원이고, 이 값은 거절에만 쓴다.
    # 없으면 지금까지와 같다(옛 클라이언트 호환). 옛 서버는 모르는 필드라 무시한다(배포 순서 무관).
    account_id: str | None = Field(default=None, min_length=1, max_length=64)


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
