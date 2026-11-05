"""계정에 딸린 데이터: 로그인 세션 · 게임 저장 · 캐릭터 · 소유 아이템 · 관리자 기록."""

from datetime import datetime

from sqlalchemy import (
    BIGINT,
    CHAR,
    INTEGER,
    JSON,
    VARCHAR,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserSession(Base):
    """로그인 세션. 원문 토큰은 쿠키에만 있고 여기에는 해시만 둔다."""

    __tablename__ = "user_sessions"
    __table_args__ = (Index("ix_user_sessions_user", "app_user_id"),)

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    app_user_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)


class LoginThrottle(Base):
    """로그인 실패 횟수. 이메일·IP 원문을 남기지 않게 해시를 열쇠로 쓴다."""

    __tablename__ = "login_throttles"

    key_hash: Mapped[str] = mapped_column(CHAR(64), primary_key=True)
    failed_count: Mapped[int] = mapped_column(INTEGER, nullable=False)
    window_started_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )


class GamePlaySave(Base):
    """사용자별 게임 진행. 단계는 관리자 조회용으로 열에 빼고 나머지는 state_json 에 둔다."""

    __tablename__ = "game_play_saves"
    __table_args__ = (
        UniqueConstraint("app_user_id", "slot", name="uq_game_play_saves_user_slot"),
    )

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    app_user_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    slot: Mapped[int] = mapped_column(INTEGER, nullable=False)
    # 고쳐 쓸 때마다 1 오른다. 창 두 개가 서로 덮어쓰지 못하게 한다.
    revision: Mapped[int] = mapped_column(INTEGER, nullable=False)
    schema_version: Mapped[int] = mapped_column(INTEGER, nullable=False)
    stage: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    state_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class UserCharacter(Base):
    """사용자의 게임 캐릭터. 외형은 게임이 정한 모양 그대로 JSON 으로 둔다."""

    __tablename__ = "user_characters"

    app_user_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    appearance_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class ItemCatalog(Base):
    """얻을 수 있는 아이템 목록(옷·에셋·소모품 등). 새 종류는 kind 값만 늘리면 된다."""

    __tablename__ = "item_catalog"

    id: Mapped[str] = mapped_column(VARCHAR(64), primary_key=True)
    kind: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    name: Mapped[str] = mapped_column(VARCHAR(100), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class UserItem(Base):
    """사용자가 가진 아이템. 지급은 서버만 한다 — 사용자 API 에는 쓰기 경로가 없다."""

    __tablename__ = "user_items"
    __table_args__ = (
        UniqueConstraint("app_user_id", "item_id", name="uq_user_items_user_item"),
    )

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    app_user_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(
        VARCHAR(64), ForeignKey("item_catalog.id"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(INTEGER, nullable=False)
    source: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class AdminAuditLog(Base):
    """관리자가 누구의 기록을 언제 봤는지 남긴다."""

    __tablename__ = "admin_audit_logs"
    __table_args__ = (Index("ix_admin_audit_logs_target", "target_user_id"),)

    id: Mapped[int] = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    admin_user_id: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    action: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    target_user_id: Mapped[str | None] = mapped_column(CHAR(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
