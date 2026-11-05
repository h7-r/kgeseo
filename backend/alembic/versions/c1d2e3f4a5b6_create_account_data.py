"""로그인 세션 · 게임 저장 · 캐릭터 · 아이템 · 관리자 기록 테이블과 계정 권한 열.

Revision ID: c1d2e3f4a5b6
Revises: b3f7c2e9a4d1
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

from alembic import op

revision = "c1d2e3f4a5b6"
down_revision = "b3f7c2e9a4d1"
branch_labels = None
depends_on = None


def _user_fk() -> sa.Column:
    return sa.Column(
        "app_user_id",
        sa.CHAR(36),
        sa.ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    op.add_column(
        "app_users",
        sa.Column("role", sa.VARCHAR(16), nullable=False, server_default="user"),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        _user_fk(),
        sa.Column("token_hash", sa.CHAR(64), nullable=False, unique=True),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", DATETIME(fsp=6), nullable=False),
        sa.Column("revoked_at", DATETIME(fsp=6), nullable=True),
    )
    op.create_index("ix_user_sessions_user", "user_sessions", ["app_user_id"])
    op.create_table(
        "login_throttles",
        sa.Column("key_hash", sa.CHAR(64), primary_key=True),
        sa.Column("failed_count", sa.INTEGER(), nullable=False),
        sa.Column("window_started_at", DATETIME(fsp=6), nullable=False),
        sa.Column("locked_until", DATETIME(fsp=6), nullable=True),
    )
    op.create_table(
        "game_play_saves",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        _user_fk(),
        sa.Column("slot", sa.INTEGER(), nullable=False),
        sa.Column("revision", sa.INTEGER(), nullable=False),
        sa.Column("schema_version", sa.INTEGER(), nullable=False),
        sa.Column("stage", sa.VARCHAR(32), nullable=False),
        sa.Column("state_json", sa.JSON(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("app_user_id", "slot", name="uq_game_play_saves_user_slot"),
    )
    op.create_table(
        "user_characters",
        sa.Column(
            "app_user_id",
            sa.CHAR(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("display_name", sa.VARCHAR(32), nullable=False),
        sa.Column("appearance_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
    )
    op.create_table(
        "item_catalog",
        sa.Column("id", sa.VARCHAR(64), primary_key=True),
        sa.Column("kind", sa.VARCHAR(32), nullable=False),
        sa.Column("name", sa.VARCHAR(100), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
    )
    op.create_table(
        "user_items",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        _user_fk(),
        sa.Column(
            "item_id", sa.VARCHAR(64), sa.ForeignKey("item_catalog.id"), nullable=False
        ),
        sa.Column("quantity", sa.INTEGER(), nullable=False),
        sa.Column("source", sa.VARCHAR(64), nullable=False),
        sa.Column("acquired_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("app_user_id", "item_id", name="uq_user_items_user_item"),
    )
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.BIGINT(), primary_key=True, autoincrement=True),
        sa.Column("admin_user_id", sa.CHAR(36), nullable=False),
        sa.Column("action", sa.VARCHAR(64), nullable=False),
        sa.Column("target_user_id", sa.CHAR(36), nullable=True),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
    )
    op.create_index(
        "ix_admin_audit_logs_target", "admin_audit_logs", ["target_user_id"]
    )


def downgrade() -> None:
    op.drop_table("admin_audit_logs")
    op.drop_table("user_items")
    op.drop_table("item_catalog")
    op.drop_table("user_characters")
    op.drop_table("game_play_saves")
    op.drop_table("login_throttles")
    op.drop_table("user_sessions")
    op.drop_column("app_users", "role")
