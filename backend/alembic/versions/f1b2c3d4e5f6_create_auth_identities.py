"""create auth identities

Revision ID: f1b2c3d4e5f6
Revises: a91f3c8d7b2a
Create Date: 2026-10-06 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = "f1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "a91f3c8d7b2a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "auth_identities",
        sa.Column("id", sa.CHAR(length=36), nullable=False),
        sa.Column("app_user_id", sa.CHAR(length=36), nullable=False),
        sa.Column("provider", sa.VARCHAR(length=32), nullable=False),
        sa.Column("provider_subject", sa.VARCHAR(length=255), nullable=False),
        sa.Column("password_hash", sa.VARCHAR(length=255), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(["app_user_id"], ["app_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "provider_subject",
            name="uq_auth_identities_provider_subject",
        ),
    )
    op.create_index(
        "ix_auth_identities_app_user_id",
        "auth_identities",
        ["app_user_id"],
        unique=False,
    )

    connection = op.get_bind()
    app_users = sa.table(
        "app_users",
        sa.column("id", sa.String(length=36)),
        sa.column("email", sa.String(length=254)),
        sa.column("password_hash", sa.String(length=255)),
        sa.column("created_at", mysql.DATETIME(fsp=6)),
        sa.column("updated_at", mysql.DATETIME(fsp=6)),
    )
    auth_identities = sa.table(
        "auth_identities",
        sa.column("id", sa.String(length=36)),
        sa.column("app_user_id", sa.String(length=36)),
        sa.column("provider", sa.String(length=32)),
        sa.column("provider_subject", sa.String(length=255)),
        sa.column("password_hash", sa.String(length=255)),
        sa.column("created_at", mysql.DATETIME(fsp=6)),
        sa.column("updated_at", mysql.DATETIME(fsp=6)),
    )

    rows = connection.execute(
        sa.select(
            app_users.c.id,
            app_users.c.email,
            app_users.c.password_hash,
            app_users.c.created_at,
            app_users.c.updated_at,
        )
    )
    for row in rows:
        connection.execute(
            auth_identities.insert().values(
                id=sa.func.uuid(),
                app_user_id=row.id,
                provider="local",
                provider_subject=row.email.strip().lower(),
                password_hash=row.password_hash,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )

    op.drop_column("app_users", "password_hash")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "app_users",
        sa.Column("password_hash", sa.VARCHAR(length=255), nullable=True),
    )

    connection = op.get_bind()
    app_users = sa.table(
        "app_users",
        sa.column("id", sa.String(length=36)),
        sa.column("password_hash", sa.String(length=255)),
    )
    auth_identities = sa.table(
        "auth_identities",
        sa.column("app_user_id", sa.String(length=36)),
        sa.column("provider", sa.String(length=32)),
        sa.column("password_hash", sa.String(length=255)),
    )

    rows = connection.execute(
        sa.select(
            auth_identities.c.app_user_id,
            auth_identities.c.password_hash,
        ).where(
            auth_identities.c.provider == "local",
            auth_identities.c.password_hash.is_not(None),
        )
    )
    for row in rows:
        connection.execute(
            app_users.update()
            .where(app_users.c.id == row.app_user_id)
            .values(password_hash=row.password_hash)
        )

    op.alter_column(
        "app_users",
        "password_hash",
        existing_type=sa.VARCHAR(length=255),
        nullable=False,
    )
    op.drop_index("ix_auth_identities_app_user_id", table_name="auth_identities")
    op.drop_table("auth_identities")
