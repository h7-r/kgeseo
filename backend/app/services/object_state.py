from dataclasses import dataclass
from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.schemas.case_content import CaseClientContent
from app.schemas.play_session import ObjectStates
from app.services.object_resolver import find_object

_OBJECT_STATES_ADAPTER = TypeAdapter(ObjectStates)


@dataclass(frozen=True)
class EffectiveObjectState:
    zone_id: str
    object_id: str
    visible: bool
    enabled: bool


class ObjectStateError(Exception):
    pass


class InvalidObjectStatesError(ObjectStateError):
    pass


def parse_object_states(object_states: Any) -> ObjectStates:
    """세션 Object 변경값의 형식을 검증하고 입력과 분리된 사본을 반환한다."""

    try:
        return _OBJECT_STATES_ADAPTER.validate_python(object_states)
    except ValidationError as error:
        raise InvalidObjectStatesError(str(error)) from error


def validate_object_state_references(
    client_content: CaseClientContent,
    object_states: Any,
) -> ObjectStates:
    """형식과 함께 모든 (zone_id, object_id)가 콘텐츠에 있는지 검증한다.

    없는 Zone/Object는 Object Resolver의 ZoneNotFoundError/ObjectNotFoundError로 거부한다.
    """

    parsed = parse_object_states(object_states)
    for zone_id, overrides in parsed.items():
        for object_id in overrides:
            find_object(client_content, zone_id, object_id)
    return parsed


def resolve_effective_object_state(
    client_content: CaseClientContent,
    object_states: Any,
    zone_id: str,
    object_id: str,
) -> EffectiveObjectState:
    """콘텐츠 초기값 위에 세션 변경값을 덮어쓴 Object의 최종 상태를 계산한다.

    세션에 기록되지 않은 속성은 콘텐츠 초기값을 따른다.
    """

    parsed = validate_object_state_references(client_content, object_states)
    obj = find_object(client_content, zone_id, object_id)
    override = parsed.get(zone_id, {}).get(object_id, {})
    return EffectiveObjectState(
        zone_id=zone_id,
        object_id=object_id,
        visible=override.get("visible", obj.visible),
        enabled=override.get("enabled", obj.enabled),
    )


def resolve_effective_object_states(
    client_content: CaseClientContent,
    object_states: Any,
) -> dict[tuple[str, str], EffectiveObjectState]:
    """콘텐츠의 모든 Object에 대해 최종 상태를 (zone_id, object_id) 순서대로 계산한다."""

    parsed = validate_object_state_references(client_content, object_states)
    effective: dict[tuple[str, str], EffectiveObjectState] = {}
    for zone in client_content.zones:
        zone_overrides = parsed.get(zone.zone_id, {})
        for obj in zone.objects:
            override = zone_overrides.get(obj.object_id, {})
            effective[(zone.zone_id, obj.object_id)] = EffectiveObjectState(
                zone_id=zone.zone_id,
                object_id=obj.object_id,
                visible=override.get("visible", obj.visible),
                enabled=override.get("enabled", obj.enabled),
            )
    return effective
