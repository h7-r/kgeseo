"""승인 이력은 추가만 한다. 잠금 행은 대상·버전별 동시 쓰기를 직렬화한다."""

from datetime import datetime

from sqlalchemy import CHAR, INTEGER, TEXT, VARCHAR, ForeignKey, Index, event
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _binary_type(length: int, *, fixed: bool = False):
    # 기존 SQLite metadata 테스트에는 MySQL 전용 collation을 전달하지 않는다.
    kind = CHAR if fixed else VARCHAR
    return kind(length).with_variant(kind(length, collation="utf8mb4_bin"), "mysql")


class NpcApprovalTarget(Base):
    __tablename__ = "npc_approval_targets"

    target_type: Mapped[str] = mapped_column(_binary_type(16), primary_key=True)
    target_id: Mapped[str] = mapped_column(_binary_type(64), primary_key=True)
    content_version: Mapped[int] = mapped_column(INTEGER, primary_key=True)

    __table_args__ = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


class NpcApprovalReview(Base):
    __tablename__ = "npc_approval_reviews"

    review_id: Mapped[str] = mapped_column(
        _binary_type(36, fixed=True), primary_key=True
    )
    target_type: Mapped[str] = mapped_column(_binary_type(16), nullable=False)
    target_id: Mapped[str] = mapped_column(_binary_type(64), nullable=False)
    content_version: Mapped[int] = mapped_column(INTEGER, nullable=False)
    gate: Mapped[str] = mapped_column(VARCHAR(2), nullable=False)
    target_hash: Mapped[str] = mapped_column(
        _binary_type(71, fixed=True), nullable=False
    )
    decision: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    reviewer: Mapped[str] = mapped_column(VARCHAR(100), nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False)
    reason: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    supersedes: Mapped[str | None] = mapped_column(
        _binary_type(36, fixed=True),
        ForeignKey("npc_approval_reviews.review_id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        Index(
            "ix_npc_approval_reviews_target",
            "target_type",
            "target_id",
            "content_version",
            "reviewed_at",
            "review_id",
        ),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )


def _immutable_review(*_args: object) -> None:
    raise ValueError("approval reviews are append-only")


event.listen(NpcApprovalReview, "before_update", _immutable_review)
event.listen(NpcApprovalReview, "before_delete", _immutable_review)
