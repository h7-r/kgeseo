from app.services.case_content import load_case_client_content
from app.services.case_content_validation import validate_case_content_links
from app.services.object_resolver import resolve_object_interaction
from app.services.puzzle_runtime import load_case_runtime, normalize_answer


def test_case_001_fire_cabinet_lock_runtime() -> None:
    client_content = load_case_client_content("case_001")
    runtime = load_case_runtime("case_001")

    validate_case_content_links(client_content, runtime)

    resolved = resolve_object_interaction(
        client_content,
        "ZONE_SECRET_CORRIDOR",
        "OBJ_FIRE_CABINET_LOCK",
        "input",
    )
    puzzle = next(
        puzzle for puzzle in runtime.puzzles if puzzle.puzzle_id == resolved.target_id
    )

    assert client_content.entry_zone_id == "ZONE_SECRET_CORRIDOR"
    assert resolved.target_id == "PUZZLE_FIRE_CABINET_LOCK"
    assert normalize_answer(" V A L V E ") in {
        normalize_answer(answer) for answer in puzzle.accepted_answers
    }
    assert puzzle.on_correct.set_flags == {"fire_cabinet_unlocked": True}
