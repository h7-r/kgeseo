"""NPC 턴 멱등 저장소 (PM v0.4.4 · v0.4.6). 이벤트 로그(`interaction_events`)와 분리된 테이블이다.

- `npc_turn_requests`: 요청 키 · 요청 동등성 값 · 처리 권한(owner_token · lease) · 콘텐츠 버전 · 만료 ·
  철회 표식. 본문을 지운 뒤에도 남는 tombstone이다.
- `npc_turn_response_bodies`: 사용자에게 실제로 전달한 최종 응답 본문만 담는다. 만료 · 긴급 차단 시 행째 지운다.

플레이어 원문 · 차단된 생성문 · model_context는 어느 테이블에도 두지 않는다. 분석 · 학습 목적으로 쓰지 않는다.
"""

from datetime import datetime

from sqlalchemy import (
    CHAR,
    INTEGER,
    VARCHAR,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
)
from sqlalchemy.dialects.mysql import DATETIME, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

TURN_STATUS_PROCESSING = "PROCESSING"
TURN_STATUS_READY = "READY"
TURN_STATUS_EXPIRED = "EXPIRED"


class NpcTurnRequest(Base):
    __tablename__ = "npc_turn_requests"

    play_session_id: Mapped[str] = mapped_column(
        CHAR(36),
        # 게스트 기록 정리로 세션이 지워지면 tombstone도 함께 지운다.
        ForeignKey("play_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    turn_request_id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    # `hmac-sha256:<key id>:<64 hex>`. 요청 원문은 저장하지 않는다.
    request_body_hash: Mapped[str] = mapped_column(VARCHAR(96), nullable=False)
    status: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    # 세션이 고정한 콘텐츠 버전. 긴급 차단 시 해당 버전의 응답을 찾는다.
    case_id: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    content_version: Mapped[int] = mapped_column(INTEGER, nullable=False)
    content_fingerprint: Mapped[str] = mapped_column(VARCHAR(128), nullable=False)
    # PROCESSING 동안의 처리 권한. owner_token은 늦은 저장을 막는 fencing 토큰이다.
    owner_token: Mapped[str | None] = mapped_column(CHAR(36), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    # 최초 응답 발급 시각과 본문 삭제 기한. READY가 될 때 정하고 재전송으로 늘리지 않는다.
    issued_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    # 기한 만료로 본문을 지운 시각(EXPIRED).
    purged_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    # 긴급 차단으로 본문을 지운(또는 처리 중 확정을 막은) 시각.
    withdrawn_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )

    __table_args__ = (
        Index("ix_npc_turn_requests_status_expires_at", "status", "expires_at"),
        Index("ix_npc_turn_requests_content", "case_id", "content_version"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )


class NpcTurnResponseBody(Base):
    __tablename__ = "npc_turn_response_bodies"

    play_session_id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    turn_request_id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    response_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["play_session_id", "turn_request_id"],
            ["npc_turn_requests.play_session_id", "npc_turn_requests.turn_request_id"],
            ondelete="CASCADE",
        ),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"},
    )
