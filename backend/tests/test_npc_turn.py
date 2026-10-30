"""NPC 한 턴 — 고정 콘텐츠 · 승인 이력 · 판단 · 대화 · 정책 검사 연결 (PM v0.4.3)."""

import uuid
from copy import deepcopy
from typing import Any

import pytest

from app.schemas.npc_content import GeneralLinePack, NpcContentPack
from app.services.approval_history import ApprovalLog, ReviewRecord
from app.services.npc_decision import NpcDecision
from app.services.npc_dialogue import (
    PM_GENERIC_PUZZLE_LINES,
    GeneralGenerationDisabledError,
    NpcReply,
    SuggestHint,
)
from app.services.npc_line_supply import general_pack_fingerprint
from app.services.npc_turn import (
    run_auto_turn,
    run_player_message_turn,
    turn_content_from_pinned,
)
from app.services.pinned_content import ContentPin, PinnedContent
from tests.test_puzzle_question import make_client, make_runtime, make_state

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 승인 기록이 아니다.
FP = "sha256:" + "e" * 64
NUDGE_A = "(가상) 그 함 주변을 한 번 더 보자."
NUDGE_GENERAL = "(가상) 천천히 둘러봐도 괜찮아."
HINT_1 = "(가상) 1단계 서버 원문"
HINT_2 = "(가상) 2단계 서버 원문"
FALLBACK = "(가상) 잠깐 숨 좀 돌려요."


def review(fp: str, gate: str) -> ReviewRecord:
    return ReviewRecord(
        review_id=str(uuid.uuid4()),
        gate=gate,
        target_hash=fp,
        decision="approved",
        reviewer="reviewer-test",
        reviewed_at="2026-10-29T00:00:00.000Z",
    )


def approved(key: tuple[str, int], fp: str) -> ApprovalLog:
    log = ApprovalLog()
    for gate in ("G1", "G2", "G3"):
        log.append(*key, review(fp, gate))
    return log


def npc_pack(**extra: Any) -> NpcContentPack:
    raw = {
        "schema_version": "npc-pack 0.1",
        "case_id": "case_test",
        "npc_id": "NPC_TEST",
        "status": "published",
        "content_version": 1,
        "content_fingerprint": FP,
        "general_nudges": [
            {
                "line_id": "NUDGE_GENERAL_01",
                "text": NUDGE_GENERAL,
                "reveal_when": {"always": True},
            }
        ],
        "puzzles": [
            {
                "puzzle_id": "PZ_A",
                "nudges": [
                    {
                        "line_id": "NUDGE_A_01",
                        "text": NUDGE_A,
                        "reveal_when": {"clue_acquired": "CLUE_LETTER"},
                    }
                ],
                "hints": [{"level": 1}, {"level": 2}],
            }
        ],
        "ng": [{"text": "(가상) 금지", "patterns": ["등대는 무너"]}],
        "open": [],
        "fallback_lines": [
            {"line_id": "FALLBACK_01", "text": FALLBACK, "use": "generation_blocked"}
        ],
    }
    raw.update(extra)
    return NpcContentPack.model_validate(raw)


def runtime_with_hints():
    raw = make_runtime().model_dump()
    raw["puzzles"][0]["hints"] = [
        {"level": 1, "text": HINT_1},
        {"level": 2, "text": HINT_2},
    ]
    return type(make_runtime()).model_validate(raw)


def bundle(**npc_extra: Any) -> PinnedContent:
    return PinnedContent(
        ContentPin("case_test", 1, FP),
        client=make_client(),
        server=runtime_with_hints(),
        npc=npc_pack(**npc_extra),
        idmap=None,
    )


def general_pack() -> GeneralLinePack:
    return GeneralLinePack.model_validate(
        {
            "schema_version": "npc-general-pack 0.1",
            "pack_id": "general_default",
            "pack_version": 1,
            "lines": [
                {"line_id": k, "text": v, "use": "puzzle_question"}
                for k, v in PM_GENERIC_PUZZLE_LINES.items()
            ],
        }
    )


def content(*, case_approved: bool = True, general_approved: bool = True, **npc_extra):
    pack = general_pack()
    return turn_content_from_pinned(
        bundle(**npc_extra),
        approved(("case_test", 1), FP).source() if case_approved else None,
        general_pack=pack,
        general_pack_approval=(
            approved(("general_default", 1), general_pack_fingerprint(pack)).source()
            if general_approved
            else None
        ),
    )


class Generator:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0

    def __call__(self, model_input: dict) -> str:
        self.calls += 1
        return self.reply


# --- 자동 개입 ---


def test_auto_intervention_serves_approved_revealed_nudge() -> None:
    result = run_auto_turn(
        NpcDecision(True, 1, "repeated_incorrect", "PZ_A"),
        state=make_state(),
        content=content(),
    )

    assert result.reply == NpcReply("approved_line", NUDGE_A, "NUDGE_A_01")
    assert result.suggest_hint is None


def test_repeated_incorrect_without_approved_nudge_escalates_to_hint_guidance() -> None:
    # PM v0.4.7: 6회 이상 오답 · 보여 줄 승인 넛지 없음 → 2단계(승인 일반 안내 + 힌트 안내)
    state = make_state()
    before = deepcopy(state)
    result = run_auto_turn(
        NpcDecision(True, 1, "repeated_incorrect", "PZ_A", trigger_value=6),
        state=state,
        content=content(case_approved=False),
    )

    assert result.reply == NpcReply(
        "approved_line",
        PM_GENERIC_PUZZLE_LINES["NPC_GENERIC_PUZZLE_02"],
        "NPC_GENERIC_PUZZLE_02",
    )
    assert result.suggest_hint == SuggestHint("PZ_A")
    assert result.fallback_reason is None
    assert (result.auto.level, result.auto.trigger, result.auto.value) == (
        2,
        "repeated_incorrect",
        6,
    )
    assert result.auto.nudge_missing is False  # 넛지는 작성돼 있지만 승인 · 공개 전
    assert state == before  # hint_levels 등 상태를 바꾸지 않는다
    assert HINT_1 not in result.reply.text and HINT_2 not in result.reply.text


def test_hint_guidance_without_approved_generic_pack_has_no_reply() -> None:
    result = run_auto_turn(
        NpcDecision(True, 1, "repeated_incorrect", "PZ_A", trigger_value=7),
        state=make_state(),
        content=content(case_approved=False, general_approved=False),
    )

    assert result.reply is None
    assert result.fallback_reason == "NPC_GENERIC_PACK_MISSING"
    assert result.suggest_hint == SuggestHint("PZ_A")
    assert result.auto.level == 2


def test_idle_without_approved_nudge_does_not_escalate() -> None:
    result = run_auto_turn(
        NpcDecision(True, 1, "idle_too_long", "PZ_A", trigger_value=300.0),
        state=make_state(),
        content=content(case_approved=False),
    )

    assert (result.reply, result.suggest_hint) == (None, None)
    assert result.no_reply_reason == "no_approved_line"
    assert (result.auto.level, result.auto.trigger) == (1, "idle_too_long")


def test_puzzle_without_authored_nudges_records_nudge_missing() -> None:
    result = run_auto_turn(
        NpcDecision(True, 1, "repeated_incorrect", "PZ_A", trigger_value=6),
        state=make_state(),
        content=content(puzzles=[]),
    )

    assert result.auto.nudge_missing is True
    assert result.auto.puzzle_ref == "PZ_A"
    assert result.suggest_hint == SuggestHint("PZ_A")


def test_no_intervention_decision_says_nothing() -> None:
    result = run_auto_turn(
        NpcDecision(False, 0, "cooldown", "PZ_A"), state=make_state(), content=content()
    )

    assert (result.reply, result.no_reply_reason) == (None, "cooldown")


def test_level_two_hint_guidance_uses_approved_generic_line_without_hint_text() -> None:
    state = make_state(acquired_clue_ids=[])  # nudge 닫힘
    before = deepcopy(state)

    result = run_auto_turn(
        NpcDecision(True, 2, "player_requested", "PZ_A"), state=state, content=content()
    )

    assert result.reply is not None
    assert result.reply.line_id == "NPC_GENERIC_PUZZLE_02"
    assert result.suggest_hint == SuggestHint("PZ_A")
    assert HINT_1 not in result.reply.text and HINT_2 not in result.reply.text
    assert state == before


def test_level_one_never_gives_hint_guidance() -> None:
    result = run_auto_turn(
        NpcDecision(True, 1, "player_requested", "PZ_A"),
        state=make_state(acquired_clue_ids=[]),
        content=content(),
    )

    assert result.suggest_hint is None
    assert result.reply is None


def test_hint_guidance_needs_approved_general_pack() -> None:
    result = run_auto_turn(
        NpcDecision(True, 2, "player_requested", "PZ_A"),
        state=make_state(acquired_clue_ids=[]),
        content=content(general_approved=False),
    )

    assert result.reply is None


# --- 플레이어 메시지 ---


def test_puzzle_question_turn_never_generates() -> None:
    generator = Generator("(가상) 생성")

    result = run_player_message_turn(
        "소화전 어떻게 열어?",
        state=make_state(),
        content=content(),
        general_generator=generator,
        generation_enabled=True,
    )

    assert generator.calls == 0
    assert result.reply == NpcReply("approved_line", NUDGE_A, "NUDGE_A_01")


def test_puzzle_question_with_approved_general_pack_suggests_hint() -> None:
    result = run_player_message_turn(
        "소화전 어떻게 열어?",
        state=make_state(acquired_clue_ids=[]),
        content=content(),
    )

    assert result.reply is not None
    assert result.reply.line_id == "NPC_GENERIC_PUZZLE_02"
    assert result.suggest_hint == SuggestHint("PZ_A")


def test_general_message_is_off_by_default() -> None:
    generator = Generator("(가상) 생성")

    result = run_player_message_turn(
        "오늘 날씨 좋다",
        state=make_state(),
        content=content(),
        general_generator=generator,
    )

    assert result.no_reply_reason == "generation_disabled"
    assert generator.calls == 0


def test_enabled_general_message_uses_pack_policy_and_fallback() -> None:
    passed = run_player_message_turn(
        "오늘 날씨 좋다",
        state=make_state(),
        content=content(),
        general_generator=Generator("오늘은 바람이 차갑네요."),
        generation_enabled=True,
    )
    blocked = run_player_message_turn(
        "오늘 날씨 좋다",
        state=make_state(),
        content=content(),
        general_generator=Generator("등대는 무너졌대요"),
        generation_enabled=True,
    )

    assert passed.reply == NpcReply("generated", "오늘은 바람이 차갑네요.")
    assert passed.generated is True
    assert blocked.reply == NpcReply("approved_line", FALLBACK, "FALLBACK_01")
    assert [(v.code, v.rule_id) for v in blocked.policy.violations] == [("NG", "ng[0]")]


def test_pack_without_policy_rules_cannot_enable_generation() -> None:
    with pytest.raises(GeneralGenerationDisabledError):
        run_player_message_turn(
            "오늘 날씨 좋다",
            state=make_state(),
            content=content(ng=None),
            general_generator=Generator("(가상)"),
            generation_enabled=True,
        )


def test_unapproved_case_fallback_is_not_served() -> None:
    result = run_player_message_turn(
        "오늘 날씨 좋다",
        state=make_state(),
        content=content(case_approved=False, general_approved=False),
        general_generator=Generator("등대는 무너졌대요"),
        generation_enabled=True,
    )

    assert result.reply is None
    assert result.no_reply_reason == "policy_blocked_no_fallback"


def test_model_input_from_pinned_content_has_no_hint_text_or_answers() -> None:
    generator_inputs: list[dict] = []

    def generator(model_input: dict) -> str:
        generator_inputs.append(model_input)
        return "오늘은 바람이 차갑네요."

    run_player_message_turn(
        "오늘 날씨 좋다",
        state=make_state(hint_levels={"PZ_A": 2}),
        content=content(),
        general_generator=generator,
        generation_enabled=True,
    )

    dumped = repr(generator_inputs)
    for secret in (HINT_1, HINT_2, "가상정답", NUDGE_A, "등대는 무너", FALLBACK):
        assert secret not in dumped
