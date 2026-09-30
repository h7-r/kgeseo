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
from app.schemas.interaction import (
    ClueAcquiredStateChange,
    CombineCluesInteraction,
    FlagUpdatedStateChange,
    InteractionProcessResult,
    InteractionRequest,
    InteractionResult,
    InteractionResultType,
    InteractionStateChange,
    PuzzleCompletedStateChange,
    SubmitAnswerInteraction,
)
from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, RuntimeEffect
from app.services.play_session import PlaySessionNotFoundError
from app.services.puzzle_runtime import load_case_runtime, normalize_answer

RuntimeLoader = Callable[[str], PuzzleRuntimeDefinition]


class InteractionServiceError(Exception):
    pass


class PuzzleNotFoundError(InteractionServiceError):
    pass


class ClueNotAcquiredError(InteractionServiceError):
    pass


class IdempotencyConflictError(InteractionServiceError):
    pass


async def process_interaction(
    db: AsyncSession,
    play_session_id: str,
    interaction: InteractionRequest,
    *,
    runtime_loader: RuntimeLoader = load_case_runtime,
) -> InteractionProcessResult:
    target_id, payload_json = _request_values(interaction)
    try:
        play_session = await _get_play_session_for_update(db, play_session_id)
        if play_session is None:
            raise PlaySessionNotFoundError()

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

        if isinstance(interaction, SubmitAnswerInteraction):
            (
                result_type,
                result_state,
                state_changes,
                attempt_count,
            ) = _process_submit_answer(
                interaction,
                current_state,
                runtime,
            )
        else:
            result_type, result_state, state_changes = _process_combine_clues(
                interaction,
                current_state,
                runtime,
            )
            attempt_count = None

        response = InteractionResult(
            result_type=result_type,
            state=PlaySessionState.model_validate(result_state),
            state_changes=state_changes,
            message=None,
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

    return updated_state, state_changes


def _process_submit_answer(
    interaction: SubmitAnswerInteraction,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
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
    )
    return "correct", updated_state, state_changes, attempt_count


def _process_combine_clues(
    interaction: CombineCluesInteraction,
    state: dict[str, Any],
    runtime: PuzzleRuntimeDefinition,
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
    )
    return "combined", updated_state, state_changes


def _request_values(
    interaction: InteractionRequest,
) -> tuple[str | None, dict[str, Any]]:
    target_id = (
        interaction.target_id
        if isinstance(interaction, SubmitAnswerInteraction)
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
