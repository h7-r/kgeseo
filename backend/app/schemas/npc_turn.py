"""NPC 턴 HTTP 계약 v0.1 (PM v0.4.3).

POST /api/v1/play-sessions/{play_session_id}/npc/turns

- 응답 `reply.source`는 `generated` · `approved_line`(line_id 필수) 두 값뿐이다. 발화가 없으면 `reply`는 null.
- `suggest_hint`는 힌트 버튼을 보여 주라는 안내다. 힌트를 해금하지 않는다(해금은 Hint API).
- 이벤트(response_json)에는 대사 · 플레이어 원문을 남기지 않는다. 출처 · line_id · 생성 여부 ·
  정책 검사 결과(code · rule_id) · 판단 결과만 남긴다.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

NpcTurnTrigger = Literal["player_message", "auto"]
MAX_PLAYER_MESSAGE_LENGTH = 200


class NpcTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_event_id: UUID
    client_timestamp: datetime | None = None
    trigger: NpcTurnTrigger
    # player_message 일 때만. 서버는 원문을 저장하지 않는다.
    message: str | None = Field(
        default=None, min_length=1, max_length=MAX_PLAYER_MESSAGE_LENGTH
    )
    # 플레이어가 보고 있는 Object(현재 구역). 서버가 퍼즐로 다시 찾는다(퍼즐 ID는 받지 않는다).
    focus_object_id: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("client_timestamp")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("client_timestamp must include a timezone offset")
        return value

    @model_validator(mode="after")
    def validate_trigger(self) -> "NpcTurnRequest":
        if self.trigger == "player_message" and (
            self.message is None or not self.message.strip()
        ):
            raise ValueError("player_message requires message")
        if self.trigger == "auto" and self.message is not None:
            raise ValueError("auto turn must not carry a message")
        return self


class NpcReplyOut(BaseModel):
    source: Literal["generated", "approved_line"]
    text: str
    line_id: str | None = None


class SuggestHintOut(BaseModel):
    puzzle_id: str


class NpcTurnResponse(BaseModel):
    npc_event_id: UUID
    reply: NpcReplyOut | None
    suggest_hint: SuggestHintOut | None


class NpcTurnEventRecord(BaseModel):
    """interaction_events.response_json. 대사 · 플레이어 원문 · 정답 · 힌트 원문을 담지 않는다."""

    trigger: NpcTurnTrigger
    reply_source: Literal["generated", "approved_line"] | None
    line_id: str | None
    generated: bool
    no_reply_reason: str | None
    suggest_hint_puzzle_id: str | None
    policy: list[dict[str, str]] = Field(default_factory=list)
    decision: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    # 자동 개입으로 실제 말을 했는가(쿨다운 · 상한 계산에 쓴다)
    auto_intervened: bool = False
    # NPC는 게임 상태를 바꾸지 않는다.
    state_changes: list[dict[str, object]] = Field(default_factory=list, max_length=0)
