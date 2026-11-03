"""create content reviews

G1~G3 게시 승인 이력(PM v0.4.3 `ReviewRecord`)을 저장할 append-only 테이블을 만든다.
애플리케이션은 추가 · 조회만 한다(`app.services.approval_store`). 수정 · 삭제 경로는 없다.
DB 수준의 수정 · 삭제 차단(트리거 · 권한 분리)은 운영 DB 계정 정책이 정해진 뒤 붙인다.

Revision ID: e2a7c4f9b1d3
Revises: c9e1a4b7d2f0
Create Date: 2026-11-03 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2a7c4f9b1d3"
down_revision: str | Sequence[str] | None = "c9e1a4b7d2f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "content_reviews",
        sa.Column("review_id", sa.CHAR(length=36), nullable=False),
        sa.Column("subject_id", sa.VARCHAR(length=128), nullable=False),
        sa.Column("subject_version", sa.INTEGER(), nullable=False),
        sa.Column("gate", sa.VARCHAR(length=2), nullable=False),
        sa.Column("target_hash", sa.VARCHAR(length=71), nullable=False),
        sa.Column("decision", sa.VARCHAR(length=16), nullable=False),
        sa.Column("reviewer", sa.VARCHAR(length=100), nullable=False),
        sa.Column("reviewed_at", mysql.DATETIME(fsp=3), nullable=False),
        sa.Column("reason", sa.TEXT(), nullable=True),
        sa.Column("supersedes", sa.CHAR(length=36), nullable=True),
        sa.Column("recorded_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(["supersedes"], ["content_reviews.review_id"]),
        sa.PrimaryKeyConstraint("review_id"),
    )
    op.create_index(
        "ix_content_reviews_subject",
        "content_reviews",
        ["subject_id", "subject_version"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    # 승인 이력이 모두 사라진다. 운영 DB에서는 백업 뒤에만 내린다.
    op.drop_index("ix_content_reviews_subject", table_name="content_reviews")
    op.drop_table("content_reviews")
