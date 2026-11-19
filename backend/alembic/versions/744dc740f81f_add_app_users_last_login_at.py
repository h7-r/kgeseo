"""회원 최근 로그인 시각 app_users.last_login_at(세진 11/16, 미르 승인 · 계약 `docs/contracts/admin_last_login.md`).

Revision ID: 744dc740f81f
Revises: 734021834040

- 열 하나를 더한다: `last_login_at DATETIME(6) NULL`. 색인은 만들지 않는다(목록은 쪽 단위 PK 조회, 이 값으로 정렬 · 필터하지 않는다).
- 기존 회원은 한 번 채운다: 회원별 `MAX(user_sessions.created_at)`(만료 · 철회와 무관하게 마지막으로 세션을 만든 시각).
  세션이 없는 회원은 NULL 그대로. 회원 행을 만들거나 지우지 않고, `updated_at` 은 건드리지 않는다(UPDATE 에 열을 적지 않고,
  app_users 에는 DB 의 ON UPDATE 가 없다). 시각은 저장된 UTC naive 값 그대로 옮긴다.
- downgrade 는 열만 지운다(회원 행은 그대로, 채운 값은 사라진다 — 다시 upgrade 하면 같은 규칙으로 다시 채운다).
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

from alembic import op

revision = "744dc740f81f"
down_revision = "734021834040"
branch_labels = None
depends_on = None

# 회원별 마지막 세션 생성 시각으로 한 번 채운다. 세션이 있는 회원만 바뀐다(나머지는 NULL).
BACKFILL = sa.text(
    "UPDATE app_users AS u "
    "JOIN (SELECT app_user_id, MAX(created_at) AS last_created "
    "      FROM user_sessions GROUP BY app_user_id) AS s "
    "  ON s.app_user_id = u.id "
    "SET u.last_login_at = s.last_created"
)


def upgrade() -> None:
    op.add_column(
        "app_users", sa.Column("last_login_at", DATETIME(fsp=6), nullable=True)
    )
    op.execute(BACKFILL)


def downgrade() -> None:
    op.drop_column("app_users", "last_login_at")
