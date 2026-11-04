import json
from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services import case_content, puzzle_runtime
from app.services.case_content_validation import (
    CaseContentLinkValidationError,
    validate_case_content_links,
)
from app.services.hint_access import is_puzzle_discovered
from app.services.interaction import PuzzleNotFoundError, _grade_puzzle
from tests.client_skill_case import (
    CASE,
    OTHER_ZONE,
    ZONE,
    body,
    documents,
    models,
    session,
)
from tests.test_interactions import INTERACTIONS_URL
from tests.test_publication_gate import base_documents, run, seal


@pytest.fixture
def skill_case(tmp_path, monkeypatch):
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)

    def write(client=None, server=None):
        default_client, default_server = documents()
        for role, document in (
            ("client", client if client is not None else default_client),
            ("server", server if server is not None else default_server),
        ):
            (tmp_path / f"{CASE}.{role}.json").write_text(
                json.dumps(document), encoding="utf-8"
            )

    write()
    return write


def test_complete_applies_server_effect_once_and_preserves_hint_stats(
    client, db_session, skill_case
):
    row = session()
    db_session.get_result = row
    first = client.post(INTERACTIONS_URL, json=body())
    assert first.status_code == 200
    assert first.json()["result_type"] == "correct"
    assert first.json()["attempt_count"] == 1
    assert row.state_json["completed_puzzle_ids"] == ["SKILL_A"]
    assert row.state_json["acquired_item_ids"] == ["ITEM_TEST"]
    assert row.state_json["acquired_clue_ids"] == ["CL_TEST"]
    assert row.state_json["hint_levels"] == {"SKILL_A": 1}
    assert (row.help_used, row.hint_balance) == (1, 4)
    again = client.post(INTERACTIONS_URL, json=body())
    assert again.json()["result_type"] == "already_completed"
    assert again.json()["state_changes"] == []
    assert row.state_json["attempt_counts"] == {"SKILL_A": 1}


def test_same_event_replay_survives_movement_and_missing_content(
    client, db_session, skill_case
):
    row = session()
    db_session.get_result = row
    request = body()
    first = client.post(INTERACTIONS_URL, json=request)
    db_session.scalar_result = db_session.added[0]
    row.state_json["current_zone_id"] = OTHER_ZONE
    # Invalid content must not be loaded while replaying a committed event.
    skill_case(server={})
    again = client.post(INTERACTIONS_URL, json=request)
    assert again.json() == first.json()
    assert db_session.commit_count == 1
    assert len(db_session.added) == 1


@pytest.mark.parametrize(
    "change",
    [
        {"zone_id": OTHER_ZONE},
        {"target_id": "OBJ_B"},
        {"client_timestamp": "2026-11-04T12:01:00+09:00"},
        {"action": "input", "payload": {"answer": "test"}},
    ],
)
def test_same_event_different_body_conflicts(client, db_session, skill_case, change):
    db_session.get_result = session()
    request = body()
    assert client.post(INTERACTIONS_URL, json=request).status_code == 200
    db_session.scalar_result = db_session.added[0]
    changed = client.post(INTERACTIONS_URL, json={**request, **change})
    assert changed.status_code == 409
    assert len(db_session.added) == 1


@pytest.mark.parametrize(
    "payload", [{"success": True}, {"answer": "test"}, {"stars": 3}]
)
def test_complete_rejects_client_claims(client, db_session, skill_case, payload):
    db_session.get_result = session()
    assert client.post(INTERACTIONS_URL, json=body(payload=payload)).status_code == 422
    assert not db_session.added


@pytest.mark.parametrize(
    "overrides,target,status",
    [
        ({}, "OBJ_B", 409),
        ({"current_zone_id": OTHER_ZONE}, "OBJ_A", 409),
        ({}, "MISSING", 404),
        ({"completed_puzzle_ids": ["SKILL_A"]}, "OBJ_B", 409),
        (
            {"completed_puzzle_ids": ["SKILL_A"], "acquired_clue_ids": ["CL_TEST"]},
            "OBJ_B",
            409,
        ),
        (
            {
                "completed_puzzle_ids": ["SKILL_A"],
                "acquired_clue_ids": ["CL_TEST"],
                "acquired_item_ids": ["ITEM_TEST"],
                "consumed_item_ids": ["ITEM_TEST"],
            },
            "OBJ_B",
            409,
        ),
    ],
)
def test_rejections_have_no_side_effects(
    client, db_session, skill_case, overrides, target, status
):
    row = session(**overrides)
    db_session.get_result = row
    before = deepcopy(row.state_json)
    response = client.post(INTERACTIONS_URL, json=body(target))
    assert response.status_code == status
    assert row.state_json == before
    assert not db_session.added
    assert db_session.commit_count == 0


@pytest.mark.parametrize("field", ["visible", "enabled"])
def test_hidden_or_locked_object_cannot_complete(client, db_session, skill_case, field):
    row = session(object_states={ZONE: {"OBJ_A": {field: False}}})
    db_session.get_result = row
    response = client.post(INTERACTIONS_URL, json=body())
    assert response.status_code == 409
    assert not db_session.added


@pytest.mark.parametrize(
    "action,payload", [("input", {"answer": "x"}), ("select", {"choice": "x"})]
)
def test_answer_actions_cannot_grade_skill(
    client, db_session, skill_case, action, payload
):
    raw_client, _ = documents()
    raw_client["zones"][0]["objects"][0]["interaction"]["type"] = action
    skill_case(client=raw_client)
    db_session.get_result = session()
    response = client.post(INTERACTIONS_URL, json=body(action=action, payload=payload))
    assert response.status_code == 409
    assert not db_session.added


def test_complete_cannot_grade_legacy_answer_puzzle(client, db_session, skill_case):
    raw_client, _ = documents()
    raw_client["zones"][0]["objects"][2]["interaction"]["type"] = "complete"
    skill_case(client=raw_client)
    db_session.get_result = session()
    response = client.post(INTERACTIONS_URL, json=body("OBJ_C"))
    assert response.status_code == 409
    assert not db_session.added


def test_mixed_steps_item_consumption_and_completion_are_per_puzzle(
    client, db_session, skill_case
):
    row = session()
    db_session.get_result = row
    assert client.post(INTERACTIONS_URL, json=body("OBJ_A")).status_code == 200
    second = client.post(INTERACTIONS_URL, json=body("OBJ_B"))
    assert second.status_code == 200
    assert {c["type"] for c in second.json()["state_changes"]} == {
        "puzzle_completed",
        "item_consumed",
        "flag_updated",
        "scene_cleared",
        "case_completed",
    }
    completed_at = row.completed_at
    final = client.post(
        INTERACTIONS_URL,
        json=body("OBJ_C", action="input", payload={"answer": "synthetic-answer"}),
    )
    assert final.json()["result_type"] == "correct"
    duplicate = client.post(INTERACTIONS_URL, json=body("OBJ_B"))
    assert duplicate.json()["state_changes"] == []
    assert row.state_json["attempt_counts"] == {
        "SKILL_A": 1,
        "SKILL_B": 1,
        "VALUE_C": 1,
    }
    assert row.state_json["consumed_item_ids"] == ["ITEM_TEST"]
    assert row.completed_at == completed_at
    assert row.state_json["hint_levels"] == {"SKILL_A": 1}
    assert row.help_used == 1


@pytest.mark.parametrize(
    "change",
    [
        {"solve": {"mode": "unknown"}},
        {"accepted_answers": ["fake"]},
        {"solve": {}},
    ],
)
def test_invalid_solve_definition_rejected(change):
    _, raw = documents()
    raw["puzzles"][0].update(change)
    with pytest.raises(ValidationError):
        PuzzleRuntimeDefinition.model_validate(raw)


def test_legacy_answers_remain_required_and_unknown_puzzle_is_not_completed():
    client, runtime = models()
    raw = runtime.model_dump()
    raw["puzzles"][2]["accepted_answers"] = []
    with pytest.raises(ValidationError):
        PuzzleRuntimeDefinition.model_validate(raw)
    with pytest.raises(PuzzleNotFoundError):
        _grade_puzzle(
            "MISSING",
            None,
            session().state_json,
            runtime,
            lambda: client,
            client_skill=True,
        )


def test_skill_host_is_discovered_for_existing_hint_access():
    client, runtime = models()
    row = session()
    row.state_json["hint_levels"] = {}
    assert is_puzzle_discovered(client, row.state_json, "SKILL_A")
    assert not is_puzzle_discovered(client, row.state_json, "VALUE_UNKNOWN")
    raw_client, _ = documents()
    raw_client["zones"][0]["objects"][0]["interaction"]["target_id"] = "MISSING"
    with pytest.raises(CaseContentLinkValidationError):
        validate_case_content_links(type(client).model_validate(raw_client), runtime)


def test_skill_without_fake_answer_can_pass_existing_publication_gate():
    docs = base_documents()
    docs["server"]["puzzles"][0].pop("accepted_answers")
    docs["server"]["puzzles"][0]["solve"] = {"mode": "client_skill"}
    docs["client"]["zones"][0]["objects"][0]["interaction"]["type"] = "complete"
    del docs["idmap"]
    files, fingerprint = seal(docs)
    result, _ = run({**files, "idmap": None}, fingerprint, general_pack=None)
    assert result.approved and result.registered
    assert result.check("LEAK_CLIENT").status == "PASS"


def test_publication_rejects_complete_pointing_to_nonexecutable_puzzle():
    docs = base_documents()
    docs["server"]["puzzles"][0].pop("accepted_answers")
    docs["server"]["puzzles"][0]["solve"] = {"mode": "client_skill"}
    docs["client"]["zones"][0]["objects"][0]["interaction"]["type"] = "complete"
    docs["idmap"]["objects"][0]["interaction"] = {"type": "complete"}
    docs["idmap"]["puzzles"][0]["status"] = "blocked"
    files, fingerprint = seal(docs)
    result, _ = run(files, fingerprint, general_pack=None)
    assert result.check("EXECUTABLE_REFS").status == "FAIL"
    assert "interaction_puzzle:PUZZLE_A" in result.check("EXECUTABLE_REFS").reasons
    assert not result.registered
