from copy import deepcopy
from typing import Any

import pytest

from app.schemas.case_content import CaseClientContent
from app.schemas.naju_idmap import NajuIdmap
from app.schemas.puzzle_runtime import (
    ClueDefinition,
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.idmap_validation import IdmapLookup, validate_idmap

# PM 초안(naju-idmap/0.1-draft)의 구조를 최소로 재현한 가상 데이터. 실제 이름 · 제목 · ID가 아니다.
CASE_ID = "case_idmap_test"


def draft() -> dict[str, Any]:
    return {
        "schema": "naju-idmap/0.1-draft",
        "case_id": CASE_ID,
        "status": "draft — 가상 초안",
        "local_source": {
            "game": "g",
            "commit": "c",
            "site_plan": "p",
            "generated_trial": "t",
        },
        "rules": {
            "direction": "local → runtime",
            "object_id": "OBJ_S<씬>_<이름>_<번호>",
        },
        "zones": [
            {
                "local": "Z1",
                "name": "가",
                "x_m": [0, 10],
                "z_m": [0, 10],
                "zone_id": "ZONE_ALPHA",
            },
            {
                "local": "Z2",
                "name": "나",
                "x_m": [10, 20],
                "z_m": [0, 10],
                "zone_id": "ZONE_BETA",
            },
        ],
        "scenes": [
            {
                "local": 1,
                "local_complete_signal": "endScene(1)",
                "note": "",
                "scene_id": "SCENE_ONE",
                "src_id": "scene-01",
                "title": "가상 1",
                "zones": ["Z1", "Z2"],
                "zone_ids": ["ZONE_ALPHA", "ZONE_BETA"],
            },
            {
                "local": 2,
                "local_complete_signal": "endScene(2)",
                "note": "",
                "scene_id": "SCENE_TWO",
                "src_id": "scene-02",
                "title": "가상 2",
                "zones": ["Z2"],
                "zone_ids": ["ZONE_BETA"],
            },
        ],
        "navigation": [
            {"local": "T1", "name": "길", "from": "Z1", "to": "Z2"},
            {"local": "T2", "name": "길", "from": "Z2", "to": "Z1", "note": "되돌아감"},
        ],
        "blockers": [
            {"local": "B1", "name": "바위", "object_id": "OBJ_BLOCKER_ONE"},
            {
                "local": "숲",
                "name": "숲",
                "object_id": None,
                "local_clear": "x",
                "note": "y",
            },
        ],
        "objects": [
            {
                "local": "씬1.통#1",
                "object_id": "OBJ_S1_BASKET_1",
                "scene": 1,
                "zone": "Z1",
                "zone_id": "ZONE_ALPHA",
                "status": "placed_no_interaction",
                "interaction": None,
                "at_m": [1.5, 2],
            },
            {
                "local": "씬2.깃#3",
                "object_id": "OBJ_S2_POLE_3",
                "scene": 2,
                "zone": "Z2",
                "zone_id": "ZONE_BETA",
                "status": "placed_no_interaction",
                "interaction": None,
                "at_m": [12, 3],
            },
        ],
        "object_groups_without_instances": [
            {"local_group": "씬2.배", "object_id_base": "OBJ_S2_BOAT", "note": "배치 0"}
        ],
        "puzzles": [
            {
                "local": None,
                "puzzle_id": "PUZZLE_ONE_1",
                "scene_id": "SCENE_ONE",
                "src_id": "PZ-01",
                "status": "unplaced",
                "title": "가상",
                "note": "호스트 없음",
            }
        ],
        "clues": [
            {
                "local": None,
                "clue_id": "CLUE_ONE_1_1",
                "src_id": "CL-01-1",
                "puzzle_src_id": "PZ-01",
                "status": "unplaced",
            }
        ],
        "not_mapped": [{"local": "stage.seenClues", "why": "근접은 획득이 아님"}],
    }


def codes(report, severity: str | None = None) -> list[tuple[str, str | None]]:
    return [
        (issue.code, issue.reference)
        for issue in report.issues
        if severity is None or issue.severity == severity
    ]


def errors(raw: dict) -> list[tuple[str, str | None]]:
    return codes(validate_idmap(raw), "error")


# --- 초안 파싱 ---


def test_draft_shape_parses_and_is_internally_valid_but_not_publishable() -> None:
    report = validate_idmap(draft())

    assert report.schema_valid is True
    assert report.internal_valid is True
    assert report.is_draft is True
    assert report.publishable is False
    assert codes(report, "error") == []
    assert report.count("PLACED_NO_INTERACTION") == 2
    assert report.count("UNPLACED") == 2
    assert report.count("NO_RUNTIME_TARGET") == 1
    assert report.cross_check == "not_run"
    assert report.local_ids_check == "not_run"
    assert report.publish_blockers == (
        "STATUS_NOT_PUBLISHED",
        "PENDING_ITEMS",
        "VERSION_HEADER_MISSING",
        "CROSS_CHECK_NOT_RUN",
        "LOCAL_IDS_UNVERIFIED",
        "FINGERPRINT_UNVERIFIED",
    )


def test_optional_draft_fields_and_navigation_aliases() -> None:
    idmap = NajuIdmap.model_validate(draft())

    assert idmap.schema_name == "naju-idmap/0.1-draft"
    assert idmap.navigation[0].from_zone == "Z1"
    assert idmap.navigation[0].note is None
    assert idmap.blockers[0].local_clear is None
    assert idmap.content_version is None


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(extra=1),
        lambda d: d["zones"][0].update(extra=1),
        lambda d: d.pop("not_mapped"),
        lambda d: d["objects"][0].pop("zone_id"),
        lambda d: d.update(case_id=""),
        lambda d: d["scenes"][0].update(local="1"),
        lambda d: d["scenes"][0].update(zones=[]),
        lambda d: d["objects"][0].update(scene=True),
        lambda d: d["zones"][0].update(x_m=[1]),
        lambda d: d["not_mapped"][0].update(why=""),
        lambda d: d.update(content_version=0),
    ],
)
def test_schema_errors(mutate) -> None:
    raw = draft()
    mutate(raw)

    report = validate_idmap(raw)

    assert report.schema_valid is False
    assert report.publish_blockers == ("SCHEMA_INVALID",)


# --- 중복 ---


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda d: d["zones"][1].update(local="Z1"), ("DUPLICATE_LOCAL_ID", "Z1")),
        (lambda d: d["navigation"][1].update(local="T1"), ("DUPLICATE_LOCAL_ID", "T1")),
        (
            lambda d: d["objects"][1].update(local="씬1.통#1"),
            ("DUPLICATE_LOCAL_ID", "씬1.통#1"),
        ),
        (lambda d: d["scenes"][1].update(local=1), ("DUPLICATE_LOCAL_ID", "1")),
        (
            lambda d: d["zones"][1].update(zone_id="ZONE_ALPHA"),
            ("DUPLICATE_RUNTIME_ID", "ZONE_ALPHA"),
        ),
        (
            lambda d: d["scenes"][1].update(scene_id="SCENE_ONE"),
            ("DUPLICATE_RUNTIME_ID", "SCENE_ONE"),
        ),
        (
            lambda d: d["blockers"][0].update(object_id="OBJ_S1_BASKET_1"),
            ("DUPLICATE_RUNTIME_ID", "OBJ_S1_BASKET_1"),
        ),
        (
            lambda d: d["objects"][1].update(object_id="OBJ_S1_BASKET_1"),
            ("DUPLICATE_RUNTIME_ID", "OBJ_S1_BASKET_1"),
        ),
        (
            lambda d: d["scenes"][1].update(src_id="scene-01"),
            ("DUPLICATE_SRC_ID", "scene-01"),
        ),
    ],
)
def test_duplicate_ids(mutate, expected) -> None:
    raw = draft()
    mutate(raw)

    assert expected in errors(raw)


def test_duplicate_puzzle_and_clue_ids() -> None:
    raw = draft()
    raw["puzzles"].append({**raw["puzzles"][0]})
    raw["clues"].append({**raw["clues"][0]})

    found = errors(raw)

    assert ("DUPLICATE_RUNTIME_ID", "PUZZLE_ONE_1") in found
    assert ("DUPLICATE_RUNTIME_ID", "CLUE_ONE_1_1") in found
    assert ("DUPLICATE_SRC_ID", "PZ-01") in found
    assert ("DUPLICATE_SRC_ID", "CL-01-1") in found


# --- Zone · Scene · Navigation · Object ---


def test_unknown_zones() -> None:
    raw = draft()
    raw["scenes"][0]["zones"] = ["Z1", "Z9"]
    raw["scenes"][1]["zone_ids"] = ["ZONE_GHOST"]
    raw["objects"][0]["zone"] = "Z9"

    found = errors(raw)

    assert ("UNKNOWN_LOCAL_ZONE", "Z9") in found
    assert ("UNKNOWN_RUNTIME_ZONE", "ZONE_GHOST") in found
    assert found.count(("UNKNOWN_LOCAL_ZONE", "Z9")) == 2


@pytest.mark.parametrize(
    "zone_ids",
    [["ZONE_BETA", "ZONE_ALPHA"], ["ZONE_ALPHA"], ["ZONE_ALPHA", "ZONE_ALPHA"]],
)
def test_scene_zone_mismatch(zone_ids: list[str]) -> None:
    raw = draft()
    raw["scenes"][0]["zone_ids"] = zone_ids

    assert ("SCENE_ZONE_MISMATCH", "SCENE_ONE") in errors(raw)


def test_navigation_errors() -> None:
    raw = draft()
    raw["navigation"][0]["to"] = "Z9"
    raw["navigation"].append({"local": "T3", "name": "x", "from": "Z2", "to": "Z2"})
    raw["navigation"].append({"local": "T4", "name": "x", "from": "Z2", "to": "Z1"})

    found = errors(raw)

    assert ("UNKNOWN_LOCAL_ZONE", "Z9") in found
    assert ("NAVIGATION_SELF_LOOP", "T3") in found
    assert ("DUPLICATE_NAVIGATION", "Z2->Z1") in found


def test_object_zone_mismatch_and_unknown_runtime_zone() -> None:
    raw = draft()
    raw["objects"][0]["zone_id"] = "ZONE_BETA"
    raw["objects"][1]["zone_id"] = "ZONE_NOWHERE"

    found = errors(raw)

    assert ("OBJECT_ZONE_MISMATCH", "OBJ_S1_BASKET_1") in found
    assert ("UNKNOWN_RUNTIME_ZONE", "ZONE_NOWHERE") in found


def test_object_scene_and_key_checks() -> None:
    raw = draft()
    raw["objects"][0]["scene"] = 9
    raw["objects"][1]["local"] = "씬2.깃"
    raw["objects"].append(
        {
            **raw["objects"][0],
            "local": "씬2.배#1",
            "object_id": "OBJ_S1_X_1",
            "scene": 1,
        }
    )

    found = errors(raw)

    assert ("UNKNOWN_SCENE", "9") in found
    assert ("OBJECT_LOCAL_KEY_INVALID", "OBJ_S2_POLE_3") in found
    assert ("OBJECT_GROUP_CONFLICT", "OBJ_S1_X_1") in found


def test_object_rule_and_scene_placement_warnings_do_not_invalidate_draft() -> None:
    raw = draft()
    raw["objects"][0]["object_id"] = "OBJ_S1_BASKET_7"
    raw["objects"][1]["local"] = "씬1.깃#3"
    raw["objects"][1]["zone"] = "Z1"
    raw["objects"][1]["zone_id"] = "ZONE_ALPHA"

    report = validate_idmap(raw)
    warnings = codes(report, "warning")

    assert report.internal_valid is True
    assert ("OBJECT_ID_RULE_MISMATCH", "OBJ_S1_BASKET_7") in warnings
    assert ("OBJECT_SCENE_MISMATCH", "OBJ_S2_POLE_3") in warnings
    assert ("OBJECT_ZONE_OUTSIDE_SCENE", "OBJ_S2_POLE_3") in warnings


def test_runtime_prefix_is_warning_only() -> None:
    raw = draft()
    raw["clues"][0]["clue_id"] = "CL-01-1"

    report = validate_idmap(raw)

    assert report.internal_valid is True
    assert ("RUNTIME_ID_PREFIX", "CL-01-1") in codes(report, "warning")


# --- Puzzle · Clue src_id ---


def test_puzzle_scene_and_clue_puzzle_src_references() -> None:
    raw = draft()
    raw["puzzles"][0]["scene_id"] = "SCENE_MISSING"
    raw["clues"][0]["puzzle_src_id"] = "PZ-99"

    found = errors(raw)

    assert ("UNKNOWN_SCENE", "SCENE_MISSING") in found
    assert ("UNKNOWN_PUZZLE_SRC", "PZ-99") in found


# --- 미배치 · 미상호작용 · 상태 ---


def test_pending_items_block_publication_but_not_draft_validity() -> None:
    raw = draft()
    raw["objects"][0]["status"] = "somewhere_else"
    raw["puzzles"][0]["status"] = "placed"

    report = validate_idmap(raw)

    assert report.internal_valid is True
    assert ("UNKNOWN_STATUS", "OBJ_S1_BASKET_1") in codes(report, "pending")
    assert ("NO_LOCAL_HOST", "PUZZLE_ONE_1") in codes(report, "pending")
    assert "PENDING_ITEMS" in report.publish_blockers


def test_published_status_alone_is_not_publishable() -> None:
    raw = draft()
    raw.update(status="published", content_version=1, content_fingerprint="opaque")

    report = validate_idmap(raw)

    assert report.is_draft is False
    assert "STATUS_NOT_PUBLISHED" not in report.publish_blockers
    assert "VERSION_HEADER_MISSING" not in report.publish_blockers
    assert "FINGERPRINT_UNVERIFIED" in report.publish_blockers
    assert report.publishable is False


# --- 매핑 제외 ---


def test_not_mapped_local_mapped_elsewhere_is_error() -> None:
    raw = draft()
    raw["not_mapped"].append({"local": "Z1", "why": "x"})

    assert ("NOT_MAPPED_CONFLICT", "Z1") in errors(raw)


def test_lookup_never_sends_not_mapped_or_pending_items() -> None:
    raw = draft()
    raw["objects"][1]["status"] = "ready"
    raw["objects"][1]["interaction"] = {"type": "inspect"}
    lookup = IdmapLookup(NajuIdmap.model_validate(raw))

    assert lookup.runtime_zone("Z1") == "ZONE_ALPHA"
    assert lookup.runtime_zone("Z9") is None
    assert lookup.runtime_object("씬1.통#1") is None  # placed_no_interaction
    assert lookup.runtime_object("씬2.깃#3") == ("ZONE_BETA", "OBJ_S2_POLE_3")
    assert lookup.runtime_object("씬2.깃#4") is None  # 추측해서 만들지 않음
    assert lookup.runtime_blocker("B1") == "OBJ_BLOCKER_ONE"
    assert lookup.runtime_blocker("숲") is None
    assert lookup.is_not_mapped("stage.seenClues") is True
    assert lookup.runtime_zone("stage.seenClues") is None
    assert lookup.local_zone("ZONE_BETA") == "Z2"
    assert lookup.local_scene("SCENE_TWO") == 2
    assert lookup.local_object("OBJ_UNKNOWN") is None


def test_lookup_refuses_internally_invalid_idmap() -> None:
    raw = draft()
    raw["objects"][0]["zone_id"] = "ZONE_BETA"

    with pytest.raises(ValueError):
        IdmapLookup(NajuIdmap.model_validate(raw))


# --- 교차 검증 · 로컬 ID 목록 ---


def make_client(object_ids: list[tuple[str, str]]) -> CaseClientContent:
    zones: dict[str, list[dict]] = {"ZONE_ALPHA": [], "ZONE_BETA": []}
    for zone_id, object_id in object_ids:
        zones[zone_id].append(
            {
                "object_id": object_id,
                "object_name": "x",
                "object_type": "prop",
                "visible": True,
                "enabled": True,
                "interaction": {"type": "inspect", "target_id": "IN_X"},
            }
        )
    return CaseClientContent.model_validate(
        {
            "case_id": CASE_ID,
            "entry_zone_id": "ZONE_ALPHA",
            "zones": [
                {
                    "zone_id": zone_id,
                    "zone_name": zone_id,
                    "zone_type": "outdoor",
                    "description": "",
                    "objects": objects,
                    "navigation": [],
                }
                for zone_id, objects in zones.items()
            ],
        }
    )


def make_server(*, puzzles: list[str], clues: list[str]) -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=CASE_ID,
        puzzles=[
            PuzzleDefinition(
                puzzle_id=puzzle_id,
                accepted_answers=["가상"],
                on_correct=RuntimeEffect(grant_clue_ids=clues, set_flags={}),
            )
            for puzzle_id in puzzles
        ],
        clue_combinations=[],
        clues=[ClueDefinition(clue_id=clue_id, title="(가상)") for clue_id in clues],
    )


def test_cross_check_reports_missing_and_unmapped_runtime_targets() -> None:
    client = make_client(
        [
            ("ZONE_ALPHA", "OBJ_S1_BASKET_1"),
            ("ZONE_ALPHA", "OBJ_BLOCKER_ONE"),
            ("ZONE_BETA", "OBJ_EXTRA"),
        ]
    )
    server = make_server(puzzles=["PUZZLE_OTHER"], clues=["CLUE_ONE_1_1"])

    report = validate_idmap(draft(), client=client, server=server)
    found = codes(report, "error")

    assert report.cross_check == "run"
    assert ("MISSING_IN_CLIENT", "OBJ_S2_POLE_3") in found
    assert ("MISSING_IN_SERVER", "PUZZLE_ONE_1") in found
    assert ("UNMAPPED_RUNTIME_TARGET", "OBJ_EXTRA") in found
    assert ("MISSING_IN_CLIENT", "OBJ_BLOCKER_ONE") not in found
    assert "CROSS_CHECK_FAILED" in report.publish_blockers
    assert "SCENES_UNVERIFIED" in report.publish_blockers
    assert report.publishable is False


def test_cross_check_passing_still_leaves_scenes_and_fingerprint_unverified() -> None:
    client = make_client(
        [
            ("ZONE_ALPHA", "OBJ_S1_BASKET_1"),
            ("ZONE_BETA", "OBJ_S2_POLE_3"),
            ("ZONE_ALPHA", "OBJ_BLOCKER_ONE"),
        ]
    )
    server = make_server(puzzles=["PUZZLE_ONE_1"], clues=["CLUE_ONE_1_1"])

    report = validate_idmap(draft(), client=client, server=server)

    assert "CROSS_CHECK_FAILED" not in report.publish_blockers
    assert "CROSS_CHECK_NOT_RUN" not in report.publish_blockers
    assert {"SCENES_UNVERIFIED", "FINGERPRINT_UNVERIFIED"} <= set(
        report.publish_blockers
    )


def test_local_ids_from_game_are_checked_when_provided() -> None:
    local_ids = {
        "zones": ["Z1", "Z2"],
        "navigation": ["T1"],
        "blockers": ["B1", "숲"],
        "objects": ["씬1.통#1", "씬2.깃#3"],
        "scenes": ["1", "2"],
    }

    report = validate_idmap(draft(), local_ids=local_ids)

    assert report.local_ids_check == "run"
    assert codes(report, "error") == [("LOCAL_ID_NOT_IN_GAME", "T2")]
    assert "LOCAL_IDS_FAILED" in report.publish_blockers
    assert "LOCAL_IDS_UNVERIFIED" not in report.publish_blockers


def test_validation_does_not_mutate_input() -> None:
    raw = draft()
    before = deepcopy(raw)

    validate_idmap(raw)
    IdmapLookup(NajuIdmap.model_validate(raw))

    assert raw == before
