"""allow social users without terms

Revision ID: b8a7c6d5e4f3
Revises: f1b2c3d4e5f6
Create Date: 2026-10-06 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = "b8a7c6d5e4f3"
down_revision: str | Sequence[str] | None = "f1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "app_users",
        "terms_version",
        existing_type=sa.VARCHAR(length=32),
        nullable=True,
    )
    op.alter_column(
        "app_users",
        "terms_accepted_at",
        existing_type=mysql.DATETIME(fsp=6),
        nullable=True,
    )
    op.alter_column(
        "app_users",
        "privacy_accepted_at",
        existing_type=mysql.DATETIME(fsp=6),
        nullable=True,
    )
    op.alter_column(
        "app_users",
        "age_confirmed_at",
        existing_type=mysql.DATETIME(fsp=6),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "app_users",
        "age_confirmed_at",
        existing_type=mysql.DATETIME(fsp=6),
        nullable=False,
    )
    op.alter_column(
        "app_users",
        "privacy_accepted_at",
        existing_type=mysql.DATETIME(fsp=6),
        nullable=False,
    )
    op.alter_column(
        "app_users",
        "terms_accepted_at",
        existing_type=mysql.DATETIME(fsp=6),
        nullable=False,
    )
    op.alter_column(
        "app_users",
        "terms_version",
        existing_type=sa.VARCHAR(length=32),
        nullable=False,
    )
