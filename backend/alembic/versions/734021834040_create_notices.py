"""공지사항 notices 표(세진 11/16, 계약 `docs/contracts/notices_api_v0.2.md`).

Revision ID: 734021834040
Revises: 63566bb6005b

새 표 하나만 만든다(기존 표 · 행은 건드리지 않는다). 기존 웹 하드코딩 공지 이전은 마이그레이션이 아니라
`scripts/import_legacy_notices.py`(명시 실행)가 맡는다.
`down_revision` 은 감사 기록 확장(63566bb6005b, #163) — 공지 감사 기록이 그 열(target_type · target_id)을 쓴다.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME, MEDIUMTEXT

from alembic import op

revision = "734021834040"
down_revision = "63566bb6005b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notices",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column("category", sa.VARCHAR(16), nullable=False),
        sa.Column("title", sa.VARCHAR(200), nullable=False),
        # 20,000자 × utf8mb4 최대 4바이트 = 80,000바이트 — TEXT(65,535) 로는 모자라 MEDIUMTEXT
        sa.Column("body", MEDIUMTEXT(), nullable=False),
        sa.Column(
            "is_pinned",
            sa.Boolean(create_constraint=False),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("published_at", DATETIME(fsp=6), nullable=True),
        sa.Column(
            "created_by",
            sa.CHAR(36),
            sa.ForeignKey(
                "app_users.id", name="fk_notices_created_by", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        sa.Column("deleted_at", DATETIME(fsp=6), nullable=True),
    )
    op.create_index("ix_notices_public", "notices", ["deleted_at", "published_at"])
    op.create_index("ix_notices_created_by", "notices", ["created_by"])


def downgrade() -> None:
    op.drop_table("notices")
