from datetime import datetime

from sqlalchemy import CHAR, INTEGER, TEXT, VARCHAR, ForeignKey, Index
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ContentReview(Base):
    """[레거시 · 판정에 쓰지 않음] G1~G3 승인 이력 한 건(PM v0.4.3 `ReviewRecord`).

    통합 뒤 승인 판정 근거는 `npc_approval_reviews`(`app.models.npc_approval_review`)뿐이다. 이 테이블은
    migration `e2a7c4f9b1d3`을 보존하려고 모델만 남겨 두었고, 앱에는 읽거나 쓰는 경로가 없다.
    정리(drop) 여부는 별도 결정이다.

    (subject_id, subject_version)은 `approval_source(id, version)`의 key다. 케이스 콘텐츠는
    (case_id, content_version), NPC 일반 대사 팩은 (pack_id, pack_version)이다.
    """

    __tablename__ = "content_reviews"

    review_id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, nullable=False)
    subject_id: Mapped[str] = mapped_column(VARCHAR(128), nullable=False)
    subject_version: Mapped[int] = mapped_column(INTEGER(), nullable=False)
    gate: Mapped[str] = mapped_column(VARCHAR(2), nullable=False)
    # 승인 대상 내용의 공식 fingerprint("sha256:" + 64 hex)
    target_hash: Mapped[str] = mapped_column(VARCHAR(71), nullable=False)
    decision: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    reviewer: Mapped[str] = mapped_column(VARCHAR(100), nullable=False)
    # 결정 시각(기록이 말하는 시각, UTC 밀리초)
    reviewed_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False)
    reason: Mapped[str | None] = mapped_column(TEXT(), nullable=True)
    # 직전 유효 기록. 이미 저장된 기록만 가리킬 수 있다.
    supersedes: Mapped[str | None] = mapped_column(
        CHAR(36), ForeignKey("content_reviews.review_id"), nullable=True
    )
    # 서버가 저장한 시각(감사용). 판정에는 쓰지 않는다.
    recorded_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    __table_args__ = (
        Index("ix_content_reviews_subject", "subject_id", "subject_version"),
    )
