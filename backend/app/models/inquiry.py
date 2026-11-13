"""1:1 문의(관리자 API v0.3 3단계 P3-1, 해랑 11/13).

- `seq` 가 BIGINT AUTO_INCREMENT 기본 키다 — 접수 번호(`number`)의 순번을 DB 가 매기므로 동시 접수에도 겹치지 않는다(세진 ①).
  밖으로 보이는 식별자는 `id`(UUID, 유일)다. 답변 표는 `id` 를 가리킨다.
- `client_ip` 는 서버가 확인한 요청 IP 원문(미르 11/13 — 원문 저장 · 화면은 앞 두 자리 · 1년 뒤 NULL 파기는 세진 배치).
- 본문은 글자만 저장한다(HTML 해석 없음).
"""

from datetime import datetime

from sqlalchemy import BIGINT, CHAR, VARCHAR, ForeignKey, Index, Text
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

INQUIRY_CATEGORIES = ("account", "gameplay", "payment", "tech", "other")
INQUIRY_STATUSES = ("open", "answered", "closed")
INQUIRY_PRIORITIES = ("normal", "urgent")


class Inquiry(Base):
    __tablename__ = "inquiries"

    seq: Mapped[int] = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    # 삽입 → flush 로 seq 를 받은 뒤 같은 트랜잭션에서 채운다. NULL 은 커밋 전 잠깐뿐
    number: Mapped[str | None] = mapped_column(VARCHAR(24), nullable=True, unique=True)
    app_user_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    email: Mapped[str] = mapped_column(VARCHAR(254), nullable=False)
    category: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    title: Mapped[str] = mapped_column(VARCHAR(100), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(VARCHAR(16), nullable=False, default="open")
    priority: Mapped[str] = mapped_column(VARCHAR(8), nullable=False, default="normal")
    client_ip: Mapped[str | None] = mapped_column(VARCHAR(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    answered_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)

    __table_args__ = (
        Index("ix_inquiries_status_created", "status", "created_at"),
        Index("ix_inquiries_user", "app_user_id"),
        Index("ix_inquiries_created", "created_at"),
    )


class InquiryReply(Base):
    __tablename__ = "inquiry_replies"

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    inquiry_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False
    )
    admin_user_id: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    __table_args__ = (Index("ix_inquiry_replies_inquiry", "inquiry_id", "created_at"),)
