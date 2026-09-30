from app.schemas.case_bundle import (
    CaseBundleData,
    CaseBundleInteraction,
    CaseBundleMetadata,
    CaseBundleNavigation,
    CaseBundleObject,
    CaseBundleZone,
)
from app.schemas.case_content import CaseClientContent
from app.services.case_content import load_case_client_content
from app.services.case_content_validation import validate_case_content_links
from app.services.puzzle_runtime import load_case_runtime


def get_case_bundle(case_id: str) -> CaseBundleData:
    client_content = load_case_client_content(case_id)
    server_runtime = load_case_runtime(case_id)
    validate_case_content_links(client_content, server_runtime)
    return _build_public_bundle(client_content)


def _build_public_bundle(client_content: CaseClientContent) -> CaseBundleData:
    return CaseBundleData(
        case_id=client_content.case_id,
        entry_zone_id=client_content.entry_zone_id,
        zones=[
            CaseBundleZone(
                zone_id=zone.zone_id,
                zone_name=zone.zone_name,
                zone_type=zone.zone_type,
                description=zone.description,
                objects=[
                    CaseBundleObject(
                        object_id=obj.object_id,
                        object_name=obj.object_name,
                        object_type=obj.object_type,
                        asset_key=obj.asset_key,
                        visible=obj.visible,
                        enabled=obj.enabled,
                        interaction=(
                            CaseBundleInteraction(type=obj.interaction.type)
                            if obj.interaction is not None
                            else None
                        ),
                    )
                    for obj in zone.objects
                ],
                navigation=[
                    CaseBundleNavigation(
                        door_object_id=navigation.door_object_id,
                        target_zone_id=navigation.target_zone_id,
                    )
                    for navigation in zone.navigation
                ],
                metadata=CaseBundleMetadata(),
            )
            for zone in client_content.zones
        ],
    )
