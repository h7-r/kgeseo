"""select · 퍼즐 선행 · Case 완료 테스트가 함께 쓰는 테스트 전용 미니 케이스.

실제 나주 콘텐츠가 아니다. 나주 흐름(배치 퍼즐 → 선행 퍼즐 → select 퍼즐 → Case 완료)을 최소 크기로 흉내 낸다.
"""

import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest

from app.models.play_session import PlaySession
from app.services import case_content, puzzle_runtime

CASE_ID = "naju_mini_test"
PLAY_SESSION_ID = "33333333-3333-4333-8333-333333333333"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"
PUZZLES_MISSING = "Required puzzles are not completed."
CLUES_MISSING = "Required clues are not acquired."


def obj(object_id: str, kind: str, target: str, **state: bool) -> dict:
    return {
        "object_id": object_id,
        "object_name": object_id,
        "object_type": "prop",
        "visible": state.get("visible", True),
        "enabled": state.get("enabled", True),
        "interaction": {"type": kind, "target_id": target},
    }


CLIENT_DATA = {
    "case_id": CASE_ID,
    "entry_zone_id": "ZONE_A",
    "zones": [
        {
            "zone_id": "ZONE_A",
            "zone_name": "Ferry",
            "zone_type": "outdoor",
            "description": "Ferry",
            "objects": [
                obj("OBJ_NOTE", "inspect", "INSP_NOTE"),
                obj("OBJ_JARS", "input", "PZ_JARS"),
                obj("OBJ_POSTS", "input", "PZ_POSTS"),
                obj("OBJ_ALTAR", "select", "PZ_OFFERING"),
                obj("OBJ_BIRDS", "select", "PZ_BIRDS"),
                obj("OBJ_HIDDEN_SELECT", "select", "PZ_HIDDEN", visible=False),
                obj("OBJ_LOCKED_SELECT", "select", "PZ_LOCKED", enabled=False),
            ],
            "navigation": [],
        },
        {
            "zone_id": "ZONE_B",
            "zone_name": "Ridge",
            "zone_type": "outdoor",
            "description": "Ridge",
            "objects": [],
            "navigation": [],
        },
    ],
}


def effect(**values) -> dict:
    return {"grant_clue_ids": [], "set_flags": {}, **values}


def puzzle(puzzle_id: str, answer: str, **values) -> dict:
    return {
        "puzzle_id": puzzle_id,
        "accepted_answers": [answer],
        "on_correct": effect(),
        **values,
    }


RUNTIME_DATA = {
    "schema_version": "0.2-draft",
    "case_id": CASE_ID,
    "puzzles": [
        puzzle("PZ_JARS", "do-mi-sol"),
        puzzle(
            "PZ_POSTS",
            "moon-wave-sun-bird",
            requires_puzzle_ids=["PZ_JARS"],
            requires_clue_ids=["CL_NOTE"],
        ),
        puzzle(
            "PZ_OFFERING",
            "offered",
            requires_puzzle_ids=["PZ_POSTS"],
            on_correct=effect(set_flags={"offering_done": True}),
        ),
        puzzle("PZ_BIRDS", "facing", requires_puzzle_ids=["PZ_OFFERING"]),
        puzzle("PZ_HIDDEN", "x"),
        puzzle("PZ_LOCKED", "x"),
    ],
    "clue_combinations": [],
    "inspections": [
        {"inspect_id": "INSP_NOTE", "on_inspect": effect(grant_clue_ids=["CL_NOTE"])}
    ],
    "clues": [{"clue_id": "CL_NOTE", "title": "Note"}],
    "case_completion": {"requires_puzzle_ids": ["PZ_OFFERING", "PZ_BIRDS"]},
}


def runtime_data(**overrides) -> dict:
    data = deepcopy(RUNTIME_DATA)
    data.update(overrides)
    return data


def write_case(
    directory: Path, runtime: dict | None = None, client: dict | None = None
) -> None:
    (directory / f"{CASE_ID}.client.json").write_text(
        json.dumps(client or CLIENT_DATA), encoding="utf-8"
    )
    (directory / f"{CASE_ID}.server.json").write_text(
        json.dumps(runtime or RUNTIME_DATA), encoding="utf-8"
    )


def prepare_case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """각 테스트 파일의 case_directory fixture가 부른다."""

    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    write_case(tmp_path)
    return tmp_path


def make_play_session(
    *, completed_at: datetime | None = None, **state_overrides
) -> PlaySession:
    now = datetime(2026, 11, 2, 1, 2, 3)
    return PlaySession(
        id=PLAY_SESSION_ID,
        anonymous_session_id="anonymous-session-id",
        case_id=CASE_ID,
        state_json={
            "current_zone_id": "ZONE_A",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
            **state_overrides,
        },
        created_at=now,
        updated_at=now,
        completed_at=completed_at,
    )


EVENT_IDS = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 100_000))


def request_body(
    object_id: str,
    action: str,
    payload: dict,
    *,
    zone_id: str = "ZONE_A",
    target_type: str = "object",
    client_event_id: str | None = None,
) -> dict:
    return {
        "client_event_id": client_event_id or next(EVENT_IDS),
        "client_timestamp": "2026-11-04T10:00:00+09:00",
        "zone_id": zone_id,
        "action": action,
        "target_type": target_type,
        "target_id": object_id,
        "payload": payload,
    }


def select_body(object_id: str, choice: str, **options) -> dict:
    return request_body(object_id, "select", {"choice": choice}, **options)


def input_body(object_id: str, answer: str, **options) -> dict:
    return request_body(object_id, "input", {"answer": answer}, **options)


def inspect_body(object_id: str, **options) -> dict:
    return request_body(object_id, "inspect", {}, **options)
