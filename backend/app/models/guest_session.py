"""게스트 세션(11/6 PM) — 로그인하지 않은 플레이어의 쿠키 세션.

- 게스트 1명 = 익명 세션 1개(`anonymous_session_id` 유일). 가짜 AppUser 를 만들지 않는다.
- 토큰은 로그인 세션(`user_sessions`)과 같은 규칙: 원문은 쿠키에만, DB 에는 sha256 해시만.
- 로그인하면 이 게스트의 Play Session 이 계정으로 넘어가고(`guest_session_transfers`) 게스트는 폐기된다.
"""

from datetime import datetime

from sqlalchemy import CHAR, INTEGER, ForeignKey
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GuestSession(Base):
    __tablename__ = "guest_sessions"

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    anonymous_session_id: Mapped[str] = mapped_column(
        CHAR(36),
        ForeignKey("anonymous_sessions.id"),
        nullable=False,
        unique=True,
    )
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)


class GuestSessionTransfer(Base):
    """로그인 순간 게스트 진행을 계정으로 옮긴 기록. 게스트 하나는 한 번만 옮겨진다(guest_session_id 유일)."""

    __tablename__ = "guest_session_transfers"

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    guest_session_id: Mapped[str] = mapped_column(
        CHAR(36),
        ForeignKey("guest_sessions.id"),
        nullable=False,
        unique=True,
    )
    anonymous_session_id: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    app_user_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    play_session_count: Mapped[int] = mapped_column(INTEGER, nullable=False)
    transferred_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
