from copy import deepcopy
from typing import Any

import pytest

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.scene_validation import assess_scenes
from tests.test_publication_gate import (
    CASE_ID,
    HINTS,
    approvals_for,
    base_documents,
    encode,
    run,
    seal,
    statuses,
)

# 가상 테스트 데이터. 실제 나주 장면 · 승인 기록이 아니다.
SERVER = PuzzleRuntimeDefinition.model_validate(
    {
        "schema_version": "0.1",
        "case_id": CASE_ID,
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_A",
                "accepted_answers": ["a"],
                "on_correct": {"grant_clue_ids": [], "set_flags": {"gate_open": True}},
            },
            {
                "puzzle_id": "PUZZLE_B",
                "accepted_answers": ["b"],
                "on_correct": {"grant_clue_ids": [], "set_flags": {"lamp_on": False}},
            },
        ],
        "clue_combinations": [],
    }
)


def scene(clear_when: Any, scene_id: str = "SCENE_ONE") -> dict:
    return {"scene_id": scene_id, "clear_when": clear_when}


PUZZLE_A = {"puzzle_completed": "PUZZLE_A"}
GATE_OPEN = {"flag": {"name": "gate_open", "eq": True}}


# ── 정적 검증: 통과 ──


@pytest.mark.parametrize(
    "clear_when",
    [
        pytest.param(PUZZLE_A, id="puzzle"),
        pytest.param(GATE_OPEN, id="flag-true"),
        pytest.param({"flag": {"name": "lamp_on", "eq": False}}, id="flag-false"),
        pytest.param({"all": [PUZZLE_A, GATE_OPEN]}, id="all"),
        pytest.param({"all": [PUZZLE_A]}, id="all-single"),
    ],
)
def test_supported_clear_when_passes(clear_when: dict) -> None:
    result = assess_scenes([scene(clear_when)], SERVER)

    assert result.status == "PASS"
    assert result.reasons == ()


def test_multiple_scenes_pass_and_report_puzzle_references() -> None:
    result = assess_scenes(
        [
            scene(PUZZLE_A),
            scene({"all": [{"puzzle_completed": "PUZZLE_B"}, GATE_OPEN]}, "SCENE_TWO"),
        ],
        SERVER,
    )

    assert result.status == "PASS"
    assert result.scene_ids == ("SCENE_ONE", "SCENE_TWO")
    assert result.puzzle_references == (
        ("SCENE_ONE", "PUZZLE_A"),
        ("SCENE_TWO", "PUZZLE_B"),
    )


# ── 정적 검증: 잘못된 형식 · 참조 ──


@pytest.mark.parametrize(
    ("scenes", "reason"),
    [
        pytest.param({"scene_id": "SCENE_ONE"}, "scenes:not_a_list", id="not-list"),
        pytest.param(["SCENE_ONE"], "scenes.0:invalid", id="scene-not-object"),
        pytest.param([{"scene_id": "SCENE_ONE"}], "scenes.0:invalid", id="no-clear"),
        pytest.param(
            [{**scene(PUZZLE_A), "title": "x"}], "scenes.0:invalid", id="extra-field"
        ),
        pytest.param([scene(PUZZLE_A, " ")], "scenes.0:invalid", id="blank-id"),
        pytest.param([scene(PUZZLE_A, 1)], "scenes.0:invalid", id="id-not-string"),
        pytest.param(
            [scene(PUZZLE_A), scene(GATE_OPEN)],
            "duplicate_scene:SCENE_ONE",
            id="duplicate-scene",
        ),
    ],
)
def test_invalid_scene_shape_fails(scenes: Any, reason: str) -> None:
    result = assess_scenes(scenes, SERVER)

    assert result.status == "FAIL"
    assert reason in result.reasons


@pytest.mark.parametrize(
    ("clear_when", "reason"),
    [
        pytest.param(None, "invalid", id="null"),
        pytest.param([PUZZLE_A], "invalid", id="list"),
        pytest.param({}, "invalid", id="no-key"),
        pytest.param({**PUZZLE_A, **GATE_OPEN}, "invalid", id="two-keys"),
        pytest.param({"puzle_completed": "PUZZLE_A"}, "unknown_condition", id="typo"),
        pytest.param({"puzzle_completed": ""}, "invalid", id="blank-puzzle"),
        pytest.param({"puzzle_completed": 1}, "invalid", id="puzzle-not-string"),
        pytest.param({"flag": {"name": "gate_open"}}, "invalid", id="flag-no-eq"),
        pytest.param(
            {"flag": {"name": "gate_open", "eq": 1}}, "invalid", id="flag-eq-int"
        ),
        pytest.param(
            {"flag": {"name": "gate_open", "eq": "true"}}, "invalid", id="flag-eq-str"
        ),
        pytest.param(
            {"flag": {"name": "gate_open", "eq": True, "x": 1}},
            "invalid",
            id="flag-extra",
        ),
        pytest.param({"flag": {"name": " ", "eq": True}}, "invalid", id="flag-blank"),
        pytest.param({"all": PUZZLE_A}, "invalid", id="all-not-list"),
        pytest.param({"all": []}, "empty_group", id="all-empty"),
        pytest.param(
            {"all": [PUZZLE_A, {"puzzle_completed": "PUZZLE_A"}]},
            "duplicate_condition",
            id="duplicate-leaf",
        ),
        pytest.param({"all": [PUZZLE_A, "x"]}, "invalid", id="all-bad-child"),
        pytest.param(
            {"puzzle_completed": "PUZZLE_NOPE"},
            "unknown_puzzle:PUZZLE_NOPE",
            id="unknown-puzzle",
        ),
        pytest.param(
            {"flag": {"name": "never_set", "eq": True}},
            "unknown_flag:never_set",
            id="unknown-flag",
        ),
        pytest.param(
            {"flag": {"name": "gate_open", "eq": False}},
            "unknown_flag:gate_open",
            id="flag-value-never-set",
        ),
        pytest.param(
            {"all": [PUZZLE_A, {"puzzle_completed": "PUZZLE_NOPE"}]},
            "unknown_puzzle:PUZZLE_NOPE",
            id="unknown-inside-all",
        ),
    ],
)
def test_invalid_clear_when_fails(clear_when: Any, reason: str) -> None:
    result = assess_scenes([scene(clear_when)], SERVER)

    assert result.status == "FAIL"
    assert result.reasons == (f"clear_when:SCENE_ONE:{reason}",)


# ── 정적 검증: 계약에는 있지만 아직 지원하지 않는 조건 ──


@pytest.mark.parametrize(
    ("clear_when", "kind"),
    [
        pytest.param({"any": [PUZZLE_A, GATE_OPEN]}, "any", id="any"),
        pytest.param({"always": True}, "always", id="always"),
        pytest.param({"clue_acquired": "CLUE_A"}, "clue_acquired", id="clue"),
        pytest.param(
            {"hint_level": {"puzzle": "PUZZLE_A", "gte": 1}}, "hint_level", id="hint"
        ),
        pytest.param({"scene_reached": "SCENE_TWO"}, "scene_reached", id="reached"),
        pytest.param({"scene_cleared": "SCENE_TWO"}, "scene_cleared", id="cleared"),
        pytest.param({"ending_reached": "END_A"}, "ending_reached", id="ending"),
        pytest.param({"all": [{"all": [PUZZLE_A]}]}, "all", id="nested-all"),
        pytest.param(
            {"all": [PUZZLE_A, {"any": [GATE_OPEN]}]}, "any", id="any-inside-all"
        ),
    ],
)
def test_unsupported_clear_when_stays_unverified(clear_when: dict, kind: str) -> None:
    result = assess_scenes([scene(clear_when)], SERVER)

    assert result.status == "UNVERIFIED"
    assert result.reasons == (f"clear_when:SCENE_ONE:unsupported_condition:{kind}",)


def test_failure_outranks_unsupported_condition() -> None:
    result = assess_scenes(
        [
            scene({"any": [PUZZLE_A]}),
            scene({"puzzle_completed": "PUZZLE_NOPE"}, "SCENE_TWO"),
        ],
        SERVER,
    )

    assert result.status == "FAIL"
    assert result.reasons == (
        "clear_when:SCENE_ONE:unsupported_condition:any",
        "clear_when:SCENE_TWO:unknown_puzzle:PUZZLE_NOPE",
    )


def test_assessment_does_not_mutate_input() -> None:
    scenes = [scene({"all": [PUZZLE_A, GATE_OPEN]})]
    before = deepcopy(scenes)

    assess_scenes(scenes, SERVER)

    assert scenes == before


# ── 게시 게이트 ──


def with_scenes(scenes: list[dict], *, idmap: bool = True, **kwargs: Any):
    documents = base_documents(**kwargs)
    if not idmap:
        del documents["idmap"]
    documents["server"]["scenes"] = scenes
    files, fingerprint = seal(documents)
    if not idmap:
        files = {**files, "idmap": None}
    return files, fingerprint


def test_scene_bundle_with_verifiable_clear_when_is_registered() -> None:
    files, fingerprint = with_scenes([scene(PUZZLE_A)])

    result, store = run(files, fingerprint)

    assert result.check("SCENES").status == "PASS"
    assert set(statuses(result).values()) == {"PASS"}
    assert result.approved is True
    assert result.registered is True
    assert store.versions(CASE_ID) == (1,)
    # 등록한 Server Runtime 모델에 장면이 그대로 실려, 고정 세션의 런타임 로더도 장면을 판정한다.
    pinned = store.get_version(CASE_ID, 1)
    assert pinned.server().puzzles[0].puzzle_id == "PUZZLE_A"
    runtime = pinned.runtime_loader()(CASE_ID)
    assert [s.model_dump() for s in runtime.scenes] == [scene(PUZZLE_A)]


def test_naju_case_with_verifiable_clear_when_is_registered_without_idmap() -> None:
    files, fingerprint = with_scenes(
        [scene(PUZZLE_A)], idmap=False, case_id="naju-angam-01"
    )

    result, store = run(
        files,
        fingerprint,
        hint_source=lambda case_id, puzzle_id, level: HINTS.get(
            (CASE_ID, puzzle_id, level)
        ),
    )

    assert result.check("SCENES").status == "PASS"
    assert result.registered is True
    assert store.versions("naju-angam-01") == (1,)


@pytest.mark.parametrize(
    ("scenes", "reason"),
    [
        pytest.param(
            [scene({"puzzle_completed": "PUZZLE_NOPE"})],
            "clear_when:SCENE_ONE:unknown_puzzle:PUZZLE_NOPE",
            id="unknown-puzzle",
        ),
        pytest.param(
            [scene({"flag": {"name": "never_set", "eq": True}})],
            "clear_when:SCENE_ONE:unknown_flag:never_set",
            id="unknown-flag",
        ),
        pytest.param(
            [scene({"all": []})],
            "clear_when:SCENE_ONE:empty_group",
            id="empty-all",
        ),
    ],
)
def test_invalid_scene_bundle_fails_and_is_not_registered(
    scenes: list[dict], reason: str
) -> None:
    files, fingerprint = with_scenes(scenes)

    result, store = run(files, fingerprint)

    assert result.check("SCENES").status == "FAIL"
    assert reason in result.check("SCENES").reasons
    assert result.approved is False
    assert store.versions(CASE_ID) == ()


def test_unsupported_scene_bundle_is_unverified_and_not_registered() -> None:
    files, fingerprint = with_scenes([scene({"any": [PUZZLE_A]})])

    result, store = run(files, fingerprint)

    assert result.check("SCENES").status == "UNVERIFIED"
    assert result.check("SCENES").reasons == (
        "clear_when:SCENE_ONE:unsupported_condition:any",
    )
    assert result.approved is False
    assert store.versions(CASE_ID) == ()


def test_idmap_scene_missing_from_server_scenes_fails() -> None:
    files, fingerprint = with_scenes([scene(PUZZLE_A, "SCENE_OTHER")])

    result, store = run(files, fingerprint)

    assert result.check("SCENES").status == "FAIL"
    assert result.check("SCENES").reasons == (
        "idmap_scene_without_clear_when:SCENE_ONE",
        "scene_not_in_idmap:SCENE_OTHER",
    )
    assert store.versions(CASE_ID) == ()


def test_empty_scene_list_does_not_satisfy_required_scenes() -> None:
    files, fingerprint = with_scenes([])

    result, store = run(files, fingerprint)

    assert result.check("SCENES").status == "UNVERIFIED"
    assert result.check("SCENES").reasons == (
        "scene completion required but no clear_when",
    )
    assert store.versions(CASE_ID) == ()


def test_clear_when_on_non_executable_puzzle_fails_executable_refs() -> None:
    documents = base_documents()
    documents["server"]["scenes"] = [scene(PUZZLE_A)]
    documents["idmap"]["puzzles"][0]["status"] = "placed_no_interaction"
    files, fingerprint = seal(documents)

    result, store = run(files, fingerprint)

    assert "clear_when_puzzle:SCENE_ONE:PUZZLE_A" in (
        result.check("EXECUTABLE_REFS").reasons
    )
    assert result.registered is False


# ── 승인 · fingerprint 게이트 회귀 ──


def test_verifiable_scenes_still_need_trusted_approvals() -> None:
    files, _ = with_scenes([scene(PUZZLE_A)])

    result, store = run(files, None)

    assert result.check("SCENES").status == "PASS"
    assert result.check("APPROVALS").status == "FAIL"
    assert result.registered is False
    assert store.versions(CASE_ID) == ()


def test_approvals_for_previous_scene_content_are_not_reused() -> None:
    # clear_when만 바꿔도 fingerprint가 바뀌어, 이전 내용에 대한 승인은 쓰이지 않는다.
    _, old_fingerprint = with_scenes([scene(PUZZLE_A)])
    files, new_fingerprint = with_scenes([scene({"all": [PUZZLE_A]})])

    result, store = run(files, approval_source=approvals_for(old_fingerprint))

    assert new_fingerprint != old_fingerprint
    assert result.check("SCENES").status == "PASS"
    assert result.check("APPROVALS").status == "FAIL"
    assert store.versions(CASE_ID) == ()


def test_scene_edit_after_sealing_fails_header_check() -> None:
    documents = base_documents()
    documents["server"]["scenes"] = [scene(PUZZLE_A)]
    _, fingerprint = seal(documents)
    documents["server"]["scenes"] = [scene({"all": [PUZZLE_A]})]

    result, store = run(encode(documents), fingerprint)

    assert result.check("HEADER").status == "FAIL"
    assert result.registered is False
    assert store.versions(CASE_ID) == ()
