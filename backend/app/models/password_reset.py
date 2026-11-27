from datetime import datetime

from sqlalchemy import CHAR, INTEGER, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PasswordResetCode(Base):
    """비밀번호 찾기 코드(계약 password_reset_v0.1, 11/25). 메일로 보낸 6자리 코드와, 코드를 맞힌 뒤 내주는 재설정 증표.

    원문은 메일 · 응답에만 있고 여기에는 해시만 둔다(코드 = 서버 비밀값 HMAC-SHA256, 증표 = SHA-256). 회원당 살아 있는 코드는 하나 — 새 코드를 만들면 앞의 것을 지운다.
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


class PasswordResetVerifyThrottle(Base):
    """이메일 하나의 코드 확인 실패 집계(하루 20번이면 하루 잠금). 가입 여부와 상관없이 이메일마다 센다.

    로그인 실패(`login_throttles`, 15분 집계)와 따로 둔다 — 같은 표를 쓰면 관리자 「로그인 잠김」에 섞이고 파기 기준도 갈렸다(미르 11/27).
    열쇠는 이메일 해시(`sha256("password-reset-verify:" + 이메일)`) — 원문은 두지 않는다. 탈퇴하면 지운다(`account_withdrawal`).
    """

    __tablename__ = "password_reset_verify_throttles"
    __table_args__ = (
        Index("ix_password_reset_verify_throttles_window", "window_started_at"),
    )

    key_hash: Mapped[str] = mapped_column(CHAR(64), primary_key=True)
    failed_count: Mapped[int] = mapped_column(INTEGER, nullable=False)
    # 집계 창(1일)의 시작. 창이 지나 다시 틀리면 0 부터 센다
    window_started_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    # 잠금이 풀리는 때 = window_started_at + 1일. 잠기지 않았으면 NULL
    locked_until: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )
