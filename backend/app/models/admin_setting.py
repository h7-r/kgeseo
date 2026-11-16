"""관리자가 화면에서 바꾸는 설정 값(관리자 API v0.3 3단계 P3-2, 해랑 11/13).

key 하나에 JSON 값 하나. 처음 키는 `maintenance_mode`(`{"on": false, "message": ""}`)뿐이고, 키를 더해도 표는 그대로다.
서버 config(환경 변수) 값은 여기 넣지 않는다 — 그건 읽기 전용으로 보여 줄 뿐 배포로만 바꾼다.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import CHAR, JSON, VARCHAR, ForeignKey
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

MAINTENANCE_MODE_KEY = "maintenance_mode"
SETTING_KEYS = (MAINTENANCE_MODE_KEY,)


class AdminSetting(Base):
    __tablename__ = "admin_settings"

    key: Mapped[str] = mapped_column(VARCHAR(64), primary_key=True)
    value_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
