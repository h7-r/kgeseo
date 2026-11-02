"""장면 완료(clear_when) 판정을 실제 MySQL에서 확인한다(격리 DB에서만 실행).

    $env:DB_NAME = "waegok_test"
    .\\.venv\\Scripts\\python.exe -m scripts.verify_scene_progress

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
    InspectInteraction,
    InspectPayload,
    SelectChoiceInteraction,
    SelectChoicePayload,
)
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.interaction import process_interaction

ZONE_ID = "ZONE_A"
CASE_COMPLETED = {"type": "case_completed"}


def _cleared(scene_id: str) -> dict:
    return {"type": "scene_cleared", "scene_id": scene_id}


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

    def effect(set_flags: dict[str, bool]) -> dict:
        return {"grant_clue_ids": [], "set_flags": set_flags}

    def puzzle(puzzle_id: str) -> dict:
        return {
            "puzzle_id": puzzle_id,
            "accepted_answers": ["offered"],
            "on_correct": effect({}),
        }

    runtime = PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "0.2-draft",
            "case_id": case_id,
            "puzzles": [puzzle("PZ_A"), puzzle("PZ_B")],
            "clue_combinations": [],
            "inspections": [
                {"inspect_id": "INSP_LAMP", "on_inspect": effect({"lamp_lit": True})},
            ],
            "case_completion": {"requires_puzzle_ids": ["PZ_B"]},
            "scenes": [
                {"scene_id": "SCENE_A", "clear_when": {"puzzle_completed": "PZ_A"}},
                {
                    "scene_id": "SCENE_LAMP",
                    "clear_when": {"flag": {"name": "lamp_lit", "eq": True}},
                },
                {
                    "scene_id": "SCENE_AB",
                    "clear_when": {
                        "all": [
                            {"puzzle_completed": "PZ_A"},
                            {"puzzle_completed": "PZ_B"},
                        ]
                    },
                },
            ],
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
                        obj("OBJ_A", "select", "PZ_A"),
                        obj("OBJ_B", "select", "PZ_B"),
                        obj("OBJ_LAMP", "inspect", "INSP_LAMP"),
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
        # completed_scene_ids key가 없는 과거 형태의 state_json으로 시작한다.
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


def _select(event_id: str, object_id: str, puzzle_id: str):
    return SelectChoiceInteraction(
        client_event_id=event_id,
        interaction_type="select_choice",
        target_id=puzzle_id,
        zone_id=ZONE_ID,
        object_id=object_id,
        payload=SelectChoicePayload(choice="offered"),
    )


def _inspect(event_id: str):
    return InspectInteraction(
        client_event_id=event_id,
        interaction_type="inspect",
        target_id="INSP_LAMP",
        zone_id=ZONE_ID,
        object_id="OBJ_LAMP",
        payload=InspectPayload(),
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


def _changes(result) -> list[dict]:
    return [c.model_dump(mode="json") for c in result.result.state_changes]


async def _verify() -> None:
    anonymous_session_id = str(uuid4())
    play_session_id = str(uuid4())
    case_id = f"scene-verification-{uuid4().hex[:12]}"
    runtime, client = _make_content(case_id)

    try:
        await _prepare_rows(anonymous_session_id, play_session_id, case_id)

        # 1. 과거 세션에서 퍼즐을 풀면 그 퍼즐로 끝나는 장면만 기록한다(Case 완료 아님)
        result = await _run_one(
            play_session_id, _select(str(uuid4()), "OBJ_A", "PZ_A"), runtime, client
        )
        state, completed_at, _ = await _read_session(play_session_id)
        if _changes(result)[-1:] != [_cleared("SCENE_A")]:
            raise AssertionError(f"Unexpected changes {_changes(result)}")
        if state["completed_scene_ids"] != ["SCENE_A"] or completed_at is not None:
            raise AssertionError(f"Stored scenes {state.get('completed_scene_ids')}")
        print("[OK] A correct answer stored its scene without completing the case.")

        # 2. 같은 client_event_id 동시 재전송은 이벤트 하나 · 장면 기록 한 번이다(flag 조건)
        _, _, events_before = await _read_session(play_session_id)
        shared_id = str(uuid4())
        same = await asyncio.gather(
            *(
                _run_one(play_session_id, _inspect(shared_id), runtime, client)
                for _ in range(2)
            )
        )
        state, _, events_after = await _read_session(play_session_id)
        if same[0].interaction_id != same[1].interaction_id:
            raise AssertionError("Same client_event_id produced two interactions.")
        if events_after != events_before + 1:
            raise AssertionError(f"Expected {events_before + 1} events.")
        if _changes(same[0]) != _changes(same[1]) or _cleared(
            "SCENE_LAMP"
        ) not in _changes(same[0]):
            raise AssertionError("Replay did not return the first scene_cleared.")
        if state["completed_scene_ids"] != ["SCENE_A", "SCENE_LAMP"]:
            raise AssertionError(f"Stored scenes {state['completed_scene_ids']}")
        print("[OK] Same client_event_id raced into one flag scene record.")

        # 3. 서로 다른 이벤트가 같은 장면을 동시에 끝내도 한 번만 기록 · 알린다
        outcomes = await asyncio.gather(
            *(
                _run_one(
                    play_session_id,
                    _select(str(uuid4()), "OBJ_B", "PZ_B"),
                    runtime,
                    client,
                )
                for _ in range(2)
            )
        )
        result_types = sorted(o.result.result_type for o in outcomes)
        if result_types != ["already_completed", "correct"]:
            raise AssertionError(f"Concurrent outcomes {result_types}")
        all_changes = [change for o in outcomes for change in _changes(o)]
        if all_changes.count(_cleared("SCENE_AB")) != 1:
            raise AssertionError(f"scene_cleared count in {all_changes}")
        if all_changes.count(CASE_COMPLETED) != 1:
            raise AssertionError(f"case_completed count in {all_changes}")
        state, completed_at, _ = await _read_session(play_session_id)
        if state["completed_scene_ids"] != ["SCENE_A", "SCENE_LAMP", "SCENE_AB"]:
            raise AssertionError(f"Stored scenes {state['completed_scene_ids']}")
        if completed_at is None:
            raise AssertionError("Case completion was not stored with the scene.")
        print("[OK] Two events racing for one scene recorded it once with the case.")
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
