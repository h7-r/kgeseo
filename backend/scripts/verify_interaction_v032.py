import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select

from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services import case_content, puzzle_runtime


def _write_case_content(directory: Path, case_id: str) -> None:
    client_content = {
        "case_id": case_id,
        "entry_zone_id": "ZONE_ENTRY",
        "zones": [
            {
                "zone_id": "ZONE_ENTRY",
                "zone_name": "Entry",
                "zone_type": "room",
                "description": "Interaction verification zone",
                "objects": [
                    {
                        "object_id": "OBJ_LOCK",
                        "object_name": "Lock",
                        "object_type": "lock",
                        "visible": True,
                        "enabled": True,
                        "interaction": {
                            "type": "input",
                            "target_id": "PUZZLE_LOCK",
                        },
                    }
                ],
                "navigation": [],
            }
        ],
    }
    server_runtime = {
        "schema_version": "0.1",
        "case_id": case_id,
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_LOCK",
                "accepted_answers": ["answer"],
                "on_correct": {
                    "grant_clue_ids": ["CLUE_LOCK"],
                    "set_flags": {"lock_open": True},
                },
            }
        ],
        "clue_combinations": [],
    }
    (directory / f"{case_id}.client.json").write_text(
        json.dumps(client_content),
        encoding="utf-8",
    )
    (directory / f"{case_id}.server.json").write_text(
        json.dumps(server_runtime),
        encoding="utf-8",
    )


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
                    "current_zone_id": "ZONE_ENTRY",
                    "completed_puzzle_ids": [],
                    "acquired_clue_ids": [],
                    "hint_levels": {},
                    "attempt_counts": {},
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


async def _post_interaction(
    client: AsyncClient,
    play_session_id: str,
    client_event_id: str,
    answer: str,
) -> dict:
    response = await client.post(
        f"/api/v1/play-sessions/{play_session_id}/interactions",
        json={
            "client_event_id": client_event_id,
            "client_timestamp": "2026-09-09T09:10:00+09:00",
            "zone_id": "ZONE_ENTRY",
            "action": "input",
            "target_type": "object",
            "target_id": "OBJ_LOCK",
            "payload": {"answer": answer},
        },
    )
    if response.status_code != 200:
        raise AssertionError(
            f"Interaction POST failed: {response.status_code} {response.text}"
        )
    return response.json()


async def _verify() -> None:
    anonymous_session_id = str(uuid4())
    play_session_id = str(uuid4())
    incorrect_event_id = str(uuid4())
    correct_event_id = str(uuid4())
    completed_event_id = str(uuid4())
    case_id = f"iv32-{uuid4()}"
    original_client_directory = case_content.CASES_DIRECTORY
    original_runtime_directory = puzzle_runtime.CASES_DIRECTORY

    try:
        with TemporaryDirectory() as temporary_directory:
            cases_directory = Path(temporary_directory)
            _write_case_content(cases_directory, case_id)
            case_content.CASES_DIRECTORY = cases_directory
            puzzle_runtime.CASES_DIRECTORY = cases_directory
            await _prepare_rows(anonymous_session_id, play_session_id, case_id)

            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                incorrect = await _post_interaction(
                    client,
                    play_session_id,
                    incorrect_event_id,
                    "wrong",
                )
                if incorrect["result_type"] != "incorrect":
                    raise AssertionError("Incorrect answer result was not returned.")
                if incorrect["attempt_count"] != 1:
                    raise AssertionError("First graded input did not return attempt 1.")
                if incorrect["state_changes"] != []:
                    raise AssertionError(
                        "Incorrect answer unexpectedly changed game state."
                    )

                replay = await _post_interaction(
                    client,
                    play_session_id,
                    incorrect_event_id,
                    "wrong",
                )
                if replay != incorrect:
                    raise AssertionError(
                        "Idempotent replay changed the stored response."
                    )

                correct = await _post_interaction(
                    client,
                    play_session_id,
                    correct_event_id,
                    "answer",
                )
                if correct["result_type"] != "correct":
                    raise AssertionError("Correct answer result was not returned.")
                if correct["attempt_count"] != 2:
                    raise AssertionError(
                        "Second graded input did not return attempt 2."
                    )

                completed = await _post_interaction(
                    client,
                    play_session_id,
                    completed_event_id,
                    "answer",
                )
                if completed["result_type"] != "already_completed":
                    raise AssertionError("Completed puzzle was graded again.")
                if completed["attempt_count"] != 2:
                    raise AssertionError("already_completed changed the attempt count.")
                if completed["state_changes"] != []:
                    raise AssertionError("already_completed changed game state.")

            async with AsyncSessionLocal() as verification_db:
                play_session = await verification_db.get(
                    PlaySession,
                    play_session_id,
                )
                incorrect_event = await verification_db.scalar(
                    select(InteractionEvent).where(
                        InteractionEvent.play_session_id == play_session_id,
                        InteractionEvent.client_event_id == incorrect_event_id,
                    )
                )
                event_count = await verification_db.scalar(
                    select(func.count(InteractionEvent.id)).where(
                        InteractionEvent.play_session_id == play_session_id
                    )
                )

            if play_session is None or incorrect_event is None:
                raise AssertionError("Verification rows were not stored in MySQL.")
            if play_session.state_json["attempt_counts"]["PUZZLE_LOCK"] != 2:
                raise AssertionError("MySQL attempt_counts did not stop at 2.")
            if play_session.state_json["completed_puzzle_ids"] != ["PUZZLE_LOCK"]:
                raise AssertionError("MySQL did not store the completed puzzle.")
            if event_count != 3:
                raise AssertionError(
                    f"Expected 3 InteractionEvents, got {event_count}."
                )
            if incorrect_event.client_timestamp != datetime(2026, 9, 9, 0, 10):
                raise AssertionError("client_timestamp was not stored as UTC naive.")
            if incorrect_event.response_json["attempt_count"] != 1:
                raise AssertionError("Initial response was not persisted for replay.")

        print("[OK] Flat Interaction API returned the Phase 1 result fields.")
        print("[OK] Replay returned the stored response without another attempt.")
        print("[OK] MySQL state_json stored attempts and the completed puzzle.")
        print("[OK] client_timestamp was normalized to UTC naive DATETIME(6).")
        print("[OK] already_completed did not increment attempt_count.")
    finally:
        case_content.CASES_DIRECTORY = original_client_directory
        puzzle_runtime.CASES_DIRECTORY = original_runtime_directory
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
