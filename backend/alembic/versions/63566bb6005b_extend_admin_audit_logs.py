"""관리자 감사 기록 확장 — client_ip · user_agent · target_type · target_id(세진 11/16, 미르 · 세진 11/13 확정).

Revision ID: 63566bb6005b
Revises: e7a1b2c3d4f5

`admin_audit_logs` 에 열 넷을 더한다. 모두 NULL 허용이고 기본값 · 백필이 없다 — 이미 쌓인 기록은 NULL 로 남고,
기존 열 · 색인 · 쓰기 코드는 그대로다. 행을 다시 쓰지 않으므로 MySQL 8 에서 열 추가는 메타데이터 변경으로 끝난다.
`down_revision` 은 #154(1:1 문의 · 관리자 설정, e7a1b2c3d4f5) 뒤 — 이 브랜치를 만든 main(1bf8c99d)의 단일 head.
계약: `docs/contracts/admin_audit_log_ext.md`.
"""

import sqlalchemy as sa

from alembic import op

revision = "63566bb6005b"
down_revision = "e7a1b2c3d4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IPv6 표준 표기 최대 45자(inquiries.client_ip 와 같다)
    op.add_column(
        "admin_audit_logs", sa.Column("client_ip", sa.VARCHAR(45), nullable=True)
    )
    op.add_column(
        "admin_audit_logs", sa.Column("user_agent", sa.VARCHAR(512), nullable=True)
    )
    op.add_column(
        "admin_audit_logs", sa.Column("target_type", sa.VARCHAR(32), nullable=True)
    )
    op.add_column(
        "admin_audit_logs", sa.Column("target_id", sa.VARCHAR(64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("admin_audit_logs", "target_id")
    op.drop_column("admin_audit_logs", "target_type")
    op.drop_column("admin_audit_logs", "user_agent")
    op.drop_column("admin_audit_logs", "client_ip")
