"""나주 로컬 ID ↔ 런타임 ID 대응표(`<case_id>.idmap.json`) 스키마 v0.1 (팀 검토 대기).

NPC 콘텐츠 데이터 계약 v0.4 §11과 PM 초안 `naju-angam-01.idmap.draft.json`(schema
`naju-idmap/0.1-draft`)의 필드를 그대로 따른다. 초안에 없는 필드를 필수로 더하지 않는다.

- 형식만 검사한다. 참조 무결성 · 게시 가능 여부는 `app.services.idmap_validation`이 판정한다.
- 서술용 문자열(`status` · `rules` · `local_source` · `name` · `title` · `note` · `why`)은 내용을 판정에 쓰지 않는다.
  `status`는 정확히 `"published"`일 때만 게시본으로 본다(그 밖은 초안).
- `interaction`은 초안에서 모두 `null`이고 형식이 정해지지 않아 값의 모양을 검사하지 않는다.
"""

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

NonBlank = Annotated[str, StringConstraints(min_length=1)]
Range = Annotated[list[float], Field(min_length=2, max_length=2)]


def _require_text(**values: str | None) -> None:
    for field, value in values.items():
        if value is not None and not value.strip():
            raise ValueError(f"{field} must not be blank")


class IdmapModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class IdmapZone(IdmapModel):
    local: NonBlank
    name: str
    x_m: Range
    z_m: Range
    zone_id: NonBlank

    @model_validator(mode="after")
    def validate_text(self) -> "IdmapZone":
        _require_text(local=self.local, zone_id=self.zone_id)
        return self


class IdmapScene(IdmapModel):
    local: int = Field(strict=True)
    local_complete_signal: str
    note: str
    scene_id: NonBlank
    src_id: NonBlank
    title: str
    # 로컬 구역 · 런타임 구역을 함께 적는다. 둘의 대응은 검증기가 본다.
    zones: list[NonBlank] = Field(min_length=1)
    zone_ids: list[NonBlank] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_text(self) -> "IdmapScene":
        _require_text(scene_id=self.scene_id, src_id=self.src_id)
        return self


class IdmapNavigation(IdmapModel):
    local: NonBlank
    name: str
    # 로컬 구역 코드. 런타임 문 ID는 초안에 없다(navigate는 런타임 Zone ID로 보낸다).
    from_zone: NonBlank = Field(alias="from")
    to_zone: NonBlank = Field(alias="to")
    note: str | None = None


class IdmapBlocker(IdmapModel):
    local: NonBlank
    name: str
    # None이면 런타임 대응이 없다(서버로 보내지 않는다).
    object_id: NonBlank | None
    local_clear: str | None = None
    note: str | None = None


class IdmapObject(IdmapModel):
    # `<인스턴스 묶음 이름>#<번호>` (rules.object_local_key)
    local: NonBlank
    object_id: NonBlank
    scene: int = Field(strict=True)
    zone: NonBlank
    zone_id: NonBlank
    status: NonBlank
    interaction: Any | None
    at_m: Range


class IdmapObjectGroup(IdmapModel):
    local_group: NonBlank
    object_id_base: NonBlank
    note: str


class IdmapPuzzle(IdmapModel):
    # 나주 맵에 호스트가 없으면 None
    local: NonBlank | None
    puzzle_id: NonBlank
    scene_id: NonBlank
    src_id: NonBlank
    status: NonBlank
    title: str
    note: str


class IdmapClue(IdmapModel):
    local: NonBlank | None
    clue_id: NonBlank
    src_id: NonBlank
    puzzle_src_id: NonBlank
    status: NonBlank


class IdmapNotMapped(IdmapModel):
    local: NonBlank
    why: NonBlank


class NajuIdmap(IdmapModel):
    schema_name: NonBlank = Field(alias="schema")
    case_id: NonBlank
    status: NonBlank
    # v0.4 §6 파일 머리 일치 규칙(idmap 포함). 초안에는 없어 선택으로 받고, 게시 검증에서 요구한다.
    content_version: int | None = Field(default=None, ge=1, strict=True)
    content_fingerprint: NonBlank | None = None
    local_source: dict[str, str]
    rules: dict[str, str]
    zones: list[IdmapZone]
    scenes: list[IdmapScene]
    navigation: list[IdmapNavigation]
    blockers: list[IdmapBlocker]
    objects: list[IdmapObject]
    object_groups_without_instances: list[IdmapObjectGroup]
    puzzles: list[IdmapPuzzle]
    clues: list[IdmapClue]
    not_mapped: list[IdmapNotMapped]

    @model_validator(mode="after")
    def validate_text(self) -> "NajuIdmap":
        _require_text(schema=self.schema_name, case_id=self.case_id, status=self.status)
        return self

    @property
    def is_published(self) -> bool:
        return self.status == "published"
