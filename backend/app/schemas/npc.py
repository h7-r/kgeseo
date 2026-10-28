from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.hint import HintLevel

NUDGE_LINE_ID_PATTERN = r"^NUDGE_[A-Za-z0-9_]+$"

NpcResultType = Literal["nudge_given", "hint_reshown"]


class NpcRequestModel(BaseModel):
    # 클라이언트가 대사 원문(text 등)을 함께 보내도 받지 않는다.
    model_config = ConfigDict(extra="forbid")


class NpcNudgeRequest(NpcRequestModel):
    client_event_id: str = Field(min_length=1)
    client_timestamp: datetime | None = None
    kind: Literal["nudge"]
    npc_id: str = Field(min_length=1)
    line_id: str = Field(pattern=NUDGE_LINE_ID_PATTERN)
    # 퍼즐 범위 nudge일 때만 보낸다. 대사에 퍼즐이 정해져 있으면 같아야 한다.
    puzzle_id: str | None = None


class NpcHintReshowRequest(NpcRequestModel):
    """이미 해금한 정식 힌트 한 단계의 재표시. 자동 도움 제안 흐름은 이 요청을 만들지 않는다."""

    client_event_id: str = Field(min_length=1)
    client_timestamp: datetime | None = None
    kind: Literal["hint_reshow"]
    npc_id: str = Field(min_length=1)
    puzzle_id: str = Field(min_length=1)
    hint_level: HintLevel
    # 요청 출처(기록용). 인가 근거가 아니며 플레이어가 실제로 눌렀다는 증명도 아니다.
    # "auto_help_offer"는 서비스가 거부한다(자동 도움 제안은 nudge만).
    trigger: str | None = Field(default=None, max_length=32)


NpcRequest = Annotated[
    NpcNudgeRequest | NpcHintReshowRequest, Field(discriminator="kind")
]


class ApprovedNpcLine(BaseModel):
    """주입받는 승인 콘텐츠 한 줄 (게시 형식 · 위치 미정)."""

    line_id: str
    kind: Literal["nudge"]
    text: str
    # G3 검수 승인 여부. False면 내보내지 않는다.
    approved: bool
    # 이 퍼즐에서만 쓰는 대사. None이면 퍼즐과 무관한 일반 nudge.
    puzzle_id: str | None = None
    # 공개 조건(npc.json `reveal_when`). 없거나 판정할 수 없으면 내보내지 않는다.
    reveal_when: dict[str, Any] | None = None


class NpcEventRecord(BaseModel):
    """이벤트 response_json에 저장하는 결과. 대사 · 힌트 원문은 담지 않는다."""

    result_type: NpcResultType
    npc_id: str
    line_id: str | None
    puzzle_id: str | None
    hint_level: int | None
    # NPC는 게임 상태를 바꾸지 않는다. 항상 빈 목록이다.
    state_changes: list[dict[str, object]] = Field(default_factory=list, max_length=0)


class NpcLineText(BaseModel):
    line_id: str
    text: str


class ReshownHint(BaseModel):
    puzzle_id: str
    level: HintLevel
    text: str


class NpcProcessResult(BaseModel):
    npc_event_id: str
    result: NpcEventRecord
    # 일반 NPC 대사 (nudge). 재표시 응답에는 없다.
    line: NpcLineText | None
    # 재표시한 정식 힌트 원문. 대사와 섞지 않는다.
    reshown_hint: ReshownHint | None
