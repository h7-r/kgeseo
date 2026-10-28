"""NPC 콘텐츠 PM v0.4.3 필드 — npc_scenario · ng · open · fallback_lines."""

import json
from copy import deepcopy
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.npc_content import NpcContentPack
from app.services.content_fingerprint import compute_content_fingerprint
from app.services.npc_content_validation import (
    assess_npc_content,
    validate_npc_content_links,
)
from tests.test_npc_content import (
    ANSWER_A,
    HINTS,
    hint_source,
    make_runtime,
    valid_pack,
)

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.


def v043_pack() -> dict[str, Any]:
    raw = valid_pack()
    raw.update(
        npc_scenario={"address": "탐정님", "avoid_topics": ["(가상) 사적인 질문"]},
        ng=[
            {"text": "(가상) 금지 왜곡 문장", "patterns": ["금지패턴"]},
            {"text": "(가상) 패턴 없는 금지 문장"},
        ],
        open=[{"text": "(가상) 관리인의 정체", "patterns": ["관리인이 범인"]}],
        fallback_lines=[
            {
                "line_id": "FALLBACK_GENERAL_01",
                "text": "(가상) 잠깐 숨 좀 돌려요.",
                "use": "generation_blocked",
            }
        ],
    )
    return raw


def link_issues(raw: dict) -> list[tuple[str, str]]:
    pack = NpcContentPack.model_validate(raw)
    return [
        (issue.code, issue.location)
        for issue in validate_npc_content_links(
            pack, make_runtime(), hint_source=hint_source
        )
    ]


# --- 스키마 ---


def test_v043_fields_parse() -> None:
    pack = NpcContentPack.model_validate(v043_pack())

    assert pack.npc_scenario is not None
    assert pack.npc_scenario.address == "탐정님"
    assert [rule.patterns for rule in pack.ng or []] == [["금지패턴"], []]
    assert pack.open is not None and pack.open[0].text == "(가상) 관리인의 정체"
    assert pack.fallback_lines[0].use == "generation_blocked"


def test_missing_policy_lists_are_none_not_empty() -> None:
    pack = NpcContentPack.model_validate(valid_pack())

    assert (pack.npc_scenario, pack.ng, pack.open) == (None, None, None)
    assert pack.fallback_lines == []


def test_explicit_empty_policy_lists_are_kept() -> None:
    raw = valid_pack() | {"ng": [], "open": []}

    pack = NpcContentPack.model_validate(raw)

    assert (pack.ng, pack.open) == ([], [])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r["npc_scenario"].update(nickname="x"),
        lambda r: r["ng"][0].update(id="NG_1"),
        lambda r: r["open"][0].update(hedges=["일지도"]),
        lambda r: r["fallback_lines"][0].update(approved=True),
        lambda r: r.update(endings=[]),
        lambda r: r["npc_scenario"].update(address="  "),
        lambda r: r["npc_scenario"].update(avoid_topics=[""]),
        lambda r: r["ng"][0].update(text=" "),
        lambda r: r["ng"][0].update(patterns=["  "]),
        lambda r: r["open"][0].pop("text"),
        lambda r: r["fallback_lines"][0].update(text="가" * 201),
        lambda r: r["fallback_lines"][0].update(use=""),
        lambda r: r["fallback_lines"][0].pop("line_id"),
        lambda r: r["fallback_lines"].append(dict(r["fallback_lines"][0])),
        lambda r: r["fallback_lines"][0].update(line_id="NUDGE_LOOK_AROUND"),
        lambda r: r["puzzles"][0].update(hints=[{"level": 1, "text": "(가상)"}]),
    ],
    ids=[
        "scenario_unknown",
        "ng_unknown",
        "open_unknown",
        "fallback_unknown",
        "top_unknown",
        "blank_address",
        "blank_avoid_topic",
        "blank_ng_text",
        "blank_pattern",
        "open_without_text",
        "long_fallback",
        "blank_use",
        "fallback_without_id",
        "duplicate_fallback",
        "fallback_reuses_nudge_id",
        "hint_text_in_npc",
    ],
)
def test_invalid_v043_content_is_rejected(mutate) -> None:
    raw = v043_pack()
    mutate(raw)

    with pytest.raises(ValidationError):
        NpcContentPack.model_validate(raw)


# --- 누출 ---


def test_clean_v043_pack_has_no_link_issues() -> None:
    assert link_issues(v043_pack()) == []


@pytest.mark.parametrize(
    ("mutate", "location"),
    [
        (
            lambda r: r["fallback_lines"][0].update(text=f"정답은 {ANSWER_A}"),
            "$.fallback_lines.0.text",
        ),
        (
            lambda r: r["npc_scenario"].update(
                address=HINTS[("case_test", "PUZZLE_A", 1)]
            ),
            "$.npc_scenario.address",
        ),
        (
            lambda r: r["npc_scenario"].update(avoid_topics=[ANSWER_A]),
            "$.npc_scenario.avoid_topics.0",
        ),
        (lambda r: r["open"][0].update(text=ANSWER_A), "$.open.0.text"),
    ],
)
def test_public_v043_text_with_answer_or_hint_is_protected(mutate, location) -> None:
    raw = v043_pack()
    mutate(raw)

    assert ("PROTECTED_TEXT", location) in link_issues(raw)


def test_server_only_ng_text_is_not_a_public_leak() -> None:
    raw = v043_pack()
    raw["ng"][0]["text"] = f"(가상) {ANSWER_A} 라고 단정하는 왜곡"

    assert link_issues(raw) == []


def test_issues_carry_no_text() -> None:
    raw = v043_pack()
    raw["fallback_lines"][0]["text"] = f"정답은 {ANSWER_A}"
    pack = NpcContentPack.model_validate(raw)

    issues = validate_npc_content_links(pack, make_runtime(), hint_source=hint_source)

    assert ANSWER_A not in repr(issues)


# --- fingerprint · 승인 ---


def fingerprint(npc: dict) -> str:
    return compute_content_fingerprint(
        client=b'{"case_id": "case_test", "zones": []}',
        server=b'{"case_id": "case_test", "puzzles": []}',
        npc=json.dumps(npc, ensure_ascii=False).encode("utf-8"),
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r["npc_scenario"].update(address="형사님"),
        lambda r: r["ng"][0]["patterns"].append("새패턴"),
        lambda r: r["open"].append({"text": "(가상) 새 주제", "patterns": ["p"]}),
        lambda r: r["fallback_lines"][0].update(use="other"),
        lambda r: r.pop("ng"),
    ],
)
def test_v043_content_changes_change_fingerprint(mutate) -> None:
    base = v043_pack()
    changed = deepcopy(base)
    mutate(changed)

    assert fingerprint(base) != fingerprint(changed)


def test_v043_pack_is_still_not_publish_approved() -> None:
    raw = v043_pack() | {"status": "published"}

    readiness = assess_npc_content(raw, make_runtime(), hint_source=hint_source)

    assert readiness.schema_valid
    assert not readiness.publish_approved
    assert not readiness.servable
