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
    payload: SubmitAnswerPayload


class CombineCluesPayload(BaseModel):
    clue_ids: list[str] = Field(min_length=2, max_length=2)


class CombineCluesInteraction(BaseModel):
    client_event_id: str
    client_timestamp: datetime | None = None
    interaction_type: Literal["combine_clues"]
    payload: CombineCluesPayload


InteractionRequest = SubmitAnswerInteraction | CombineCluesInteraction
InteractionResultType = Literal[
    "correct",
    "incorrect",
    "combined",
    "incorrect_combination",
    "already_completed",
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


class HintLevelChangedStateChange(BaseModel):
    type: Literal["hint_level_changed"]
    puzzle_id: str
    hint_level: int


class FlagUpdatedStateChange(BaseModel):
    type: Literal["flag_updated"]
    flag: str
    value: Any


InteractionStateChange = Annotated[
    PuzzleCompletedStateChange
    | ClueAcquiredStateChange
    | ZoneUnlockedStateChange
    | HintLevelChangedStateChange
    | FlagUpdatedStateChange,
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
