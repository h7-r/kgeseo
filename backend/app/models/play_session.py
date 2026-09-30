from datetime import datetime

from sqlalchemy import CHAR, VARCHAR, ForeignKey, Index
from sqlalchemy.dialects.mysql import DATETIME, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PlaySession(Base):
    """
    한 번의 실제 게임 플레이 진행 상태를 저장하는 테이블.

    AnonymousSession이 '누가 플레이하는가'를 구분한다면,
    PlaySession은 '그 사용자가 어떤 플레이를 진행하고 있는가'를 관리한다.
    """

    __tablename__ = "play_sessions"

    # 한 번의 플레이를 구분하는 UUID
    id: Mapped[str] = mapped_column(
        CHAR(36),
        primary_key=True,
        nullable=False,
    )

    # 이 플레이를 시작한 익명 사용자의 ID
    #
    # anonymous_sessions.id를 참조하는 Foreign Key다.
    anonymous_session_id: Mapped[str] = mapped_column(
        CHAR(36),
        ForeignKey("anonymous_sessions.id"),
        nullable=False,
    )

    # 어떤 사건(Case)을 플레이하고 있는지 구분한다.
    #
    # 아직 cases 테이블을 만들지 않았기 때문에
    # 현재는 문자열 ID만 저장하고 Foreign Key는 걸지 않는다.
    case_id: Mapped[str] = mapped_column(
        VARCHAR(64),
        nullable=False,
    )

    # 현재 게임 진행 상태를 JSON 형태로 저장한다.
    #
    # 예:
    # {
    #   "completed_puzzle_ids": [],
    #   "acquired_clue_ids": [],
    #   "hint_levels": {},
    #   "flags": {}
    # }
    state_json: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    # 플레이를 처음 시작한 시각
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    # 게임 상태가 마지막으로 변경된 시각
    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    # 플레이를 완료한 시각
    #
    # 아직 플레이 중이라면 NULL이다.
    completed_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    # 특정 익명 사용자의 플레이 기록을 찾을 때 사용하기 위한 Index
    __table_args__ = (
        Index(
            "ix_play_sessions_anonymous_session_id",
            "anonymous_session_id",
        ),
    )
