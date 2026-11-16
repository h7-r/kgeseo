"""설정 · 점검 모드 · 관리자 목록 응답(관리자 API v0.3 3단계 P3-2)."""

from datetime import datetime

from pydantic import BaseModel, Field


class MaintenanceMode(BaseModel):
    on: bool
    message: str
    updated_at: datetime | None
    # 마지막으로 바꾼 관리자 닉네임(계정이 사라졌으면 null)
    updated_by: str | None


class MaintenanceModeUpdate(BaseModel):
    on: bool
    message: str = Field(default="", max_length=200)


class AdminSettingsEditable(BaseModel):
    maintenance_mode: MaintenanceMode


class AdminSettingsResponse(BaseModel):
    editable: AdminSettingsEditable
    # 실행 중 서버의 실제 config · 상수 값(비밀값 없음). 바꾸려면 배포
    readonly: dict[str, int | bool]


class SiteMaintenance(BaseModel):
    on: bool
    message: str


class SiteStatus(BaseModel):
    maintenance: SiteMaintenance


class AdminAccount(BaseModel):
    user_id: str
    nickname: str
    # 목록은 가림(1단계 규칙)
    email: str
    created_at: datetime
    last_login_at: datetime | None
    last_session_started_at: datetime | None


class AdminAccountList(BaseModel):
    items: list[AdminAccount]
