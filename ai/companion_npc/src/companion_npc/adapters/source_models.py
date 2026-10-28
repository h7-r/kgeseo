"""backend Case 파일의 스키마를 **그대로 옮긴** 입력 모델.

[왜 backend 를 import 하지 않나]
  contracts/common.py 와 같은 이유 — 실험 환경을 backend 의 Python·DB 설정에 묶지 않는다.
  대신 tests/test_backend_compat.py 가 필드 이름과 검증 결과가 backend 와 같은지 검사한다.

[모르는 key]
  backend 는 client · server 모델 모두 모르는 key 를 거부한다(extra="forbid").
  여기서도 똑같이 거부해, 받아들이는 입력의 범위를 backend 와 맞춘다.
  key 이름에 정답이 섞일 수 있으므로 오류 위치에서 key 이름은 가린다(errors.py).
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


# ── backend/app/schemas/case_content.py ─────────────────────────
class ClientContentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClientMetadata(ClientContentModel):
    pass


class ObjectInteractionDefinition(ClientContentModel):
    type: str = Field(min_length=1)
    target_id: str = Field(min_length=1)


class ObjectDefinition(ClientContentModel):
    object_id: str = Field(min_length=1)
    object_name: str = Field(min_length=1)
    object_type: str = Field(min_length=1)
    asset_key: str | None = None
    visible: bool
    enabled: bool
    interaction: ObjectInteractionDefinition | None = None


class NavigationDefinition(ClientContentModel):
    door_object_id: str = Field(min_length=1)
    target_zone_id: str = Field(min_length=1)


class ZoneDefinition(ClientContentModel):
    zone_id: str = Field(min_length=1)
    zone_name: str = Field(min_length=1)
    zone_type: str = Field(min_length=1)
    description: str
    objects: list[ObjectDefinition]
    navigation: list[NavigationDefinition]
    metadata: ClientMetadata = Field(default_factory=ClientMetadata)

    @model_validator(mode="after")
    def validate_object_references(self) -> "ZoneDefinition":
        object_ids = [item.object_id for item in self.objects]
        if len(object_ids) != len(set(object_ids)):
            raise ValueError("object_id must be unique within a zone")

        if any(item.door_object_id not in object_ids for item in self.navigation):
            raise ValueError("navigation door_object_id must reference a zone object")
        # [backend 와 다른 점] backend 는 navigation 규칙(자기 Zone 금지 · 목적지 / 문 유일 ·
        # 문 Object 의 navigate 선언과 양방향 일치)을 더 검사한다. 테스트 견본 Case 의
        # 돌아오는 문에는 navigate 선언이 없어, 견본과 그 해시에 묶인 실험을 정리하기 전까지
        # 여기서는 옮기지 않는다.
        return self


class CaseClientContent(ClientContentModel):
    case_id: str = Field(min_length=1)
    entry_zone_id: str = Field(min_length=1)
    zones: list[ZoneDefinition]

    @model_validator(mode="after")
    def validate_zone_references(self) -> "CaseClientContent":
        zone_ids = [zone.zone_id for zone in self.zones]
        if len(zone_ids) != len(set(zone_ids)):
            raise ValueError("zone_id must be unique within a case")

        if self.entry_zone_id not in zone_ids:
            raise ValueError("entry_zone_id must reference a case zone")

        if any(
            navigation.target_zone_id not in zone_ids
            for zone in self.zones
            for navigation in zone.navigation
        ):
            raise ValueError("navigation target_zone_id must reference a case zone")
        return self


# ── backend/app/schemas/puzzle_runtime.py ───────────────────────
ClueCarrierKind = Literal["letter", "note", "key", "piece", "mark", "deduction"]


class ServerModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ObjectStateEffect(ServerModel):
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
        if self.enabled is False:
            raise ValueError("set_object_states enabled=false is not supported")
        return self


class RuntimeEffect(ServerModel):
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


class PuzzleDefinition(ServerModel):
    puzzle_id: str
    accepted_answers: list[str] = Field(min_length=1)
    requires_clue_ids: list[str] = Field(default_factory=list)
    on_correct: RuntimeEffect

    @model_validator(mode="after")
    def validate_requirements(self) -> "PuzzleDefinition":
        _validate_required_clue_ids(
            f"Puzzle '{self.puzzle_id}'", self.requires_clue_ids
        )
        return self


class ClueCombinationDefinition(ServerModel):
    combination_id: str
    clue_ids: list[str] = Field(min_length=2, max_length=2)
    on_success: RuntimeEffect


class InspectionDefinition(ServerModel):
    inspect_id: str = Field(min_length=1)
    requires_clue_ids: list[str] = Field(default_factory=list)
    on_inspect: RuntimeEffect
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


class ClueDefinition(ServerModel):
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


class PuzzleRuntimeDefinition(ServerModel):
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
                # backend 는 메시지에 ID 를 넣는다. ID 는 정답이 아니므로 그대로 둔다.
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

        # clues 를 적지 않은 기존 콘텐츠는 단서 정의 없이 ID 만 쓰는 방식을 유지한다.
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
