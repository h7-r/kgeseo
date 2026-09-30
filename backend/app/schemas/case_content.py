from pydantic import BaseModel, ConfigDict, Field, model_validator


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
