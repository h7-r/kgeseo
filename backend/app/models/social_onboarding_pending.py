from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, Index, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SocialOnboardingPending(Base):
    __tablename__ = "social_onboarding_pendings"

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    provider: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    provider_subject: Mapped[str] = mapped_column(VARCHAR(255), nullable=False)
    email: Mapped[str] = mapped_column(VARCHAR(254), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_social_onboarding_pendings_token_hash"),
        Index("ix_social_onboarding_pendings_expires_at", "expires_at"),
        Index("ix_social_onboarding_pendings_consumed_at", "consumed_at"),
    )
