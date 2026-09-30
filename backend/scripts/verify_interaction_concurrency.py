import asyncio
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.db.session import AsyncSessionLocal, engine
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.interaction import SubmitAnswerInteraction, SubmitAnswerPayload
from app.schemas.puzzle_runtime import (
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.interaction import process_interaction


async def _prepare_rows(
    anonymous_session_id: str,
    play_session_id: str,
    case_id: str,
) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    async with AsyncSessionLocal() as db:
        db.add(
            AnonymousSession(
                id=anonymous_session_id,
                created_at=now,
                expires_at=now + timedelta(hours=1),
            )
        )
        db.add(
            PlaySession(
                id=play_session_id,
                anonymous_session_id=anonymous_session_id,
                case_id=case_id,
                state_json={
                    "completed_puzzle_ids": [],
                    "acquired_clue_ids": [],
                    "hint_levels": {},
                    "flags": {},
                },
                created_at=now,
                updated_at=now,
                completed_at=None,
            )
        )
        await db.commit()


async def _cleanup_rows(
    anonymous_session_id: str,
    play_session_id: str,
) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(InteractionEvent).where(
                InteractionEvent.play_session_id == play_session_id
            )
        )
        await db.execute(delete(PlaySession).where(PlaySession.id == play_session_id))
        await db.execute(
            delete(AnonymousSession).where(AnonymousSession.id == anonymous_session_id)
        )
        await db.commit()


def _make_runtime(case_id: str) -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=case_id,
        puzzles=[
            PuzzleDefinition(
                puzzle_id="concurrency_puzzle_02",
                accepted_answers=["answer"],
                on_correct=RuntimeEffect(
                    grant_clue_ids=[],
                    set_flags={},
                ),
            )
        ],
        clue_combinations=[],
    )


async def _verify() -> None:
    anonymous_session_id = str(uuid4())
    play_session_id = str(uuid4())
    first_event_id = str(uuid4())
    first_client_event_id = str(uuid4())
    second_client_event_id = str(uuid4())
    case_id = f"concurrency-verification-{uuid4()}"
    second_task: asyncio.Task | None = None

    try:
        await _prepare_rows(anonymous_session_id, play_session_id, case_id)
        runtime = _make_runtime(case_id)

        async with AsyncSessionLocal() as first_db, AsyncSessionLocal() as second_db:
            first_play_session = await first_db.get(
                PlaySession,
                play_session_id,
                with_for_update=True,
                populate_existing=True,
            )
            if first_play_session is None:
                raise AssertionError("Verification PlaySession was not created.")

            first_state = deepcopy(first_play_session.state_json)
            first_state["completed_puzzle_ids"].append("concurrency_puzzle_01")
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            first_play_session.state_json = first_state
            first_play_session.updated_at = now
            first_db.add(
                InteractionEvent(
                    id=first_event_id,
                    play_session_id=play_session_id,
                    client_event_id=first_client_event_id,
                    interaction_type="submit_answer",
                    target_id="concurrency_puzzle_01",
                    payload_json={"answer": "answer"},
                    result_type="correct",
                    response_json={
                        "success": True,
                        "result_type": "correct",
                        "state": first_state,
                        "state_changes": [
                            {
                                "type": "puzzle_completed",
                                "target_id": "concurrency_puzzle_01",
                                "value": True,
                            }
                        ],
                    },
                    created_at=now,
                )
            )

            second_task = asyncio.create_task(
                process_interaction(
                    second_db,
                    play_session_id,
                    SubmitAnswerInteraction(
                        client_event_id=second_client_event_id,
                        interaction_type="submit_answer",
                        target_id="concurrency_puzzle_02",
                        payload=SubmitAnswerPayload(answer="answer"),
                    ),
                    runtime_loader=lambda _: runtime,
                )
            )

            try:
                await asyncio.wait_for(asyncio.shield(second_task), timeout=0.5)
            except TimeoutError:
                pass
            else:
                raise AssertionError(
                    "Second interaction completed before the first row lock was released."
                )

            await first_db.commit()
            second_result = await asyncio.wait_for(second_task, timeout=5)

        async with AsyncSessionLocal() as verification_db:
            final_state = await verification_db.scalar(
                select(PlaySession.state_json).where(PlaySession.id == play_session_id)
            )
            event_count = await verification_db.scalar(
                select(func.count(InteractionEvent.id)).where(
                    InteractionEvent.play_session_id == play_session_id
                )
            )

        expected_puzzles = [
            "concurrency_puzzle_01",
            "concurrency_puzzle_02",
        ]
        if final_state is None:
            raise AssertionError("Verification PlaySession disappeared.")
        if final_state["completed_puzzle_ids"] != expected_puzzles:
            raise AssertionError(
                "Final state did not preserve both interaction results: "
                f"{final_state['completed_puzzle_ids']}"
            )
        if event_count != 2:
            raise AssertionError(f"Expected 2 InteractionEvents, got {event_count}.")
        if second_result.result.state.completed_puzzle_ids != expected_puzzles:
            raise AssertionError(
                "Second interaction did not use the latest locked state."
            )

        print("[OK] Second transaction waited for the PlaySession row lock.")
        print("[OK] Final state preserved both puzzle completions.")
        print("[OK] Two InteractionEvents were committed.")
    finally:
        if second_task is not None and not second_task.done():
            second_task.cancel()
            await asyncio.gather(second_task, return_exceptions=True)
        await _cleanup_rows(anonymous_session_id, play_session_id)
        print("[OK] Verification rows were cleaned up.")


async def _run() -> None:
    try:
        await _verify()
    finally:
        await engine.dispose()


def main() -> int:
    try:
        asyncio.run(_run())
    except Exception as error:
        print(f"[FAIL] {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
