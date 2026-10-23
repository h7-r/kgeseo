from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.schemas.play_session import PlaySessionState


class SubmitAnswerPayload(BaseModel):
    answer: str


class SubmitAnswerInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["submit_answer"]
    target_id: str
    # 요청한 Object가 있는 Zone. 현재 위치 검사에 쓰므로 생략할 수 없다.
    zone_id: str = Field(min_length=1)
    payload: SubmitAnswerPayload


class CombineCluesPayload(BaseModel):
    clue_ids: list[str] = Field(min_length=2, max_length=2)


class CombineCluesInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["combine_clues"]
    payload: CombineCluesPayload


class InspectPayload(BaseModel):
    pass


class InspectInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["inspect"]
    # Server Runtime의 inspect_id
    target_id: str
    # 조사한 Object. 현재 위치 검사와 유효 visible/enabled 판정에 쓴다.
    zone_id: str = Field(min_length=1)
    object_id: str
    payload: InspectPayload


class NavigatePayload(BaseModel):
    pass


class NavigateInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["navigate"]
    # 목적지 Zone ID
    target_id: str = Field(min_length=1)
    # 출발 Zone ID. 서버의 현재 위치와 같아야 한다.
    zone_id: str = Field(min_length=1)
    payload: NavigatePayload


InteractionRequest = (
    SubmitAnswerInteraction
    | CombineCluesInteraction
    | InspectInteraction
    | NavigateInteraction
)
InteractionResultType = Literal[
    "correct",
    "incorrect",
    "combined",
    "incorrect_combination",
    "already_completed",
    "inspected",
    "already_inspected",
    "navigated",
]


class PuzzleCompletedStateChange(BaseModel):
    type: Literal["puzzle_completed"]
    puzzle_id: str


class ClueAcquiredStateChange(BaseModel):
    type: Literal["clue_acquired"]
    clue_id: str


class ZoneUnlockedStateChange(BaseModel):
    type: Literal["zone_unlocked"]
    zone_id: str


class CurrentZoneChangedStateChange(BaseModel):
    type: Literal["current_zone_changed"]
    zone_id: str


class HintLevelChangedStateChange(BaseModel):
    type: Literal["hint_level_changed"]
    puzzle_id: str
    hint_level: int


class FlagUpdatedStateChange(BaseModel):
    type: Literal["flag_updated"]
    flag: str
    value: Any


class ObjectRevealedStateChange(BaseModel):
    type: Literal["object_revealed"]
    zone_id: str
    object_id: str


class ObjectHiddenStateChange(BaseModel):
    type: Literal["object_hidden"]
    zone_id: str
    object_id: str


class ObjectUnlockedStateChange(BaseModel):
    type: Literal["object_unlocked"]
    zone_id: str
    object_id: str


InteractionStateChange = Annotated[
    PuzzleCompletedStateChange
    | ClueAcquiredStateChange
    | ZoneUnlockedStateChange
    | CurrentZoneChangedStateChange
    | HintLevelChangedStateChange
    | FlagUpdatedStateChange
    | ObjectRevealedStateChange
    | ObjectHiddenStateChange
    | ObjectUnlockedStateChange,
    Field(discriminator="type"),
]


class InteractionResult(BaseModel):
    result_type: InteractionResultType
    state: PlaySessionState
    state_changes: list[InteractionStateChange] = Field(default_factory=list)
    message: str | None = None
    attempt_count: int | None = None
    ui_actions: list[dict[str, object]] = Field(default_factory=list)


class InteractionProcessResult(BaseModel):
    interaction_id: str
    result: InteractionResult
