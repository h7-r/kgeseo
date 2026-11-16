"""공지사항(11/16 세진, 계약 `docs/contracts/notices_api_v0.2.md`).

- `id` 는 UUID 문자열(소문자 36자). 공개 주소 · 감사 기록 대상(`target_type="notice"`)에 그대로 쓴다.
- 본문은 일반 텍스트만 저장한다(HTML 해석 없음). 최대 20,000자 — utf8mb4 에서 한 자가 최대 4바이트라 80,000바이트가
  될 수 있어 TEXT(65,535바이트) 대신 MEDIUMTEXT 를 쓴다. 제목은 VARCHAR(200)(utf8mb4 800바이트).
- 상태(draft · scheduled · published)는 저장하지 않고 `published_at` 과 지금 시각으로 서버가 계산한다(services/notice).
- 삭제는 `deleted_at` 만 적는 소프트 삭제다. 복구 기능은 없다.
- 시각은 모두 UTC naive(프로젝트 규칙).
"""

from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, Boolean, ForeignKey, Index, Text, false
from sqlalchemy.dialects.mysql import DATETIME, MEDIUMTEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

NOTICE_CATEGORIES = ("maintenance", "event", "update", "info")
NOTICE_TITLE_MAX = 200
NOTICE_BODY_MAX = 20_000


class Notice(Base):
    __tablename__ = "notices"
    __table_args__ = (
        # 공개 목록: 삭제 안 됨 · 게시 시각 지남 · 고정 먼저 · 최신 게시 먼저
        Index("ix_notices_public", "deleted_at", "published_at"),
        Index("ix_notices_created_by", "created_by"),
    )

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    category: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    title: Mapped[str] = mapped_column(VARCHAR(NOTICE_TITLE_MAX), nullable=False)
    # MySQL 은 MEDIUMTEXT(마이그레이션과 같음). 다른 방언(시험의 SQLite)은 TEXT
    body: Mapped[str] = mapped_column(
        Text().with_variant(MEDIUMTEXT(), "mysql"), nullable=False
    )
    is_pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )
    created_by: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
