"""server.json 정식 힌트 원문(`puzzles[].hints[]`) 계약 — PM v0.4.2.

원문은 server.json 한 곳에만 둔다. npc.json은 단계 참조만, client.json에는 원문이 없어야 한다.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.play_session import PlaySession
from app.schemas.hint import HintUnlockRequest
from app.schemas.npc import NpcHintReshowRequest
from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import (
    HintDefinition,
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.hint import (
    HintNotFoundError,
    server_hint_source,
    server_hint_text,
    unlock_hint,
)
from app.services.npc import process_npc_request
from app.services.npc_content_validation import validate_npc_content_links
from app.services.pinned_content import ContentPin, PinnedContent
from app.services.publication_gate import _client_leaks
from app.services.puzzle_runtime import load_case_runtime
from tests.conftest import FakeAsyncSession

CASES_DIR = Path(__file__).resolve().parents[1] / "app" / "content" / "cases"

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
CASE_ID = "case_test"
PUZZLE_ID = "PZ_TEST_01"
HINT_1 = "(가상) 1단계 힌트 원문"
HINT_2 = "(가상) 2단계 정답 원문 가상정답"


def puzzle_raw(**overrides) -> dict:
    raw = {
        "puzzle_id": PUZZLE_ID,
        "accepted_answers": ["가상정답"],
        "on_correct": {"grant_clue_ids": [], "set_flags": {}},
        "hints": [{"level": 1, "text": HINT_1}, {"level": 2, "text": HINT_2}],
    }
    raw.update(overrides)
    return raw


def runtime_raw(**puzzle_overrides) -> dict:
    return {
        "schema_version": "0.1",
        "case_id": CASE_ID,
        "puzzles": [
            puzzle_raw(**puzzle_overrides),
            {
                "puzzle_id": "PZ_TEST_NO_HINT",
                "accepted_answers": ["다른정답"],
                "on_correct": {"grant_clue_ids": [], "set_flags": {}},
            },
        ],
        "clue_combinations": [],
    }


def make_runtime() -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition.model_validate(runtime_raw())


def load_runtime(case_id: str) -> PuzzleRuntimeDefinition:
    assert case_id == CASE_ID
    return make_runtime()


def make_play_session(hint_levels: dict | None = None) -> PlaySession:
    now = datetime(2026, 10, 28, 1, 2, 3)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anonymous-session-id",
        case_id=CASE_ID,
        state_json={
            "current_zone_id": "ZONE_TEST",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": hint_levels or {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


# --- 파싱 ---


def test_server_hints_parse_levels_one_and_two() -> None:
    puzzle = PuzzleDefinition.model_validate(puzzle_raw())

    assert [(hint.level, hint.text) for hint in puzzle.hints] == [
        (1, HINT_1),
        (2, HINT_2),
    ]
    assert puzzle.hint_text(1) == HINT_1
    assert puzzle.hint_text(2) == HINT_2


def test_level_one_only_is_allowed() -> None:
    puzzle = PuzzleDefinition.model_validate(
        puzzle_raw(hints=[{"level": 1, "text": HINT_1}])
    )

    assert puzzle.hint_text(1) == HINT_1
    assert puzzle.hint_text(2) is None


def test_puzzle_without_hints_defaults_to_empty() -> None:
    raw = puzzle_raw()
    del raw["hints"]

    assert PuzzleDefinition.model_validate(raw).hints == []


def test_existing_case_001_still_loads_without_hints() -> None:
    runtime = load_case_runtime("case_001")

    assert all(puzzle.hints == [] for puzzle in runtime.puzzles)


@pytest.mark.parametrize(
    "hints",
    [
        [{"level": 1, "text": HINT_1}, {"level": 1, "text": "(가상) 다른 원문"}],
        [{"level": 2, "text": HINT_2}],
        [{"level": 1, "text": "   "}],
        [{"level": 1, "text": ""}],
        [{"level": 0, "text": HINT_1}],
        [{"level": 3, "text": HINT_1}],
        [{"level": True, "text": HINT_1}],
        [{"level": "1", "text": HINT_1}],
        [{"level": 1.0, "text": HINT_1}],
        [{"level": 1}],
        [{"text": HINT_1}],
        [{"level": 1, "text": HINT_1, "note": "x"}],
    ],
    ids=[
        "duplicate_level",
        "level_two_without_one",
        "blank_text",
        "empty_text",
        "level_zero",
        "level_three",
        "bool_level",
        "string_level",
        "float_level",
        "missing_text",
        "missing_level",
        "unknown_field",
    ],
)
def test_invalid_server_hints_are_rejected(hints: list) -> None:
    with pytest.raises(ValidationError):
        PuzzleDefinition.model_validate(puzzle_raw(hints=hints))


def test_hint_error_messages_do_not_contain_hint_text() -> None:
    secret = "(가상) 노출되면 안 되는 원문"
    for hints in (
        [{"level": 1, "text": secret}, {"level": 1, "text": secret}],
        [{"level": 2, "text": secret}],
    ):
        with pytest.raises(ValidationError) as info:
            PuzzleDefinition.model_validate(puzzle_raw(hints=hints))
        messages = " ".join(item["msg"] for item in info.value.errors())
        assert secret not in messages
        assert "가상정답" not in messages


# --- HintSource ---


def test_server_hint_text_reads_server_runtime() -> None:
    runtime = make_runtime()

    assert server_hint_text(runtime, PUZZLE_ID, 1) == HINT_1
    assert server_hint_text(runtime, PUZZLE_ID, 2) == HINT_2
    assert server_hint_text(runtime, "PZ_TEST_NO_HINT", 1) is None
    assert server_hint_text(runtime, "PZ_UNKNOWN", 1) is None


def test_server_hint_source_uses_runtime_loader() -> None:
    source = server_hint_source(load_runtime)

    assert source(CASE_ID, PUZZLE_ID, 1) == HINT_1
    assert source(CASE_ID, PUZZLE_ID, 2) == HINT_2
    assert source(CASE_ID, "PZ_TEST_NO_HINT", 2) is None


def test_pinned_content_hint_source_accepts_server_resolver() -> None:
    from app.schemas.case_content import CaseClientContent

    client = CaseClientContent.model_validate(
        {
            "case_id": CASE_ID,
            "entry_zone_id": "ZONE_TEST",
            "zones": [
                {
                    "zone_id": "ZONE_TEST",
                    "zone_name": "zone",
                    "zone_type": "room",
                    "description": "",
                    "objects": [],
                    "navigation": [],
                }
            ],
        }
    )
    pinned = PinnedContent(
        ContentPin(CASE_ID, 1, "a" * 64),
        client=client,
        server=make_runtime(),
        npc=None,
        idmap=None,
    )

    source = pinned.hint_source(server_hint_text)

    assert source(CASE_ID, PUZZLE_ID, 2) == HINT_2


@pytest.mark.anyio
async def test_unlock_hint_returns_server_text() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    db.scalar_result = None

    result = await unlock_hint(
        db,
        "play-session-id",
        PUZZLE_ID,
        HintUnlockRequest(
            client_event_id="hint-event-1",
            client_timestamp=datetime(2026, 10, 28, 3, 0, tzinfo=timezone.utc),
            target_level=1,
        ),
        hint_source=server_hint_source(load_runtime),
        access_policy=lambda state, puzzle, level: None,
        runtime_loader=load_runtime,
    )

    assert result.hint.text == HINT_1
    # 원문은 이벤트에 저장하지 않는다(기존 방침).
    assert HINT_1 not in json.dumps(db.added[0].response_json, ensure_ascii=False)


@pytest.mark.anyio
async def test_unlock_hint_without_server_text_is_not_found() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session()
    db.scalar_result = None

    with pytest.raises(HintNotFoundError):
        await unlock_hint(
            db,
            "play-session-id",
            "PZ_TEST_NO_HINT",
            HintUnlockRequest(client_event_id="hint-event-1", target_level=1),
            hint_source=server_hint_source(load_runtime),
            access_policy=lambda state, puzzle, level: None,
            runtime_loader=load_runtime,
        )


@pytest.mark.anyio
async def test_npc_reshow_returns_server_text_verbatim() -> None:
    db = FakeAsyncSession()
    db.get_result = make_play_session({PUZZLE_ID: 2})
    db.scalar_result = None

    result = await process_npc_request(
        db,
        "play-session-id",
        NpcHintReshowRequest(
            client_event_id="npc-event-1",
            kind="hint_reshow",
            npc_id="NPC_TEST",
            puzzle_id=PUZZLE_ID,
            hint_level=2,
        ),
        line_source=lambda case_id, npc_id, line_id: None,
        hint_source=server_hint_source(load_runtime),
        runtime_loader=load_runtime,
    )

    assert result.reshown_hint is not None
    assert result.reshown_hint.text == HINT_2


# --- 다른 파일로의 원문 유출 방지 ---


def test_npc_pack_rejects_hint_text_and_accepts_level_refs() -> None:
    base = {
        "schema_version": "npc-pack 0.1",
        "case_id": CASE_ID,
        "npc_id": "NPC_TEST",
        "status": "draft",
        "puzzles": [
            {
                "puzzle_id": PUZZLE_ID,
                "nudges": [
                    {
                        "line_id": "NUDGE_TEST_01",
                        "text": "(가상) 한 번 더 둘러보자.",
                        "reveal_when": {"always": True},
                    }
                ],
                "hints": [{"level": 1}, {"level": 2}],
            }
        ],
    }
    pack = NpcContentPack.model_validate(base)

    issues = validate_npc_content_links(
        pack, make_runtime(), hint_source=server_hint_source(load_runtime)
    )
    assert issues == ()

    base["puzzles"][0]["hints"] = [{"level": 1, "text": HINT_1}]
    with pytest.raises(ValidationError):
        NpcContentPack.model_validate(base)


def test_npc_level_ref_without_server_text_is_reported() -> None:
    pack = NpcContentPack.model_validate(
        {
            "schema_version": "npc-pack 0.1",
            "case_id": CASE_ID,
            "npc_id": "NPC_TEST",
            "status": "draft",
            "puzzles": [
                {
                    "puzzle_id": "PZ_TEST_NO_HINT",
                    "nudges": [
                        {
                            "line_id": "NUDGE_TEST_01",
                            "text": "(가상) 한 번 더 둘러보자.",
                            "reveal_when": {"always": True},
                        }
                    ],
                    "hints": [{"level": 1}],
                }
            ],
        }
    )

    issues = validate_npc_content_links(
        pack, make_runtime(), hint_source=server_hint_source(load_runtime)
    )

    assert [issue.code for issue in issues] == ["UNDEFINED_HINT_LEVEL"]


def test_client_containing_server_hint_text_is_a_leak() -> None:
    clean = json.loads((CASES_DIR / "case_001.client.json").read_text("utf-8"))
    leaked = json.loads(json.dumps(clean))
    leaked["zones"][0]["description"] = HINT_1
    source = server_hint_source(load_runtime)
    runtime = make_runtime()

    assert _client_leaks(clean, CASE_ID, runtime, source) == []
    assert f"hint:{PUZZLE_ID}:1" in _client_leaks(leaked, CASE_ID, runtime, source)


def test_typed_construction_defaults_hints_to_empty() -> None:
    puzzle = PuzzleDefinition(
        puzzle_id=PUZZLE_ID,
        accepted_answers=["가상정답"],
        on_correct=RuntimeEffect(grant_clue_ids=[], set_flags={}),
    )

    assert puzzle.hints == []
    assert HintDefinition(level=1, text=HINT_1).text == HINT_1
