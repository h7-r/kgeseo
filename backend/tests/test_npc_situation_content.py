"""NPC 상황 대사 콘텐츠(계약 v0.4.16 §4 · §8-1 · §9-4 · §9-7) — 스키마 · 게시 검증.

가상 테스트 데이터만 쓴다. 실제 나주 콘텐츠 · 승인 기록이 아니며 아무것도 게시하지 않는다.
"""

from typing import Any, get_args

import pytest

from app.schemas import npc_content, npc_turn
from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import ClueDefinition
from app.services.case_ng_check import build_case_ng_checker
from app.services.npc_content_validation import validate_npc_content_links
from app.services.pinned_content import ContentPin
from tests import test_publication_gate as gate
from tests.test_npc_content import (
    ANSWER_A,
    assess,
    codes,
    hint_source,
    link_codes,
    make_runtime,
    valid_pack,
)

SITUATION_CODES = [
    "BREATH_LOW",
    "SENT_BACK",
    "ITEM_MISSING",
    "ITEM_LEFT_BEHIND",
    "ITEM_NOT_PICKED",
    "REPEATED_MISTAKE",
    "OFF_OBJECTIVE",
    "NO_PROGRESS",
    "STEP_ARRIVED",
    "STEP_DONE",
    "QUIET",
]
CLUE_BODY = "(가상) 우물 바닥에 붉은 열쇠가 묻혀 있다"


def situations() -> list[dict[str, Any]]:
    return [
        {
            "code": "BREATH_LOW",
            "cooldown_seconds": 45,
            "lines": [
                {
                    "line_id": "SIT_BREATH_LOW_01",
                    "text": "(가상) 숨이 얼마 남지 않았어요.",
                },
                {"line_id": "SIT_BREATH_LOW_02", "text": "(가상) 거품 쪽으로 가 봐요."},
            ],
        },
        {
            "code": "STEP_ARRIVED",
            "lines": [
                {
                    "line_id": "SIT_STEP_ARRIVED_01",
                    "text": "(가상) 바람이 차네요.",
                    "focus_object_id": "OBJ_S1_NOTE_2",
                }
            ],
        },
    ]


def pack_with(**fields: Any) -> dict[str, Any]:
    return valid_pack() | fields


def schema_locations(raw: dict[str, Any]) -> list[str]:
    readiness = assess(raw)
    assert readiness.schema_valid is False
    return [issue.location for issue in readiness.issues]


# --- 스키마 ---


def test_valid_situations_parse_and_pass_links() -> None:
    raw = pack_with(situations=situations())

    readiness = assess(raw)
    pack = NpcContentPack.model_validate(raw)

    assert readiness.schema_valid is True
    assert readiness.links_valid is True
    assert codes(readiness) == ["APPROVAL_UNVERIFIED"]
    assert [entry.code for entry in pack.situations] == ["BREATH_LOW", "STEP_ARRIVED"]
    assert pack.situations[0].cooldown_seconds == 45
    assert pack.situations[1].cooldown_seconds is None
    assert pack.situations[1].lines[0].focus_object_id == "OBJ_S1_NOTE_2"
    assert pack.situations[0].lines[0].focus_object_id is None
    assert [line.line_id for line in pack.situation_lines()] == [
        "SIT_BREATH_LOW_01",
        "SIT_BREATH_LOW_02",
        "SIT_STEP_ARRIVED_01",
    ]


def test_all_eleven_contract_codes_are_accepted() -> None:
    raw = pack_with(
        situations=[
            {
                "code": code,
                "lines": [{"line_id": f"SIT_{code}_01", "text": "(가상) 음."}],
            }
            for code in SITUATION_CODES
        ]
    )

    pack = NpcContentPack.model_validate(raw)

    assert [entry.code for entry in pack.situations] == SITUATION_CODES
    assert list(get_args(npc_content.NpcSituationCode)) == SITUATION_CODES


def test_turn_request_and_content_share_one_code_list() -> None:
    assert npc_turn.NpcSituationCode is npc_content.NpcSituationCode


@pytest.mark.parametrize("code", ["UNKNOWN", "breath_low", "", "CHATTER", 1, None])
def test_unknown_code_is_rejected(code: Any) -> None:
    entries = situations()
    entries[0]["code"] = code

    assert "$.situations.0.code" in schema_locations(pack_with(situations=entries))


@pytest.mark.parametrize("cooldown", [1, 45, 600, None])
def test_cooldown_is_optional_positive_integer(cooldown: Any) -> None:
    entries = situations()
    entries[0]["cooldown_seconds"] = cooldown

    pack = NpcContentPack.model_validate(pack_with(situations=entries))

    assert pack.situations[0].cooldown_seconds == cooldown


@pytest.mark.parametrize("cooldown", [0, -1, "45", 45.5, 45.0, True, [45]])
def test_invalid_cooldown_is_rejected(cooldown: Any) -> None:
    entries = situations()
    entries[0]["cooldown_seconds"] = cooldown

    assert "$.situations.0.cooldown_seconds" in schema_locations(
        pack_with(situations=entries)
    )


@pytest.mark.parametrize("focus", ["", " ", "O" * 65, 3, ["OBJ_A"]])
def test_invalid_focus_object_id_is_rejected(focus: Any) -> None:
    entries = situations()
    entries[1]["lines"][0]["focus_object_id"] = focus

    assert schema_locations(pack_with(situations=entries))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda e: e[0].update(lines=[]),
        lambda e: e[0].pop("lines"),
        lambda e: e[0].pop("code"),
        lambda e: e[0].update(extra="x"),
        lambda e: e[0]["lines"][0].pop("line_id"),
        lambda e: e[0]["lines"][0].pop("text"),
        lambda e: e[0]["lines"][0].update(text=" "),
        lambda e: e[0]["lines"][0].update(text="가" * 201),
        lambda e: e[0]["lines"][0].update(line_id=" "),
        # 계약 §4 의 상황 대사에는 reveal_when · 치환 변수 · 힌트가 없다
        lambda e: e[0]["lines"][0].update(reveal_when={"always": True}),
        lambda e: e[0]["lines"][0].update(zone_id="ZONE_A"),
        lambda e: e[0].update(suggest_hint=True),
    ],
    ids=[
        "empty_lines",
        "missing_lines",
        "missing_code",
        "entry_extra_field",
        "missing_line_id",
        "missing_text",
        "blank_text",
        "text_too_long",
        "blank_line_id",
        "line_reveal_when",
        "line_zone_id",
        "entry_suggest_hint",
    ],
)
def test_malformed_situation_entries_are_rejected(mutate) -> None:
    entries = situations()
    mutate(entries)

    assert schema_locations(pack_with(situations=entries))


@pytest.mark.parametrize("value", ["BREATH_LOW", {"code": "QUIET"}, None])
def test_situations_must_be_a_list_when_present(value: Any) -> None:
    raw = pack_with(situations=value)

    if value is None:
        # 명시한 null 은 「미제공」과 같다
        assert NpcContentPack.model_validate(raw).situations is None
    else:
        assert schema_locations(raw)


def test_same_code_twice_is_rejected() -> None:
    entries = situations()
    entries.append(
        {
            "code": "BREATH_LOW",
            "lines": [{"line_id": "SIT_BREATH_LOW_09", "text": "(가상) 음."}],
        }
    )

    readiness = assess(pack_with(situations=entries))

    assert readiness.schema_valid is False
    assert codes(readiness) == ["SCHEMA_INVALID"]


# --- general_nudges[].zone_id ---


def test_general_nudge_zone_id_is_optional() -> None:
    raw = valid_pack()
    raw["general_nudges"].append(
        {
            "line_id": "NUDGE_QUIET_DOCK",
            "text": "(가상) 강바람이 시원하네요.",
            "reveal_when": {"always": True},
            "zone_id": "ZONE_DOCK",
        }
    )

    pack = NpcContentPack.model_validate(raw)

    assert [nudge.zone_id for nudge in pack.general_nudges] == [None, "ZONE_DOCK"]
    assert assess(raw).links_valid is True


@pytest.mark.parametrize("zone", ["", " ", "Z" * 65, 3])
def test_invalid_general_nudge_zone_id_is_rejected(zone: Any) -> None:
    raw = valid_pack()
    raw["general_nudges"][0]["zone_id"] = zone

    assert schema_locations(raw)


def test_puzzle_nudge_does_not_take_zone_id() -> None:
    raw = valid_pack()
    raw["puzzles"][0]["nudges"][0]["zone_id"] = "ZONE_A"

    assert schema_locations(raw)


# --- line_id 중복(케이스 안에서 유일) ---


@pytest.mark.parametrize(
    "other",
    [
        lambda raw: raw["general_nudges"][0]["line_id"],
        lambda raw: raw["puzzles"][0]["nudges"][0]["line_id"],
        lambda raw: raw["fallback_lines"][0]["line_id"],
        lambda raw: "SIT_STEP_ARRIVED_01",
        lambda raw: "SIT_BREATH_LOW_02",
    ],
    ids=["general_nudge", "puzzle_nudge", "fallback_line", "other_entry", "same_entry"],
)
def test_situation_line_id_must_be_unique_in_case(other) -> None:
    raw = pack_with(
        situations=situations(),
        fallback_lines=[
            {"line_id": "FALLBACK_A", "text": "(가상) 음.", "use": "blocked"}
        ],
    )
    raw["situations"][0]["lines"][0]["line_id"] = other(raw)

    readiness = assess(raw)

    assert readiness.schema_valid is False
    assert codes(readiness) == ["SCHEMA_INVALID"]


# --- 정답 · 힌트 원문 보호 / 미공개 단서 ---


@pytest.mark.parametrize(
    ("text", "reference"),
    [
        (f"(가상) 혹시 {ANSWER_A} 아닐까요", "PUZZLE_A"),
        ("(가상) 정답은 가상 정답 에이 같아요", "PUZZLE_A"),
        ("(가상) 참고: (가상) B 1단계 원문", "PUZZLE_B"),
    ],
)
def test_situation_line_with_answer_or_hint_text_is_protected(
    text: str, reference: str
) -> None:
    entries = situations()
    entries[0]["lines"][1]["text"] = text

    readiness = assess(pack_with(situations=entries))

    assert readiness.links_valid is False
    [issue] = [i for i in readiness.issues if i.code == "PROTECTED_TEXT"]
    assert issue.reference == reference
    assert issue.location == "$.situations.0.lines.1.text"
    assert text not in repr(readiness)
    assert ANSWER_A not in repr(readiness)


def runtime_with_clue_body():
    runtime = make_runtime()
    clues = [
        *runtime.clues,
        ClueDefinition(clue_id="CLUE_WELL", title="(가상) 우물", body=CLUE_BODY),
    ]
    return runtime.model_copy(update={"clues": clues})


def leak_issues(raw: dict[str, Any], *, source=hint_source):
    pack = NpcContentPack.model_validate(raw)
    return [
        (issue.code, issue.location, issue.reference)
        for issue in validate_npc_content_links(
            pack, runtime_with_clue_body(), hint_source=source
        )
    ]


def test_situation_line_overlapping_any_clue_text_is_blocked() -> None:
    entries = situations()
    entries[0]["lines"][0]["text"] = "(가상) 우물 바닥에 붉은 열쇠가 묻혀 있을지도요"

    issues = leak_issues(pack_with(situations=entries))

    # 상황 대사는 reveal_when 이 없어 「아무것도 얻지 않은 상태」로 본다.
    assert issues == [
        ("UNREVEALED_LEAK", "$.situations.0.lines.0.text", "LEAK_CLUE:CLUE_WELL")
    ]
    assert CLUE_BODY not in repr(issues)


def test_situation_line_overlapping_unrevealed_hint_is_blocked() -> None:
    entries = situations()
    # 원문 전체 포함(PROTECTED_TEXT)이 아니라 8자 이상 이어진 겹침
    entries[0]["lines"][0]["text"] = "(가상) A 2단계 원문이 생각나요"

    issues = leak_issues(pack_with(situations=entries))

    assert (
        "UNREVEALED_LEAK",
        "$.situations.0.lines.0.text",
        "LEAK_HINT:PUZZLE_A:2",
    ) in issues


def test_unreadable_hint_source_never_passes_situation_lines() -> None:
    def broken(case_id: str, puzzle_id: str, level: int) -> str | None:
        raise RuntimeError("hint store down")

    pack = NpcContentPack.model_validate(pack_with(situations=situations()))
    # 상황 대사만 남겨, 상황 대사 검사가 힌트 원본을 읽지 못할 때를 본다.
    pack = pack.model_copy(update={"puzzles": [], "general_nudges": []})

    # 넛지와 같이 정답 · 힌트 원문 보호가 먼저 힌트 원본을 읽다가 실패를 그대로 올린다(통과로 보지 않는다).
    with pytest.raises(RuntimeError):
        validate_npc_content_links(pack, runtime_with_clue_body(), hint_source=broken)


def test_reveal_gated_nudges_keep_their_existing_rules() -> None:
    # 넛지는 reveal_when 으로 공개 시점을 묶으므로 미공개 겹침 검사 대상이 아니다(기존 그대로).
    raw = valid_pack()
    raw["general_nudges"][0]["text"] = "(가상) 우물 바닥에 붉은 열쇠가 묻혀 있을지도요"

    assert [code for code, _, _ in leak_issues(raw)] == []


# --- 하위 호환 ---


def test_pack_without_situations_is_unchanged() -> None:
    raw = valid_pack()

    pack = NpcContentPack.model_validate(raw)
    readiness = assess(raw)

    assert "situations" not in raw
    assert pack.situations is None
    assert pack.situation_lines() == []
    assert codes(readiness) == ["APPROVAL_UNVERIFIED"]


def test_empty_situations_differs_from_missing_but_has_no_lines() -> None:
    missing = NpcContentPack.model_validate(valid_pack())
    empty = NpcContentPack.model_validate(pack_with(situations=[]))

    assert missing.situations is None
    assert empty.situations == []
    assert missing.situation_lines() == empty.situation_lines() == []
    assert link_codes(pack_with(situations=[])) == link_codes(valid_pack())


def test_schema_version_stays_npc_pack_0_1() -> None:
    raw = pack_with(situations=situations(), schema_version="npc-pack 0.2")

    assert "$.schema_version" in schema_locations(raw)


# --- 게시 게이트 ---


def gate_documents(**npc_fields: Any) -> dict[str, dict[str, Any]]:
    documents = gate.base_documents()
    del documents["idmap"]
    documents["npc"].update(npc_fields)
    return documents


def gate_situations() -> list[dict[str, Any]]:
    return [
        {
            "code": "BREATH_LOW",
            "cooldown_seconds": 45,
            "lines": [
                {
                    "line_id": "SIT_BREATH_LOW_01",
                    "text": "(가상) 숨이 얼마 남지 않았어요.",
                }
            ],
        },
        {
            "code": "STEP_ARRIVED",
            "lines": [
                {
                    "line_id": "SIT_STEP_ARRIVED_01",
                    "text": "(가상) 쪽지가 바람에 흔들려요.",
                    "focus_object_id": "OBJ_S1_NOTE_2",
                }
            ],
        },
    ]


def publish(documents: dict[str, dict[str, Any]], **overrides: Any):
    files, fingerprint = gate.seal(documents)
    result, store = gate.run({**files, "idmap": None}, fingerprint, **overrides)
    store.last_fingerprint = fingerprint
    return result, store


def test_bundle_with_situations_passes_gate_and_registers() -> None:
    result, store = publish(gate_documents(situations=gate_situations()))

    assert result.approved is True
    assert result.registered is True
    assert gate.statuses(result)["NPC"] == "PASS"
    assert gate.statuses(result)["NG"] == "PASS"
    npc = store.get(ContentPin(gate.CASE_ID, 1, store.last_fingerprint)).npc()
    assert [entry.code for entry in npc.situations] == ["BREATH_LOW", "STEP_ARRIVED"]


@pytest.mark.parametrize("situations_value", [None, []], ids=["missing", "empty"])
def test_gate_results_for_packs_without_situation_lines_match(situations_value) -> None:
    baseline, _ = publish(gate_documents())
    documents = gate_documents()
    if situations_value is not None:
        documents["npc"]["situations"] = situations_value

    result, _ = publish(documents)

    assert gate.statuses(result) == gate.statuses(baseline)
    assert result.approved is True


def test_injected_ng_checker_sees_situation_lines() -> None:
    result, store = publish(
        gate_documents(situations=gate_situations()),
        ng_checker=lambda text: "숨이" in text,
    )

    assert result.check("NG").status == "FAIL"
    assert result.check("NG").reasons == ("SIT_BREATH_LOW_01",)
    assert result.registered is False


@pytest.mark.parametrize(
    ("policy", "text"),
    [
        (
            {"ng": [{"text": "(가상) 등대는 무너졌다", "patterns": ["등대는 무너"]}]},
            "(가상) 등대는 무너졌대요.",
        ),
        (
            {"open": [{"text": "(가상) 범인", "patterns": ["범인은 이장"]}]},
            "(가상) 범인은 이장이에요.",
        ),
    ],
    ids=["ng_pattern", "u_assertion"],
)
def test_case_ng_and_u_rules_apply_to_situation_lines(policy, text) -> None:
    entries = gate_situations()
    entries[0]["lines"][0]["text"] = text
    documents = gate_documents(situations=entries, **({"open": []} | policy))
    pack = NpcContentPack.model_validate(
        {k: v for k, v in documents["npc"].items() if k != "generated_at"}
    )

    result, _ = publish(documents, ng_checker=build_case_ng_checker(pack))

    assert result.check("NG").status == "FAIL"
    assert result.check("NG").reasons == ("SIT_BREATH_LOW_01",)
    assert text not in repr(result)


def test_gate_blocks_answer_in_situation_line() -> None:
    entries = gate_situations()
    entries[0]["lines"][0]["text"] = f"(가상) 혹시 {gate.ANSWER} 아닐까요"

    result, store = publish(gate_documents(situations=entries))

    assert result.check("NPC").status == "FAIL"
    assert result.check("NPC").reasons == ("PROTECTED_TEXT:PUZZLE_A",)
    assert result.registered is False
    assert gate.ANSWER not in repr(result)


def test_gate_blocks_situation_line_leaking_unacquired_clue() -> None:
    documents = gate_documents(situations=gate_situations())
    documents["server"]["clues"][0]["body"] = CLUE_BODY
    documents["npc"]["situations"][0]["lines"][0]["text"] = (
        "(가상) 우물 바닥에 붉은 열쇠가 묻혀 있을지도요"
    )

    result, _ = publish(documents)

    assert result.check("NPC").status == "FAIL"
    assert result.check("NPC").reasons == ("UNREVEALED_LEAK:LEAK_CLUE:CLUE_A",)
    assert CLUE_BODY not in repr(result)


def test_gate_blocks_duplicate_situation_line_id() -> None:
    entries = gate_situations()
    entries[1]["lines"][0]["line_id"] = "NUDGE_LOOK"

    result, _ = publish(gate_documents(situations=entries))

    assert result.check("NPC").status == "FAIL"
    assert result.registered is False


def test_case_proper_noun_in_situation_line_is_allowed() -> None:
    # 계약 §6: 케이스 팩 대사에는 그 케이스의 고유명이 들어가도 된다(GEN-CASE 는 공용 일반 팩 전용).
    entries = gate_situations()
    entries[0]["lines"][0]["text"] = "(가상) 아랑사 쪽 물이 차가워요."
    documents = gate_documents(
        situations=entries,
        proper_nouns=[{"text": "아랑사", "kind": "place", "aliases": []}],
    )

    result, _ = publish(documents)

    assert result.approved is True
    assert result.check("NPC").status == "PASS"
