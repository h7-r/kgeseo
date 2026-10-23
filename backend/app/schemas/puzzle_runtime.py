from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


class ServerContentModel(BaseModel):
    """Server Runtime 콘텐츠 모델. 정의되지 않은 필드는 조용히 버리지 않고 거부한다."""

    model_config = ConfigDict(extra="forbid")


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


class RuntimeEffect(ServerContentModel):
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


def _validate_required_clue_ids(owner: str, clue_ids: list[str]) -> None:
    seen: set[str] = set()
    for clue_id in clue_ids:
        if not clue_id.strip():
            raise ValueError(f"{owner} requires_clue_ids must not contain blank IDs")
        if clue_id in seen:
            raise ValueError(f"{owner} requires_clue_ids has duplicate '{clue_id}'")
        seen.add(clue_id)


class PuzzleDefinition(ServerContentModel):
    puzzle_id: str
    accepted_answers: list[str] = Field(min_length=1)
    # 정답 판정 전에 PlaySession이 모두 획득해야 하는 단서. 비어 있으면 조건 없음.
    requires_clue_ids: list[str] = Field(default_factory=list)
    on_correct: RuntimeEffect

    @model_validator(mode="after")
    def validate_requirements(self) -> "PuzzleDefinition":
        _validate_required_clue_ids(
            f"Puzzle '{self.puzzle_id}'", self.requires_clue_ids
        )
        return self


class ClueCombinationDefinition(ServerContentModel):
    combination_id: str
    clue_ids: list[str] = Field(min_length=2, max_length=2)
    on_success: RuntimeEffect


class InspectionDefinition(ServerContentModel):
    inspect_id: str = Field(min_length=1)
    # 조사 효과 적용 전에 PlaySession이 모두 획득해야 하는 단서. 비어 있으면 조건 없음.
    requires_clue_ids: list[str] = Field(default_factory=list)
    on_inspect: RuntimeEffect

    @model_validator(mode="after")
    def validate_requirements(self) -> "InspectionDefinition":
        _validate_required_clue_ids(
            f"Inspection '{self.inspect_id}'", self.requires_clue_ids
        )
        return self


class ClueDefinition(ServerContentModel):
    """획득한 PlaySession에만 공개하는 단서 표시 정보."""

    clue_id: str = Field(min_length=1)
    title: str
    summary: str | None = None
    body: str | None = None

    @model_validator(mode="after")
    def validate_text(self) -> "ClueDefinition":
        if not self.clue_id.strip():
            raise ValueError("clue_id must not be blank")
        if not self.title.strip():
            raise ValueError(f"Clue '{self.clue_id}' title must not be blank")
        for field in ("summary", "body"):
            value = getattr(self, field)
            if value is not None and not value.strip():
                raise ValueError(
                    f"Clue '{self.clue_id}' {field} must be omitted or not blank"
                )
        return self


class PuzzleRuntimeDefinition(ServerContentModel):
    schema_version: str
    case_id: str
    puzzles: list[PuzzleDefinition]
    clue_combinations: list[ClueCombinationDefinition]
    inspections: list[InspectionDefinition] = Field(default_factory=list)
    clues: list[ClueDefinition] = Field(default_factory=list)

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

    @model_validator(mode="after")
    def validate_clue_references(self) -> "PuzzleRuntimeDefinition":
        seen_ids: set[str] = set()
        for clue in self.clues:
            if clue.clue_id in seen_ids:
                raise ValueError(f"Duplicate clue_id: '{clue.clue_id}'")
            seen_ids.add(clue.clue_id)

        # clues를 명시하지 않은 기존 콘텐츠는 단서 정의 없이 ID만 쓰는 방식을 유지한다.
        if "clues" not in self.model_fields_set:
            return self

        references = [
            (f"Puzzle '{puzzle.puzzle_id}'", puzzle.on_correct.grant_clue_ids)
            for puzzle in self.puzzles
        ]
        for combination in self.clue_combinations:
            owner = f"Clue combination '{combination.combination_id}'"
            references.append((owner, combination.clue_ids))
            references.append((owner, combination.on_success.grant_clue_ids))
        references += [
            (
                f"Inspection '{inspection.inspect_id}'",
                inspection.on_inspect.grant_clue_ids,
            )
            for inspection in self.inspections
        ]
        references += [
            (f"Puzzle '{puzzle.puzzle_id}' requires_clue_ids", puzzle.requires_clue_ids)
            for puzzle in self.puzzles
        ]
        references += [
            (
                f"Inspection '{inspection.inspect_id}' requires_clue_ids",
                inspection.requires_clue_ids,
            )
            for inspection in self.inspections
        ]
        for owner, clue_ids in references:
            for clue_id in clue_ids:
                if clue_id not in seen_ids:
                    raise ValueError(
                        f"{owner} references clue '{clue_id}' not defined in clues"
                    )
        return self
