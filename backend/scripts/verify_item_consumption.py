"""아이템 획득 · 소비를 실제 MySQL에서 확인한다(격리 DB에서만 실행).

    $env:DB_NAME = "waegok_test"
    .\\.venv\\Scripts\\python.exe -m scripts.verify_item_consumption

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
from app.services.interaction import RequiredItemsNotHeldError, process_interaction

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

    def effect(grant_item_ids: list[str]) -> dict:
        return {"grant_clue_ids": [], "grant_item_ids": grant_item_ids, "set_flags": {}}

    def puzzle(puzzle_id: str, consumes: list[str]) -> dict:
        return {
            "puzzle_id": puzzle_id,
            "accepted_answers": ["offered"],
            "consumes_item_ids": consumes,
            "on_correct": effect([]),
        }

    runtime = PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "0.2-draft",
            "case_id": case_id,
            "puzzles": [
                # 같은 쌀을 소비하는 두 제단. 먼저 처리된 쪽만 성공해야 한다.
                puzzle("PZ_ALTAR_A", ["ITEM_RICE"]),
                puzzle("PZ_ALTAR_B", ["ITEM_RICE"]),
                puzzle("PZ_SHRINE", ["ITEM_WINE"]),
            ],
            "clue_combinations": [],
            "inspections": [
                {"inspect_id": "INSP_RICE", "on_inspect": effect(["ITEM_RICE"])},
                {"inspect_id": "INSP_WINE", "on_inspect": effect(["ITEM_WINE"])},
            ],
            "case_completion": {"requires_puzzle_ids": ["PZ_SHRINE"]},
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
                        obj("OBJ_RICE", "inspect", "INSP_RICE"),
                        obj("OBJ_WINE", "inspect", "INSP_WINE"),
                        obj("OBJ_ALTAR_A", "select", "PZ_ALTAR_A"),
                        obj("OBJ_ALTAR_B", "select", "PZ_ALTAR_B"),
                        obj("OBJ_SHRINE", "select", "PZ_SHRINE"),
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
        # 아이템 key가 없는 과거 형태의 state_json으로 시작한다.
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


def _inspect(object_id: str, inspect_id: str):
    return InspectInteraction(
        client_event_id=str(uuid4()),
        interaction_type="inspect",
        target_id=inspect_id,
        zone_id=ZONE_ID,
        object_id=object_id,
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


def _change_types(result) -> list[dict]:
    return [c.model_dump(mode="json") for c in result.result.state_changes]


async def _verify() -> None:
    anonymous_session_id = str(uuid4())
    play_session_id = str(uuid4())
    case_id = f"item-verification-{uuid4().hex[:12]}"
    runtime, client = _make_content(case_id)

    try:
        await _prepare_rows(anonymous_session_id, play_session_id, case_id)

        # 1. 보유하지 않은 아이템 소비는 거부하고 아무것도 남기지 않는다
        try:
            await _run_one(
                play_session_id,
                _select(str(uuid4()), "OBJ_ALTAR_A", "PZ_ALTAR_A"),
                runtime,
                client,
            )
        except RequiredItemsNotHeldError as error:
            if error.missing_item_count != 1:
                raise AssertionError(f"Unexpected count {error.missing_item_count}")
        else:
            raise AssertionError("Item that is not held was consumed.")
        state, _, events = await _read_session(play_session_id)
        if events != 0 or "consumed_item_ids" in state or state["attempt_counts"]:
            raise AssertionError("Rejected consumption left rows or state behind.")
        print("[OK] Consuming an item that is not held was rejected without writes.")

        # 2. 조사로 아이템을 얻는다(단서 목록은 그대로)
        for object_id, inspect_id in (
            ("OBJ_RICE", "INSP_RICE"),
            ("OBJ_WINE", "INSP_WINE"),
        ):
            await _run_one(
                play_session_id, _inspect(object_id, inspect_id), runtime, client
            )
        state, _, _ = await _read_session(play_session_id)
        if state["acquired_item_ids"] != ["ITEM_RICE", "ITEM_WINE"]:
            raise AssertionError(f"Acquired items {state['acquired_item_ids']}")
        if state["acquired_clue_ids"]:
            raise AssertionError("Item grant touched acquired_clue_ids.")
        print("[OK] Inspections stored acquired items separately from clues.")

        # 3. 같은 쌀을 소비하는 두 제단을 동시에 풀면 하나만 성공한다
        outcomes = await asyncio.gather(
            _run_one(
                play_session_id,
                _select(str(uuid4()), "OBJ_ALTAR_A", "PZ_ALTAR_A"),
                runtime,
                client,
            ),
            _run_one(
                play_session_id,
                _select(str(uuid4()), "OBJ_ALTAR_B", "PZ_ALTAR_B"),
                runtime,
                client,
            ),
            return_exceptions=True,
        )
        successes = [o for o in outcomes if not isinstance(o, BaseException)]
        rejections = [o for o in outcomes if isinstance(o, RequiredItemsNotHeldError)]
        if len(successes) != 1 or len(rejections) != 1:
            raise AssertionError(f"Concurrent consumption outcomes {outcomes!r}")
        state, _, _ = await _read_session(play_session_id)
        if state["consumed_item_ids"] != ["ITEM_RICE"]:
            raise AssertionError(f"Consumed items {state['consumed_item_ids']}")
        if len(set(state["completed_puzzle_ids"])) != 1:
            raise AssertionError(f"Completed puzzles {state['completed_puzzle_ids']}")
        print("[OK] Two puzzles racing for one item consumed it once.")

        # 4. 같은 client_event_id 동시 재전송은 이벤트 하나 · 소비 한 번 · 완료 한 번이다
        _, _, events_before = await _read_session(play_session_id)
        shared_id = str(uuid4())
        same = await asyncio.gather(
            *(
                _run_one(
                    play_session_id,
                    _select(shared_id, "OBJ_SHRINE", "PZ_SHRINE"),
                    runtime,
                    client,
                )
                for _ in range(2)
            )
        )
        state, completed_at, events_after = await _read_session(play_session_id)
        if same[0].interaction_id != same[1].interaction_id:
            raise AssertionError("Same client_event_id produced two interactions.")
        if events_after != events_before + 1:
            raise AssertionError(f"Expected {events_before + 1} events.")
        if state["consumed_item_ids"] != ["ITEM_RICE", "ITEM_WINE"]:
            raise AssertionError(f"Consumed items {state['consumed_item_ids']}")
        if completed_at is None or CASE_COMPLETED not in _change_types(same[0]):
            raise AssertionError("Consumption and case completion were not stored.")
        print("[OK] Same client_event_id raced into one consumption and completion.")
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
