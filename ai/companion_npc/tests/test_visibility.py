import copy

from companion_npc.contracts import ScenarioPack
from companion_npc.contracts.common import PlaySessionStateSnapshot
from companion_npc.contracts.visibility import visible_chunks


def _state(**overrides) -> PlaySessionStateSnapshot:
    base = {
        "current_zone_id": None,
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "flags": {},
    }
    return PlaySessionStateSnapshot.model_validate({**base, **overrides})


def _ids(chunks) -> set[str]:
    return {c.chunk_id for c in chunks}


def test_tier_cap_blocks_higher_hints(pack_case_001):
    pack = ScenarioPack.model_validate(pack_case_001)
    state = _state(current_zone_id="ZONE_SECRET_CORRIDOR")
    assert "K_HINT_FIRE_LOCK_2" not in _ids(
        visible_chunks(pack, "case_001", state, max_tier=1)
    )
    assert "K_HINT_FIRE_LOCK_2" in _ids(
        visible_chunks(pack, "case_001", state, max_tier=2)
    )


def test_zone_gate(pack_case_001):
    pack = ScenarioPack.model_validate(pack_case_001)
    elsewhere = _state(current_zone_id="ZONE_LOBBY")
    assert _ids(visible_chunks(pack, "case_001", elsewhere, max_tier=2)) == {
        "K_PREMISE"
    }


def test_other_case_is_blocked(pack_case_001):
    pack = ScenarioPack.model_validate(pack_case_001)
    state = _state(current_zone_id="ZONE_SECRET_CORRIDOR")
    assert visible_chunks(pack, "case_fixture_lighthouse", state, max_tier=2) == []


def test_unpublished_pack_is_blocked(pack_case_001):
    data = copy.deepcopy(pack_case_001)
    data["publication"] = {"status": "draft"}
    pack = ScenarioPack.model_validate(data)
    state = _state(current_zone_id="ZONE_SECRET_CORRIDOR")
    assert visible_chunks(pack, "case_001", state, max_tier=2) == []


def test_solved_puzzle_hints_are_dropped(pack_case_001):
    pack = ScenarioPack.model_validate(pack_case_001)
    state = _state(
        current_zone_id="ZONE_SECRET_CORRIDOR",
        completed_puzzle_ids=["PUZZLE_FIRE_CABINET_LOCK"],
    )
    ids = _ids(visible_chunks(pack, "case_001", state, max_tier=2))
    assert not {"K_HINT_FIRE_LOCK_1", "K_HINT_FIRE_LOCK_2"} & ids


def test_story_truth_waits_for_progress(pack_fictional):
    # 같은 코드가 나주가 아닌 사건에서도 그대로 돈다 — 시나리오별 분기 없음
    pack = ScenarioPack.model_validate(pack_fictional)
    case_id = "case_fixture_lighthouse"
    early = _state(
        current_zone_id="ZONE_LAMP_ROOM", completed_puzzle_ids=["PUZZLE_DRAWER"]
    )
    assert "K_TRUTH_KEEPER" not in _ids(
        visible_chunks(pack, case_id, early, max_tier=2)
    )
    done = _state(
        current_zone_id="ZONE_LAMP_ROOM",
        completed_puzzle_ids=["PUZZLE_DRAWER", "PUZZLE_LENS"],
    )
    assert "K_TRUTH_KEEPER" in _ids(visible_chunks(pack, case_id, done, max_tier=2))


def test_clue_gate(pack_fictional):
    pack = ScenarioPack.model_validate(pack_fictional)
    case_id = "case_fixture_lighthouse"
    without = _state(current_zone_id="ZONE_LAMP_ROOM")
    assert "K_HINT_LENS_2" not in _ids(
        visible_chunks(pack, case_id, without, max_tier=2)
    )
    with_clue = _state(
        current_zone_id="ZONE_LAMP_ROOM", acquired_clue_ids=["CLUE_LENS_NOTE"]
    )
    assert "K_HINT_LENS_2" in _ids(visible_chunks(pack, case_id, with_clue, max_tier=2))
