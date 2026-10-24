"""backend Case 파일의 스키마를 **그대로 옮긴** 입력 모델.

[왜 backend 를 import 하지 않나]
  contracts/common.py 와 같은 이유 — 실험 환경을 backend 의 Python·DB 설정에 묶지 않는다.
  대신 tests/test_backend_compat.py 가 필드 이름과 검증 결과가 backend 와 같은지 검사한다.

[원본과 다른 점 하나]
  backend 의 server 쪽 모델은 모르는 key 를 조용히 버린다(pydantic 기본값 ignore).
  여기서는 allow 로 받아 두되 **값은 읽지 않고 key 이름만** 보고서에 적는다.
  받아들이는 입력의 범위는 backend 와 같다.
"""

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
class ServerModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class RuntimeEffect(ServerModel):
    grant_clue_ids: list[str]
    complete_puzzle_ids: list[str] = Field(default_factory=list)
    set_flags: dict[str, bool]


class PuzzleDefinition(ServerModel):
    puzzle_id: str
    accepted_answers: list[str] = Field(min_length=1)
    on_correct: RuntimeEffect


class ClueCombinationDefinition(ServerModel):
    combination_id: str
    clue_ids: list[str] = Field(min_length=2, max_length=2)
    on_success: RuntimeEffect


class PuzzleRuntimeDefinition(ServerModel):
    schema_version: str
    case_id: str
    puzzles: list[PuzzleDefinition]
    clue_combinations: list[ClueCombinationDefinition]

    @model_validator(mode="after")
    def validate_unique_puzzle_ids(self) -> "PuzzleRuntimeDefinition":
        seen_ids: set[str] = set()
        for puzzle in self.puzzles:
            if puzzle.puzzle_id in seen_ids:
                # backend 는 메시지에 ID 를 넣는다. ID 는 정답이 아니므로 그대로 둔다.
                raise ValueError(f"Duplicate puzzle_id: '{puzzle.puzzle_id}'")
            seen_ids.add(puzzle.puzzle_id)
        return self


def extra_field_paths(model: BaseModel, prefix: str = "") -> list[str]:
    """server 모델에 들어온 모르는 key 의 위치. 값은 돌려주지 않는다."""

    paths = [f"{prefix}{key}" for key in sorted(model.model_extra or {})]
    for name in type(model).model_fields:
        value = getattr(model, name)
        items = value if isinstance(value, list) else [value]
        for index, item in enumerate(items):
            if isinstance(item, BaseModel):
                step = f"{name}[{index}]" if isinstance(value, list) else name
                paths += extra_field_paths(item, f"{prefix}{step}.")
    return paths
