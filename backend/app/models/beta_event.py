"""베타 분석 기록(11/11 미르, 베타 수집 항목 v1.1 2-2절).

게임 진행(interaction_events) · 로그인 저장(game_play_saves)과 완전히 떨어진 표다. 다른 표를 참조하지 않는다
(외래 키 없음) — 분석 기록 때문에 기존 행이 잠기거나 지워지지 못하는 일이 없게.

- event_id: 클라이언트가 만든 UUID. 같은 값을 다시 보내면 한 번만 남는다(유일 색인).
- app_user_id · guest_session_id: 요청 쿠키로 서버가 정한 주인(요청 본문의 사용자 id 는 믿지 않는다). 둘 다 없을 수 있다.
- participant_code: 베타 참여 코드(설문과 잇는 열쇠). 계정 인증 수단이 아니다.
"""

from datetime import datetime

from sqlalchemy import BIGINT, CHAR, INTEGER, VARCHAR, Index, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BetaEvent(Base):
    __tablename__ = "beta_events"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_beta_events_event_id"),
        Index("ix_beta_events_participant_client_ts", "participant_code", "client_ts"),
        Index("ix_beta_events_app_user_id", "app_user_id"),
        Index("ix_beta_events_type_received", "event_type", "received_at"),
    )

    id: Mapped[int] = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    client_ts: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    event_type: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    phase: Mapped[str | None] = mapped_column(VARCHAR(32), nullable=True)
    participant_code: Mapped[str | None] = mapped_column(VARCHAR(16), nullable=True)
    run_id: Mapped[str | None] = mapped_column(VARCHAR(36), nullable=True)
    run_index: Mapped[int | None] = mapped_column(INTEGER, nullable=True)
    tab_id: Mapped[str | None] = mapped_column(VARCHAR(36), nullable=True)
    seq: Mapped[int | None] = mapped_column(BIGINT, nullable=True)
    objective_id: Mapped[str | None] = mapped_column(VARCHAR(40), nullable=True)
    page: Mapped[str | None] = mapped_column(VARCHAR(16), nullable=True)
    build: Mapped[str | None] = mapped_column(VARCHAR(40), nullable=True)
    app_user_id: Mapped[str | None] = mapped_column(CHAR(36), nullable=True)
    guest_session_id: Mapped[str | None] = mapped_column(CHAR(36), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
