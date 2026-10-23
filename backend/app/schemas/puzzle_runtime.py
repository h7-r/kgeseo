from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


class ObjectStateEffect(BaseModel):
    """Object 하나의 visible/enabled를 바꾸는 효과. 기록한 속성만 바꾼다."""

    model_config = ConfigDict(extra="forbid")

    zone_id: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    visible: StrictBool | None = None
    enabled: StrictBool | None = None

    @model_validator(mode="after")
    def validate_change(self) -> "ObjectStateEffect":
        for field in ("visible", "enabled"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"set_object_states {field} must be a boolean")
        if self.visible is None and self.enabled is None:
            raise ValueError("set_object_states entry must set visible or enabled")
        # enabled true -> false(잠금)는 대응하는 state_change 계약이 없어 지원하지 않는다.
        if self.enabled is False:
            raise ValueError("set_object_states enabled=false is not supported")
        return self


class RuntimeEffect(BaseModel):
    grant_clue_ids: list[str]
    complete_puzzle_ids: list[str] = Field(default_factory=list)
    set_flags: dict[str, bool]
    set_object_states: list[ObjectStateEffect] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_object_targets(self) -> "RuntimeEffect":
        seen: set[tuple[str, str]] = set()
        for effect in self.set_object_states:
            target = (effect.zone_id, effect.object_id)
            if target in seen:
                raise ValueError(
                    f"Duplicate set_object_states target: "
                    f"'{effect.zone_id}' / '{effect.object_id}'"
                )
            seen.add(target)
        return self


class PuzzleDefinition(BaseModel):
    puzzle_id: str
    accepted_answers: list[str] = Field(min_length=1)
    on_correct: RuntimeEffect


class ClueCombinationDefinition(BaseModel):
    combination_id: str
    clue_ids: list[str] = Field(min_length=2, max_length=2)
    on_success: RuntimeEffect


class InspectionDefinition(BaseModel):
    inspect_id: str = Field(min_length=1)
    on_inspect: RuntimeEffect


class PuzzleRuntimeDefinition(BaseModel):
    schema_version: str
    case_id: str
    puzzles: list[PuzzleDefinition]
    clue_combinations: list[ClueCombinationDefinition]
    inspections: list[InspectionDefinition] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_puzzle_ids(self) -> "PuzzleRuntimeDefinition":
        seen_ids: set[str] = set()
        for puzzle in self.puzzles:
            if puzzle.puzzle_id in seen_ids:
                raise ValueError(f"Duplicate puzzle_id: '{puzzle.puzzle_id}'")
            seen_ids.add(puzzle.puzzle_id)
        return self

    @model_validator(mode="after")
    def validate_unique_inspect_ids(self) -> "PuzzleRuntimeDefinition":
        seen_ids: set[str] = set()
        for inspection in self.inspections:
            if inspection.inspect_id in seen_ids:
                raise ValueError(f"Duplicate inspect_id: '{inspection.inspect_id}'")
            seen_ids.add(inspection.inspect_id)
        return self
