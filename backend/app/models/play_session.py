from datetime import datetime
from typing import Any

from sqlalchemy import CHAR, INTEGER, VARCHAR, ForeignKey, Index, event
from sqlalchemy.dialects.mysql import DATETIME, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# "sha256:" + 16진 64자 = 71자. 형식은 아직 확정 전이라 여유를 둔다(값은 불투명 문자열).
CONTENT_FINGERPRINT_MAX_LENGTH = 128


class ContentPinColumnsError(ValueError):
    """content_version · content_fingerprint는 둘 다 NULL이거나 둘 다 유효한 값이어야 한다."""


def check_content_pin_columns(content_version: Any, content_fingerprint: Any) -> None:
    if content_version is None and content_fingerprint is None:
        return
    if content_version is None or content_fingerprint is None:
        raise ContentPinColumnsError(
            "content_version and content_fingerprint must be set together"
        )
    if (
        isinstance(content_version, bool)
        or not isinstance(content_version, int)
        or content_version < 1
    ):
        raise ContentPinColumnsError("content_version must be a positive integer")
    if (
        not isinstance(content_fingerprint, str)
        or not content_fingerprint.strip()
        or len(content_fingerprint) > CONTENT_FINGERPRINT_MAX_LENGTH
    ):
        raise ContentPinColumnsError("content_fingerprint must be a non-blank string")


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

    # 세션이 시작할 때 고정한 콘텐츠 버전(게임 진행 상태가 아니라 세션 메타데이터).
    #
    # 버전 체계 이전 세션 · 레거시 케이스는 둘 다 NULL이다. 둘은 함께 있거나 함께 없다
    # (아래 check_content_pin_columns를 저장 전에 검사한다. DB CHECK 제약은 MySQL 버전 확인 전이라 두지 않았다).
    content_version: Mapped[int | None] = mapped_column(
        INTEGER,
        nullable=True,
    )
    content_fingerprint: Mapped[str | None] = mapped_column(
        VARCHAR(CONTENT_FINGERPRINT_MAX_LENGTH),
        nullable=True,
    )

    # 특정 익명 사용자의 플레이 기록을 찾을 때 사용하기 위한 Index
    __table_args__ = (
        Index(
            "ix_play_sessions_anonymous_session_id",
            "anonymous_session_id",
        ),
    )


@event.listens_for(PlaySession, "before_insert")
@event.listens_for(PlaySession, "before_update")
def _check_content_pin_before_flush(
    mapper: Any, connection: Any, target: PlaySession
) -> None:
    check_content_pin_columns(target.content_version, target.content_fingerprint)
