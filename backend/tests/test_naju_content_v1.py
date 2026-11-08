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

from app.schemas.npc_content import NpcContentPack
from app.services import case_content, puzzle_runtime
from app.services.pinned_content import PinnedContentStore
from app.services.publication_gate import evaluate_publication
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
    # 10/27 초안 ID는 지우거나 바꾸지 않는다
    for item in idmap_draft["objects"]:
        assert item in idmap["objects"]
    for key in ("scenes", "navigation", "blockers", "not_mapped"):
        assert idmap[key] == idmap_draft[key]
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
    # 검수 근거가 없는 목록은 비워 두지 않는다(게이트가 막는다)
    assert pack.proper_nouns is None and pack.ng is None and pack.open is None
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


def test_p03_outside_the_entry_zone_needs_a_server_navigate_first(
    client, db_session, naju_case
):
    """차단 요소 기록: 새 세션의 현재 구역은 입구(나루터)다. FE 가 navigate 를 보내지 않으면 P03 · P07 · P09 는 409."""

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


# ── 3. 게시 게이트(가상 정답 묶음) ──


def test_sealed_bundle_passes_schema_checks_and_reports_known_blockers():
    files, fingerprint = builder.seal(built())
    result = evaluate_publication(**files, store=PinnedContentStore())
    checks = {c.code: c for c in result.checks}
    for code in (
        "PARSE",
        "FINGERPRINT",
        "HEADER",
        "CLIENT_SERVER",
        "NPC",
        "NUDGE_COVERAGE",
    ):
        assert checks[code].status == "PASS", code
    assert not result.approved and not result.registered
    # 검수 목록(proper_nouns · ng) 없음 → 막힌다
    assert checks["POLICY_DATA"].status == "FAIL"
    # v1.1 대표 로컬 ID(`clam-holes` 등)는 idmap 검증기 v0.1 의 `<묶음>#<번호>` 규칙과 맞지 않는다
    reasons = set(checks["IDMAP"].reasons)
    assert checks["IDMAP"].status == "FAIL"
    for object_id in (
        "OBJ_S1_CLAM_HOLES",
        "OBJ_S1_JAR_SLOTS",
        "OBJ_S1_CAVE_BIG_CLAM",
        "OBJ_S1_CAVE_RING_DOOR",
        "OBJ_S1_CAVE_TABLET",
    ):
        assert f"OBJECT_LOCAL_KEY_INVALID:{object_id}" in reasons
    assert fingerprint.startswith("sha256:")


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
