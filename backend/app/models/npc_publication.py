"""NPC 콘텐츠 게시 상태 (PM v0.4.6).

- `npc_content_versions`: 불변 콘텐츠 버전 · fingerprint. 한 번 등록하면 바꾸거나 지우지 않는다.
- `npc_publication_states`: 버전별 현재 게시 상태(`published` · `suspended` · `blocked`). 바뀌는 값은 여기에만 있다.
- `npc_publication_events`: 상태 변경 이력. 추가만 한다.

게시 중단을 콘텐츠 삭제나 메모리 저장소 제거로 표현하지 않는다. 서버를 다시 시작해도 마지막으로 commit된
상태가 그대로 남는다.
"""

from datetime import datetime

from sqlalchemy import (
    CHAR,
    INTEGER,
    VARCHAR,
    ForeignKeyConstraint,
    Index,
    event,
)
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

PUBLICATION_PUBLISHED = "published"
PUBLICATION_SUSPENDED = "suspended"
PUBLICATION_BLOCKED = "blocked"
PUBLICATION_STATUSES = (
    PUBLICATION_PUBLISHED,
    PUBLICATION_SUSPENDED,
    PUBLICATION_BLOCKED,
)


class NpcContentVersion(Base):
    __tablename__ = "npc_content_versions"

    case_id: Mapped[str] = mapped_column(VARCHAR(64), primary_key=True)
    content_version: Mapped[int] = mapped_column(INTEGER, primary_key=True)
    content_fingerprint: Mapped[str] = mapped_column(VARCHAR(128), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    __table_args__ = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


class NpcPublicationState(Base):
    __tablename__ = "npc_publication_states"

    case_id: Mapped[str] = mapped_column(VARCHAR(64), primary_key=True)
    content_version: Mapped[int] = mapped_column(INTEGER, primary_key=True)
    status: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    # 상태가 바뀔 때마다 1씩 늘어난다. 이력의 state_revision과 짝을 이룬다.
    revision: Mapped[int] = mapped_column(INTEGER, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["case_id", "content_version"],
            ["npc_content_versions.case_id", "npc_content_versions.content_version"],
            ondelete="RESTRICT",
        ),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )


class NpcPublicationEvent(Base):
    """publication_event {case_id, content_version, from, to, reason, actor, at}."""

    __tablename__ = "npc_publication_events"

    event_id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    content_version: Mapped[int] = mapped_column(INTEGER, nullable=False)
    # 최초 게시는 NULL
    from_status: Mapped[str | None] = mapped_column(VARCHAR(16), nullable=True)
    to_status: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    reason: Mapped[str] = mapped_column(VARCHAR(500), nullable=False)
    actor: Mapped[str] = mapped_column(VARCHAR(100), nullable=False)
    at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    state_revision: Mapped[int] = mapped_column(INTEGER, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["case_id", "content_version"],
            ["npc_content_versions.case_id", "npc_content_versions.content_version"],
            ondelete="RESTRICT",
        ),
        Index(
            "ix_npc_publication_events_version",
            "case_id",
            "content_version",
            "state_revision",
            unique=True,
        ),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )


def _immutable(*_args: object) -> None:
    raise ValueError("content versions and publication events are append-only")


for _model in (NpcContentVersion, NpcPublicationEvent):
    event.listen(_model, "before_update", _immutable)
    event.listen(_model, "before_delete", _immutable)
