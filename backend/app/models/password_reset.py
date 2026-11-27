from datetime import datetime

from sqlalchemy import CHAR, INTEGER, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PasswordResetCode(Base):
    """비밀번호 찾기 코드(계약 password_reset_v0.1, 11/25). 메일로 보낸 6자리 코드와, 코드를 맞힌 뒤 내주는 재설정 증표.

    원문은 메일 · 응답에만 있고 여기에는 SHA-256 해시만 둔다. 회원당 살아 있는 코드는 하나 — 새 코드를 만들면 앞의 것을 지운다.
    탈퇴하면 지운다(`account_withdrawal`).
    """

    __tablename__ = "password_reset_codes"
    __table_args__ = (
        Index("ix_password_reset_codes_user", "app_user_id"),
        UniqueConstraint("token_hash", name="uq_password_reset_codes_token_hash"),
    )

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    app_user_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    # 틀린 횟수. 한도에 닿으면 이 코드는 더 받지 않는다(새 코드를 받아야 한다)
    failed_attempts: Mapped[int] = mapped_column(INTEGER, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    # 코드를 맞히면 채운다. 증표 원문은 응답으로 한 번만 나간다
    token_hash: Mapped[str | None] = mapped_column(CHAR(64), nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )
    used_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
