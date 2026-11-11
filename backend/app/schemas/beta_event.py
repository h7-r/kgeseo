"""베타 분석 기록 요청 · 응답(11/11 미르, 베타 수집 항목 v1.1 2-2절).

- 한 번에 1~50개. 본문 전체는 라우터가 64KB 로 먼저 자른다.
- 알 수 없는 필드는 무시한다(게임 화면이 필드를 더해도 묶음 전체를 잃지 않게). 형식이 틀린 필드는 묶음 전체를 거절한다.
- data 는 JSON 으로 2048바이트 이하. 대화 전문 · 정답 원문 · 전체 주소 · 계정 정보는 게임 화면이 넣지 않는다(문서 7절).
"""

import json
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

BETA_EVENT_TYPES = (
    "beta_entry",
    "stage_reached",
    "run_state",
    "objective_state",
    "puzzle_attempt",
    "help_event",
    "npc_turn",
    "story_exposure",
    "activity_snapshot",
    "client_error",
    "survey_link",
)
BetaEventType = Literal[
    "beta_entry",
    "stage_reached",
    "run_state",
    "objective_state",
    "puzzle_attempt",
    "help_event",
    "npc_turn",
    "story_exposure",
    "activity_snapshot",
    "client_error",
    "survey_link",
]

MAX_EVENTS_PER_BATCH = 50
MAX_DATA_BYTES = 2048
PARTICIPANT_CODE_PATTERN = r"^[A-Z0-9-]{4,16}$"


class BetaEventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: UUID
    type: BetaEventType
    phase: str | None = Field(default=None, max_length=32, pattern=r"^[a-z0-9_]+$")
    pc: str | None = Field(default=None, pattern=PARTICIPANT_CODE_PATTERN)
    run_id: str | None = Field(default=None, max_length=36)
    run_index: int | None = Field(default=None, ge=0, le=1000)
    tab_id: str | None = Field(default=None, max_length=36)
    seq: int | None = Field(default=None, ge=0, le=10**9)
    client_ts: datetime
    objective_id: str | None = Field(
        default=None, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$"
    )
    page: str | None = Field(default=None, max_length=16)
    build: str | None = Field(default=None, max_length=40)
    # 기록을 만든 때의 계정 id(게임 화면이 /me 로 확인한 값). "" = 로그인 안 함. 저장 여부를 가르는 데만 쓰고,
    # 저장하는 계정은 늘 쿠키로 정한다 — 쿠키 계정과 다르면 버린다(공용 PC 에서 앞사람 기록이 다음 사람에게 붙지 않게)
    acct: str | None = Field(default=None, max_length=36)
    data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("data")
    @classmethod
    def data_is_small(cls, value: dict[str, Any]) -> dict[str, Any]:
        size = len(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )
        if size > MAX_DATA_BYTES:
            raise ValueError(f"data must be at most {MAX_DATA_BYTES} bytes as JSON")
        return value

    def client_ts_utc(self) -> datetime:
        """DATETIME 열에 넣을 UTC(시간대 없음). 시간대가 없는 값은 UTC 로 본다."""
        if self.client_ts.tzinfo is None:
            return self.client_ts
        return self.client_ts.astimezone(timezone.utc).replace(tzinfo=None)


class BetaEventBatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    events: list[BetaEventIn] = Field(min_length=1, max_length=MAX_EVENTS_PER_BATCH)


class BetaEventBatchResult(BaseModel):
    accepted: int
    duplicates: int
    disabled: bool = False
    # 로그인하지 않았고 참여 코드도 없는 기록 — 저장하지 않는다(베타 참가자 = 회원, 미르 11/11)
    ignored: int = 0


class BetaEventOut(BaseModel):
    id: int
    event_id: str
    received_at: datetime
    client_ts: datetime | None
    event_type: str
    phase: str | None
    participant_code: str | None
    run_id: str | None
    run_index: int | None
    tab_id: str | None
    seq: int | None
    objective_id: str | None
    page: str | None
    build: str | None
    app_user_id: str | None
    guest_session_id: str | None
    data: dict[str, Any]


class BetaEventExport(BaseModel):
    events: list[BetaEventOut]
    next_after_id: int | None
