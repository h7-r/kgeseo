"""NPC 턴 HTTP 계약 v0.2 (PM v0.4.3 · v0.4.7).

POST /api/v1/play-sessions/{play_session_id}/npc/turns

- 응답 `reply.source`는 `generated` · `approved_line`(line_id 필수) 두 값뿐이다. 발화가 없으면 `reply`는 null.
- `suggest_hint`는 힌트 버튼을 보여 주라는 안내다. 힌트를 해금하지 않는다(해금은 Hint API).
  PM v0.4.7: 내부 puzzle_id 대신 서버가 발급한 불투명 `hint_ref`만 싣는다(`app.services.hint_ref`).
- `fallback_reason`: 발화가 없거나 대체된 이유 코드(PM 확정 값만). 예: 승인 일반 팩이 없으면
  `NPC_GENERIC_PACK_MISSING`.
- `content_mode`(PM v0.4.13 §4): 정상 응답은 `"case"`. 긴급 중단(`NPC_CONTENT_WITHDRAWN`) · NPC 콘텐츠 없음
  (`NPC_CONTENT_MISSING`) · 버전 불일치(`NPC_CONTENT_VERSION_MISMATCH`) · 검증 실패(`NPC_CONTENT_INVALID`)이면
  `"generic"`(`reply: null`이어도). 늘 값이 있다(null 없음).
- `npc_event_id`는 자동 개입 제안의 ID이기도 하다. FE는 표시 · 미표시 · 거절을 이 ID로 보고한다
  (`app.services.npc_suggestion_events`).
- 이벤트(response_json)에는 대사 · 플레이어 원문을 남기지 않는다. 출처 · line_id · 생성 여부 ·
  정책 검사 결과(code · rule_id) · 판단 결과만 남긴다.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 상황 코드는 콘텐츠 팩(`situations[].code`)과 같은 목록 하나를 쓴다. 이 목록 밖의 코드는 422다.
from app.schemas.npc_content import NpcSituationCode

NpcTurnTrigger = Literal["player_message", "auto"]
MAX_PLAYER_MESSAGE_LENGTH = 200


class NpcSituation(BaseModel):
    """auto 턴에 FE가 감지한 상황(계약 v0.4.16 §2). 말할지 · 무엇을 말할지는 BE가 정한다.

    - `code`만 필수. `zone_id` · `value`는 선택이다.
    - `zone_id`: 플레이어가 있는 Zone. 11/9 나주 대응표 전에는 형식을 묶지 않는다(§9-8).
    - `value`: 수치가 있는 상황(남은 숨 초 · 누적 실수 · 머문 시간 등). 숫자만 받는다 — 문자열 · 불리언은 422.
    """

    model_config = ConfigDict(extra="forbid")

    code: NpcSituationCode
    zone_id: str | None = Field(default=None, min_length=1, max_length=64)
    value: float | None = Field(default=None, strict=True, allow_inf_nan=False)


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
    # 계약 v0.4.16 §2: trigger=auto 일 때만. 없으면 기존 퍼즐 자동 개입 그대로다.
    situation: NpcSituation | None = None

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
        if self.trigger != "auto" and self.situation is not None:
            # 계약 v0.4.16 §2: player_message 턴에는 situation을 싣지 않는다.
            raise ValueError("situation is only allowed on auto turns")
        return self


class NpcReplyOut(BaseModel):
    source: Literal["generated", "approved_line"]
    text: str
    line_id: str | None = None


class SuggestHintOut(BaseModel):
    hint_ref: str


FallbackReason = Literal[
    "NPC_GENERIC_PACK_MISSING",
    "NPC_CONTENT_WITHDRAWN",
    "NPC_CONTENT_MISSING",
    "NPC_CONTENT_VERSION_MISMATCH",
    "NPC_CONTENT_INVALID",
]
# PM v0.4.13 §4 (v0.3 §6): 정상 응답은 "case". 긴급 중단 · 콘텐츠 없음 · 버전 불일치 · 검증 실패는 "generic"
# (`reply: null`이어도). null로 두지 않는다.
ContentMode = Literal["case", "generic"]


class NpcTurnResponse(BaseModel):
    npc_event_id: UUID
    reply: NpcReplyOut | None
    suggest_hint: SuggestHintOut | None
    fallback_reason: FallbackReason | None = None
    # 늘 명시한다(`npc_turn_service._content_mode`). 기본값을 두지 않는다 — 빠뜨리면 "case"로 잘못 표시되지 않게.
    content_mode: ContentMode


class NpcAutoInterveneRecord(BaseModel):
    """`npc_auto_intervene {trigger, value, puzzle_ref}` + nudge_missing · level (PM v0.4.7)."""

    trigger: str
    value: float | None
    # 내부 puzzle_id(이벤트 로그 전용, 응답에는 싣지 않는다)
    puzzle_ref: str | None
    nudge_missing: bool
    level: int


class NpcTurnEventRecord(BaseModel):
    """interaction_events.response_json. 대사 · 플레이어 원문 · 정답 · 힌트 원문을 담지 않는다."""

    trigger: NpcTurnTrigger
    reply_source: Literal["generated", "approved_line"] | None
    line_id: str | None
    generated: bool
    no_reply_reason: str | None
    suggest_hint_puzzle_id: str | None
    fallback_reason: FallbackReason | None = None
    policy: list[dict[str, str]] = Field(default_factory=list)
    decision: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    # 자동 개입 제안을 응답했는가. 횟수 · 쿨다운은 표시 보고(npc_suggestion_shown)로만 센다(PM v0.4.7).
    auto_intervened: bool = False
    auto_intervene: NpcAutoInterveneRecord | None = None
    # NPC는 게임 상태를 바꾸지 않는다.
    state_changes: list[dict[str, object]] = Field(default_factory=list, max_length=0)
