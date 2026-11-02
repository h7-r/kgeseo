from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.play_session import PlaySessionState
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition, SceneDefinition
from app.schemas.scene_condition import (
    LEAF_CONDITIONS,
    UNSUPPORTED_CONDITIONS,
    UnsupportedClearWhen,
    parse_clear_when,
)
from app.services.puzzle_runtime import load_case_runtime
from app.services.scene_progress import clear_scenes
from app.services.scene_validation import assess_scenes
from tests.conftest import FakeAsyncSession
from tests.naju_mini_case import (
    INTERACTIONS_URL,
    PLAY_SESSION_ID,
    effect,
    input_body,
    inspect_body,
    make_play_session,
    prepare_case_directory,
    runtime_data,
    select_body,
    write_case,
)

FERRY = {"scene_id": "SCENE_FERRY", "clear_when": {"puzzle_completed": "PZ_JARS"}}
NOTE = {
    "scene_id": "SCENE_NOTE",
    "clear_when": {"flag": {"name": "note_read", "eq": True}},
}
ALTAR = {"scene_id": "SCENE_ALTAR", "clear_when": {"puzzle_completed": "PZ_OFFERING"}}
OFFERING = {
    "scene_id": "SCENE_OFFERING",
    "clear_when": {
        "all": [
            {"puzzle_completed": "PZ_POSTS"},
            {"flag": {"name": "offering_done", "eq": True}},
        ]
    },
}
BIRDS = {"scene_id": "SCENE_BIRDS", "clear_when": {"puzzle_completed": "PZ_BIRDS"}}
SCENES = [FERRY, NOTE, ALTAR, OFFERING, BIRDS]
# PZ_OFFERING을 풀 수 있는 상태(선행 퍼즐 완료, 그 퍼즐로 끝나는 장면은 이미 완료)
BEFORE_OFFERING = {
    "completed_puzzle_ids": ["PZ_JARS", "PZ_POSTS"],
    "completed_scene_ids": ["SCENE_FERRY"],
}


def scene_runtime_data(scenes: list | None = None) -> dict:
    data = runtime_data()
    data["inspections"][0]["on_inspect"] = effect(
        grant_clue_ids=["CL_NOTE"], set_flags={"note_read": True}
    )
    data["scenes"] = deepcopy(SCENES if scenes is None else scenes)
    return data


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = prepare_case_directory(tmp_path, monkeypatch)
    write_case(directory, runtime=scene_runtime_data())
    return directory


def cleared(*scene_ids: str) -> list[dict]:
    return [{"type": "scene_cleared", "scene_id": scene_id} for scene_id in scene_ids]


# ── 콘텐츠 모델 · 기존 콘텐츠 호환 ──


def test_existing_content_has_no_scenes() -> None:
    assert load_case_runtime("case_001").scenes == []


def test_runtime_without_scenes_key_is_valid() -> None:
    data = scene_runtime_data()
    del data["scenes"]

    assert PuzzleRuntimeDefinition.model_validate(data).scenes == []


def test_scene_runtime_keeps_scenes_in_definition_order() -> None:
    runtime = PuzzleRuntimeDefinition.model_validate(scene_runtime_data())

    assert [scene.scene_id for scene in runtime.scenes] == [
        "SCENE_FERRY",
        "SCENE_NOTE",
        "SCENE_ALTAR",
        "SCENE_OFFERING",
        "SCENE_BIRDS",
    ]
    assert runtime.scenes[3].clear_when_leaves == (
        ("puzzle_completed", "PZ_POSTS"),
        ("flag", {"name": "offering_done", "eq": True}),
    )
    assert runtime.model_dump()["scenes"] == SCENES


def test_legacy_state_reads_empty_completed_scene_ids() -> None:
    state = PlaySessionState.model_validate(
        {
            "completed_puzzle_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "flags": {},
        }
    )

    assert state.completed_scene_ids == []


# ── 정적 검증과 런타임 모델의 조건 동등성 ──


def _scene(clear_when, scene_id="SCENE_X") -> list:
    return [{"scene_id": scene_id, "clear_when": clear_when}]


EQUIVALENCE_CORPUS = [
    pytest.param([], id="empty"),
    pytest.param(SCENES, id="all-supported"),
    pytest.param(_scene({"flag": {"name": "offering_done", "eq": True}}), id="flag"),
    pytest.param("SCENE", id="not-a-list"),
    pytest.param([{"scene_id": "S"}], id="missing-clear-when"),
    pytest.param([{**FERRY, "title": "x"}], id="extra-field"),
    pytest.param(_scene({"puzzle_completed": "PZ_JARS"}, scene_id=1), id="int-id"),
    pytest.param(_scene({"puzzle_completed": "PZ_JARS"}, scene_id=" "), id="blank-id"),
    pytest.param([FERRY, FERRY], id="duplicate-scene"),
    pytest.param(_scene([{"puzzle_completed": "PZ_JARS"}]), id="list-condition"),
    pytest.param(_scene({}), id="empty-condition"),
    pytest.param(
        _scene({"puzzle_completed": "PZ_JARS", "flag": {"name": "x", "eq": True}}),
        id="two-keys",
    ),
    pytest.param(_scene({"puzzle_completed": ""}), id="blank-puzzle"),
    pytest.param(_scene({"puzzle_completed": "PZ_GHOST"}), id="unknown-puzzle"),
    pytest.param(_scene({"puzle_completed": "PZ_JARS"}), id="typo"),
    pytest.param(_scene({"flag": {"name": "offering_done", "eq": 1}}), id="int-eq"),
    pytest.param(
        _scene({"flag": {"name": "offering_done", "eq": False}}), id="unset-eq"
    ),
    pytest.param(_scene({"flag": {"name": "ghost", "eq": True}}), id="unknown-flag"),
    pytest.param(_scene({"flag": {"name": "offering_done"}}), id="flag-no-eq"),
    pytest.param(_scene({"all": []}), id="empty-all"),
    pytest.param(
        _scene({"all": [{"puzzle_completed": "PZ_JARS"}] * 2}), id="duplicate-leaf"
    ),
    pytest.param(
        _scene({"all": [{"all": [{"puzzle_completed": "PZ_JARS"}]}]}), id="nested-all"
    ),
    *(
        pytest.param(_scene({kind: "PZ_JARS"}), id=f"unsupported-{kind}")
        for kind in sorted(UNSUPPORTED_CONDITIONS)
    ),
    pytest.param(
        _scene({"all": [{"puzzle_completed": "PZ_JARS"}, {"any": []}]}),
        id="unsupported-inside-all",
    ),
]


@pytest.mark.parametrize("scenes", EQUIVALENCE_CORPUS)
def test_runtime_model_accepts_exactly_what_the_gate_passes(scenes) -> None:
    base = PuzzleRuntimeDefinition.model_validate(scene_runtime_data([]))
    gate_passes = assess_scenes(scenes, base).status == "PASS"

    try:
        PuzzleRuntimeDefinition.model_validate(scene_runtime_data(scenes))
        runtime_accepts = True
    except ValidationError:
        runtime_accepts = False

    assert runtime_accepts == gate_passes


@pytest.mark.parametrize(
    ("scenes", "message"),
    [
        pytest.param(
            _scene({"scene_reached": "S1"}),
            "scenes UNVERIFIED: clear_when:SCENE_X:unsupported_condition:scene_reached",
            id="unsupported",
        ),
        pytest.param(
            _scene({"puzzle_completed": "PZ_GHOST"}),
            "scenes FAIL: clear_when:SCENE_X:unknown_puzzle:PZ_GHOST",
            id="unknown-puzzle",
        ),
    ],
)
def test_runtime_model_rejects_scenes_the_gate_blocks(scenes, message) -> None:
    with pytest.raises(ValidationError, match=message):
        PuzzleRuntimeDefinition.model_validate(scene_runtime_data(scenes))


def test_evaluator_covers_exactly_the_leaf_conditions() -> None:
    samples = {
        "puzzle_completed": {"puzzle_completed": "PZ_JARS"},
        "flag": {"flag": {"name": "offering_done", "eq": True}},
    }
    assert set(samples) == LEAF_CONDITIONS
    state = {"completed_puzzle_ids": ["PZ_JARS"], "flags": {"offering_done": True}}

    for condition in samples.values():
        scene = SceneDefinition(scene_id="S", clear_when=condition)
        assert clear_scenes([scene], state)[1] != []


def test_scene_that_skipped_validation_is_not_evaluated() -> None:
    # 검증을 거치지 않은 장면(model_construct)이 와도 미지원 조건을 거짓 · 참으로 넘기지 않는다.
    scene = SceneDefinition.model_construct(
        scene_id="S", clear_when={"scene_reached": "S0"}
    )

    with pytest.raises(UnsupportedClearWhen):
        clear_scenes([scene], {"completed_puzzle_ids": [], "flags": {}})


@pytest.mark.parametrize(
    ("flags", "eq", "met"),
    [
        ({"lit": True}, True, True),
        ({"lit": False}, False, True),
        ({"lit": True}, False, False),
        ({}, False, False),
        ({"lit": 1}, True, False),
        ({"lit": "true"}, True, False),
    ],
)
def test_flag_condition_needs_the_same_bool(flags: dict, eq: bool, met: bool) -> None:
    condition = {"flag": {"name": "lit", "eq": eq}}
    scene = SceneDefinition(scene_id="S", clear_when=condition)
    assert parse_clear_when(condition) == (("flag", {"name": "lit", "eq": eq}),)

    _, changes = clear_scenes([scene], {"completed_puzzle_ids": [], "flags": flags})

    assert (changes != []) is met


# ── 장면 완료 판정 ──


def test_correct_answer_clears_single_scene(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_JARS", "do-mi-sol"))

    assert response.status_code == 200
    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_JARS"},
        *cleared("SCENE_FERRY"),
    ]
    assert play_session.state_json["completed_scene_ids"] == ["SCENE_FERRY"]
    assert play_session.completed_at is None
    assert db_session.commit_count == 1


def test_incorrect_answer_clears_nothing(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_JARS", "wrong"))

    assert response.json()["state_changes"] == []
    assert "completed_scene_ids" not in play_session.state_json


def test_flag_effect_from_inspect_clears_scene(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_NOTE"))

    assert response.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CL_NOTE"},
        {"type": "flag_updated", "flag": "note_read", "value": True},
        *cleared("SCENE_NOTE"),
    ]
    assert play_session.state_json["completed_scene_ids"] == ["SCENE_NOTE"]


def test_all_condition_waits_for_every_leaf(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    # PZ_POSTS만 풀면 SCENE_OFFERING의 flag가 아직 없다.
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_JARS"],
        acquired_clue_ids=["CL_NOTE"],
        completed_scene_ids=["SCENE_FERRY", "SCENE_NOTE"],
    )
    db_session.get_result = play_session

    response = client.post(
        INTERACTIONS_URL, json=input_body("OBJ_POSTS", "moon-wave-sun-bird")
    )

    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_POSTS"}
    ]
    assert play_session.state_json["completed_scene_ids"] == [
        "SCENE_FERRY",
        "SCENE_NOTE",
    ]


def test_scenes_met_together_clear_in_definition_order(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**BEFORE_OFFERING)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_OFFERING"},
        {"type": "flag_updated", "flag": "offering_done", "value": True},
        *cleared("SCENE_ALTAR", "SCENE_OFFERING"),
    ]
    assert play_session.state_json["completed_scene_ids"] == [
        "SCENE_FERRY",
        "SCENE_ALTAR",
        "SCENE_OFFERING",
    ]
    # 장면 완료는 Case 완료가 아니다(case_completion은 PZ_BIRDS까지 요구한다).
    assert play_session.completed_at is None


def test_definition_order_not_id_order_decides_clear_order(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    write_case(case_directory, runtime=scene_runtime_data([OFFERING, ALTAR]))
    play_session = make_play_session(**BEFORE_OFFERING)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.json()["state_changes"][-2:] == cleared(
        "SCENE_OFFERING", "SCENE_ALTAR"
    )


def test_cleared_scene_is_not_cleared_again(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_JARS"], completed_scene_ids=["SCENE_FERRY"]
    )
    db_session.get_result = play_session
    state_before = deepcopy(play_session.state_json)

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_JARS", "do-mi-sol"))

    assert response.json()["result_type"] == "already_completed"
    assert response.json()["state_changes"] == []
    assert play_session.state_json == state_before


def test_last_puzzle_clears_scene_then_completes_case_in_same_commit(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(
        completed_puzzle_ids=["PZ_JARS", "PZ_POSTS", "PZ_OFFERING"],
        completed_scene_ids=["SCENE_FERRY", "SCENE_ALTAR"],
        flags={"offering_done": True},
    )
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_BIRDS", "facing"))

    # SCENE_OFFERING은 조건이 이미 참이었으므로 이번 상호작용에서 함께 기록된다.
    assert response.json()["state_changes"] == [
        {"type": "puzzle_completed", "puzzle_id": "PZ_BIRDS"},
        *cleared("SCENE_OFFERING", "SCENE_BIRDS"),
        {"type": "case_completed"},
    ]
    assert play_session.state_json["completed_scene_ids"] == [
        "SCENE_FERRY",
        "SCENE_ALTAR",
        "SCENE_OFFERING",
        "SCENE_BIRDS",
    ]
    assert play_session.completed_at is not None
    assert db_session.commit_count == 1
    assert len(db_session.added) == 1


def test_scene_clears_after_case_completion_without_touching_completed_at(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    completed_at = datetime(2026, 11, 2, 9, 0, 0)
    play_session = make_play_session(completed_at=completed_at)
    db_session.get_result = play_session

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_JARS", "do-mi-sol"))

    assert response.json()["state_changes"][-1] == cleared("SCENE_FERRY")[0]
    assert play_session.completed_at == completed_at


def test_replay_returns_first_response_without_second_clear(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session(**BEFORE_OFFERING)
    db_session.get_result = play_session
    request = select_body("OBJ_ALTAR", "offered")
    first = client.post(INTERACTIONS_URL, json=request)
    db_session.scalar_result = db_session.added[0]

    replay = client.post(INTERACTIONS_URL, json=request)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert play_session.state_json["completed_scene_ids"] == [
        "SCENE_FERRY",
        "SCENE_ALTAR",
        "SCENE_OFFERING",
    ]
    assert len(db_session.added) == 1
    assert db_session.commit_count == 1


def test_rejected_interaction_clears_nothing(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    # 선행 퍼즐 부족(409)이면 이미 참인 장면 조건도 기록하지 않는다(아무것도 저장하지 않는다).
    play_session = make_play_session(completed_puzzle_ids=["PZ_JARS"])
    db_session.get_result = play_session
    state_before = deepcopy(play_session.state_json)

    response = client.post(INTERACTIONS_URL, json=select_body("OBJ_ALTAR", "offered"))

    assert response.status_code == 409
    assert play_session.state_json == state_before
    assert db_session.commit_count == 0


def test_unsupported_clear_when_on_disk_stops_the_interaction(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    runtime = scene_runtime_data([*SCENES, _scene({"any": []})[0]])
    write_case(case_directory, runtime=runtime)
    play_session = make_play_session()
    db_session.get_result = play_session
    state_before = deepcopy(play_session.state_json)

    response = client.post(INTERACTIONS_URL, json=input_body("OBJ_JARS", "do-mi-sol"))

    assert response.status_code == 500
    assert response.json() == {"detail": "Puzzle runtime is unavailable."}
    assert play_session.state_json == state_before
    assert db_session.added == []
    assert db_session.commit_count == 0


# ── 조회 · 계약 ──


def test_play_session_read_returns_completed_scene_ids(
    client: TestClient,
    db_session: FakeAsyncSession,
    case_directory: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session
    client.post(INTERACTIONS_URL, json=input_body("OBJ_JARS", "do-mi-sol"))

    response = client.get(f"/api/v1/play-sessions/{PLAY_SESSION_ID}")

    assert response.json()["data"]["state"]["completed_scene_ids"] == ["SCENE_FERRY"]


def test_openapi_lists_scene_cleared_state_change(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]

    items = schemas["InteractionApiResponse"]["properties"]["state_changes"]["items"]
    mapping = items["discriminator"]["mapping"]
    assert mapping["scene_cleared"] == "#/components/schemas/SceneClearedStateChange"
    assert set(schemas["SceneClearedStateChange"]["properties"]) == {
        "type",
        "scene_id",
    }
    assert "completed_scene_ids" in schemas["PlaySessionState"]["properties"]
