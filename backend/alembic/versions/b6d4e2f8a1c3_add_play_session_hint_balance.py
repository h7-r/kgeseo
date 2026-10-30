"""add play session hint balance (PM v0.4.8 · v0.4.9)

회차별 힌트 잔액 `hint_balance`와 도움 사용 수 `help_used`를 play_sessions에 더한다.

- 새 회차의 잔액은 앱 설정 `HINT_INITIAL_BALANCE`(기본 3)로 세션 생성 때 넣는다. DB 기본값 0은 지급 경로를
  거치지 않은 행이 무료 힌트를 받지 않게 하는 안전값이다.
- 기존 행: `hint_balance`는 이 revision 작성 시점의 PM 기본값 N(3)으로, `help_used`는 이미 연 단계의 합
  (`state_json.hint_levels` 값의 합, 0~2 정수만)으로 채운다. 이 revision 전에는 Hint HTTP 경로가 없어 실제로는
  모두 0이다.
- 0 미만 금지는 Hint 서비스가 세션 행 잠금 안에서 지킨다. CHECK 제약은 배포 DB 버전 확인 전이라 두지 않는다
  (c9e1a4b7d2f0와 같은 이유). 확인 뒤 붙일 제약(제안):

    ALTER TABLE play_sessions ADD CONSTRAINT ck_play_sessions_hint_balance CHECK (hint_balance >= 0);

Revision ID: b6d4e2f8a1c3
Revises: a5c7e9b2d4f6
Create Date: 2026-10-30 18:00:00.000000

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b6d4e2f8a1c3"
down_revision: str | Sequence[str] | None = "a5c7e9b2d4f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 기존 행에 넣는 잔액(작성 시점의 PM 기본값). 새 회차는 앱 설정값을 쓴다.
LEGACY_INITIAL_BALANCE = 3
MAX_HINT_LEVEL = 2


def _opened_levels(state_json) -> int:
    if isinstance(state_json, (str, bytes)):
        state_json = json.loads(state_json)
    levels = (state_json or {}).get("hint_levels") or {}
    if not isinstance(levels, dict):
        return 0
    return sum(
        level
        for level in levels.values()
        if isinstance(level, int)
        and not isinstance(level, bool)
        and 0 <= level <= MAX_HINT_LEVEL
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "play_sessions",
        sa.Column(
            "hint_balance", sa.INTEGER(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.add_column(
        "play_sessions",
        sa.Column(
            "help_used", sa.INTEGER(), nullable=False, server_default=sa.text("0")
        ),
    )

    op.execute(
        sa.text("UPDATE play_sessions SET hint_balance = :balance").bindparams(
            balance=LEGACY_INITIAL_BALANCE
        )
    )
    if op.get_context().as_sql:
        # 오프라인 SQL 생성(`--sql`)에서는 기존 행을 읽을 수 없다. help_used 채우기는 온라인 실행에서만 한다.
        return
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, state_json FROM play_sessions")).all()
    for row_id, state_json in rows:
        used = _opened_levels(state_json)
        if used:
            connection.execute(
                sa.text("UPDATE play_sessions SET help_used = :used WHERE id = :id"),
                {"used": used, "id": row_id},
            )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("play_sessions", "help_used")
    op.drop_column("play_sessions", "hint_balance")
