from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, Index
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
