"""자동 개입 nudge 선택 규칙(PM 11/10 요청) — 분류 순서 · ARRIVE 제외 · 회차 내 중복 방지 · 소진.

가상 테스트 데이터만 쓴다(실제 PM 대사 · 승인 기록이 아니다). 실제 나주 v1 묶음 검증은 저장소 밖 하네스로 한다.
"""

from types import SimpleNamespace

import pytest

from app.schemas.npc import ApprovedNpcLine
from app.schemas.npc_content import NpcContentPack
from app.services.npc_decision import NpcDecision
from app.services.npc_dialogue import (
    nudge_category,
    select_auto_nudge,
)
from app.services.npc_turn import run_auto_turn
from app.services.npc_turn_service import NPC_TURN_EVENT_TYPE, used_auto_nudges
from tests.test_npc_turn import FP, content
from tests.test_puzzle_question import make_state

CASE, NPC = "case_test", "NPC_TEST"

# 나주 v1 과 같은 이름 꼴(분류 · 번호 · 말투). 원문은 가상이다.
P1 = (
    "NUDGE_P01_HELP_1_J",
    "NUDGE_P01_HELP_2_J",
    "NUDGE_P01_STUCK_1_J",
    "NUDGE_P01_WRONG_1_J",
    "NUDGE_P01_WRONG_2_J",
)
P3 = (
    "NUDGE_P03_ARRIVE_1_J",
    "NUDGE_P03_HELP_1_J",
    "NUDGE_P03_STUCK_1_J",
)


def _nudge(line_id: str, reveal: dict | None = None) -> dict:
    return {
        "line_id": line_id,
        "text": f"(가상) {line_id}",
        "reveal_when": reveal or {"always": True},
    }


def pack(puzzles: dict[str, list[dict]]) -> NpcContentPack:
    return NpcContentPack.model_validate(
        {
            "schema_version": "npc-pack 0.1",
            "case_id": CASE,
            "npc_id": NPC,
            "status": "published",
            "content_version": 1,
            "content_fingerprint": FP,
            "general_nudges": [],
            "puzzles": [
                {"puzzle_id": pid, "nudges": nudges} for pid, nudges in puzzles.items()
            ],
            "ng": [],
            "open": [],
        }
    )


def naju_like() -> NpcContentPack:
    return pack(
        {
            "P01": [_nudge(i) for i in P1],
            "P03": [_nudge(i) for i in P3],
            # 다른 퍼즐에 같은 짧은 꼴의 line_id 가 있어도 섞이지 않는지 보려는 대상
            "P07": [_nudge("NUDGE_P07_HELP_1_J"), _nudge("NUDGE_P07_STUCK_1_J")],
        }
    )


def line_source_for(p: NpcContentPack, *, unapproved=frozenset()):
    by_id = {
        n.line_id: (entry.puzzle_id, n) for entry in p.puzzles for n in entry.nudges
    }

    def source(case_id, npc_id, line_id):
        puzzle_id, nudge = by_id[line_id]
        return ApprovedNpcLine(
            line_id=line_id,
            kind="nudge",
            text=nudge.text,
            approved=line_id not in unapproved,
            puzzle_id=puzzle_id,
            reveal_when=nudge.reveal_when,
        )

    return source


def pick(p, puzzle, reason, *, used=frozenset(), state=None, unapproved=frozenset()):
    return select_auto_nudge(
        p,
        NPC,
        puzzle,
        state or make_state(),
        CASE,
        line_source_for(p, unapproved=unapproved),
        reason=reason,
        used=used,
    )


def drain(p, puzzle, reason, **kwargs) -> list[str]:
    used: set = set()
    picked = []
    while True:
        selection = pick(p, puzzle, reason, used=frozenset(used), **kwargs)
        if selection.nudge is None:
            assert selection.exhausted == bool(picked)
            return picked
        picked.append(selection.nudge.line_id)
        used.add((puzzle, selection.nudge.line_id))


# ── 분류 ──


@pytest.mark.parametrize(
    ("line_id", "category"),
    [
        ("NUDGE_P01_WRONG_2_J", "WRONG"),
        ("NUDGE_P03_ARRIVE_1_J", "ARRIVE"),
        ("NUDGE_P07_STUCK_1_J", "STUCK"),
        ("NUDGE_P09_HELP_1", "HELP"),
        ("NUDGE_S3_KEY_WHAT_1_J", None),  # 정하지 않은 분류
        ("NUDGE_A_01", None),
        ("NUDGE_WRONG_ID", None),  # 분류 낱말이 있어도 꼴이 다르면 분류 없음
    ],
)
def test_nudge_category(line_id, category) -> None:
    assert nudge_category(line_id) == category


# ── A · B · C · D · E ──


def test_repeated_incorrect_prefers_wrong_then_help_and_never_stuck() -> None:
    assert drain(naju_like(), "P01", "repeated_incorrect") == [
        "NUDGE_P01_WRONG_1_J",
        "NUDGE_P01_WRONG_2_J",
        "NUDGE_P01_HELP_1_J",
        "NUDGE_P01_HELP_2_J",
    ]


def test_idle_prefers_stuck_then_help_and_never_wrong() -> None:
    assert drain(naju_like(), "P01", "idle_too_long") == [
        "NUDGE_P01_STUCK_1_J",
        "NUDGE_P01_HELP_1_J",
        "NUDGE_P01_HELP_2_J",
    ]


def test_missing_primary_category_falls_back_to_help() -> None:
    # P07 에는 WRONG 이 없다 → HELP 부터
    assert drain(naju_like(), "P07", "repeated_incorrect") == ["NUDGE_P07_HELP_1_J"]


def test_arrive_is_never_used_for_auto_intervention() -> None:
    for reason in ("repeated_incorrect", "idle_too_long", "player_requested"):
        assert "NUDGE_P03_ARRIVE_1_J" not in drain(naju_like(), "P03", reason)
    only_arrive = pack({"P03": [_nudge("NUDGE_P03_ARRIVE_1_J")]})
    selection = pick(only_arrive, "P03", "idle_too_long")
    assert (selection.nudge, selection.exhausted) == (None, False)


def test_used_lines_are_skipped_and_scoped_by_puzzle() -> None:
    used = frozenset({("P01", "NUDGE_P01_STUCK_1_J")})
    assert (
        pick(naju_like(), "P01", "idle_too_long", used=used).nudge.line_id
        == "NUDGE_P01_HELP_1_J"
    )
    # 다른 퍼즐에서 쓴 같은 line_id 는 이 퍼즐 사용 이력이 아니다
    other = frozenset({("P07", "NUDGE_P01_STUCK_1_J"), (None, "NUDGE_P01_STUCK_1_J")})
    assert (
        pick(naju_like(), "P01", "idle_too_long", used=other).nudge.line_id
        == "NUDGE_P01_STUCK_1_J"
    )


def test_exhausted_candidates_return_nothing() -> None:
    used = frozenset(("P01", i) for i in P1)
    selection = pick(naju_like(), "P01", "idle_too_long", used=used)
    assert (selection.nudge, selection.exhausted) == (None, True)


def test_lines_used_for_one_reason_are_not_reused_for_another_reason() -> None:
    # 미르님 11/10: 중복 기준은 (회차, 퍼즐, line_id) — 개입 사유가 달라도 다시 고르지 않는다.
    p = naju_like()
    used: set = set()
    for _ in range(3):  # 오답 사유로 WRONG_1 · WRONG_2 · HELP_1 반환
        nudge = pick(p, "P01", "repeated_incorrect", used=frozenset(used)).nudge
        used.add(("P01", nudge.line_id))
    assert ("P01", "NUDGE_P01_HELP_1_J") in used
    idle = []
    while (
        nudge := pick(p, "P01", "idle_too_long", used=frozenset(used)).nudge
    ) is not None:
        idle.append(nudge.line_id)
        used.add(("P01", nudge.line_id))
    assert idle == [
        "NUDGE_P01_STUCK_1_J",
        "NUDGE_P01_HELP_2_J",
    ]  # HELP_1 은 다시 나오지 않는다
    assert len(used) == len(P1)


def test_run_auto_turn_wrong_then_stuck_never_repeats_a_line() -> None:
    p = naju_like()
    reasons = ["repeated_incorrect"] * 3 + ["idle_too_long"] * 3
    served: list = []
    for reason in reasons:
        selection = pick(
            p, "P01", reason, used=frozenset(("P01", i) for i in served if i)
        )
        served.append(selection.nudge.line_id if selection.nudge else None)
    assert served == [
        "NUDGE_P01_WRONG_1_J",
        "NUDGE_P01_WRONG_2_J",
        "NUDGE_P01_HELP_1_J",
        "NUDGE_P01_STUCK_1_J",
        "NUDGE_P01_HELP_2_J",
        None,
    ]


# ── F ──


def test_unapproved_or_unrevealed_lines_are_never_selected() -> None:
    p = pack(
        {
            "P01": [
                _nudge("NUDGE_P01_STUCK_1_J", {"clue_acquired": "CLUE_NOT_YET"}),
                _nudge("NUDGE_P01_STUCK_2_J"),
                _nudge("NUDGE_P01_HELP_1_J"),
            ]
        }
    )
    assert drain(p, "P01", "idle_too_long", unapproved={"NUDGE_P01_STUCK_2_J"}) == [
        "NUDGE_P01_HELP_1_J"
    ]
    # 공개 조건을 충족하면 그때 고른다
    revealed = make_state(acquired_clue_ids=["CLUE_NOT_YET"])
    assert (
        pick(p, "P01", "idle_too_long", state=revealed).nudge.line_id
        == "NUDGE_P01_STUCK_1_J"
    )


def test_unspecified_reason_keeps_pack_order_without_arrive() -> None:
    # player_requested 등 순서가 정해지지 않은 사유는 기존처럼 팩 파일 순서(정책 미정, 보고 대상)
    assert drain(naju_like(), "P01", "player_requested") == list(P1)


def test_uncategorized_lines_remain_last_fallback() -> None:
    p = pack({"PZ": [_nudge("NUDGE_A_01"), _nudge("NUDGE_PZ_HELP_1")]})
    assert drain(p, "PZ", "repeated_incorrect") == ["NUDGE_PZ_HELP_1", "NUDGE_A_01"]


# ── 회차 이력 추출 ──


def _event(kind=NPC_TURN_EVENT_TYPE, **record):
    base = {
        "trigger": "auto",
        "auto_intervened": True,
        "reply_source": "approved_line",
        "line_id": "NUDGE_P01_STUCK_1_J",
        "auto_intervene": {"puzzle_ref": "P01", "level": 1},
    }
    return SimpleNamespace(interaction_type=kind, response_json=base | record)


def test_used_auto_nudges_counts_only_returned_level1_auto_nudges() -> None:
    events = [
        _event(),
        _event(
            line_id="NUDGE_P07_HELP_1_J",
            auto_intervene={"puzzle_ref": "P07", "level": 1},
        ),
        _event(trigger="player_message", line_id="X1"),
        _event(auto_intervened=False, line_id="X2"),
        _event(reply_source=None, line_id=None),
        _event(
            line_id="NPC_GENERIC_PUZZLE_02",
            auto_intervene={"puzzle_ref": "P01", "level": 2},
        ),
        _event(kind="submit_answer", line_id="X3"),
        SimpleNamespace(interaction_type=NPC_TURN_EVENT_TYPE, response_json=None),
    ]
    assert used_auto_nudges(events) == {
        ("P01", "NUDGE_P01_STUCK_1_J"),
        ("P07", "NUDGE_P07_HELP_1_J"),
    }


# ── run_auto_turn 연결 ──


def test_run_auto_turn_skips_used_and_reports_exhaustion() -> None:
    decision = NpcDecision(True, 1, "idle_too_long", "PZ_A", trigger_value=240.0)
    first = run_auto_turn(decision, state=make_state(), content=content())
    assert first.reply.line_id == "NUDGE_A_01"  # 분류 없는 기존 팩도 계속 쓴다

    again = run_auto_turn(
        decision,
        state=make_state(),
        content=content(),
        used_nudges=frozenset({("PZ_A", "NUDGE_A_01")}),
    )
    assert (again.reply, again.suggest_hint) == (None, None)
    assert again.no_reply_reason == "auto_nudges_exhausted"
    assert (again.auto.level, again.auto.trigger) == (1, "idle_too_long")
