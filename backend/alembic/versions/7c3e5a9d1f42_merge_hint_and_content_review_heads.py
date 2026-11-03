"""Hint · NPC 승인 · 게시 상태 계열과 content_reviews 계열을 하나의 head로 합친다(스키마 변경 없음).

Revision ID: 7c3e5a9d1f42
Revises: b6d4e2f8a1c3, e2a7c4f9b1d3

- b6d4e2f8a1c3: 힌트 잔액(부모 a5c7e9b2d4f6 → d2a6f8b1c903 · f3b8d2c6a1e7 → c9e1a4b7d2f0)
- e2a7c4f9b1d3: content_reviews(부모 c9e1a4b7d2f0)
두 계열이 만드는 테이블 · 칼럼은 겹치지 않는다(npc_approval_reviews · npc_approval_targets ·
npc_turn_* · npc_content_versions · npc_publication_* · play_sessions.hint_balance/help_used 대
content_reviews). content_reviews와 npc_approval_reviews는 같은 G1~G3 이력을 담는 중복 저장소이며,
어느 쪽을 남길지는 별도 결정이다(이 revision은 어느 테이블도 바꾸지 않는다).
소셜 온보딩(c9d8e7f6a5b4)은 이 브랜치에 없다. 그 브랜치를 통합할 때 이 revision과 c9d8e7f6a5b4를 합치는
merge revision을 따로 만든다. 기존 revision의 down_revision은 바꾸지 않는다.
"""

revision = "7c3e5a9d1f42"
down_revision = ("b6d4e2f8a1c3", "e2a7c4f9b1d3")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
