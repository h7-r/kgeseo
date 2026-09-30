from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class InteractionEvent(Base):
    __tablename__ = "interaction_events"

    id: Mapped[str] = mapped_column(
        CHAR(36),
        primary_key=True,
        nullable=False,
    )

    play_session_id: Mapped[str] = mapped_column(
        CHAR(36),
        ForeignKey("play_sessions.id"),
        nullable=False,
    )

    client_event_id: Mapped[str] = mapped_column(
        CHAR(36),
        nullable=False,
    )

    client_timestamp: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    interaction_type: Mapped[str] = mapped_column(
        VARCHAR(32),
        nullable=False,
    )

    target_id: Mapped[str | None] = mapped_column(
        VARCHAR(64),
        nullable=True,
    )

    payload_json: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    result_type: Mapped[str] = mapped_column(
        VARCHAR(32),
        nullable=False,
    )

    response_json: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "play_session_id",
            "client_event_id",
            name="uq_interaction_events_play_session_client_event",
        ),
        Index(
            "ix_interaction_events_play_session_id",
            "play_session_id",
        ),
    )
