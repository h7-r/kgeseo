"""나주 개발용 콘텐츠 골격(`content_drafts/naju/`)의 정적 검증.

- FE ID 목록 · idmap · 퍼즐 표가 서로 어긋나지 않는지(중복 · 누락 · 참조).
- idmap은 운영 검증기(`validate_idmap`)로 스키마 · 내부 참조가 통과하고, 게시는 막혀 있는지.
- 정답 · 힌트 원문 같은 판정 값이 없는지, 케이스 로더 · 게시 로더가 읽는 위치가 아닌지.
FE 코드와의 대조는 `scripts/verify_naju_fe_ids.py`(git으로 FE 커밋을 읽는다)가 한다.
"""

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.puzzle_runtime import PuzzleDefinition
from app.services import puzzle_runtime
from app.services.idmap_validation import OBJECT_ID_RULE, validate_idmap
from app.services.puzzle_runtime import CaseRuntimeNotFoundError, load_case_runtime

DRAFTS = Path(__file__).resolve().parents[1] / "content_drafts" / "naju"
FE_IDS = json.loads((DRAFTS / "naju_fe_ids.dev.json").read_text(encoding="utf-8"))
IDMAP = json.loads(
    (DRAFTS / "naju-angam-01.idmap.dev.json").read_text(encoding="utf-8")
)
PUZZLES = json.loads((DRAFTS / "naju_puzzles.dev.json").read_text(encoding="utf-8"))
FE_ID = re.compile(r"^[a-z][a-z0-9]*(-(?:[a-z0-9]+|\{n\}))*$")


def expand(template: str, count: int | None) -> list[str]:
    if "{n}" not in template:
        return [template]
    return [template.replace("{n}", str(n)) for n in range(count or 0)]


def test_fe_ids_are_unique_well_formed_and_cover_the_nine_puzzles():
    items = FE_IDS["interactables"]
    templates = [item["id"] for item in items]
    assert len(templates) == len(set(templates))
    assert all(FE_ID.fullmatch(value) for value in templates), templates
    expanded = [v for item in items for v in expand(item["id"], item["count"])]
    assert len(expanded) == len(set(expanded))

    numbers = [puzzle["no"] for puzzle in FE_IDS["puzzles"]]
    assert numbers == list(range(1, 10))
    for item in items:
        assert item["puzzle"] in {None, *numbers}
        if item["puzzle"] is not None:
            # 9종에 속한 ID는 개수가 정해져 있어야 한다(템플릿이면 개수 상수도)
            assert item["count"] and item["count"] >= 1, item["id"]
            assert ("{n}" in item["id"]) == (item["count_source"] is not None)
    assert {item["puzzle"] for item in items} >= set(numbers)


def test_placements_point_at_listed_fe_ids_and_idmap_objects():
    by_template = {item["id"]: item for item in FE_IDS["interactables"]}
    expanded = {
        value: item
        for item in by_template.values()
        for value in expand(item["id"], item["count"])
    }
    idmap_objects = {obj["local"]: obj for obj in IDMAP["objects"]}
    zones = {zone["local"] for zone in IDMAP["zones"]}
    keys = [placement["key"] for placement in FE_IDS["placements"]]
    assert len(keys) == len(set(keys))
    for placement in FE_IDS["placements"]:
        if placement["fe_id"] is not None:
            item = expanded[placement["fe_id"]]
            assert placement["key"].split("#")[0] == item["placement"]
        assert placement["zone"] in zones
        obj = idmap_objects[placement["key"]]
        assert (obj["at_m"], obj["zone"]) == (placement["at_m"], placement["zone"])


def test_dev_idmap_passes_the_validator_but_cannot_be_published():
    report = validate_idmap(IDMAP)

    assert report.schema_valid and report.internal_valid
    assert not any(issue.severity == "error" for issue in report.issues)
    assert not report.publishable
    assert {
        "STATUS_NOT_PUBLISHED",
        "PENDING_ITEMS",
        "VERSION_HEADER_MISSING",
        "FINGERPRINT_UNVERIFIED",
    } <= set(report.publish_blockers)
    # 공식 fingerprint · 버전을 임의로 채우지 않는다
    assert "content_version" not in IDMAP and "content_fingerprint" not in IDMAP
    assert IDMAP["status"] != "published"
    # 상호작용 판정이 정해지지 않아 모든 물건은 실행 불가 상태로 둔다
    assert {obj["status"] for obj in IDMAP["objects"]} == {"placed_no_interaction"}
    assert all(obj["interaction"] is None for obj in IDMAP["objects"])
    for obj in IDMAP["objects"]:
        rule = OBJECT_ID_RULE.fullmatch(obj["object_id"])
        assert rule is not None and int(rule["scene"]) == obj["scene"], obj


def test_puzzle_table_references_only_known_ids():
    templates_by_puzzle: dict[int, set[str]] = {}
    for item in FE_IDS["interactables"]:
        if item["puzzle"] is not None:
            templates_by_puzzle.setdefault(item["puzzle"], set()).add(item["id"])
    object_ids = {obj["object_id"] for obj in IDMAP["objects"]}
    zone_ids = {zone["zone_id"] for zone in IDMAP["zones"]}
    puzzles = PUZZLES["puzzles"]

    assert [p["no"] for p in puzzles] == list(range(1, 10))
    candidates = [p["candidate_puzzle_id"] for p in puzzles]
    assert len(candidates) == len(set(candidates))
    assert all(value.startswith("PUZZLE_") for value in candidates)
    for puzzle in puzzles:
        assert set(puzzle["fe_interactables"]) == templates_by_puzzle[puzzle["no"]]
        assert set(puzzle["runtime_objects"]) <= object_ids
        assert puzzle["zone_id"] in {None, *zone_ids}
        # 장면 연결은 FE 근거가 없어 비워 둔다
        assert puzzle["scene_id"] is None
        assert puzzle["missing"]


ANSWER_KEYS = {"accepted_answers", "answer", "answers", "hints", "hint", "text"}


def _keys(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys(v)}
    return set()


@pytest.mark.parametrize("document", [FE_IDS, IDMAP, PUZZLES])
def test_skeleton_holds_no_answer_or_hint_values(document):
    assert not _keys(document) & ANSWER_KEYS


def test_server_puzzles_cannot_be_written_without_pm_answers():
    # PuzzleDefinition은 accepted_answers가 1개 이상이어야 한다 — 골격으로 server.json을 만들 수 없다.
    for puzzle in PUZZLES["puzzles"]:
        with pytest.raises(ValidationError):
            PuzzleDefinition.model_validate(
                {
                    "puzzle_id": puzzle["candidate_puzzle_id"],
                    "accepted_answers": [],
                    "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                }
            )


def test_skeleton_is_not_loadable_as_a_case_or_a_published_bundle():
    assert not DRAFTS.resolve().is_relative_to(puzzle_runtime.CASES_DIRECTORY.resolve())
    with pytest.raises(CaseRuntimeNotFoundError):
        load_case_runtime(IDMAP["case_id"])
    # 게시 로더는 이 위치를 기본으로 읽지 않는다(루트 기본값 없음, 파일 이름도 게시 구조가 아님)
    assert "content_drafts" not in settings.published_content_root
    assert not any(DRAFTS.glob("*/v*/*.json"))
