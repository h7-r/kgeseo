"""통합 계열(Hint · NPC · 게시 · content_reviews)과 소셜 온보딩 계열을 하나의 head로 합친다(스키마 변경 없음).

Revision ID: 4b8e1d6a9c27
Revises: 7c3e5a9d1f42, c9d8e7f6a5b4

- 7c3e5a9d1f42: 통합 merge revision(b6d4e2f8a1c3 + e2a7c4f9b1d3, 공통 조상 b8a7c6d5e4f3)
- c9d8e7f6a5b4: social_onboarding_pendings(부모 b8a7c6d5e4f3)
두 계열이 만드는 테이블 · 칼럼은 겹치지 않는다(social_onboarding_pendings 대 play_sessions 칼럼 ·
npc_* · content_reviews). 기존 revision의 down_revision은 바꾸지 않는다.
"""

revision = "4b8e1d6a9c27"
down_revision = ("7c3e5a9d1f42", "c9d8e7f6a5b4")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
