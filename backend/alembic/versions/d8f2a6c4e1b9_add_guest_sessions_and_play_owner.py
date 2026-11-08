"""게스트 세션 · 게스트 승계 기록 테이블과 Play Session 소유자 열(11/6 PM).

- guest_sessions: 게스트 쿠키 세션. 게스트 1명 = 익명 세션 1개(유일), 토큰은 해시만.
- guest_session_transfers: 로그인 순간 게스트 진행을 계정으로 옮긴 기록(게스트당 한 번).
- play_sessions.owner_user_id · owner_anonymous_session_id: 소유자. 기존 행은 둘 다 NULL 로 남아
  누구도 접근할 수 없다(PM: 소유자 없는 기존 데이터 초기화 허용 — 행을 지우지는 않는다).

Revision ID: d8f2a6c4e1b9
Revises: c1d2e3f4a5b6
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

from alembic import op

revision = "d8f2a6c4e1b9"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "guest_sessions",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column(
            "anonymous_session_id",
            sa.CHAR(36),
            sa.ForeignKey("anonymous_sessions.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("token_hash", sa.CHAR(64), nullable=False, unique=True),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", DATETIME(fsp=6), nullable=False),
        sa.Column("revoked_at", DATETIME(fsp=6), nullable=True),
    )
    op.create_table(
        "guest_session_transfers",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column(
            "guest_session_id",
            sa.CHAR(36),
            sa.ForeignKey("guest_sessions.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("anonymous_session_id", sa.CHAR(36), nullable=False),
        sa.Column(
            "app_user_id",
            sa.CHAR(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("play_session_count", sa.INTEGER(), nullable=False),
        sa.Column("transferred_at", DATETIME(fsp=6), nullable=False),
    )
    op.create_index(
        "ix_guest_session_transfers_user", "guest_session_transfers", ["app_user_id"]
    )
    op.add_column(
        "play_sessions", sa.Column("owner_user_id", sa.CHAR(36), nullable=True)
    )
    op.add_column(
        "play_sessions",
        sa.Column("owner_anonymous_session_id", sa.CHAR(36), nullable=True),
    )
    # 인덱스를 먼저 만들어 FK 가 이것을 쓰게 한다(MySQL 이 FK 용 인덱스를 따로 만들지 않게).
    op.create_index(
        "ix_play_sessions_owner_user_id", "play_sessions", ["owner_user_id"]
    )
    op.create_index(
        "ix_play_sessions_owner_anonymous_session_id",
        "play_sessions",
        ["owner_anonymous_session_id"],
    )
    op.create_foreign_key(
        "fk_play_sessions_owner_user",
        "play_sessions",
        "app_users",
        ["owner_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_play_sessions_owner_anonymous",
        "play_sessions",
        "anonymous_sessions",
        ["owner_anonymous_session_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_play_sessions_owner_anonymous", "play_sessions", "foreignkey"
    )
    op.drop_constraint("fk_play_sessions_owner_user", "play_sessions", "foreignkey")
    op.drop_index("ix_play_sessions_owner_anonymous_session_id", "play_sessions")
    op.drop_index("ix_play_sessions_owner_user_id", "play_sessions")
    op.drop_column("play_sessions", "owner_anonymous_session_id")
    op.drop_column("play_sessions", "owner_user_id")
    op.drop_table("guest_session_transfers")
    op.drop_table("guest_sessions")
