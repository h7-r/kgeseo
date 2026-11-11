"""베타 분석 기록 테이블(11/11 미르, 베타 수집 항목 v1.1 2-2절).

- beta_events: 게임 화면이 보내는 분석 기록. 새 표만 만든다 — 기존 표는 바꾸지 않고, 외래 키도 없다.
- event_id 유일 색인으로 같은 기록의 재전송을 한 번만 남긴다.

Revision ID: a3f9c2e7b1d4
Revises: d8f2a6c4e1b9
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME, JSON

from alembic import op

revision = "a3f9c2e7b1d4"
down_revision = "d8f2a6c4e1b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "beta_events",
        sa.Column("id", sa.BIGINT(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.CHAR(36), nullable=False),
        sa.Column("received_at", DATETIME(fsp=6), nullable=False),
        sa.Column("client_ts", DATETIME(fsp=6), nullable=True),
        sa.Column("event_type", sa.VARCHAR(32), nullable=False),
        sa.Column("phase", sa.VARCHAR(32), nullable=True),
        sa.Column("participant_code", sa.VARCHAR(16), nullable=True),
        sa.Column("run_id", sa.VARCHAR(36), nullable=True),
        sa.Column("run_index", sa.INTEGER(), nullable=True),
        sa.Column("tab_id", sa.VARCHAR(36), nullable=True),
        sa.Column("seq", sa.BIGINT(), nullable=True),
        sa.Column("objective_id", sa.VARCHAR(40), nullable=True),
        sa.Column("page", sa.VARCHAR(16), nullable=True),
        sa.Column("build", sa.VARCHAR(40), nullable=True),
        sa.Column("app_user_id", sa.CHAR(36), nullable=True),
        sa.Column("guest_session_id", sa.CHAR(36), nullable=True),
        sa.Column("data", JSON(), nullable=False),
        sa.UniqueConstraint("event_id", name="uq_beta_events_event_id"),
    )
    op.create_index(
        "ix_beta_events_participant_client_ts",
        "beta_events",
        ["participant_code", "client_ts"],
    )
    op.create_index("ix_beta_events_app_user_id", "beta_events", ["app_user_id"])
    op.create_index(
        "ix_beta_events_type_received", "beta_events", ["event_type", "received_at"]
    )


def downgrade() -> None:
    op.drop_table("beta_events")
