"""나주 content_version 1 게시 후보(scripts.build_naju_content_v1)의 판정 계약.

정답은 공개 저장소에 두지 않는다. 기본 테스트는 **가상 정답**으로 묶음을 만들어 구조 · 판정 흐름을 본다.
실제 정답 묶음은 `NAJU_V1_BUNDLE_ROOT`(봉인된 게시 루트) · `NAJU_V1_ANSWERS`(비공개 정답 JSON)가 있을 때만 본다.
"""

import json
import os
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest

from app.main import app
from app.schemas.case_content import CaseClientContent
from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services import case_content, puzzle_runtime
from app.services.case_ng_check import build_case_ng_checker
from app.services.interaction import accepts_request_zone
from app.services.pinned_content import ContentPin, PinnedContent, PinnedContentStore
from app.services.publication_gate import evaluate_publication
from app.services.session_content import get_pinned_content_store
from scripts import build_naju_content_v1 as builder
from tests.test_interactions import INTERACTIONS_URL, make_play_session

CASE = builder.CASE_ID
HALL = "ZONE_RIVER_CAVE_HALL"
FERRY = "ZONE_FERRY_TERRACE"
BEACH = "ZONE_GRAVEL_BEACH"
# 가상 정답 — 실제 나주 정답이 아니다
SYNTHETIC = {
    "P01": {"hole_count": 7, "clam_holes": [1, 4]},
    "P03": {"accepted_answers": ["5,4,3,2,1,0"]},
    "P09": {"accepted_answers": ["11,22,33"]},
}


def drafts():
    idmap = json.loads(builder.DEFAULT_IDMAP_DRAFT.read_text(encoding="utf-8"))
    lines = json.loads(builder.DEFAULT_NPC_LINES.read_text(encoding="utf-8"))
    return idmap, lines


def built(answers=SYNTHETIC):
    idmap, lines = drafts()
    return builder.build_documents(answers, idmap, lines)


def legacy(document):
    """기본 로더(`<case>.server.json`)는 파일 머리를 모른다."""
    return {
        k: v
        for k, v in document.items()
        if k not in {"content_version", "content_fingerprint", "status"}
    }


@pytest.fixture
def naju_case(tmp_path, monkeypatch):
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)

    def write(documents):
        for role in ("client", "server"):
            (tmp_path / f"{CASE}.{role}.json").write_text(
                json.dumps(legacy(documents[role]), ensure_ascii=False),
                encoding="utf-8",
            )

    write(built())
    return write


def session(zone=FERRY, **extra):
    row = make_play_session(
        state={
            "current_zone_id": zone,
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
            **extra,
        }
    )
    row.case_id = CASE
    return row


def body(object_id, action, zone, payload=None):
    return {
        "client_event_id": str(uuid4()),
        "client_timestamp": "2026-11-08T12:00:00+09:00",
        "zone_id": zone,
        "action": action,
        "target_type": "object",
        "target_id": object_id,
        "payload": payload or {},
    }


def answer(object_id, zone, value):
    return body(object_id, "input", zone, {"answer": value})


# ── 1. 구조: 공식 ID · 서버 연결 범위 ──


def test_v1_connects_only_p01_p03_p07_p09_and_tablet_with_official_ids():
    docs = built()
    server = docs["server"]
    assert [p["puzzle_id"] for p in server["puzzles"]] == ["P01", "P03", "P07", "P09"]
    by_id = {p["puzzle_id"]: p for p in server["puzzles"]}
    assert by_id["P07"]["solve"] == {"mode": "client_skill"}
    assert "accepted_answers" not in by_id["P07"]
    # v1.1 §6: P09 서버 선행은 P07 완료만. 아이템 소비 · 단서 조건 없음
    assert by_id["P09"]["requires_puzzle_ids"] == ["P07"]
    for puzzle in server["puzzles"]:
        assert puzzle.get("consumes_item_ids", []) == []
        assert puzzle.get("requires_clue_ids", []) == []
    targets = {
        obj["object_id"]: (zone["zone_id"], obj["interaction"])
        for zone in docs["client"]["zones"]
        for obj in zone["objects"]
        if obj["interaction"] is not None
    }
    assert targets == {
        "OBJ_S1_CLAM_HOLES": (FERRY, {"type": "input", "target_id": "P01"}),
        "OBJ_S1_JAR_SLOTS": (BEACH, {"type": "input", "target_id": "P03"}),
        "OBJ_S1_CAVE_BIG_CLAM": (HALL, {"type": "complete", "target_id": "P07"}),
        "OBJ_S1_CAVE_RING_DOOR": (HALL, {"type": "input", "target_id": "P09"}),
        "OBJ_S1_CAVE_TABLET": (
            HALL,
            {"type": "inspect", "target_id": builder.TABLET_INSPECT_ID},
        ),
    }
    assert docs["client"]["entry_zone_id"] == FERRY
    assert {z["zone_id"] for z in docs["client"]["zones"]} == {
        FERRY,
        BEACH,
        "ZONE_CLIFF_TOP",
        "ZONE_JINBU_RIDGE",
        HALL,
        "ZONE_RIVER_CAVE_INNER",
    }


def test_idmap_keeps_draft_ids_adds_v11_ids_and_drops_generated_puzzles():
    idmap_draft, _ = drafts()
    idmap = built()["idmap"]
    objects = [o["object_id"] for o in idmap["objects"]]
    groups = [g["object_id_base"] for g in idmap["object_groups_without_instances"]]
    # 10/27 초안 ID는 바꾸지 않는다. v1 게시본에서 빼는 것은 PM 11/8 결정분(차단물 4 · v1 장면 밖 소품 4)뿐이다
    for item in idmap_draft["objects"]:
        if item["object_id"] in builder.EXCLUDED_DRAFT_PROP_IDS:
            assert item["object_id"] not in objects
        else:
            assert item in idmap["objects"]
    assert len(builder.EXCLUDED_DRAFT_PROP_IDS) == 4
    for key in ("navigation", "not_mapped"):
        assert idmap[key] == idmap_draft[key]
    assert idmap["blockers"] == [
        b
        for b in idmap_draft["blockers"]
        if b["object_id"] not in builder.EXCLUDED_BLOCKER_IDS
    ]
    assert [b["object_id"] for b in idmap["blockers"]] == [
        None
    ]  # 수목대(런타임 대응 없음)만 남는다
    client_ids = {
        o["object_id"] for z in built()["client"]["zones"] for o in z["objects"]
    }
    assert not client_ids & (
        builder.EXCLUDED_BLOCKER_IDS | builder.EXCLUDED_DRAFT_PROP_IDS
    )
    assert json.dumps(built()).count("OBJ_BLOCKER_") == 0
    for group in idmap_draft["object_groups_without_instances"]:
        assert group in idmap["object_groups_without_instances"]
    # v1.1 §8 추가분
    assert {z["zone_id"] for z in idmap["zones"]} >= {HALL, "ZONE_RIVER_CAVE_INNER"}
    for object_id in (
        "OBJ_S1_CLAM_HOLES",
        "OBJ_S1_JAR_SLOTS",
        "OBJ_S1_CAVE_BIG_CLAM",
        "OBJ_S1_CAVE_RING_DOOR",
        "OBJ_S1_CAVE_TABLET",
    ):
        assert objects.count(object_id) == 1
    step_ids = [object_id for _, _, object_id in builder.STEP_FOCUS]
    assert len(step_ids) == 12
    assert objects.count("OBJ_S1_BONFIRE_0") == 1 and "OBJ_S1_BONFIRE_0" not in groups
    for object_id in step_ids[1:]:
        assert groups.count(object_id) == 1 and object_id not in objects
    all_ids = (
        objects + groups + [b["object_id"] for b in idmap["blockers"] if b["object_id"]]
    )
    assert len(all_ids) == len(set(all_ids))
    # 생성본 퍼즐 · 단서(PUZZLE_ANGAM_*)는 싣지 않는다(v1.1 §7)
    assert [p["puzzle_id"] for p in idmap["puzzles"]] == ["P01", "P03", "P07", "P09"]
    assert idmap["clues"] == []


def test_scenes_follow_pm_1108_decision():
    docs = built()
    assert docs["server"]["scenes"] == [
        {"scene_id": "SCENE_STAGE1_FERRY", "clear_when": {"puzzle_completed": "P01"}},
        {
            "scene_id": "SCENE_STAGE2_ROCK_CAVE",
            "clear_when": {"puzzle_completed": "P09"},
        },
    ]
    scenes = {s["scene_id"]: s for s in docs["idmap"]["scenes"]}
    assert set(scenes) == {"SCENE_STAGE1_FERRY", "SCENE_STAGE2_ROCK_CAVE"}
    assert scenes["SCENE_STAGE1_FERRY"]["zone_ids"] == [FERRY]
    assert scenes["SCENE_STAGE2_ROCK_CAVE"]["zone_ids"] == [
        BEACH,
        HALL,
        "ZONE_RIVER_CAVE_INNER",
    ]
    # 능선 · 바위 위는 장면에 넣지 않는다(장면 필수 때문에 채우지 않는다)
    in_scenes = {z for s in scenes.values() for z in s["zone_ids"]}
    assert not in_scenes & {"ZONE_JINBU_RIDGE", "ZONE_CLIFF_TOP"}
    puzzle_scene = {p["puzzle_id"]: p["scene_id"] for p in docs["idmap"]["puzzles"]}
    assert puzzle_scene == {
        "P01": "SCENE_STAGE1_FERRY",
        "P03": "SCENE_STAGE2_ROCK_CAVE",
        "P07": "SCENE_STAGE2_ROCK_CAVE",
        "P09": "SCENE_STAGE2_ROCK_CAVE",
    }
    p09 = next(p for p in docs["server"]["puzzles"] if p["puzzle_id"] == "P09")
    assert p09["requires_puzzle_ids"] == ["P07"]


def test_p01_accepts_every_dig_set_that_contains_all_clam_holes():
    answers = builder.p01_accepted_answers(7, [1, 4])
    assert len(answers) == 2**5
    assert "1,4" in answers and "0,1,2,3,4,5,6" in answers and "1,2,4" in answers
    assert "1" not in answers and "0,1,2,3,5,6" not in answers
    assert all(a == ",".join(sorted(a.split(","), key=int)) for a in answers)
    with pytest.raises(builder.BuildError):
        builder.p01_accepted_answers(7, [1, 7])
    with pytest.raises(builder.BuildError):
        builder.p01_accepted_answers(7, [])


def test_answers_are_never_in_client_npc_or_idmap():
    docs = built()
    public = json.dumps(
        [docs["client"], docs["npc"], docs["idmap"]], ensure_ascii=False
    )
    for value in ("5,4,3,2,1,0", "11,22,33", "1,4"):
        assert value not in public


def test_npc_v1_has_puzzle_nudges_only_and_no_situations():
    _, lines = drafts()
    npc = built()["npc"]
    pack = NpcContentPack.model_validate(
        {k: v for k, v in npc.items() if k != "content_fingerprint"}
    )
    assert [p.puzzle_id for p in pack.puzzles] == ["P01", "P03", "P07", "P09"]
    assert "situations" not in npc
    # PM 11/8 G1 확정 검수 목록(빈 배열이 아니다)
    assert [(n.text, n.kind, n.aliases) for n in pack.proper_nouns] == [
        ("아랑사", "person", []),
        ("아비사", "person", ["아비사 처녀"]),
        ("앙암바위", "place", ["앙암바우", "아망바우"]),
        ("진부촌", "place", []),
        ("택촌", "place", []),
        ("영산강", "place", []),
        ("영산포", "place", []),
    ]
    assert [r.text.split()[0] for r in pack.ng] == [f"NG-0{i}" for i in range(1, 7)]
    assert [r.patterns for r in pack.ng] == [
        ["아랑사는 진부촌", "아비사는 택촌"],
        ["살아서 다시 만"],
        [],
        ["씻김굿은 저주"],
        ["밀양 아랑"],
        ["구렁이는 아랑사였다"],
    ]
    assert [r.text.split()[0] for r in pack.open] == ["U-01", "U-02", "U-05"]
    assert all(r.patterns for r in pack.open)
    ids = [n.line_id for p in pack.puzzles for n in p.nudges]
    assert len(ids) == len(set(ids))
    draft_ids = {line["line_id"] for line in lines["lines"]}
    assert set(ids) <= draft_ids


def test_situations_draft_is_separate_and_uses_v11_focus_and_zone_ids():
    idmap, lines = drafts()
    draft = builder.build_situations_draft(lines)
    registered = {o["object_id"] for o in built()["idmap"]["objects"]} | {
        g["object_id_base"] for g in built()["idmap"]["object_groups_without_instances"]
    }
    focus = [
        line["focus_object_id"]
        for situation in draft["situations"]
        for line in situation["lines"]
        if "focus_object_id" in line
    ]
    assert focus and set(focus) <= registered
    zones = {n["zone_id"] for n in draft["general_nudges"] if "zone_id" in n}
    assert zones == set(builder.QUIET_ZONE_IDS.values())
    assert draft["skipped_cave_quiet_line_ids"]
    v1_ids = {n["line_id"] for p in built()["npc"]["puzzles"] for n in p["nudges"]}
    draft_ids = {
        line["line_id"] for s in draft["situations"] for line in s["lines"]
    } | {n["line_id"] for n in draft["general_nudges"]}
    assert not v1_ids & draft_ids


def test_builder_refuses_output_inside_the_repository(capsys):
    assert (
        builder.main(["--answers", "x.json", "--out", str(builder.REPO_ROOT / "tmp")])
        == 1
    )
    assert "outside the repository" in capsys.readouterr().err


# ── 2. 판정 흐름(HTTP, 가짜 DB) ──


def test_p01_correct_even_with_extra_holes_and_incorrect_when_a_clam_is_missing(
    client, db_session, naju_case
):
    row = session()
    db_session.get_result = row
    missing = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CLAM_HOLES", FERRY, "1,2")
    )
    assert missing.json()["result_type"] == "incorrect"
    done = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CLAM_HOLES", FERRY, "1, 2,4")
    )
    assert done.status_code == 200
    assert done.json()["result_type"] == "correct"
    assert {"type": "puzzle_completed", "puzzle_id": "P01"} in done.json()[
        "state_changes"
    ]


def test_p09_is_blocked_until_p07_complete_and_then_graded(
    client, db_session, naju_case
):
    row = session(zone=HALL)
    db_session.get_result = row
    early = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "11,22,33")
    )
    assert early.status_code == 409
    assert early.json() == {
        "detail": "Required puzzles are not completed.",
        "missing_puzzle_count": 1,
    }
    # 선행 부족은 시도 횟수를 늘리지 않는다
    assert row.state_json["attempt_counts"] == {}

    p07 = client.post(
        INTERACTIONS_URL, json=body("OBJ_S1_CAVE_BIG_CLAM", "complete", HALL)
    )
    assert p07.json()["result_type"] == "correct"
    assert row.state_json["completed_puzzle_ids"] == ["P07"]
    # P07 은 화면 판정 — 답을 보내는 input 으로는 완료할 수 없다
    assert (
        client.post(
            INTERACTIONS_URL,
            json=body("OBJ_S1_CAVE_BIG_CLAM", "input", HALL, {"answer": "x"}),
        ).status_code
        == 409
    )

    wrong = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "2,2,2")
    )
    assert wrong.json()["result_type"] == "incorrect"
    right = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "11,22,33")
    )
    assert right.json()["result_type"] == "correct"
    assert row.state_json["completed_puzzle_ids"] == ["P07", "P09"]


def test_p09_does_not_need_p08_or_gear_stones(client, db_session, naju_case):
    row = session(zone=HALL, completed_puzzle_ids=["P07"])
    db_session.get_result = row
    right = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "11,22,33")
    )
    assert right.json()["result_type"] == "correct"
    assert row.state_json.get("acquired_item_ids", []) == []


def test_tablet_inspect_is_recorded_once_and_is_not_a_p09_condition(
    client, db_session, naju_case
):
    row = session(zone=HALL)
    db_session.get_result = row
    first = client.post(
        INTERACTIONS_URL, json=body("OBJ_S1_CAVE_TABLET", "inspect", HALL)
    )
    assert first.status_code == 200 and first.json()["result_type"] == "ok"
    assert row.state_json["completed_inspect_ids"] == [builder.TABLET_INSPECT_ID]
    again = client.post(
        INTERACTIONS_URL, json=body("OBJ_S1_CAVE_TABLET", "inspect", HALL)
    )
    assert again.json()["result_type"] == "ok" and again.json()["state_changes"] == []


def test_unpinned_naju_session_keeps_the_current_zone_check(
    client, db_session, naju_case
):
    """버전 없는(레거시) 세션은 Zone 호환 대상이 아니다 — 기존대로 현재 구역이 아니면 409."""

    row = session(zone=FERRY)
    db_session.get_result = row
    response = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "5,4,3,2,1,0")
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Zone is not current."
    moved = session(zone=BEACH)
    db_session.get_result = moved
    ok = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "5,4,3,2,1,0")
    )
    assert ok.json()["result_type"] == "correct"


# ── 2-1. 나주 v1 Zone 호환(PM 11/8: 요청 Zone 을 현재 위치로 인정, 버전 고정 v1 세션만) ──


def pinned_bundle(version=1):
    docs = built()
    for document in docs.values():
        document["content_version"] = version
    _, fingerprint = builder.seal(docs)
    return (
        PinnedContent(
            ContentPin(CASE, version, fingerprint),
            client=CaseClientContent.model_validate(legacy(docs["client"])),
            server=PuzzleRuntimeDefinition.model_validate(legacy(docs["server"])),
            npc=None,
            idmap=docs["idmap"],
        ),
        fingerprint,
    )


@pytest.fixture
def pinned_store():
    store = PinnedContentStore()
    pins = {}
    for version in (1, 2):
        bundle, fingerprint = pinned_bundle(version)
        store.add(bundle)
        pins[version] = fingerprint
    app.dependency_overrides[get_pinned_content_store] = lambda: store
    yield pins
    app.dependency_overrides.pop(get_pinned_content_store, None)


def pinned_session(pins, version=1, zone=FERRY, **extra):
    row = session(zone=zone, **extra)
    row.content_version = version
    row.content_fingerprint = pins[version]
    return row


def test_accepts_request_zone_only_for_naju_v1():
    for case_id, version, expected in (
        (CASE, 1, True),
        (CASE, 2, False),
        (CASE, None, False),
        ("case_001", 1, False),
        ("case_001", None, False),
    ):
        row = make_play_session()
        row.case_id, row.content_version = case_id, version
        assert accepts_request_zone(row) is expected


def test_naju_v1_accepts_request_zone_and_records_it(client, db_session, pinned_store):
    row = pinned_session(pinned_store, zone=FERRY)
    db_session.get_result = row
    response = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "5,4,3,2,1,0")
    )
    assert response.status_code == 200
    assert response.json()["result_type"] == "correct"
    changes = response.json()["state_changes"]
    assert changes[0] == {"type": "current_zone_changed", "zone_id": BEACH}
    assert {"type": "puzzle_completed", "puzzle_id": "P03"} in changes
    assert row.state_json["current_zone_id"] == BEACH
    assert row.state_json["completed_puzzle_ids"] == ["P03"]


def test_naju_v1_same_zone_has_no_extra_zone_change(client, db_session, pinned_store):
    row = pinned_session(pinned_store, zone=BEACH)
    db_session.get_result = row
    response = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "0,0,0,0,0,0")
    )
    assert response.json()["result_type"] == "incorrect"
    assert response.json()["state_changes"] == []


def test_naju_v1_keeps_object_zone_binding_and_rejects_unknown_zones(
    client, db_session, pinned_store
):
    row = pinned_session(pinned_store, zone=FERRY)
    db_session.get_result = row
    # 다른 Zone 의 Object 로는 판정할 수 없다(Object 는 등록된 Zone 에서만 찾는다)
    wrong_zone = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", HALL, "5,4,3,2,1,0")
    )
    assert wrong_zone.status_code == 404
    assert wrong_zone.json()["detail"] == "Object not found."
    complete_wrong = client.post(
        INTERACTIONS_URL, json=body("OBJ_S1_CAVE_BIG_CLAM", "complete", BEACH)
    )
    assert complete_wrong.status_code == 404
    unknown = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", "ZONE_NOWHERE", "x")
    )
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "Zone not found."
    assert row.state_json["current_zone_id"] == FERRY
    assert row.state_json["completed_puzzle_ids"] == []
    assert db_session.commit_count == 0


def test_naju_v1_keeps_prerequisites_and_records_p07_then_p09(
    client, db_session, pinned_store
):
    row = pinned_session(pinned_store, zone=FERRY)
    db_session.get_result = row
    early = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "11,22,33")
    )
    assert early.status_code == 409
    assert early.json()["detail"] == "Required puzzles are not completed."
    # 선행 부족(409)은 저장하지 않는다 — 현재 구역도 그대로다
    assert row.state_json["current_zone_id"] == FERRY
    p07 = client.post(
        INTERACTIONS_URL, json=body("OBJ_S1_CAVE_BIG_CLAM", "complete", HALL)
    )
    assert p07.json()["result_type"] == "correct"
    assert row.state_json["current_zone_id"] == HALL
    p09 = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "11,22,33")
    )
    assert p09.json()["result_type"] == "correct"
    changes = p09.json()["state_changes"]
    assert {"type": "scene_cleared", "scene_id": "SCENE_STAGE2_ROCK_CAVE"} in changes
    assert row.state_json["completed_puzzle_ids"] == ["P07", "P09"]


def test_naju_v1_scene_clears_on_p01(client, db_session, pinned_store):
    row = pinned_session(pinned_store, zone=BEACH)
    db_session.get_result = row
    response = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_CLAM_HOLES", FERRY, "1,4")
    )
    assert response.json()["state_changes"] == [
        {"type": "current_zone_changed", "zone_id": FERRY},
        {"type": "puzzle_completed", "puzzle_id": "P01"},
        {"type": "scene_cleared", "scene_id": "SCENE_STAGE1_FERRY"},
    ]
    assert row.state_json["completed_scene_ids"] == ["SCENE_STAGE1_FERRY"]


def test_naju_v1_replay_returns_the_first_response(client, db_session, pinned_store):
    row = pinned_session(pinned_store, zone=FERRY)
    db_session.get_result = row
    request = answer("OBJ_S1_JAR_SLOTS", BEACH, "5,4,3,2,1,0")
    first = client.post(INTERACTIONS_URL, json=request)
    db_session.scalar_result = db_session.added[0]
    again = client.post(INTERACTIONS_URL, json=request)
    assert again.json() == first.json()
    assert db_session.commit_count == 1


def test_other_pinned_versions_keep_the_current_zone_check(
    client, db_session, pinned_store
):
    row = pinned_session(pinned_store, version=2, zone=FERRY)
    db_session.get_result = row
    response = client.post(
        INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "5,4,3,2,1,0")
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Zone is not current."


def test_naju_v1_zone_compat_aligns_hint_discovery_with_the_accepted_zone(
    client, db_session, pinned_store
):
    from app.services.hint_access import is_puzzle_discovered

    content = CaseClientContent.model_validate(legacy(built()["client"]))
    row = pinned_session(pinned_store, zone=FERRY)
    db_session.get_result = row
    assert not is_puzzle_discovered(content, row.state_json, "P03")
    client.post(INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "0,1,2,3,4,5"))
    assert is_puzzle_discovered(content, row.state_json, "P03")


# ── 3. 게시 게이트(가상 정답 묶음) ──


def test_sealed_bundle_passes_every_content_check():
    files, fingerprint = builder.seal(built())
    pack = NpcContentPack.model_validate(json.loads(files["npc"]))
    result = evaluate_publication(
        **files, ng_checker=build_case_ng_checker(pack), store=PinnedContentStore()
    )
    statuses = {c.code: c.status for c in result.checks}
    assert statuses == {
        "PARSE": "PASS",
        "FINGERPRINT": "PASS",
        "HEADER": "PASS",
        "VERSION_ORDER": "PASS",
        "CLIENT_SERVER": "PASS",
        "NPC": "PASS",
        "POLICY_DATA": "PASS",
        "NUDGE_COVERAGE": "PASS",
        "IDMAP": "PASS",
        "EXECUTABLE_REFS": "PASS",
        # FE 실행본 로컬 ID 목록이 없다
        "LOCAL_IDS": "UNVERIFIED",
        "SCENES": "PASS",
        "LEAK_CLIENT": "PASS",
        "NG": "PASS",
        "GEN_PACK": "NOT_APPLICABLE",
        # 승인 기록 없음(승인 대기) — 만들지 않는다
        "APPROVALS": "FAIL",
    }
    assert not result.approved and not result.registered
    assert fingerprint.startswith("sha256:")


# ── 3-1. NG · U 패턴 오탐 · 누락(설화 사실 계약서 v0.5.1) ──

FACT_SENTENCES = {
    "F-01": "앙암바위는 영산강을 따라 영산포구 쪽에 자리한 깎아지른 절벽이다. 앙암바우 또는 아망바우라고도 불린다.",
    "F-02": "영산강을 사이에 두고 앙암바위 허리쯤에는 진부촌이 있으며, 그 맞은편에는 택촌이 있다.",
    "F-03": "아랑사는 택촌에 사는 어부이며, 아비사는 진부촌에 사는 처녀다.",
    "F-05": "물고기를 구하지 못해 울던 아비사를 아랑사가 발견해 물고기를 잡아 주면서 두 사람의 인연이 시작되었다.",
    "F-06": "두 사람은 밤마다 앙암바위에서 만나 사랑을 속삭였다.",
    "F-07": "진부촌 젊은이들은 두 사람의 관계를 시기해 아랑사를 속였고, 앙암바위 아래로 떨어뜨려 죽였다.",
    "F-08": "아랑사가 죽은 뒤에도 아비사는 앙암바위를 계속 찾았으며, 강에서 올라온 커다란 구렁이와 사랑을 나누었다.",
    "F-09": "마을 젊은이들은 이를 나쁜 징조로 여겨 아비사와 구렁이를 함께 바위 아래로 굴려 버렸다.",
    "F-10": "이후 진부촌 젊은이들이 잇달아 시름시름 앓다가 죽었으며, 서로 얽힌 두 마리의 구렁이가 밤마다 진부촌에 나타났다.",
    "F-11": "마을 노인들은 협의 끝에 무당들에게 음력 8월 씻김굿을 맡겨 이들의 넋을 위로했으며, 이후 마을은 화를 면했다.",
}


@pytest.fixture
def ng_violates():
    pack = NpcContentPack.model_validate(legacy(built()["npc"]) | {"status": "draft"})
    checker = build_case_ng_checker(pack)
    assert checker is not None
    return checker


def test_policy_patterns_do_not_flag_contract_facts_or_approved_nudges(ng_violates):
    for fact_id, sentence in FACT_SENTENCES.items():
        assert not ng_violates(sentence), fact_id
    for nudge in (n for p in built()["npc"]["puzzles"] for n in p["nudges"]):
        assert not ng_violates(nudge["text"]), nudge["line_id"]


@pytest.mark.parametrize(
    "sentence",
    [
        "아랑사는 진부촌 사람이었어요.",
        "아비사는 택촌 처녀였대요.",
        "두 사람은 살아서 다시 만났대요.",
        "씻김굿은 저주였어요.",
        "밀양 아랑 이야기와 같은 이야기예요.",
        "구렁이는 아랑사였다고 해요.",
        "구렁이는 아랑사의 환생이에요.",
        "두 구렁이는 아랑사와 아비사예요.",
        "아비사는 죽었어요.",
    ],
)
def test_policy_patterns_flag_pm_listed_distortions(ng_violates, sentence):
    assert ng_violates(sentence)


@pytest.mark.parametrize(
    ("sentence", "note"),
    [
        # 사실과 맞는 문장인데 NG-01 패턴에 걸린다(오탐)
        ("택촌 어부 아랑사는 진부촌 처녀 아비사와 사랑했다.", "false_positive"),
        # 계약서가 바라는 유보 표현인데 U 패턴에 걸린다(팩 규칙에 hedge 칸이 없다)
        ("구렁이가 아랑사의 환생인지는 전해지지 않는다.", "hedge_blocked"),
        ("아비사가 죽었는지는 이야기에 직접 나오지 않는다.", "hedge_blocked"),
    ],
)
def test_known_over_blocking_is_documented(ng_violates, sentence, note):
    assert ng_violates(sentence), note


@pytest.mark.parametrize(
    "sentence",
    [
        "둘은 살아남아 재회했어요.",  # NG-02 바꿔 말하기
        "아랑사는 실수로 미끄러져 떨어졌어요.",  # NG-03 의미 규칙(패턴 없음)
        "씻김굿은 악령을 부르는 의식이에요.",  # NG-04 바꿔 말하기
        "구렁이가 바로 아랑사예요.",  # NG-06 바꿔 말하기
    ],
)
def test_known_misses_need_g1_review(ng_violates, sentence):
    assert not ng_violates(sentence)


def test_v1_npc_uses_exactly_the_15_approved_nudges_verbatim():
    _, lines = drafts()
    draft = {line["line_id"]: line for line in lines["lines"]}
    npc = built()["npc"]
    nudges = [n for p in npc["puzzles"] for n in p["nudges"]]
    assert [n["line_id"] for n in nudges] == list(builder.APPROVED_V1_NUDGE_IDS)
    assert len(nudges) == 15
    assert "NUDGE_P01_HELP_3_J" not in {n["line_id"] for n in nudges}
    for nudge in nudges:
        source = draft[nudge["line_id"]]
        assert nudge["text"] == source["text"]
        assert (source["category"], source["tone"]) == ("퍼즐 넛지", "polite")
    assert npc["general_nudges"] == [] and "situations" not in npc
    assert all(npc[key] for key in ("proper_nouns", "ng", "open"))


# ── 4. 실제 묶음(비공개 정답) — 환경 변수가 있을 때만 ──

REAL_ROOT = os.environ.get("NAJU_V1_BUNDLE_ROOT")
REAL_ANSWERS = os.environ.get("NAJU_V1_ANSWERS")
real_only = pytest.mark.skipif(
    not (REAL_ROOT and REAL_ANSWERS),
    reason="NAJU_V1_BUNDLE_ROOT and NAJU_V1_ANSWERS (private) required",
)


@real_only
def test_real_bundle_matches_builder_and_grades_fe_shaped_answers(
    client, db_session, naju_case
):
    from scripts.publish_case_content import read_case_bundle

    answers = json.loads(Path(REAL_ANSWERS).read_text(encoding="utf-8"))
    bundle = read_case_bundle(REAL_ROOT, CASE, builder.CONTENT_VERSION)
    expected, fingerprint = builder.seal(built(answers))
    assert bundle.fingerprint == fingerprint
    assert {r: bundle.files[r] for r in builder.ROLES} == expected
    documents = {r: json.loads(bundle.files[r]) for r in builder.ROLES}
    naju_case(documents)

    clam = answers["P01"]["clam_holes"]
    others = [h for h in range(answers["P01"]["hole_count"]) if h not in clam]
    row = session(zone=FERRY)
    db_session.get_result = row
    partial = ",".join(str(h) for h in sorted(clam[:-1] + others[:1]))
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_CLAM_HOLES", FERRY, partial)
        ).json()["result_type"]
        == "incorrect"
    )
    full = ",".join(str(h) for h in sorted(clam + others[:2]))
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_CLAM_HOLES", FERRY, full)
        ).json()["result_type"]
        == "correct"
    )

    row = session(zone=BEACH)
    db_session.get_result = row
    p03 = answers["P03"]["accepted_answers"][0]
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, "0,1,2,3,4,5")
        ).json()["result_type"]
        == "incorrect"
    )
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_JAR_SLOTS", BEACH, p03)
        ).json()["result_type"]
        == "correct"
    )

    row = session(zone=HALL)
    db_session.get_result = row
    p09 = answers["P09"]["accepted_answers"][0]
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, p09)
        ).status_code
        == 409
    )
    assert (
        client.post(
            INTERACTIONS_URL, json=body("OBJ_S1_CAVE_BIG_CLAM", "complete", HALL)
        ).json()["result_type"]
        == "correct"
    )
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, "1,1,1")
        ).json()["result_type"]
        == "incorrect"
    )
    assert (
        client.post(
            INTERACTIONS_URL, json=answer("OBJ_S1_CAVE_RING_DOOR", HALL, p09)
        ).json()["result_type"]
        == "correct"
    )
    assert deepcopy(row.state_json["completed_puzzle_ids"]) == ["P07", "P09"]
