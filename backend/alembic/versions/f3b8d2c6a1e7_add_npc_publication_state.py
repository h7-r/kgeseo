"""NPC 콘텐츠 게시 상태(불변 버전 · 현재 상태 · 변경 이력).

Revision ID: f3b8d2c6a1e7
Revises: e4c1f7a2b9d6

승인 영속화(d2a6f8b1c903) · 소셜 온보딩(c9d8e7f6a5b4)과 통합할 때 별도 merge revision으로 합친다.
기존 revision은 변경하지 않는다. 트리거를 만들지 않으므로 TRIGGER 권한이 필요 없다.
운영 DB에는 이번 작업에서 적용하지 않는다.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "f3b8d2c6a1e7"
down_revision = "e4c1f7a2b9d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "npc_content_versions",
        sa.Column("case_id", sa.VARCHAR(64), primary_key=True),
        sa.Column("content_version", sa.INTEGER(), primary_key=True),
        sa.Column("content_fingerprint", sa.VARCHAR(128), nullable=False),
        sa.Column("registered_at", mysql.DATETIME(fsp=6), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "npc_publication_states",
        sa.Column("case_id", sa.VARCHAR(64), primary_key=True),
        sa.Column("content_version", sa.INTEGER(), primary_key=True),
        sa.Column("status", sa.VARCHAR(16), nullable=False),
        sa.Column("revision", sa.INTEGER(), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id", "content_version"],
            ["npc_content_versions.case_id", "npc_content_versions.content_version"],
            ondelete="RESTRICT",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "npc_publication_events",
        sa.Column("event_id", sa.CHAR(36), primary_key=True),
        sa.Column("case_id", sa.VARCHAR(64), nullable=False),
        sa.Column("content_version", sa.INTEGER(), nullable=False),
        sa.Column("from_status", sa.VARCHAR(16), nullable=True),
        sa.Column("to_status", sa.VARCHAR(16), nullable=False),
        sa.Column("reason", sa.VARCHAR(500), nullable=False),
        sa.Column("actor", sa.VARCHAR(100), nullable=False),
        sa.Column("at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("state_revision", sa.INTEGER(), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id", "content_version"],
            ["npc_content_versions.case_id", "npc_content_versions.content_version"],
            ondelete="RESTRICT",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_npc_publication_events_version",
        "npc_publication_events",
        ["case_id", "content_version", "state_revision"],
        unique=True,
    )


def downgrade() -> None:
    # 게시 상태와 변경 이력이 모두 사라진다. 운영 적용 전 별도 검토한다.
    op.drop_table("npc_publication_events")
    op.drop_table("npc_publication_states")
    op.drop_table("npc_content_versions")
