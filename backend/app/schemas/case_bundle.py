from pydantic import BaseModel, ConfigDict


class CaseBundleModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CaseBundleMetadata(CaseBundleModel):
    pass


class CaseBundleInteraction(CaseBundleModel):
    type: str


class CaseBundleObject(CaseBundleModel):
    object_id: str
    object_name: str
    object_type: str
    asset_key: str | None = None
    visible: bool
    enabled: bool
    interaction: CaseBundleInteraction | None = None


class CaseBundleNavigation(CaseBundleModel):
    door_object_id: str
    target_zone_id: str


class CaseBundleZone(CaseBundleModel):
    zone_id: str
    zone_name: str
    zone_type: str
    description: str
    objects: list[CaseBundleObject]
    navigation: list[CaseBundleNavigation]
    metadata: CaseBundleMetadata


class CaseBundleData(CaseBundleModel):
    case_id: str
    entry_zone_id: str
    zones: list[CaseBundleZone]


class CaseBundleResponse(CaseBundleModel):
    success: bool
    data: CaseBundleData
