"""비밀번호 찾기 코드 표 password_reset_codes(11/25, 계약 `docs/contracts/password_reset_v0.1.md`).

Revision ID: b7e4c2a9d1f3
Revises: 93fb40166c08

- 새 표 하나만 만든다. 기존 표 · 행은 바꾸지 않는다.
- 코드 · 증표 원문은 두지 않는다(SHA-256 해시만). 회원 행이 지워지면 함께 지워진다(FK CASCADE) — 탈퇴는 회원 행을 남기므로
  `account_withdrawal` 이 직접 지운다.
- downgrade 는 표를 지운다. 살아 있는 코드는 길어야 25분짜리라 잃어도 사용자가 코드를 다시 받으면 된다.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

from alembic import op

revision = "b7e4c2a9d1f3"
down_revision = "93fb40166c08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column(
            "app_user_id",
            sa.CHAR(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.CHAR(64), nullable=False),
        sa.Column("failed_attempts", sa.INTEGER(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", DATETIME(fsp=6), nullable=False),
        sa.Column("token_hash", sa.CHAR(64), nullable=True),
        sa.Column("token_expires_at", DATETIME(fsp=6), nullable=True),
        sa.Column("used_at", DATETIME(fsp=6), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_password_reset_codes_token_hash"),
    )
    op.create_index(
        "ix_password_reset_codes_user", "password_reset_codes", ["app_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_password_reset_codes_user", table_name="password_reset_codes")
    op.drop_table("password_reset_codes")
