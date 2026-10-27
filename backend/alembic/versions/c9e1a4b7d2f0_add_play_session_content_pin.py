"""add play session content pin

세션이 시작할 때 고정한 콘텐츠 버전(content_version, content_fingerprint)을 담을 칼럼을 더한다.
둘 다 NULL을 허용한다. 기존 행은 값이 없는 레거시 세션으로 남는다(값을 채우지 않는다).

"둘 다 NULL이거나 둘 다 값" 규칙은 지금 ORM 저장 전 검사(app.models.play_session)로만 지킨다.
MySQL은 8.0.16부터 CHECK 제약을 실제로 검사하고 그 전 버전은 문법만 받고 무시하므로, 배포 DB 버전을
확인하기 전에는 DB 제약을 두지 않는다. 확인 뒤 붙일 제약(제안):

    ALTER TABLE play_sessions ADD CONSTRAINT ck_play_sessions_content_pin_pair
      CHECK ((content_version IS NULL) = (content_fingerprint IS NULL));

Revision ID: c9e1a4b7d2f0
Revises: b8a7c6d5e4f3
Create Date: 2026-10-27 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e1a4b7d2f0"
down_revision: str | Sequence[str] | None = "b8a7c6d5e4f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "play_sessions",
        sa.Column("content_version", sa.INTEGER(), nullable=True),
    )
    op.add_column(
        "play_sessions",
        sa.Column("content_fingerprint", sa.VARCHAR(length=128), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # 버전 고정 정보가 사라진다. 남은 세션은 레거시 세션으로 돌아간다.
    op.drop_column("play_sessions", "content_fingerprint")
    op.drop_column("play_sessions", "content_version")
