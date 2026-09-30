from pydantic import BaseModel, Field, model_validator


class RuntimeEffect(BaseModel):
    grant_clue_ids: list[str]
    complete_puzzle_ids: list[str] = Field(default_factory=list)
    set_flags: dict[str, bool]


class PuzzleDefinition(BaseModel):
    puzzle_id: str
    accepted_answers: list[str] = Field(min_length=1)
    on_correct: RuntimeEffect


class ClueCombinationDefinition(BaseModel):
    combination_id: str
    clue_ids: list[str] = Field(min_length=2, max_length=2)
    on_success: RuntimeEffect


class PuzzleRuntimeDefinition(BaseModel):
    schema_version: str
    case_id: str
    puzzles: list[PuzzleDefinition]
    clue_combinations: list[ClueCombinationDefinition]

    @model_validator(mode="after")
    def validate_unique_puzzle_ids(self) -> "PuzzleRuntimeDefinition":
        seen_ids: set[str] = set()
        for puzzle in self.puzzles:
            if puzzle.puzzle_id in seen_ids:
                raise ValueError(f"Duplicate puzzle_id: '{puzzle.puzzle_id}'")
            seen_ids.add(puzzle.puzzle_id)
        return self
