import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.services.content_fingerprint import compute_content_fingerprint
from app.services.pinned_content import ContentPin, PinnedContentStore
from app.services.publication_gate import ApprovalRecord, evaluate_publication

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 승인 기록이 아니다.
CASE_ID = "case_gate_test"
ANSWER = "가상정답일"
HINTS = {
    (CASE_ID, "PUZZLE_A", 1): "(가상) 1단계 원문",
    (CASE_ID, "PUZZLE_A", 2): "(가상) 2단계 원문",
}
CASES_DIR = Path(__file__).resolve().parents[1] / "app" / "content" / "cases"


def hint_source(case_id: str, puzzle_id: str, level: int) -> str | None:
    return HINTS.get((case_id, puzzle_id, level))


def base_documents(
    version: int = 1, case_id: str = CASE_ID
) -> dict[str, dict[str, Any]]:
    client = {
        "case_id": CASE_ID,
        "entry_zone_id": "ZONE_A",
        "zones": [
            {
                "zone_id": "ZONE_A",
                "zone_name": "가상 방",
                "zone_type": "room",
                "description": "(가상) 조용한 방",
                "objects": [
                    {
                        "object_id": "OBJ_S1_LOCK_1",
                        "object_name": "자물쇠",
                        "object_type": "lock",
                        "visible": True,
                        "enabled": True,
                        "interaction": {"type": "input", "target_id": "PUZZLE_A"},
                    },
                    {
                        "object_id": "OBJ_S1_NOTE_2",
                        "object_name": "쪽지",
                        "object_type": "note",
                        "visible": True,
                        "enabled": True,
                        "interaction": {"type": "inspect", "target_id": "IN_1"},
                    },
                ],
                "navigation": [],
            }
        ],
    }
    server = {
        "schema_version": "0.1",
        "case_id": CASE_ID,
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_A",
                "accepted_answers": [ANSWER],
                "on_correct": {"grant_clue_ids": ["CLUE_A"], "set_flags": {}},
            }
        ],
        "clue_combinations": [],
        "inspections": [
            {
                "inspect_id": "IN_1",
                "on_inspect": {"grant_clue_ids": ["CLUE_B"], "set_flags": {}},
            }
        ],
        "clues": [
            {"clue_id": "CLUE_A", "title": "(가상) 단서 A"},
            {"clue_id": "CLUE_B", "title": "(가상) 단서 B"},
        ],
    }
    npc = {
        "schema_version": "npc-pack 0.1",
        "case_id": CASE_ID,
        "npc_id": "NPC_COMPANION",
        "status": "published",
        "approvals": [],
        "generated_at": "2026-10-27T00:00:00Z",
        "general_nudges": [
            {
                "line_id": "NUDGE_LOOK",
                "text": "(가상) 둘러보자.",
                "reveal_when": {"always": True},
            }
        ],
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_A",
                "nudges": [
                    {
                        "line_id": "NUDGE_PUZZLE_A",
                        "text": "(가상) 그 자물쇠를 다시 보자.",
                        "reveal_when": {"clue_acquired": "CLUE_A"},
                    }
                ],
                "hints": [{"level": 1}, {"level": 2}],
            }
        ],
    }
    idmap = {
        "schema": "naju-idmap/0.1",
        "case_id": CASE_ID,
        "status": "published",
        "local_source": {},
        "rules": {},
        "zones": [
            {
                "local": "Z1",
                "name": "가",
                "x_m": [0, 1],
                "z_m": [0, 1],
                "zone_id": "ZONE_A",
            }
        ],
        "scenes": [
            {
                "local": 1,
                "local_complete_signal": "endScene(1)",
                "note": "",
                "scene_id": "SCENE_ONE",
                "src_id": "scene-01",
                "title": "(가상)",
                "zones": ["Z1"],
                "zone_ids": ["ZONE_A"],
            }
        ],
        "navigation": [],
        "blockers": [],
        "objects": [
            {
                "local": f"씬1.{name}#{n}",
                "object_id": f"OBJ_S1_{name_en}_{n}",
                "scene": 1,
                "zone": "Z1",
                "zone_id": "ZONE_A",
                "status": "placed",
                "interaction": {"type": kind},
                "at_m": [0, 0],
            }
            for name, name_en, n, kind in (
                ("자물쇠", "LOCK", 1, "input"),
                ("쪽지", "NOTE", 2, "inspect"),
            )
        ],
        "object_groups_without_instances": [],
        "puzzles": [
            {
                "local": "씬1.자물쇠#1",
                "puzzle_id": "PUZZLE_A",
                "scene_id": "SCENE_ONE",
                "src_id": "PZ-01",
                "status": "placed",
                "title": "(가상)",
                "note": "",
            }
        ],
        "clues": [
            {
                "local": "x1",
                "clue_id": "CLUE_A",
                "src_id": "CL-01-1",
                "puzzle_src_id": "PZ-01",
                "status": "placed",
            },
            {
                "local": "x2",
                "clue_id": "CLUE_B",
                "src_id": "CL-01-2",
                "puzzle_src_id": "PZ-01",
                "status": "placed",
            },
        ],
        "not_mapped": [],
    }
    documents = {"client": client, "server": server, "npc": npc, "idmap": idmap}
    for document in documents.values():
        document["content_version"] = version
        document["case_id"] = case_id
    return documents


def encode(documents: dict[str, dict[str, Any]]) -> dict[str, bytes]:
    return {
        role: json.dumps(doc, ensure_ascii=False).encode("utf-8")
        for role, doc in documents.items()
    }


def seal(documents: dict[str, dict[str, Any]]) -> tuple[dict[str, bytes], str]:
    """각 파일 머리에 다시 계산한 fingerprint를 적는다(fingerprint 계산에서는 빠지는 필드)."""

    fingerprint = compute_content_fingerprint(**encode(documents))
    for document in documents.values():
        document["content_fingerprint"] = fingerprint
    return encode(documents), fingerprint


def approvals_for(fingerprint: str, gates=("G1", "G2", "G3"), decision="approved"):
    records = [
        ApprovalRecord(
            gate, decision, fingerprint, "reviewer-test", datetime(2026, 10, 27)
        )
        for gate in gates
    ]
    return lambda case_id, version: records


LOCAL_IDS = {
    "zones": ["Z1"],
    "navigation": [],
    "blockers": [],
    "objects": ["씬1.자물쇠#1", "씬1.쪽지#2"],
    "scenes": ["1"],
}


def run(
    files: dict[str, bytes | None], fingerprint: str | None = None, **overrides: Any
):
    kwargs: dict[str, Any] = {
        "hint_source": hint_source,
        "approval_source": approvals_for(fingerprint) if fingerprint else None,
        "ng_checker": lambda text: False,
        "local_ids": LOCAL_IDS,
        "store": PinnedContentStore(),
    }
    kwargs.update(overrides)
    return evaluate_publication(**files, **kwargs), kwargs["store"]


def statuses(result) -> dict[str, str]:
    return {check.code: check.status for check in result.checks}


# --- 정상 묶음 ---


def no_idmap_files(
    version: int = 1, **kwargs: Any
) -> tuple[dict[str, bytes | None], str]:
    documents = base_documents(version, **kwargs)
    del documents["idmap"]
    files, fingerprint = seal(documents)
    return {**files, "idmap": None}, fingerprint


def test_valid_non_scene_bundle_with_trusted_approvals_is_registered() -> None:
    files, fingerprint = no_idmap_files()

    result, store = run(files, fingerprint)

    assert result.approved is True
    assert result.registered is True
    assert {code for code, status in statuses(result).items() if status != "PASS"} == {
        "IDMAP",
        "EXECUTABLE_REFS",
        "LOCAL_IDS",
        "SCENES",
    }
    assert set(statuses(result).values()) == {"PASS", "NOT_APPLICABLE"}
    bundle = store.get(ContentPin(CASE_ID, 1, fingerprint))
    assert bundle.server().puzzles[0].puzzle_id == "PUZZLE_A"
    assert bundle.npc().puzzles[0].hints[0].level == 1


def test_scene_mapped_bundle_passes_everything_else_but_is_not_published() -> None:
    files, fingerprint = seal(base_documents())

    result, store = run(files, fingerprint)

    assert result.check("SCENES").status == "UNVERIFIED"
    assert result.check("SCENES").reasons == (
        "scene completion required but no clear_when",
    )
    assert {code for code, status in statuses(result).items() if status != "PASS"} == {
        "SCENES"
    }
    assert result.approved is False
    assert result.registered is False
    assert store.versions(CASE_ID) == ()


def test_declared_scenes_with_clear_when_are_unverified() -> None:
    documents = base_documents()
    del documents["idmap"]
    documents["server"]["scenes"] = [
        {"scene_id": "SCENE_ONE", "clear_when": {"puzzle_completed": "PUZZLE_A"}}
    ]
    files, fingerprint = seal(documents)

    result, store = run({**files, "idmap": None}, fingerprint)

    assert result.check("CLIENT_SERVER").status == "PASS"
    assert result.check("SCENES").reasons == ("clear_when not verifiable",)
    assert result.registered is False
    assert store.versions(CASE_ID) == ()


def test_naju_case_requires_scene_verification_even_without_idmap() -> None:
    files, fingerprint = no_idmap_files(case_id="naju-angam-01")

    result, store = run(
        files,
        fingerprint,
        hint_source=lambda case_id, puzzle_id, level: HINTS.get(
            (CASE_ID, puzzle_id, level)
        ),
    )

    # 장면 외 검사는 모두 통과한 상태에서 장면 검증이 없어 게시되지 않는다.
    assert {
        code for code, status in statuses(result).items() if status == "FAIL"
    } == set()

    assert result.check("SCENES").status == "UNVERIFIED"
    assert result.approved is False
    assert store.versions("naju-angam-01") == ()


def test_result_never_contains_fingerprint_answers_or_hint_text() -> None:
    documents = base_documents()
    documents["client"]["zones"][0]["description"] = f"(가상) {ANSWER}"
    files, fingerprint = seal(documents)

    result, _ = run(files, fingerprint)

    dumped = repr(result)
    assert fingerprint not in dumped
    assert ANSWER not in dumped
    assert all(text not in dumped for text in HINTS.values())


# --- 승인 기록의 신뢰 경계 ---


def test_missing_approval_source_is_rejected_even_if_json_claims_approval() -> None:
    documents = base_documents()
    files, fingerprint = seal(documents)
    documents["npc"]["approvals"] = [
        {
            "gate": g,
            "decision": "approved",
            "target_hash": fingerprint,
            "at": "2026-10-27T00:00:00Z",
        }
        for g in ("G1", "G2", "G3")
    ]
    files = encode(documents)  # approvals · status는 fingerprint에서 빠져 값이 같다

    result, store = run(files, None)

    assert result.check("APPROVALS").status == "FAIL"
    assert result.check("APPROVALS").reasons == ("no trusted approval source",)
    assert result.approved is False
    assert store.versions(CASE_ID) == ()


@pytest.mark.parametrize("missing", ["G1", "G2", "G3"])
def test_each_gate_is_required(missing: str) -> None:
    files, fingerprint = seal(base_documents())
    gates = tuple(g for g in ("G1", "G2", "G3") if g != missing)

    result, store = run(
        files, fingerprint, approval_source=approvals_for(fingerprint, gates)
    )

    assert result.check("APPROVALS").reasons == (f"{missing}:missing",)
    assert result.registered is False
    assert store.versions(CASE_ID) == ()


def test_approval_for_previous_content_requires_reapproval() -> None:
    files, old_fingerprint = seal(base_documents())
    changed = base_documents()
    changed["npc"]["general_nudges"][0]["text"] = "(가상) 다른 문장."
    new_files, new_fingerprint = seal(changed)

    result, _ = run(new_files, None, approval_source=approvals_for(old_fingerprint))

    assert new_fingerprint != old_fingerprint
    assert result.check("APPROVALS").reasons == (
        "G1:stale target_hash",
        "G2:stale target_hash",
        "G3:stale target_hash",
    )
    assert result.approved is False


def test_rejected_decision_blocks_publication() -> None:
    files, fingerprint = no_idmap_files()
    records = [
        ApprovalRecord(
            g, "approved", fingerprint, "reviewer-test", datetime(2026, 10, 27)
        )
        for g in ("G1", "G3")
    ] + [
        ApprovalRecord(
            "G2", "rejected", fingerprint, "reviewer-test", datetime(2026, 10, 27)
        )
    ]

    result, store = run(files, fingerprint, approval_source=lambda c, v: records)

    assert result.check("APPROVALS").reasons == ("G2:rejected",)
    assert store.versions(CASE_ID) == ()


def test_conflicting_decisions_for_same_fingerprint_are_refused() -> None:
    files, fingerprint = no_idmap_files()
    records = list(approvals_for(fingerprint)(CASE_ID, 1)) + [
        ApprovalRecord(
            "G2", "rejected", fingerprint, "reviewer-test", datetime(2026, 10, 28)
        )
    ]

    result, store = run(files, fingerprint, approval_source=lambda c, v: records)

    # 더 늦은 시각이라도 최종 판정을 추측하지 않는다.
    assert result.check("APPROVALS").reasons == ("G2:conflicting decisions",)
    assert result.registered is False
    assert store.versions(CASE_ID) == ()


# --- fingerprint · 파일 머리 ---


def test_header_fingerprint_mismatch_is_rejected() -> None:
    documents = base_documents()
    files, fingerprint = seal(documents)
    documents["idmap"]["content_fingerprint"] = "sha256:" + "0" * 64
    files = encode(documents)

    result, store = run(files, fingerprint)

    assert result.check("HEADER").status == "FAIL"
    assert result.check("HEADER").reasons == ("idmap:content_fingerprint",)
    assert store.versions(CASE_ID) == ()


def test_content_changed_after_sealing_is_rejected() -> None:
    documents = base_documents()
    files, fingerprint = seal(documents)
    documents["server"]["puzzles"][0]["accepted_answers"] = ["가상정답이"]
    files = encode(documents)  # 머리 fingerprint는 옛 값

    result, _ = run(files, fingerprint)

    assert result.check("HEADER").status == "FAIL"
    assert set(result.check("HEADER").reasons) == {
        "client:content_fingerprint",
        "server:content_fingerprint",
        "npc:content_fingerprint",
        "idmap:content_fingerprint",
    }


@pytest.mark.parametrize(
    ("role", "field", "value"),
    [
        ("idmap", "content_version", 2),
        ("npc", "case_id", "other"),
        ("client", "content_version", True),
    ],
)
def test_header_mismatch_between_files(role: str, field: str, value: Any) -> None:
    documents = base_documents()
    seal(documents)
    documents[role][field] = value
    files = encode(documents)

    result, _ = run(files, None)

    assert result.check("HEADER").status == "FAIL"
    assert any(
        reason.startswith(f"{role}:") for reason in result.check("HEADER").reasons
    )


def test_invalid_json_stops_at_parse() -> None:
    files, fingerprint = seal(base_documents())
    files["npc"] = b'{"a": 1, "a": 2}'

    result, _ = run(files, fingerprint)

    assert [c.code for c in result.checks] == ["PARSE"]
    assert result.check("PARSE").status == "FAIL"


# --- NPC · PUB-LEAK ---


def test_npc_hint_text_is_rejected() -> None:
    documents = base_documents()
    documents["npc"]["puzzles"][0]["hints"] = [
        {"level": 1, "text": "(가상) 1단계 원문"}
    ]
    files, fingerprint = seal(documents)

    result, store = run(files, fingerprint)

    assert result.check("NPC").status == "FAIL"
    assert store.versions(CASE_ID) == ()


def test_npc_hint_level_missing_in_hint_source_is_rejected() -> None:
    files, fingerprint = seal(base_documents())

    result, _ = run(
        files,
        fingerprint,
        hint_source=lambda c, p, level: HINTS.get((c, p, 1)) if level == 1 else None,
    )

    assert result.check("NPC").status == "FAIL"
    assert "UNDEFINED_HINT_LEVEL:PUZZLE_A:2" in result.check("NPC").reasons


@pytest.mark.parametrize("leak", [ANSWER, "(가상) 2단계 원문"])
def test_client_leak_of_answer_or_hint_text_is_rejected(leak: str) -> None:
    documents = base_documents()
    documents["client"]["zones"][0]["objects"][1]["object_name"] = f"쪽지 {leak}"
    files, fingerprint = seal(documents)

    result, _ = run(files, fingerprint)

    assert result.check("LEAK_CLIENT").status == "FAIL"
    assert result.approved is False


# --- 실행 불가 항목 참조 (PUB-REF) ---


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        (
            lambda d: d["idmap"]["objects"][0].update(status="placed_no_interaction"),
            "interaction_object:OBJ_S1_LOCK_1",
        ),
        (
            lambda d: d["idmap"]["objects"][1].update(status="unplaced"),
            "interaction_object:OBJ_S1_NOTE_2",
        ),
        (
            lambda d: d["idmap"]["puzzles"][0].update(status="unplaced"),
            "interaction_puzzle:PUZZLE_A",
        ),
        (
            lambda d: d["idmap"]["clues"][0].update(status="unplaced"),
            "reveal_when_clue:NUDGE_PUZZLE_A:CLUE_A",
        ),
    ],
)
def test_references_to_non_placed_items_fail(mutate, reason: str) -> None:
    documents = base_documents()
    mutate(documents)
    files, fingerprint = seal(documents)

    result, store = run(files, fingerprint)

    assert result.check("EXECUTABLE_REFS").status == "FAIL"
    assert reason in result.check("EXECUTABLE_REFS").reasons
    assert store.versions(CASE_ID) == ()


def test_reveal_when_on_unplaced_puzzle_fails() -> None:
    documents = base_documents()
    documents["npc"]["general_nudges"][0]["reveal_when"] = {
        "hint_level": {"puzzle": "PUZZLE_A", "gte": 1}
    }
    documents["idmap"]["puzzles"][0]["status"] = "unplaced"
    files, fingerprint = seal(documents)

    result, _ = run(files, fingerprint)

    assert (
        "reveal_when_puzzle:NUDGE_LOOK:PUZZLE_A"
        in result.check("EXECUTABLE_REFS").reasons
    )


def test_idmap_cross_reference_errors_fail() -> None:
    documents = base_documents()
    documents["idmap"]["clues"][0]["clue_id"] = "CLUE_GHOST"
    files, fingerprint = seal(documents)

    result, _ = run(files, fingerprint)

    assert result.check("IDMAP").status == "FAIL"
    assert "MISSING_IN_SERVER:CLUE_GHOST" in result.check("IDMAP").reasons


# --- 미검증 · 버전 순서 · 등록 ---


def test_missing_ng_checker_local_ids_or_store_are_unverified() -> None:
    files, fingerprint = seal(base_documents())

    result, _ = run(files, fingerprint, ng_checker=None, local_ids=None, store=None)

    assert statuses(result)["NG"] == "UNVERIFIED"
    assert statuses(result)["LOCAL_IDS"] == "UNVERIFIED"
    assert statuses(result)["VERSION_ORDER"] == "UNVERIFIED"
    assert result.approved is False
    assert result.registered is False


def test_ng_and_local_id_failures() -> None:
    files, fingerprint = seal(base_documents())

    result, _ = run(
        files,
        fingerprint,
        ng_checker=lambda text: "그 자물쇠" in text,
        local_ids={**LOCAL_IDS, "objects": ["씬1.자물쇠#1"]},
    )

    assert result.check("NG").reasons == ("NUDGE_PUZZLE_A",)
    assert result.check("LOCAL_IDS").reasons == ("LOCAL_ID_NOT_IN_GAME:씬1.쪽지#2",)
    assert result.approved is False


def test_version_must_increase_and_failed_bundles_are_never_registered() -> None:
    store = PinnedContentStore()
    v1_files, v1_fp = no_idmap_files(1)
    assert run(v1_files, v1_fp, store=store)[0].registered is True

    again, _ = run(v1_files, v1_fp, store=store)
    assert again.check("VERSION_ORDER").status == "FAIL"
    assert again.registered is False

    bad = base_documents(2)
    del bad["idmap"]
    bad["client"]["zones"][0]["description"] = f"(가상) {ANSWER}"
    bad_files, bad_fp = seal(bad)
    assert run({**bad_files, "idmap": None}, bad_fp, store=store)[0].registered is False

    v2_files, v2_fp = no_idmap_files(2)
    assert run(v2_files, v2_fp, store=store)[0].registered is True
    assert store.versions(CASE_ID) == (1, 2)


def test_bundle_without_idmap_marks_idmap_checks_not_applicable() -> None:
    documents = base_documents()
    del documents["idmap"]
    files, fingerprint = seal(documents)

    result, store = run({**files, "idmap": None}, fingerprint)

    assert statuses(result)["IDMAP"] == "NOT_APPLICABLE"
    assert statuses(result)["EXECUTABLE_REFS"] == "NOT_APPLICABLE"
    assert result.registered is True
    assert store.get(ContentPin(CASE_ID, 1, fingerprint)).idmap() is None


def test_inputs_are_not_mutated() -> None:
    files, fingerprint = seal(base_documents())
    before = deepcopy(files)

    run(files, fingerprint)

    assert files == before


# --- 레거시 ---


def test_legacy_case_001_cannot_be_published_through_the_gate() -> None:
    client = (CASES_DIR / "case_001.client.json").read_bytes()
    server = (CASES_DIR / "case_001.server.json").read_bytes()
    npc = json.dumps({"case_id": "case_001"}).encode("utf-8")

    result, store = run(
        {"client": client, "server": server, "npc": npc, "idmap": None}, None
    )

    assert result.check("HEADER").status == "FAIL"
    assert result.registered is False
    assert store.versions("case_001") == ()


# --- placed 판정 (PM v0.4.1) ---


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        (
            lambda d: d["idmap"]["objects"][0].update(interaction=None),
            "interaction_object:OBJ_S1_LOCK_1",
        ),
        (
            lambda d: d["idmap"]["objects"][1].update(status="ready"),
            "interaction_object:OBJ_S1_NOTE_2",
        ),
        (
            lambda d: d["idmap"]["puzzles"][0].update(local=None),
            "interaction_puzzle:PUZZLE_A",
        ),
        (
            lambda d: d["idmap"]["clues"][0].update(local=None),
            "reveal_when_clue:NUDGE_PUZZLE_A:CLUE_A",
        ),
    ],
)
def test_placed_requires_interaction_and_local_host(mutate, reason: str) -> None:
    documents = base_documents()
    mutate(documents)
    files, fingerprint = seal(documents)

    result, store = run(files, fingerprint)

    assert result.check("EXECUTABLE_REFS").status == "FAIL"
    assert reason in result.check("EXECUTABLE_REFS").reasons
    assert store.versions(CASE_ID) == ()


def test_placed_object_missing_from_game_local_ids_is_not_executable() -> None:
    files, fingerprint = seal(base_documents())

    result, _ = run(
        files, fingerprint, local_ids={**LOCAL_IDS, "objects": ["씬1.자물쇠#1"]}
    )

    assert "interaction_object:OBJ_S1_NOTE_2" in result.check("EXECUTABLE_REFS").reasons
    assert result.check("LOCAL_IDS").status == "FAIL"


def test_placed_with_interaction_and_local_host_is_executable() -> None:
    files, fingerprint = seal(base_documents())

    result, _ = run(files, fingerprint)

    assert result.check("EXECUTABLE_REFS").status == "PASS"
    assert result.check("IDMAP").status == "PASS"
