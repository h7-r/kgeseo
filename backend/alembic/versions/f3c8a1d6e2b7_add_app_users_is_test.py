"""팀 테스트 계정 표시(app_users.is_test, 미르 11/13).

- is_test: 관리자 통계에서 팀 테스트 계정을 빼기 위한 표시. BOOLEAN(MySQL TINYINT(1)) · NOT NULL · 기본 false.
- 기존 회원은 server_default 로 모두 false 가 된다(값을 따로 채우는 UPDATE 없음).
- 값은 서버 명령(scripts/set_test_account.py)으로만 바꾼다. 일반 API 는 없다.
- 색인은 두지 않는다 — 통계 쿼리는 app_users 를 id(기본 키)로 이어 읽고, 테스트 계정은 몇 개뿐이다.

Revision ID: f3c8a1d6e2b7
Revises: a3f9c2e7b1d4
"""

import sqlalchemy as sa

from alembic import op

revision = "f3c8a1d6e2b7"
down_revision = "a3f9c2e7b1d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_users",
        sa.Column(
            "is_test",
            sa.Boolean(create_constraint=False),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("app_users", "is_test")
