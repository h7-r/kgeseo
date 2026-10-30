"""승인 이력과 멱등 · 게시 상태 계열을 하나의 head로 합친다(스키마 변경 없음).

Revision ID: a5c7e9b2d4f6
Revises: d2a6f8b1c903, f3b8d2c6a1e7

- d2a6f8b1c903: NPC 승인 이력(부모 c9e1a4b7d2f0)
- f3b8d2c6a1e7: NPC 게시 상태(부모 e4c1f7a2b9d6 → c9e1a4b7d2f0)
소셜 온보딩(c9d8e7f6a5b4)은 이 브랜치에 없다. 그 브랜치를 통합할 때 이 revision과 c9d8e7f6a5b4를 합치는
merge revision을 따로 만든다. 기존 revision의 down_revision은 바꾸지 않는다.
"""

revision = "a5c7e9b2d4f6"
down_revision = ("d2a6f8b1c903", "f3b8d2c6a1e7")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
