"""NPC 승인 이력과 대상별 잠금 행.

Revision ID: d2a6f8b1c903
Revises: c9e1a4b7d2f0

온보딩 병합 시 이 최신 head와 c9d8e7f6a5b4를 새 merge revision으로 합친다.
기존 revision은 변경하지 않는다. 운영 DB에는 이번 작업에서 적용하지 않는다.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "d2a6f8b1c903"
down_revision = "c9e1a4b7d2f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "npc_approval_targets",
        sa.Column(
            "target_type", sa.VARCHAR(16, collation="utf8mb4_bin"), primary_key=True
        ),
        sa.Column(
            "target_id", sa.VARCHAR(64, collation="utf8mb4_bin"), primary_key=True
        ),
        sa.Column("content_version", sa.INTEGER(), primary_key=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "npc_approval_reviews",
        sa.Column("review_id", sa.CHAR(36, collation="utf8mb4_bin"), primary_key=True),
        sa.Column(
            "target_type", sa.VARCHAR(16, collation="utf8mb4_bin"), nullable=False
        ),
        sa.Column("target_id", sa.VARCHAR(64, collation="utf8mb4_bin"), nullable=False),
        sa.Column("content_version", sa.INTEGER(), nullable=False),
        sa.Column("gate", sa.VARCHAR(2), nullable=False),
        sa.Column("target_hash", sa.CHAR(71, collation="utf8mb4_bin"), nullable=False),
        sa.Column("decision", sa.VARCHAR(16), nullable=False),
        sa.Column("reviewer", sa.VARCHAR(100), nullable=False),
        sa.Column("reviewed_at", mysql.DATETIME(fsp=3), nullable=False),
        sa.Column("reason", sa.TEXT(), nullable=True),
        sa.Column(
            "supersedes",
            sa.CHAR(36, collation="utf8mb4_bin"),
            sa.ForeignKey("npc_approval_reviews.review_id", ondelete="RESTRICT"),
            nullable=True,
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_npc_approval_reviews_target",
        "npc_approval_reviews",
        ["target_type", "target_id", "content_version", "reviewed_at", "review_id"],
    )
    # ORM을 거치지 않는 SQL도 이력 수정·삭제를 거부한다.
    for action in ("UPDATE", "DELETE"):
        op.execute(
            sa.text(
                f"CREATE TRIGGER npc_approval_reviews_no_{action.lower()} "
                f"BEFORE {action} ON npc_approval_reviews FOR EACH ROW "
                "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval reviews are append-only'"
            )
        )


def downgrade() -> None:
    # 이력 삭제를 수반하는 명시적 schema rollback이며 운영 적용 전 별도 검토한다.
    op.drop_table("npc_approval_reviews")
    op.drop_table("npc_approval_targets")
