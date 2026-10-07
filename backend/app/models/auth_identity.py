from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuthIdentity(Base):
    __tablename__ = "auth_identities"

    id: Mapped[str] = mapped_column(
        CHAR(36),
        primary_key=True,
        nullable=False,
    )

    app_user_id: Mapped[str] = mapped_column(
        CHAR(36),
        ForeignKey("app_users.id"),
        nullable=False,
    )

    provider: Mapped[str] = mapped_column(
        VARCHAR(32),
        nullable=False,
    )

    provider_subject: Mapped[str] = mapped_column(
        VARCHAR(255),
        nullable=False,
    )

    password_hash: Mapped[str | None] = mapped_column(
        VARCHAR(255),
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
        UniqueConstraint(
            "provider",
            "provider_subject",
            name="uq_auth_identities_provider_subject",
        ),
        Index(
            "ix_auth_identities_app_user_id",
            "app_user_id",
        ),
    )
