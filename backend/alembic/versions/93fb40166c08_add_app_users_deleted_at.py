"""회원 탈퇴 시각 app_users.deleted_at(세진 11/17, 회원 탈퇴 Phase 1 · 계약 `docs/contracts/account_withdrawal_v0.2.md`).

Revision ID: 93fb40166c08
Revises: 744dc740f81f

- 열 하나를 더한다: `deleted_at DATETIME(6) NULL`. 기존 회원은 NULL(탈퇴 안 함), 서버 기본값은 두지 않는다.
- 개인정보 치환(이메일 · 닉네임 · 지역 · 동의 · 최근 로그인)은 여기서 하지 않는다 — 실제 탈퇴 트랜잭션(`account_withdrawal`)의 일이다.
  이 migration 은 회원 행을 만들거나 지우거나 바꾸지 않는다.
- 색인은 만들지 않는다: 거의 모든 행이 NULL 이라 `deleted_at IS NULL` 조건은 선택도가 없고, 회원 수 · 목록 조회는 지금도
  app_users 전체를 훑거나 created_at 순으로 읽는다(색인을 더해도 쓰이지 않는다).
- downgrade 는 열을 지운다. 단 탈퇴한 회원이 하나라도 있으면 멈춘다 — 열을 지우면 탈퇴 회원이 현재 회원 수 · 목록에 다시
  나타나고 탈퇴 표시가 사라진다(되돌릴 수 없는 손실). 그때는 코드만 되돌리고 열은 남겨 둔다(옛 코드는 이 열을 읽지 않는다).
"""

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

from alembic import op

revision = "93fb40166c08"
down_revision = "744dc740f81f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_users", sa.Column("deleted_at", DATETIME(fsp=6), nullable=True))


def downgrade() -> None:
    withdrawn = (
        op.get_bind()
        .execute(sa.text("SELECT COUNT(*) FROM app_users WHERE deleted_at IS NOT NULL"))
        .scalar_one()
    )
    if withdrawn:
        raise RuntimeError(
            f"{withdrawn} withdrawn account(s) exist; dropping app_users.deleted_at would "
            "turn them back into members. Roll back the code only and keep the column."
        )
    op.drop_column("app_users", "deleted_at")
