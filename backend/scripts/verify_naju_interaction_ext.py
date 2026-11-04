"""select · 선행 퍼즐 · Case 완료를 실제 MySQL에서 확인한다(격리 DB에서만 실행).

    $env:DB_NAME = "waegok_test"
    .\\.venv\\Scripts\\python.exe -m scripts.verify_naju_interaction_ext

검증용 세션 행을 직접 만들고, 끝나면 그 행만 지운다. 콘텐츠는 이 스크립트 안의 미니 케이스다.
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.db.session import AsyncSessionLocal, engine
from app.models.anonymous_session import AnonymousSession
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.schemas.interaction import (
    SelectChoiceInteraction,
    SelectChoicePayload,
    SubmitAnswerInteraction,
    SubmitAnswerPayload,
)
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.interaction import RequiredPuzzlesMissingError, process_interaction

ZONE_ID = "ZONE_A"
CASE_COMPLETED = {"type": "case_completed"}


def _make_content(case_id: str) -> tuple[PuzzleRuntimeDefinition, CaseClientContent]:
    def obj(object_id: str, kind: str, target: str) -> dict:
        return {
            "object_id": object_id,
            "object_name": object_id,
            "object_type": "prop",
            "visible": True,
            "enabled": True,
            "interaction": {"type": kind, "target_id": target},
        }

    def puzzle(puzzle_id: str, answer: str, requires: list[str]) -> dict:
        return {
            "puzzle_id": puzzle_id,
            "accepted_answers": [answer],
            "requires_puzzle_ids": requires,
            "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        }

    runtime = PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "0.2-draft",
            "case_id": case_id,
            "puzzles": [
                puzzle("PZ_JARS", "do-mi-sol", []),
                puzzle("PZ_OFFERING", "offered", ["PZ_JARS"]),
                puzzle("PZ_BIRDS", "facing", ["PZ_OFFERING"]),
            ],
            "clue_combinations": [],
            "case_completion": {"requires_puzzle_ids": ["PZ_OFFERING", "PZ_BIRDS"]},
        }
    )
    client = CaseClientContent.model_validate(
        {
            "case_id": case_id,
            "entry_zone_id": ZONE_ID,
            "zones": [
                {
                    "zone_id": ZONE_ID,
                    "zone_name": "Ferry",
                    "zone_type": "outdoor",
                    "description": "Ferry",
                    "objects": [
                        obj("OBJ_JARS", "input", "PZ_JARS"),
                        obj("OBJ_ALTAR", "select", "PZ_OFFERING"),
                        obj("OBJ_BIRDS", "select", "PZ_BIRDS"),
                    ],
                    "navigation": [],
                }
            ],
        }
    )
    return runtime, client


async def _prepare_rows(
    anonymous_session_id: str, play_session_id: str, case_id: str
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
                    "current_zone_id": ZONE_ID,
                    "completed_puzzle_ids": [],
                    "completed_inspect_ids": [],
                    "acquired_clue_ids": [],
                    "hint_levels": {},
                    "attempt_counts": {},
                    "flags": {},
                    "object_states": {},
                },
                created_at=now,
                updated_at=now,
                completed_at=None,
            )
        )
        await db.commit()


async def _cleanup_rows(anonymous_session_id: str, play_session_id: str) -> None:
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


async def _read_session(play_session_id: str) -> tuple[dict, datetime | None, int]:
    async with AsyncSessionLocal() as db:
        row = (
            await db.execute(
                select(PlaySession.state_json, PlaySession.completed_at).where(
                    PlaySession.id == play_session_id
                )
            )
        ).one()
        event_count = await db.scalar(
            select(func.count(InteractionEvent.id)).where(
                InteractionEvent.play_session_id == play_session_id
            )
        )
    return row.state_json, row.completed_at, event_count


def _select(event_id: str, object_id: str, puzzle_id: str, choice: str):
    return SelectChoiceInteraction(
        client_event_id=event_id,
        interaction_type="select_choice",
        target_id=puzzle_id,
        zone_id=ZONE_ID,
        object_id=object_id,
        payload=SelectChoicePayload(choice=choice),
    )


async def _run_one(play_session_id: str, interaction, runtime, client):
    async with AsyncSessionLocal() as db:
        return await process_interaction(
            db,
            play_session_id,
            interaction,
            runtime_loader=lambda _: runtime,
            client_content_loader=lambda _: client,
        )


async def _verify() -> None:
    anonymous_session_id = str(uuid4())
    play_session_id = str(uuid4())
    case_id = f"naju-ext-verification-{uuid4().hex[:12]}"
    runtime, client = _make_content(case_id)

    try:
        await _prepare_rows(anonymous_session_id, play_session_id, case_id)

        # 1. 선행 퍼즐이 없으면 거부하고 아무것도 남기지 않는다
        try:
            await _run_one(
                play_session_id,
                _select(str(uuid4()), "OBJ_ALTAR", "PZ_OFFERING", "offered"),
                runtime,
                client,
            )
        except RequiredPuzzlesMissingError as error:
            if error.missing_puzzle_count != 1:
                raise AssertionError(f"Unexpected count {error.missing_puzzle_count}")
        else:
            raise AssertionError("Missing required puzzle was not rejected.")
        state, completed_at, events = await _read_session(play_session_id)
        if state["completed_puzzle_ids"] or events != 0 or completed_at is not None:
            raise AssertionError("Rejected select left rows or state behind.")
        print("[OK] Missing required puzzle was rejected without writes.")

        # 2. input으로 선행을 풀고 select로 다음 퍼즐을 푼다
        await _run_one(
            play_session_id,
            SubmitAnswerInteraction(
                client_event_id=str(uuid4()),
                interaction_type="submit_answer",
                target_id="PZ_JARS",
                zone_id=ZONE_ID,
                payload=SubmitAnswerPayload(answer="Do-Mi-Sol"),
            ),
            runtime,
            client,
        )
        offering = await _run_one(
            play_session_id,
            _select(str(uuid4()), "OBJ_ALTAR", "PZ_OFFERING", "offered"),
            runtime,
            client,
        )
        if offering.result.result_type != "correct":
            raise AssertionError(f"select result {offering.result.result_type}")
        async with AsyncSessionLocal() as db:
            event_type = await db.scalar(
                select(InteractionEvent.interaction_type).where(
                    InteractionEvent.id == offering.interaction_id
                )
            )
        if event_type != "select_choice":
            raise AssertionError(f"Stored interaction_type {event_type!r}")
        print("[OK] select_choice event was stored and graded after the prerequisite.")

        # 3. 마지막 퍼즐을 다른 event ID 두 개로 동시에 풀어도 완료는 한 번이다
        results = await asyncio.gather(
            _run_one(
                play_session_id,
                _select(str(uuid4()), "OBJ_BIRDS", "PZ_BIRDS", "facing"),
                runtime,
                client,
            ),
            _run_one(
                play_session_id,
                _select(str(uuid4()), "OBJ_BIRDS", "PZ_BIRDS", "facing"),
                runtime,
                client,
            ),
        )
        result_types = sorted(r.result.result_type for r in results)
        completions = [
            r
            for r in results
            if CASE_COMPLETED
            in [c.model_dump(mode="json") for c in r.result.state_changes]
        ]
        if result_types != ["already_completed", "correct"]:
            raise AssertionError(f"Concurrent results {result_types}")
        if len(completions) != 1:
            raise AssertionError(f"case_completed emitted {len(completions)} times")
        state, completed_at, events = await _read_session(play_session_id)
        if completed_at is None:
            raise AssertionError("completed_at was not recorded.")
        if state["completed_puzzle_ids"] != ["PZ_JARS", "PZ_OFFERING", "PZ_BIRDS"]:
            raise AssertionError(f"Final puzzles {state['completed_puzzle_ids']}")
        print(
            "[OK] Concurrent completions recorded completed_at and case_completed once."
        )

        # 4. 같은 client_event_id 동시 재전송은 이벤트 하나 · 같은 응답이다
        shared_id = str(uuid4())
        same = await asyncio.gather(
            *(
                _run_one(
                    play_session_id,
                    _select(shared_id, "OBJ_ALTAR", "PZ_OFFERING", "offered"),
                    runtime,
                    client,
                )
                for _ in range(2)
            )
        )
        _, completed_at_after, events_after = await _read_session(play_session_id)
        if same[0].interaction_id != same[1].interaction_id:
            raise AssertionError("Same client_event_id produced two interactions.")
        if events_after != events + 1:
            raise AssertionError(f"Expected {events + 1} events, got {events_after}.")
        if completed_at_after != completed_at:
            raise AssertionError("completed_at changed after completion.")
        print("[OK] Same client_event_id raced into one event; completed_at unchanged.")
    finally:
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
