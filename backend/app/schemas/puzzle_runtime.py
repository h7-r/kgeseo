from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictStr,
    model_validator,
)

from app.schemas.scene_condition import (
    ClearWhenLeaf,
    assess_scene_list,
    parse_clear_when,
)

# 단서 수첩의 아이콘·표시 유형. 정답·선행 조건·상태 판정에는 쓰지 않는다.
ClueCarrierKind = Literal["letter", "note", "key", "piece", "mark", "deduction"]

# 정식 힌트 단계(1 = 힌트 보기, 2 = 정답 보기). app.schemas.hint.HintLevel과 같은 값이다.
# bool · 문자열 · 실수는 받지 않는다.
ServerHintLevel = Annotated[int, Field(strict=True, ge=1, le=2)]


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
    # 손에 넣는 아이템. 단서와 다른 ID 공간이며 acquired_clue_ids에 넣지 않는다.
    grant_item_ids: list[str] = Field(default_factory=list)
    set_flags: dict[str, bool]
    set_object_states: list[ObjectStateEffect] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_grant_item_ids(self) -> "RuntimeEffect":
        _validate_required_ids("Effect", "grant_item_ids", self.grant_item_ids)
        return self

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


def _validate_required_ids(owner: str, field: str, ids: list[str]) -> None:
    seen: set[str] = set()
    for value in ids:
        if not value.strip():
            raise ValueError(f"{owner} {field} must not contain blank IDs")
        if value in seen:
            raise ValueError(f"{owner} {field} has duplicate '{value}'")
        seen.add(value)


def _validate_required_clue_ids(owner: str, clue_ids: list[str]) -> None:
    _validate_required_ids(owner, "requires_clue_ids", clue_ids)


class HintDefinition(ServerContentModel):
    """정식 힌트 한 단계의 원문. 원문은 server.json 한 곳에만 둔다(PM v0.4.2).

    client.json · npc.json에는 원문을 두지 않는다. npc.json은 `{"level": n}` 참조만 갖는다.
    """

    level: ServerHintLevel
    text: str

    @model_validator(mode="after")
    def validate_text(self) -> "HintDefinition":
        # 오류에는 단계만 싣는다(원문 없음).
        if not self.text.strip():
            raise ValueError(f"Hint level {self.level} text must not be blank")
        return self


class PuzzleSolveDefinition(ServerContentModel):
    """Approved v0.4.15 extension. Omitted solve retains answer grading."""

    mode: Literal["client_skill"]


class PuzzleDefinition(ServerContentModel):
    puzzle_id: str
    solve: PuzzleSolveDefinition | None = None
    accepted_answers: list[str] = Field(default_factory=list)
    # 정답 판정 전에 PlaySession이 모두 획득해야 하는 단서. 비어 있으면 조건 없음.
    requires_clue_ids: list[str] = Field(default_factory=list)
    # 정답 판정 전에 PlaySession이 모두 완료해야 하는 퍼즐. 비어 있으면 조건 없음.
    requires_puzzle_ids: list[str] = Field(default_factory=list)
    # 정답일 때 소비하는 아이템. 정답 판정 전에 모두 보유(획득 · 미소비)해야 한다. 비어 있으면 조건 없음.
    consumes_item_ids: list[str] = Field(default_factory=list)
    on_correct: RuntimeEffect
    # 정식 힌트 원문. 비어 있으면 이 퍼즐에는 힌트가 없다(Hint API는 HintNotFoundError).
    hints: list[HintDefinition] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_requirements(self) -> "PuzzleDefinition":
        owner = f"Puzzle '{self.puzzle_id}'"
        if self.solve is None and not self.accepted_answers:
            raise ValueError(f"{owner} requires accepted_answers for answer grading")
        if self.solve is not None and self.accepted_answers:
            raise ValueError(f"{owner} client_skill must not define accepted_answers")
        _validate_required_clue_ids(owner, self.requires_clue_ids)
        _validate_required_ids(owner, "requires_puzzle_ids", self.requires_puzzle_ids)
        if self.puzzle_id in self.requires_puzzle_ids:
            raise ValueError(f"{owner} must not require itself")
        _validate_required_ids(owner, "consumes_item_ids", self.consumes_item_ids)
        if set(self.consumes_item_ids) & set(self.on_correct.grant_item_ids):
            raise ValueError(f"{owner} must not grant an item it consumes")
        levels = [hint.level for hint in self.hints]
        if len(levels) != len(set(levels)):
            raise ValueError(f"Puzzle '{self.puzzle_id}' has duplicate hint levels")
        # 힌트는 한 단계씩만 해금되므로(Hint API), 1단계 없는 2단계는 열 수 없다.
        if 2 in levels and 1 not in levels:
            raise ValueError(f"Puzzle '{self.puzzle_id}' hint level 2 requires level 1")
        return self

    def hint_text(self, level: int) -> str | None:
        return next((hint.text for hint in self.hints if hint.level == level), None)


class ClueCombinationDefinition(ServerContentModel):
    combination_id: str
    clue_ids: list[str] = Field(min_length=2, max_length=2)
    on_success: RuntimeEffect


class InspectionDefinition(ServerContentModel):
    inspect_id: str = Field(min_length=1)
    # 조사 효과 적용 전에 PlaySession이 모두 획득해야 하는 단서. 비어 있으면 조건 없음.
    requires_clue_ids: list[str] = Field(default_factory=list)
    on_inspect: RuntimeEffect
    # 조사에 처음 성공한 응답에만 싣는 표시 문구. 정답 판정·단서 조건에는 쓰지 않는다.
    message: str | None = None

    @model_validator(mode="after")
    def validate_requirements(self) -> "InspectionDefinition":
        _validate_required_clue_ids(
            f"Inspection '{self.inspect_id}'", self.requires_clue_ids
        )
        if self.message is not None and not self.message.strip():
            raise ValueError(
                f"Inspection '{self.inspect_id}' message must be omitted or not blank"
            )
        return self


class ClueDefinition(ServerContentModel):
    """획득한 PlaySession에만 공개하는 단서 표시 정보."""

    clue_id: str = Field(min_length=1)
    title: str
    summary: str | None = None
    body: str | None = None
    carrier_kind: ClueCarrierKind | None = None

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


class CaseCompletionDefinition(ServerContentModel):
    """Case 완료 조건. 나열한 퍼즐을 모두 완료하면 서버가 PlaySession을 완료로 기록한다."""

    requires_puzzle_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_requirements(self) -> "CaseCompletionDefinition":
        _validate_required_ids(
            "case_completion", "requires_puzzle_ids", self.requires_puzzle_ids
        )
        return self


class SceneDefinition(ServerContentModel):
    """장면 하나와 완료 조건. 조건 문법 · 참조 검사는 PuzzleRuntimeDefinition이 한꺼번에 한다."""

    scene_id: StrictStr
    clear_when: dict[str, Any]

    @property
    def clear_when_leaves(self) -> tuple[ClearWhenLeaf, ...]:
        # 모델 검증에서 이미 통과한 조건이라 여기서는 실패하지 않는다.
        return parse_clear_when(self.clear_when)


class PuzzleRuntimeDefinition(ServerContentModel):
    schema_version: str
    case_id: str
    puzzles: list[PuzzleDefinition]
    clue_combinations: list[ClueCombinationDefinition]
    inspections: list[InspectionDefinition] = Field(default_factory=list)
    clues: list[ClueDefinition] = Field(default_factory=list)
    # 없으면 Case 완료를 판정하지 않는다(completed_at을 기록하지 않음).
    case_completion: CaseCompletionDefinition | None = None
    # 장면 완료 조건. 없으면 장면 완료를 판정하지 않는다. 게시 게이트와 같은 규칙으로 검사해
    # 게이트가 PASS로 판정하는 장면만 받는다(미지원 조건 · 잘못된 참조는 콘텐츠 오류).
    scenes: list[SceneDefinition] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_scenes(self) -> "PuzzleRuntimeDefinition":
        assessment = assess_scene_list(
            [scene.model_dump() for scene in self.scenes],
            (puzzle.puzzle_id for puzzle in self.puzzles),
            settable_flags(self),
        )
        if assessment.status != "PASS":
            raise ValueError(
                f"scenes {assessment.status}: {', '.join(assessment.reasons)}"
            )
        return self

    @model_validator(mode="after")
    def validate_unique_puzzle_ids(self) -> "PuzzleRuntimeDefinition":
        seen_ids: set[str] = set()
        for puzzle in self.puzzles:
            if puzzle.puzzle_id in seen_ids:
                raise ValueError(f"Duplicate puzzle_id: '{puzzle.puzzle_id}'")
            seen_ids.add(puzzle.puzzle_id)
        return self

    @model_validator(mode="after")
    def validate_puzzle_references(self) -> "PuzzleRuntimeDefinition":
        puzzle_ids = {puzzle.puzzle_id for puzzle in self.puzzles}
        references = [
            (f"Puzzle '{puzzle.puzzle_id}'", puzzle.requires_puzzle_ids)
            for puzzle in self.puzzles
        ]
        if self.case_completion is not None:
            references.append(
                ("case_completion", self.case_completion.requires_puzzle_ids)
            )
        for owner, required_ids in references:
            for puzzle_id in required_ids:
                if puzzle_id not in puzzle_ids:
                    raise ValueError(f"{owner} requires unknown puzzle '{puzzle_id}'")

        # 선행 퍼즐이 순환하면 그 퍼즐들은 영영 풀 수 없다.
        requires = {p.puzzle_id: p.requires_puzzle_ids for p in self.puzzles}
        checked: set[str] = set()

        def visit(puzzle_id: str, path: list[str]) -> None:
            if puzzle_id in path:
                cycle = " -> ".join([*path[path.index(puzzle_id) :], puzzle_id])
                raise ValueError(f"requires_puzzle_ids has a cycle: {cycle}")
            if puzzle_id in checked:
                return
            for required_id in requires[puzzle_id]:
                visit(required_id, [*path, puzzle_id])
            checked.add(puzzle_id)

        for puzzle_id in requires:
            visit(puzzle_id, [])
        return self

    @model_validator(mode="after")
    def validate_item_references(self) -> "PuzzleRuntimeDefinition":
        # 어떤 효과도 주지 않는 아이템을 소비하는 퍼즐은 영영 풀 수 없다.
        effects = [puzzle.on_correct for puzzle in self.puzzles]
        effects += [combination.on_success for combination in self.clue_combinations]
        effects += [inspection.on_inspect for inspection in self.inspections]
        granted = {item_id for effect in effects for item_id in effect.grant_item_ids}
        for puzzle in self.puzzles:
            for item_id in puzzle.consumes_item_ids:
                if item_id not in granted:
                    raise ValueError(
                        f"Puzzle '{puzzle.puzzle_id}' consumes item '{item_id}' "
                        "that no effect grants"
                    )
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


def settable_flags(server: PuzzleRuntimeDefinition) -> set[tuple[str, bool]]:
    """어떤 효과의 set_flags가 설정하는 (flag, 값) 쌍. clear_when flag 참조는 이 안에 있어야 한다."""

    effects = [puzzle.on_correct for puzzle in server.puzzles]
    effects += [combination.on_success for combination in server.clue_combinations]
    effects += [inspection.on_inspect for inspection in server.inspections]
    return {
        (name, value) for effect in effects for name, value in effect.set_flags.items()
    }
