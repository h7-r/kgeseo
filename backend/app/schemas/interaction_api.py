from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.interaction import InteractionStateChange

InteractionAction = Literal[
    "inspect",
    "navigate",
    "input",
    "select",
    "combine_clues",
]
InteractionTargetType = Literal["object", "puzzle", "clue", "zone"]
ExternalInteractionResultType = Literal[
    "ok",
    "correct",
    "incorrect",
    "already_completed",
]


class InteractionApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InteractionRequestBase(InteractionApiModel):
    client_event_id: UUID
    client_timestamp: datetime
    zone_id: str = Field(min_length=1)
    action: InteractionAction
    target_type: InteractionTargetType
    target_id: str | None

    @field_validator("client_timestamp")
    @classmethod
    def validate_timezone_aware(cls, value: datetime) -> datetime:
        if value.utcoffset() is None:
            raise ValueError("client_timestamp must include a timezone offset")
        return value


class EmptyInteractionPayload(InteractionApiModel):
    pass


class InspectInteractionRequest(InteractionRequestBase):
    action: Literal["inspect"]
    payload: EmptyInteractionPayload


class NavigateInteractionRequest(InteractionRequestBase):
    action: Literal["navigate"]
    target_type: Literal["zone"]
    target_id: str = Field(min_length=1)
    payload: EmptyInteractionPayload


class InputInteractionPayload(InteractionApiModel):
    answer: str


class InputInteractionRequest(InteractionRequestBase):
    action: Literal["input"]
    target_type: Literal["object"]
    target_id: str = Field(min_length=1)
    payload: InputInteractionPayload


class SelectInteractionPayload(InteractionApiModel):
    choice: str


class SelectInteractionRequest(InteractionRequestBase):
    action: Literal["select"]
    payload: SelectInteractionPayload


class CombineCluesInteractionPayload(InteractionApiModel):
    clue_ids: list[str] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def validate_distinct_clues(self) -> "CombineCluesInteractionPayload":
        if len(set(self.clue_ids)) != len(self.clue_ids):
            raise ValueError("clue_ids must contain two distinct values")
        return self


class CombineCluesInteractionRequest(InteractionRequestBase):
    action: Literal["combine_clues"]
    target_type: Literal["clue"]
    target_id: None
    payload: CombineCluesInteractionPayload


InteractionApiRequest = Annotated[
    InspectInteractionRequest
    | NavigateInteractionRequest
    | InputInteractionRequest
    | SelectInteractionRequest
    | CombineCluesInteractionRequest,
    Field(discriminator="action"),
]


class InteractionApiResponse(InteractionApiModel):
    interaction_id: UUID
    result_type: ExternalInteractionResultType
    message: str | None
    attempt_count: int | None
    state_changes: list[InteractionStateChange]
    ui_actions: list[dict[str, object]] = Field(default_factory=list)
