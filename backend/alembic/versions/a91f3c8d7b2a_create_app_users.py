"""create app users

Revision ID: a91f3c8d7b2a
Revises: d7481874fb1c
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = 'a91f3c8d7b2a'
down_revision: Union[str, Sequence[str], None] = 'd7481874fb1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'app_users',
        sa.Column('id', sa.CHAR(length=36), nullable=False),
        sa.Column('email', sa.VARCHAR(length=254), nullable=False),
        sa.Column('nickname', sa.VARCHAR(length=32), nullable=False),
        sa.Column('region', sa.VARCHAR(length=32), nullable=True),
        sa.Column('password_hash', sa.VARCHAR(length=255), nullable=False),
        sa.Column('terms_version', sa.VARCHAR(length=32), nullable=False),
        sa.Column('terms_accepted_at', mysql.DATETIME(fsp=6), nullable=False),
        sa.Column('privacy_accepted_at', mysql.DATETIME(fsp=6), nullable=False),
        sa.Column('age_confirmed_at', mysql.DATETIME(fsp=6), nullable=False),
        sa.Column('created_at', mysql.DATETIME(fsp=6), nullable=False),
        sa.Column('updated_at', mysql.DATETIME(fsp=6), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_app_users_email', 'app_users', ['email'], unique=True)
    op.create_index('ix_app_users_nickname', 'app_users', ['nickname'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_app_users_nickname', table_name='app_users')
    op.drop_index('ix_app_users_email', table_name='app_users')
    op.drop_table('app_users')
