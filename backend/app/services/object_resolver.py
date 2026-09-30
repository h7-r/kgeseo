from dataclasses import dataclass

from app.schemas.case_content import CaseClientContent


@dataclass(frozen=True)
class ResolvedObjectInteraction:
    zone_id: str
    object_id: str
    interaction_type: str
    target_id: str


class ObjectResolverError(Exception):
    pass


class ZoneNotFoundError(ObjectResolverError):
    pass


class ObjectNotFoundError(ObjectResolverError):
    pass


class ObjectInteractionNotFoundError(ObjectResolverError):
    pass


class InteractionTypeMismatchError(ObjectResolverError):
    pass


class UnsupportedObjectInteractionTypeError(ObjectResolverError):
    pass


def resolve_object_interaction(
    client_content: CaseClientContent,
    zone_id: str,
    object_id: str,
    interaction_type: str,
) -> ResolvedObjectInteraction:
    if interaction_type == "combine_clues":
        raise UnsupportedObjectInteractionTypeError(
            "combine_clues does not resolve through an Object."
        )

    zone = next(
        (zone for zone in client_content.zones if zone.zone_id == zone_id), None
    )
    if zone is None:
        raise ZoneNotFoundError(f"Zone '{zone_id}' not found.")

    obj = next((obj for obj in zone.objects if obj.object_id == object_id), None)
    if obj is None:
        raise ObjectNotFoundError(
            f"Object '{object_id}' not found in Zone '{zone_id}'."
        )

    interaction = obj.interaction
    if interaction is None:
        raise ObjectInteractionNotFoundError(
            f"Object '{object_id}' in Zone '{zone_id}' has no interaction."
        )
    if interaction.type != interaction_type:
        raise InteractionTypeMismatchError(
            f"Object '{object_id}' in Zone '{zone_id}' declares interaction "
            f"'{interaction.type}', not '{interaction_type}'."
        )

    return ResolvedObjectInteraction(
        zone_id=zone.zone_id,
        object_id=obj.object_id,
        interaction_type=interaction.type,
        target_id=interaction.target_id,
    )
