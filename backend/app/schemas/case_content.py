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

        if any(item.target_zone_id == self.zone_id for item in self.navigation):
            raise ValueError("navigation target_zone_id must not be its own zone")

        # navigate 요청은 목적지 Zone으로 문을 찾으므로 Zone 안에서 목적지가 유일해야 한다.
        target_zone_ids = [item.target_zone_id for item in self.navigation]
        if len(target_zone_ids) != len(set(target_zone_ids)):
            raise ValueError("navigation target_zone_id must be unique within a zone")

        door_object_ids = [item.door_object_id for item in self.navigation]
        if len(door_object_ids) != len(set(door_object_ids)):
            raise ValueError("navigation door_object_id must be unique within a zone")

        # 문 Object의 navigate 선언과 navigation[] 연결은 양방향으로 일치해야 한다.
        navigation_targets = {
            item.door_object_id: item.target_zone_id for item in self.navigation
        }
        for obj in self.objects:
            interaction = obj.interaction
            is_navigate = interaction is not None and interaction.type == "navigate"
            if obj.object_id in navigation_targets:
                if (
                    not is_navigate
                    or interaction.target_id != navigation_targets[obj.object_id]
                ):
                    raise ValueError(
                        "navigation door object must declare a matching "
                        "navigate interaction"
                    )
            elif is_navigate:
                raise ValueError(
                    "navigate interaction object must be registered in navigation"
                )
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
