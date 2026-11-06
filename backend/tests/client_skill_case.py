"""Synthetic client-skill contract fixtures; no actual Naju IDs/content."""

from copy import deepcopy
from uuid import uuid4

from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from tests.test_interactions import make_play_session

CASE = "case_skill_test"
ZONE = "ZONE_TEST_A"
OTHER_ZONE = "ZONE_TEST_B"


def documents():
    def effect(**extra):
        return {"grant_clue_ids": [], "set_flags": {}, **extra}

    server = {
        "schema_version": "0.1",
        "case_id": CASE,
        "puzzles": [
            {
                "puzzle_id": "SKILL_A",
                "solve": {"mode": "client_skill"},
                "hints": [{"level": 1, "text": "Synthetic skill hint"}],
                "on_correct": effect(
                    grant_clue_ids=["CL_TEST"], grant_item_ids=["ITEM_TEST"]
                ),
            },
            {
                "puzzle_id": "SKILL_B",
                "solve": {"mode": "client_skill"},
                "requires_puzzle_ids": ["SKILL_A"],
                "requires_clue_ids": ["CL_TEST"],
                "consumes_item_ids": ["ITEM_TEST"],
                "on_correct": effect(set_flags={"test_done": True}),
            },
            {
                "puzzle_id": "VALUE_C",
                "accepted_answers": ["synthetic-answer"],
                "requires_puzzle_ids": ["SKILL_B"],
                "on_correct": effect(),
            },
        ],
        "clues": [{"clue_id": "CL_TEST", "title": "Synthetic token"}],
        "clue_combinations": [],
        "case_completion": {"requires_puzzle_ids": ["SKILL_A", "SKILL_B"]},
        "scenes": [
            {"scene_id": "SCENE_TEST", "clear_when": {"puzzle_completed": "SKILL_B"}}
        ],
    }
    objects = [
        {
            "object_id": object_id,
            "object_name": object_id,
            "object_type": "test",
            "visible": True,
            "enabled": True,
            "interaction": {"type": action, "target_id": puzzle_id},
        }
        for object_id, action, puzzle_id in (
            ("OBJ_A", "complete", "SKILL_A"),
            ("OBJ_B", "complete", "SKILL_B"),
            ("OBJ_C", "input", "VALUE_C"),
        )
    ]
    client = {
        "case_id": CASE,
        "entry_zone_id": ZONE,
        "zones": [
            {
                "zone_id": zone,
                "zone_name": zone,
                "zone_type": "room",
                "description": "Synthetic test zone",
                "objects": deepcopy(objects) if zone == ZONE else [],
                "navigation": [],
            }
            for zone in (ZONE, OTHER_ZONE)
        ],
    }
    return client, server


def models():
    client, server = documents()
    return CaseClientContent.model_validate(
        client
    ), PuzzleRuntimeDefinition.model_validate(server)


def state(**extra):
    return {
        "current_zone_id": ZONE,
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {"SKILL_A": 1},
        "attempt_counts": {},
        "flags": {},
        **extra,
    }


def session(**extra):
    row = make_play_session(state=state(**extra))
    row.case_id = CASE
    row.hint_balance = 4
    row.help_used = 1
    return row


def body(target="OBJ_A", **extra):
    return {
        "client_event_id": str(uuid4()),
        "client_timestamp": "2026-11-04T12:00:00+09:00",
        "zone_id": ZONE,
        "action": "complete",
        "target_type": "object",
        "target_id": target,
        "payload": {},
        **extra,
    }
