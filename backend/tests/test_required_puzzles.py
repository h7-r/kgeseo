from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.play_session import PlaySession
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.puzzle_runtime import CaseRuntimeValidationError, load_case_runtime
from tests.conftest import FakeAsyncSession
from tests.naju_mini_case import (
    CASE_ID,
    INTERACTIONS_URL,
    PUZZLES_MISSING,
    input_body,
    inspect_body,
    make_play_session,
    prepare_case_directory,
    puzzle,
    runtime_data,
    select_body,
    write_case,
)


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    return prepare_case_directory(tmp_path, monkeypatch)


def runtime_with_puzzles(*puzzles: dict) -> dict:
    return {
        "schema_version": "0.2-draft",
        "case_id": CASE_ID,
        "puzzles": list(puzzles),
        "clue_combinations": [],
    }


def assert_rejected_without_side_effects(
    response,
    db_session: FakeAsyncSession,
    play_session: PlaySession,
    state_before: dict,
    missing: int,
) -> None:
    assert response.status_code == 409
    assert response.json() == {
        "detail": PUZZLES_MISSING,
        "missing_puzzle_count": missing,
    }
    # 내부 퍼즐 ID · 정답을 알리지 않는다
    for secret in ("PZ_", "moon-wave", "do-mi-sol", "offered"):
        assert secret not in response.text
    assert play_session.state_json == state_before
    assert db_session.added == []
    assert db_session.commit_count == 0
    assert db_session.rollback_count == 1


# ── 콘텐츠 스키마 ──


def test_existing_content_defaults_to_no_required_puzzles() -> None:
    runtime = load_case_runtime("case_001")

    assert all(puzzle.requires_puzzle_ids == [] for puzzle in runtime.puzzles)


def test_required_puzzles_are_loaded_from_content() -> None:
    runtime = PuzzleRuntimeDefinition.model_validate(runtime_data())

    posts = next(p for p in runtime.puzzles if p.puzzle_id == "PZ_POSTS")
    assert posts.requires_puzzle_ids == ["PZ_JARS"]


@pytest.mark.parametrize(
    ("puzzles", "message"),
    [
        pytest.param(
            [puzzle("A", "a", requires_puzzle_ids=["NOPE"])],
            "Puzzle 'A' requires unknown puzzle 'NOPE'",
            id="unknown",
        ),
        pytest.param(
            [puzzle("A", "a", requires_puzzle_ids=["B", "B"]), puzzle("B", "b")],
            "Puzzle 'A' requires_puzzle_ids has duplicate 'B'",
            id="duplicate",
        ),
        pytest.param(
            [puzzle("A", "a", requires_puzzle_ids=[" "])],
            "Puzzle 'A' requires_puzzle_ids must not contain blank IDs",
            id="blank",
        ),
        pytest.param(
            [puzzle("A", "a", requires_puzzle_ids=["A"])],
            "Puzzle 'A' must not require itself",
            id="self",
        ),
        pytest.param(
            [
                puzzle("A", "a", requires_puzzle_ids=["B"]),
                puzzle("B", "b", requires_puzzle_ids=["A"]),
            ],
            "requires_puzzle_ids has a cycle",
            id="two-cycle",
        ),
        pytest.param(
            [
                puzzle("A", "a", requires_puzzle_ids=["C"]),
                puzzle("B", "b", requires_puzzle_ids=["A"]),
                puzzle("C", "c", requires_puzzle_ids=["B"]),
            ],
            "requires_puzzle_ids has a cycle",
            id="three-cycle",
        ),
    ],
)
def test_invalid_required_puzzles_are_rejected(puzzles: list, message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        PuzzleRuntimeDefinition.model_validate(runtime_with_puzzles(*puzzles))


def test_diamond_dependency_is_allowed() -> None:
    runtime = PuzzleRuntimeDefinition.model_validate(
        runtime_with_puzzles(
            puzzle("A", "a"),
            puzzle("B", "b", requires_puzzle_ids=["A"]),
            puzzle("C", "c", requires_puzzle_ids=["A"]),
            puzzle("D", "d", requires_puzzle_ids=["B", "C"]),
        )
    )

    assert [p.puzzle_id for p in runtime.puzzles] == ["A", "B", "C", "D"]


def test_runtime_file_with_cycle_fails_to_load(case_directory: Path) -> None:
    write_case(
        case_directory,
        runtime=runtime_with_puzzles(
            puzzle("A", "a", requires_puzzle_ids=["B"]),
            puzzle("B", "b", requires_puzzle_ids=["A"]),
        ),
    )

    with pytest.raises(CaseRuntimeValidationError):
        load_case_runtime(CASE_ID)


# ── 판정 ──


@pytest.mark.parametrize("answer", ["moon-wave-sun-bird", "WRONG"])
def test_missing_required_puzzle_rejects_before_grading(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
    answer: str,
) -> None:
    play_session = make_play_session(acquired_clue_ids=["CL_NOTE"])
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_POSTS", answer))

    # 정답 · 오답이 같은 409라서 응답으로 정답 여부를 알 수 없다
    assert_rejected_without_side_effects(
        response, db_session, play_session, state_before, 1
    )
    assert "PZ_POSTS" not in play_session.state_json["attempt_counts"]


def test_required_puzzles_are_checked_before_required_clues(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_POSTS", "moon-wave-sun-bird")
    )

    assert_rejected_without_side_effects(
        response, db_session, play_session, state_before, 1
    )


def test_missing_count_counts_every_unfinished_required_puzzle(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = runtime_data()
    birds = next(p for p in runtime["puzzles"] if p["puzzle_id"] == "PZ_BIRDS")
    birds["requires_puzzle_ids"] = ["PZ_JARS", "PZ_POSTS", "PZ_OFFERING"]
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session(completed_puzzle_ids=["PZ_JARS"])
    state_before = deepcopy(play_session.state_json)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    assert_rejected_without_side_effects(
        response, db_session, play_session, state_before, 2
    )


def test_puzzle_runs_normally_after_required_puzzles_completed(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_JARS"], acquired_clue_ids=["CL_NOTE"]
    )
    db_session.get_result = play_session

    wrong = client.post(INTERACTIONS_URL, json=input_body("OBJ_POSTS", "WRONG"))
    right = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_POSTS", "Moon-Wave-Sun-Bird")
    )

    assert wrong.json()["result_type"] == "incorrect"
    assert wrong.json()["attempt_count"] == 1
    assert right.json()["result_type"] == "correct"
    assert right.json()["attempt_count"] == 2
    assert right.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_POSTS"}
    ]


def test_already_completed_is_checked_before_required_puzzles(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    # 선행 조건이 콘텐츠에 나중에 추가된 경우에도 완료한 퍼즐은 그대로 완료다
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_POSTS"], attempt_counts={"PZ_POSTS": 3}
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_POSTS", "anything"))

    assert response.status_code == 200
    assert response.json()["result_type"] == "already_completed"
    assert response.json()["attempt_count"] == 3


def test_required_puzzle_completed_by_effect_counts(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = runtime_data()
    runtime["inspections"][0]["on_inspect"]["complete_puzzle_ids"] = ["PZ_JARS"]
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session()
    db_session.get_result = play_session

    client.post(INTERACTIONS_URL, json=inspect_body("OBJ_NOTE"))
    response = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_POSTS", "moon-wave-sun-bird")
    )

    assert response.json()["result_type"] == "correct"
