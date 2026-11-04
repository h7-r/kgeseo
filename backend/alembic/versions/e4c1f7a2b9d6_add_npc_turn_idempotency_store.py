"""NPC 턴 멱등 저장소(요청 tombstone · 응답 본문).

Revision ID: e4c1f7a2b9d6
Revises: c9e1a4b7d2f0

승인 영속화(d2a6f8b1c903) · 소셜 온보딩(c9d8e7f6a5b4)도 같은 계열에서 갈라진다. 통합할 때 별도
merge revision으로 합친다. 기존 revision은 변경하지 않는다. 운영 DB에는 이번 작업에서 적용하지 않는다.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "e4c1f7a2b9d6"
down_revision = "c9e1a4b7d2f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "npc_turn_requests",
        sa.Column(
            "play_session_id",
            sa.CHAR(36),
            sa.ForeignKey("play_sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("turn_request_id", sa.CHAR(36), primary_key=True),
        sa.Column("request_body_hash", sa.VARCHAR(96), nullable=False),
        sa.Column("status", sa.VARCHAR(16), nullable=False),
        sa.Column("case_id", sa.VARCHAR(64), nullable=False),
        sa.Column("content_version", sa.INTEGER(), nullable=False),
        sa.Column("content_fingerprint", sa.VARCHAR(128), nullable=False),
        sa.Column("owner_token", sa.CHAR(36), nullable=True),
        sa.Column("lease_expires_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("issued_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("purged_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("withdrawn_at", mysql.DATETIME(fsp=6), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_npc_turn_requests_status_expires_at",
        "npc_turn_requests",
        ["status", "expires_at"],
    )
    op.create_index(
        "ix_npc_turn_requests_content",
        "npc_turn_requests",
        ["case_id", "content_version"],
    )
    op.create_table(
        "npc_turn_response_bodies",
        sa.Column("play_session_id", sa.CHAR(36), primary_key=True),
        sa.Column("turn_request_id", sa.CHAR(36), primary_key=True),
        sa.Column("response_json", mysql.JSON(), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["play_session_id", "turn_request_id"],
            ["npc_turn_requests.play_session_id", "npc_turn_requests.turn_request_id"],
            ondelete="CASCADE",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    # 멱등 기록 전체가 사라진다(이후 재전송은 새 요청으로 처리된다). 운영 적용 전 별도 검토한다.
    op.drop_table("npc_turn_response_bodies")
    op.drop_table("npc_turn_requests")
