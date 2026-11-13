"""1:1 문의(inquiries · inquiry_replies) · 관리자 설정(admin_settings) — 관리자 API v0.3 3단계(해랑 11/13).

Revision ID: e7a1b2c3d4f5
Revises: a3f9c2e7b1d4

⚠ `down_revision` 은 **임시**로 지금 main 머리(a3f9c2e7b1d4)에 걸어 두었다. 세진 마이그레이션(is_test → 감사 로그 확장 → 공지)이
먼저 머지되므로, 이 PR 을 Ready 로 올리기 전에 그 마지막 revision 으로 바꾼다(머리 하나 유지 — 미르 11/13 「나중에 머지되는 쪽이 앞
revision 뒤로」). `admin_audit_logs` 는 건드리지 않는다(세진 몫).
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

from alembic import op

revision = "e7a1b2c3d4f5"
down_revision = "a3f9c2e7b1d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inquiries",
        # 접수 번호의 순번 원천 — DB 가 매기므로 동시 접수에도 겹치지 않는다(세진 ①)
        sa.Column("seq", sa.BIGINT, primary_key=True, autoincrement=True),
        sa.Column("id", sa.CHAR(36), nullable=False, unique=True),
        # 삽입 → flush 로 seq 를 받아 같은 트랜잭션에서 채운다. NULL 은 커밋 전 잠깐뿐
        sa.Column("number", sa.VARCHAR(24), nullable=True, unique=True),
        sa.Column(
            "app_user_id",
            sa.CHAR(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("email", sa.VARCHAR(254), nullable=False),
        sa.Column("category", sa.VARCHAR(16), nullable=False),
        sa.Column("title", sa.VARCHAR(100), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("status", sa.VARCHAR(16), nullable=False, server_default="open"),
        sa.Column("priority", sa.VARCHAR(8), nullable=False, server_default="normal"),
        # 서버가 확인한 요청 IP 원문(미르 11/13). 1년 뒤 NULL 로 파기(세진 배치)
        sa.Column("client_ip", sa.VARCHAR(45), nullable=True),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        sa.Column("answered_at", DATETIME(fsp=6), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_inquiries_status_created", "inquiries", ["status", "created_at"]
    )
    op.create_index("ix_inquiries_user", "inquiries", ["app_user_id"])
    op.create_index("ix_inquiries_created", "inquiries", ["created_at"])

    op.create_table(
        "inquiry_replies",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column(
            "inquiry_id",
            sa.CHAR(36),
            sa.ForeignKey("inquiries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "admin_user_id",
            sa.CHAR(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_inquiry_replies_inquiry", "inquiry_replies", ["inquiry_id", "created_at"]
    )

    op.create_table(
        "admin_settings",
        sa.Column("key", sa.VARCHAR(64), primary_key=True),
        sa.Column("value_json", sa.JSON, nullable=False),
        sa.Column(
            "updated_by",
            sa.CHAR(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("admin_settings")
    op.drop_index("ix_inquiry_replies_inquiry", table_name="inquiry_replies")
    op.drop_table("inquiry_replies")
    op.drop_index("ix_inquiries_created", table_name="inquiries")
    op.drop_index("ix_inquiries_user", table_name="inquiries")
    op.drop_index("ix_inquiries_status_created", table_name="inquiries")
    op.drop_table("inquiries")
