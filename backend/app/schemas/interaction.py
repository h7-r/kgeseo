from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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


class SelectChoicePayload(BaseModel):
    choice: str


class SelectChoiceInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["select_choice"]
    # Object가 가리키는 퍼즐 ID. 판정은 submit_answer와 같다(accepted_answers 비교).
    target_id: str
    # 고른 Object. 현재 위치 검사와 유효 visible/enabled 판정에 쓴다.
    zone_id: str = Field(min_length=1)
    object_id: str
    payload: SelectChoicePayload


class CompletePuzzlePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CompletePuzzleInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime
    interaction_type: Literal["complete"]
    # External Object ID: resolve only after replay check, under session lock.
    target_id: str = Field(min_length=1)
    zone_id: str = Field(min_length=1)
    payload: CompletePuzzlePayload


InteractionRequest = (
    SubmitAnswerInteraction
    | CombineCluesInteraction
    | InspectInteraction
    | NavigateInteraction
    | SelectChoiceInteraction
    | CompletePuzzleInteraction
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


class CaseCompletedStateChange(BaseModel):
    """Case 완료 조건을 처음 만족한 상호작용에만 싣는다. 완료 시각은 PlaySession 조회로 읽는다."""

    type: Literal["case_completed"]


class ItemAcquiredStateChange(BaseModel):
    type: Literal["item_acquired"]
    item_id: str


class ItemConsumedStateChange(BaseModel):
    type: Literal["item_consumed"]
    item_id: str


class SceneClearedStateChange(BaseModel):
    """장면 완료 조건(clear_when)을 처음 만족한 상호작용에만 싣는다. Case 완료와는 별개다."""

    type: Literal["scene_cleared"]
    scene_id: str


InteractionStateChange = Annotated[
    PuzzleCompletedStateChange
    | ClueAcquiredStateChange
    | ItemAcquiredStateChange
    | ItemConsumedStateChange
    | ZoneUnlockedStateChange
    | CurrentZoneChangedStateChange
    | HintLevelChangedStateChange
    | FlagUpdatedStateChange
    | ObjectRevealedStateChange
    | ObjectHiddenStateChange
    | ObjectUnlockedStateChange
    | SceneClearedStateChange
    | CaseCompletedStateChange,
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
