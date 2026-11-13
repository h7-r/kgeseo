from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, Boolean, Index, false
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(
        CHAR(36),
        primary_key=True,
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        VARCHAR(254),
        nullable=False,
        unique=True,
    )

    nickname: Mapped[str] = mapped_column(
        VARCHAR(32),
        nullable=False,
        unique=True,
    )

    region: Mapped[str | None] = mapped_column(
        VARCHAR(32),
        nullable=True,
    )

    terms_version: Mapped[str | None] = mapped_column(
        VARCHAR(32),
        nullable=True,
    )

    terms_accepted_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    privacy_accepted_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    age_confirmed_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    # "user" · "admin". 관리자는 scripts/set_user_role.py 로만 지정한다.
    role: Mapped[str] = mapped_column(
        VARCHAR(16),
        nullable=False,
        default="user",
        server_default="user",
    )

    # 팀 테스트 계정 표시(미르 11/13). 관리자 통계의 기본값(include_internal=false)에서 관리자와 함께 뺀다.
    # 서버 명령(scripts/set_test_account.py)으로만 바꾼다 — 일반 API 는 없다.
    is_test: Mapped[bool] = mapped_column(
        Boolean(create_constraint=False),
        nullable=False,
        default=False,
        server_default=false(),
    )

    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    __table_args__ = (
        Index(
            "ix_app_users_email",
            "email",
            unique=True,
        ),
        Index(
            "ix_app_users_nickname",
            "nickname",
            unique=True,
        ),
    )
