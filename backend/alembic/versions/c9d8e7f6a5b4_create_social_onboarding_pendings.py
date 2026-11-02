"""create social onboarding pendings

Revision ID: c9d8e7f6a5b4
Revises: b8a7c6d5e4f3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "c9d8e7f6a5b4"
down_revision: str | Sequence[str] | None = "b8a7c6d5e4f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "social_onboarding_pendings",
        sa.Column("id", sa.CHAR(36), nullable=False),
        sa.Column("token_hash", sa.CHAR(64), nullable=False),
        sa.Column("provider", sa.VARCHAR(32), nullable=False),
        sa.Column("provider_subject", sa.VARCHAR(255), nullable=False),
        sa.Column("email", sa.VARCHAR(254), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("consumed_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_social_onboarding_pendings_token_hash"),
        mysql_engine="InnoDB",
    )
    op.create_index("ix_social_onboarding_pendings_expires_at", "social_onboarding_pendings", ["expires_at"])
    op.create_index("ix_social_onboarding_pendings_consumed_at", "social_onboarding_pendings", ["consumed_at"])


def downgrade() -> None:
    op.drop_index("ix_social_onboarding_pendings_consumed_at", table_name="social_onboarding_pendings")
    op.drop_index("ix_social_onboarding_pendings_expires_at", table_name="social_onboarding_pendings")
    op.drop_table("social_onboarding_pendings")
