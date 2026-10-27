import asyncio
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.schemas.interaction import (
    ClueAcquiredStateChange,
    CombineCluesInteraction,
    CurrentZoneChangedStateChange,
    FlagUpdatedStateChange,
    InspectInteraction,
    InteractionProcessResult,
    InteractionRequest,
    InteractionResult,
    InteractionResultType,
    InteractionStateChange,
    NavigateInteraction,
    ObjectHiddenStateChange,
    ObjectRevealedStateChange,
    ObjectUnlockedStateChange,
    PuzzleCompletedStateChange,
    SubmitAnswerInteraction,
)
from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, RuntimeEffect
from app.services.case_content import load_case_client_content
from app.services.case_content_validation import validate_case_content_links
from app.services.object_resolver import ZoneNotFoundError, find_zone
from app.services.object_state import resolve_effective_object_state
from app.services.pinned_content import ensure_loaders_match_session
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import load_case_runtime, normalize_answer

RuntimeLoader = Callable[[str], PuzzleRuntimeDefinition]
ClientContentLoader = Callable[[str], CaseClientContent]


class InteractionServiceError(Exception):
    pass


class PuzzleNotFoundError(InteractionServiceError):
    pass


class ClueNotAcquiredError(InteractionServiceError):
    pass


class IdempotencyConflictError(InteractionServiceError):
    pass


class InspectionNotFoundError(InteractionServiceError):
    pass


class ObjectNotVisibleError(InteractionServiceError):
    pass


class ObjectNotEnabledError(InteractionServiceError):
    pass


class ZoneNotCurrentError(InteractionServiceError):
    pass


class CurrentZoneUnknownError(InteractionServiceError):
    pass


class NavigationUnavailableError(InteractionServiceError):
    pass


class RequiredCluesMissingError(InteractionServiceError):
    """선행 단서가 부족하다. 외부에는 부족한 개수만 알리고 단서 ID는 알리지 않는다."""

    def __init__(self, missing_clue_count: int) -> None:
        self.missing_clue_count = missing_clue_count
        super().__init__(missing_clue_count)


async def process_interaction(
    db: AsyncSession,
    play_session_id: str,
    interaction: InteractionRequest,
    *,
    runtime_loader: RuntimeLoader = load_case_runtime,
    client_content_loader: ClientContentLoader = load_case_client_content,
) -> InteractionProcessResult:
    target_id, payload_json = _request_values(interaction)
    try:
        play_session = await _get_play_session_for_update(db, play_session_id)
        if play_session is None:
            raise PlaySessionNotFoundError()

        # 버전 고정 세션은 그 버전 묶음의 로더로만 처리한다(기본 로더로 바꾸지 않는다).
        # 재전송도 같은 규칙이다. 이 검사는 콘텐츠를 읽지 않으므로 재전송은 여전히 판정 없이 응답만 돌려준다.
        ensure_loaders_match_session(
            play_session, runtime_loader, client_content_loader
        )

        existing_event = await _find_interaction_event(
            db, play_session_id, interaction.client_event_id
        )

        if existing_event is not None:
            result = _replay_existing_event(
                existing_event,
                interaction_type=interaction.interaction_type,
                target_id=target_id,
                payload_json=payload_json,
            )
            await db.rollback()
            return result

        runtime = runtime_loader(play_session.case_id)
        current_state = deepcopy(play_session.state_json)
        loaded_client_content: list[CaseClientContent] = []

        # Object 상태가 필요할 때만 Client Content를 읽고 교차 검증한다.
        def load_client_content() -> CaseClientContent:
            if not loaded_client_content:
                client_content = client_content_loader(play_session.case_id)
                validate_case_content_links(client_content, runtime)
                loaded_client_content.append(client_content)
            return loaded_client_content[0]

        message = None
        if isinstance(interaction, SubmitAnswerInteraction):
            (
                result_type,
                result_state,
                state_changes,
                attempt_count,
            ) = _process_submit_answer(
                interaction,
                _ensure_current_zone(
                    current_state, interaction.zone_id, load_client_content
                ),
                runtime,
                load_client_content,
            )
        elif isinstance(interaction, InspectInteraction):
            result_type, result_state, state_changes, message = _process_inspect(
                interaction,
                _ensure_current_zone(
                    current_state, interaction.zone_id, load_client_content
                ),
                runtime,
                load_client_content,
            )
            attempt_count = None
        elif isinstance(interaction, NavigateInteraction):
            result_type, result_state, state_changes = _process_navigate(
                interaction,
                _ensure_current_zone(
                    current_state, interaction.zone_id, load_client_content
                ),
                load_client_content,
            )
            attempt_count = None
        else:
            result_type, result_state, state_changes = _process_combine_clues(
                interaction,
                current_state,
                runtime,
                load_client_content,
            )
            attempt_count = None

        response = InteractionResult(
            result_type=result_type,
            state=PlaySessionState.model_validate(result_state),
            state_changes=state_changes,
            message=message,
            attempt_count=attempt_count,
            ui_actions=[],
        )
        now_db = datetime.now(timezone.utc).replace(tzinfo=None)
        interaction_id = str(uuid4())

        if result_state != current_state:
            play_session.state_json = result_state
            play_session.updated_at = now_db

        interaction_event = InteractionEvent(
            id=interaction_id,
            play_session_id=play_session_id,
            client_event_id=interaction.client_event_id,
            client_timestamp=_to_db_datetime(interaction.client_timestamp),
            interaction_type=interaction.interaction_type,
            target_id=target_id,
            payload_json=payload_json,
            result_type=result_type,
            response_json=response.model_dump(mode="json"),
            created_at=now_db,
        )
        db.add(interaction_event)

        try:
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            existing_event = await _find_interaction_event(
                db, play_session_id, interaction.client_event_id
            )
            if existing_event is None:
                raise error
            result = _replay_existing_event(
                existing_event,
                interaction_type=interaction.interaction_type,
                target_id=target_id,
                payload_json=payload_json,
            )
            await db.rollback()
            return result
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    return InteractionProcessResult(
        interaction_id=interaction_id,
        result=response,
    )


async def _get_play_session_for_update(
    db: AsyncSession,
    play_session_id: str,
) -> PlaySession | None:
    return await db.get(
        PlaySession,
        play_session_id,
        with_for_update=True,
        populate_existing=True,
    )


def apply_runtime_effect(
    state: dict[str, Any],
    effect: RuntimeEffect,
    *,
    complete_puzzle_ids: list[str] | None = None,
    client_content: CaseClientContent | None = None,
) -> tuple[dict[str, Any], list[InteractionStateChange]]:
    updated_state = deepcopy(state)
    state_changes: list[InteractionStateChange] = []

    puzzle_ids = [*(complete_puzzle_ids or []), *effect.complete_puzzle_ids]
    for puzzle_id in puzzle_ids:
        if puzzle_id not in updated_state["completed_puzzle_ids"]:
            updated_state["completed_puzzle_ids"].append(puzzle_id)
            state_changes.append(
                PuzzleCompletedStateChange(
                    type="puzzle_completed",
                    puzzle_id=puzzle_id,
                ),
            )

    for clue_id in effect.grant_clue_ids:
        if clue_id not in updated_state["acquired_clue_ids"]:
            updated_state["acquired_clue_ids"].append(clue_id)
            state_changes.append(
                ClueAcquiredStateChange(
                    type="clue_acquired",
                    clue_id=clue_id,
                ),
            )

    for flag_id, value in effect.set_flags.items():
        if updated_state["flags"].get(flag_id) != value:
            updated_state["flags"][flag_id] = value
            state_changes.append(
                FlagUpdatedStateChange(
                    type="flag_updated",
                    flag=flag_id,
                    value=value,
                ),
            )

    if effect.set_object_states:
        if client_content is None:
            raise ValueError("client_content is required for set_object_states")
        state_changes.extend(
            _apply_object_state_effects(updated_state, effect, client_content)
        )

    return updated_state, state_changes


def _apply_object_state_effects(
    state: dict[str, Any],
    effect: RuntimeEffect,
    client_content: CaseClientContent,
) -> list[InteractionStateChange]:
    """콘텐츠 초기값과 세션 변경값을 합친 최종 상태와 다를 때만 기록하고 알린다."""

    state_changes: list[InteractionStateChange] = []
    for object_effect in effect.set_object_states:
        zone_id = object_effect.zone_id
        object_id = object_effect.object_id
        current = resolve_effective_object_state(
            client_content,
            state.get("object_states", {}),
            zone_id,
            object_id,
        )

        def record(field: str, value: bool) -> None:
            overrides = (
                state.setdefault("object_states", {})
                .setdefault(zone_id, {})
                .setdefault(object_id, {})
            )
            overrides[field] = value

        if (
            object_effect.visible is not None
            and object_effect.visible != current.visible
        ):
            record("visible", object_effect.visible)
            if object_effect.visible:
                state_changes.append(
                    ObjectRevealedStateChange(
                        type="object_revealed",
                        zone_id=zone_id,
                        object_id=object_id,
                    ),
                )
            else:
                state_changes.append(
                    ObjectHiddenStateChange(
                        type="object_hidden",
                        zone_id=zone_id,
                        object_id=object_id,
                    ),
                )

        if (
            object_effect.enabled is not None
            and object_effect.enabled != current.enabled
        ):
            # enabled=false는 RuntimeEffect 스키마에서 거부되므로 여기서는 잠금 해제만 온다.
            if not object_effect.enabled:
                raise ValueError("set_object_states enabled=false is not supported")
            record("enabled", True)
            state_changes.append(
                ObjectUnlockedStateChange(
                    type="object_unlocked",
                    zone_id=zone_id,
                    object_id=object_id,
                ),
            )

    return state_changes


def _process_submit_answer(
    interaction: SubmitAnswerInteraction,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
    load_client_content: Callable[[], CaseClientContent],
) -> tuple[
    InteractionResultType,
    dict[str, Any],
    list[InteractionStateChange],
    int | None,
]:
    puzzle = next(
        (
            puzzle
            for puzzle in runtime.puzzles
            if puzzle.puzzle_id == interaction.target_id
        ),
        None,
    )
    if puzzle is None:
        raise PuzzleNotFoundError(interaction.target_id)

    if interaction.target_id in state["completed_puzzle_ids"]:
        attempt_count = state.get("attempt_counts", {}).get(interaction.target_id)
        return "already_completed", state, [], attempt_count

    # 정답 비교·시도 횟수 증가 전에 판정해 정답 여부가 드러나지 않게 한다.
    _ensure_required_clues(puzzle.requires_clue_ids, state)

    graded_state = deepcopy(state)
    attempt_counts = graded_state.setdefault("attempt_counts", {})
    attempt_count = attempt_counts.get(interaction.target_id, 0) + 1
    attempt_counts[interaction.target_id] = attempt_count

    normalized_answer = normalize_answer(interaction.payload.answer)
    accepted_answers = {normalize_answer(answer) for answer in puzzle.accepted_answers}
    if normalized_answer not in accepted_answers:
        return "incorrect", graded_state, [], attempt_count

    updated_state, state_changes = apply_runtime_effect(
        graded_state,
        puzzle.on_correct,
        complete_puzzle_ids=[interaction.target_id],
        client_content=(
            load_client_content() if puzzle.on_correct.set_object_states else None
        ),
    )
    return "correct", updated_state, state_changes, attempt_count


def _process_combine_clues(
    interaction: CombineCluesInteraction,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
    load_client_content: Callable[[], CaseClientContent],
) -> tuple[
    InteractionResultType,
    dict[str, Any],
    list[InteractionStateChange],
]:
    clue_ids = interaction.payload.clue_ids
    if any(clue_id not in state["acquired_clue_ids"] for clue_id in clue_ids):
        raise ClueNotAcquiredError()

    combination = next(
        (
            combination
            for combination in runtime.clue_combinations
            if sorted(combination.clue_ids) == sorted(clue_ids)
        ),
        None,
    )
    if combination is None:
        return "incorrect_combination", state, []

    updated_state, state_changes = apply_runtime_effect(
        state,
        combination.on_success,
        client_content=(
            load_client_content() if combination.on_success.set_object_states else None
        ),
    )
    return "combined", updated_state, state_changes


def _process_inspect(
    interaction: InspectInteraction,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
    load_client_content: Callable[[], CaseClientContent],
) -> tuple[
    InteractionResultType,
    dict[str, Any],
    list[InteractionStateChange],
    str | None,
]:
    inspection = next(
        (
            inspection
            for inspection in runtime.inspections
            if inspection.inspect_id == interaction.target_id
        ),
        None,
    )
    if inspection is None:
        raise InspectionNotFoundError(interaction.target_id)

    # 효과를 이미 적용한 조사는 지금 숨김·비활성이어도 오류 없이 변화 없음으로 응답한다.
    # 조사를 다시 수행하지 않으므로 문구도 싣지 않는다(첫 성공 응답은 같은 이벤트 재전송으로 재현).
    if interaction.target_id in state.get("completed_inspect_ids", []):
        return "already_inspected", state, [], None

    client_content = load_client_content()
    current = resolve_effective_object_state(
        client_content,
        state.get("object_states", {}),
        interaction.zone_id,
        interaction.object_id,
    )
    if not current.visible:
        raise ObjectNotVisibleError(interaction.object_id)
    if not current.enabled:
        raise ObjectNotEnabledError(interaction.object_id)
    _ensure_required_clues(inspection.requires_clue_ids, state)

    updated_state, state_changes = apply_runtime_effect(
        state,
        inspection.on_inspect,
        client_content=client_content,
    )
    updated_state.setdefault("completed_inspect_ids", []).append(interaction.target_id)
    return "inspected", updated_state, state_changes, inspection.message


def _process_navigate(
    interaction: NavigateInteraction,
    state: dict[str, Any],
    load_client_content: Callable[[], CaseClientContent],
) -> tuple[
    InteractionResultType,
    dict[str, Any],
    list[InteractionStateChange],
]:
    client_content = load_client_content()
    zone = find_zone(client_content, interaction.zone_id)
    find_zone(client_content, interaction.target_id)

    # 콘텐츠 검증으로 Zone 안의 목적지가 유일하므로 문은 최대 하나다.
    navigation = next(
        (
            navigation
            for navigation in zone.navigation
            if navigation.target_zone_id == interaction.target_id
        ),
        None,
    )
    if navigation is None:
        raise NavigationUnavailableError(interaction.target_id)

    door = resolve_effective_object_state(
        client_content,
        state.get("object_states", {}),
        zone.zone_id,
        navigation.door_object_id,
    )
    if not door.visible:
        raise ObjectNotVisibleError(navigation.door_object_id)
    if not door.enabled:
        raise ObjectNotEnabledError(navigation.door_object_id)

    updated_state = deepcopy(state)
    updated_state["current_zone_id"] = interaction.target_id
    return (
        "navigated",
        updated_state,
        [
            CurrentZoneChangedStateChange(
                type="current_zone_changed",
                zone_id=interaction.target_id,
            ),
        ],
    )


def _ensure_current_zone(
    state: dict[str, Any],
    zone_id: str,
    load_client_content: Callable[[], CaseClientContent],
) -> dict[str, Any]:
    """요청 Zone이 서버의 현재 위치인지 확인하고, 판정에 쓸 상태를 반환한다.

    current_zone_id가 없는 과거 세션은 Zone이 하나뿐인 콘텐츠에서만 입구로 복원한다.
    복원한 값은 반환 상태에 담겨 이번 상호작용과 함께 저장된다.
    """

    current_zone_id = state.get("current_zone_id")
    if current_zone_id is not None and current_zone_id == zone_id:
        return state

    client_content = load_client_content()
    zone_ids = {zone.zone_id for zone in client_content.zones}
    if zone_id not in zone_ids:
        raise ZoneNotFoundError(f"Zone '{zone_id}' not found.")

    if current_zone_id is None:
        # Zone이 여러 개면 실제 위치를 알 수 없으므로 입구로 간주하지 않는다.
        if len(client_content.zones) != 1:
            raise CurrentZoneUnknownError()
        current_zone_id = client_content.entry_zone_id
        state = {**state, "current_zone_id": current_zone_id}
    elif current_zone_id not in zone_ids:
        raise CurrentZoneUnknownError()

    if current_zone_id != zone_id:
        raise ZoneNotCurrentError(zone_id)
    return state


def _ensure_required_clues(required_clue_ids: list[str], state: dict[str, Any]) -> None:
    acquired = set(state.get("acquired_clue_ids", []))
    missing = [clue_id for clue_id in required_clue_ids if clue_id not in acquired]
    if missing:
        raise RequiredCluesMissingError(len(missing))


def _request_values(
    interaction: InteractionRequest,
) -> tuple[str | None, dict[str, Any]]:
    target_id = (
        interaction.target_id
        if isinstance(
            interaction,
            SubmitAnswerInteraction | InspectInteraction | NavigateInteraction,
        )
        else None
    )
    return target_id, interaction.payload.model_dump(mode="json")


async def _find_interaction_event(
    db: AsyncSession,
    play_session_id: str,
    client_event_id: str,
) -> InteractionEvent | None:
    return await db.scalar(
        select(InteractionEvent)
        .where(
            InteractionEvent.play_session_id == play_session_id,
            InteractionEvent.client_event_id == client_event_id,
        )
        .with_for_update(),
    )


def _replay_existing_event(
    event: InteractionEvent,
    *,
    interaction_type: str,
    target_id: str | None,
    payload_json: dict[str, Any],
) -> InteractionProcessResult:
    if not _is_same_request(
        event,
        interaction_type=interaction_type,
        target_id=target_id,
        payload_json=payload_json,
    ):
        raise IdempotencyConflictError()

    return InteractionProcessResult(
        interaction_id=event.id,
        result=InteractionResult.model_validate(
            _normalize_legacy_response_json(event.response_json)
        ),
    )


def _is_same_request(
    event: InteractionEvent,
    *,
    interaction_type: str,
    target_id: str | None,
    payload_json: dict[str, Any],
) -> bool:
    return (
        event.interaction_type == interaction_type
        and event.target_id == target_id
        and event.payload_json == payload_json
    )


def _to_db_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.utcoffset() is None:
        raise ValueError("client_timestamp must include a timezone offset")
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _normalize_legacy_response_json(response_json: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(response_json)
    normalized.setdefault("state_changes", [])
    normalized.setdefault("message", None)
    normalized.setdefault("attempt_count", None)
    normalized.setdefault("ui_actions", [])

    state_changes: list[dict[str, Any]] = []
    for change in normalized["state_changes"]:
        if "target_id" not in change:
            state_changes.append(change)
            continue

        change_type = change.get("type")
        target_id = change["target_id"]
        if change_type == "puzzle_completed":
            state_changes.append({"type": "puzzle_completed", "puzzle_id": target_id})
        elif change_type == "clue_acquired":
            state_changes.append({"type": "clue_acquired", "clue_id": target_id})
        elif change_type == "flag_updated":
            state_changes.append(
                {
                    "type": "flag_updated",
                    "flag": target_id,
                    "value": change.get("value"),
                }
            )
        else:
            state_changes.append(change)

    normalized["state_changes"] = state_changes
    return normalized
