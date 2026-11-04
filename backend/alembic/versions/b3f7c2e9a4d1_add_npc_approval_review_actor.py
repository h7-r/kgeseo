"""NPC 승인 이력에 기록 실행자(actor) 열을 더한다 (PM v0.4.13 §3).

Revision ID: b3f7c2e9a4d1
Revises: 4b8e1d6a9c27

- `actor`는 기록을 실행한 사람, 기존 `reviewer`는 판정한 사람이다. 판정에는 쓰지 않는다.
- 기존 기록은 고치지 않는다: 열만 더하고(NULL = 실행자 미기록) 값을 채우지 않는다.
- 이력 수정 · 삭제 거부 트리거(d2a6f8b1c903)는 그대로 두며, 새 열의 수정도 같은 트리거가 막는다.
- 기존 revision은 변경하지 않는다. 운영 · 개발 DB에는 이번 작업에서 적용하지 않는다.
"""

import sqlalchemy as sa

from alembic import op

revision = "b3f7c2e9a4d1"
down_revision = "4b8e1d6a9c27"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "npc_approval_reviews",
        sa.Column("actor", sa.VARCHAR(100), nullable=True),
    )


def downgrade() -> None:
    # 실행자 기록을 지우는 명시적 schema rollback이며 운영 적용 전 별도 검토한다.
    op.drop_column("npc_approval_reviews", "actor")
