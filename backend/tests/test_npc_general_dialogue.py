"""AI 일반 대화 흐름 — 생성 1회 · 정책 검사 · 승인 대체 대사 · 기능 스위치 (PM v0.4.3)."""

import json

import pytest

from app.services.hint import server_hint_source
from app.services.npc_dialogue import (
    GeneralGenerationDisabledError,
    NpcReply,
    respond_to_player_message,
)
from app.services.npc_general_dialogue import ApprovedLine, generate_general_reply
from app.services.npc_generation_policy import NgRule, PolicyRules
from app.services.npc_model_context import build_model_context
from tests.test_npc_dialogue import NPC_ID, LineSource, make_pack, runtime_with_hints
from tests.test_puzzle_question import make_client, make_state

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
RULES = PolicyRules(ng=(NgRule("NG_01", "x", ("등대는 무너",)),), open_topics=())
SAFE = "오늘은 바람이 꽤 차갑네요."
BLOCKED = "정답은 가상정답PZ_A 예요"  # 열린 퍼즐 PZ_A 의 정답
FALLBACK = ApprovedLine("NPC_FALLBACK_01", "(가상) 잠깐 숨 좀 돌려요.", approved=True)
PACK_LINE = ApprovedLine("NPC_GENERAL_01", "(가상) 같이 둘러봐요.", approved=True)


class Generator:
    def __init__(self, reply: str | Exception) -> None:
        self.reply = reply
        self.inputs: list[dict] = []

    def __call__(self, model_input: dict) -> str:
        self.inputs.append(model_input)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def lines(*items):
    return lambda: list(items)


def run(generator, *, fallback=None, pack=None, rules=RULES):
    runtime = runtime_with_hints()
    state = make_state()
    context = build_model_context(make_client(), runtime, state).context
    return generate_general_reply(
        context,
        generator=generator,
        case_id="case_test",
        runtime=runtime,
        state=state,
        hint_source=server_hint_source(lambda case_id: runtime),
        rules=rules,
        fallback_lines=fallback,
        general_pack_lines=pack,
    )


def test_passing_line_is_generated_reply() -> None:
    generator = Generator(SAFE)

    result = run(generator)

    assert (result.text, result.generated, result.fallback) == (SAFE, True, None)
    assert result.policy is not None and result.policy.passed
    assert len(generator.inputs) == 1
    assert "가상정답" not in json.dumps(generator.inputs[0], ensure_ascii=False)


def test_blocked_line_is_discarded_without_regeneration() -> None:
    generator = Generator(BLOCKED)

    result = run(generator, fallback=lines(FALLBACK), pack=lines(PACK_LINE))

    assert len(generator.inputs) == 1  # 재생성 0회
    assert result.generated is False
    assert (result.text, result.line_id, result.fallback) == (
        FALLBACK.text,
        FALLBACK.line_id,
        "fallback_line",
    )
    assert [(v.code, v.rule_id) for v in result.policy.violations] == [
        ("ANSWER", "PZ_A")
    ]
    assert "가상정답" not in repr(result)


def test_unapproved_fallback_is_skipped_for_approved_pack_line() -> None:
    unapproved = ApprovedLine("NPC_FALLBACK_02", "(가상) 미승인", approved=False)

    result = run(Generator(BLOCKED), fallback=lines(unapproved), pack=lines(PACK_LINE))

    assert (result.line_id, result.fallback) == (PACK_LINE.line_id, "general_pack_line")


def test_fallback_containing_answer_is_skipped() -> None:
    leaky = ApprovedLine("NPC_FALLBACK_03", "정답은 가상정답PZ_A", approved=True)

    result = run(Generator(BLOCKED), fallback=lines(leaky), pack=lines(PACK_LINE))

    assert result.line_id == PACK_LINE.line_id


def test_no_approved_fallback_means_no_reply() -> None:
    unapproved = ApprovedLine("NPC_FALLBACK_02", "(가상) 미승인", approved=False)

    result = run(Generator(BLOCKED), fallback=lines(unapproved), pack=lines())

    assert result.text is None
    assert result.no_reply_reason == "policy_blocked_no_fallback"


@pytest.mark.parametrize("reply", [RuntimeError("down"), "", "   "])
def test_generator_failure_uses_fallback_or_no_reply(reply) -> None:
    with_fallback = run(Generator(reply), fallback=lines(FALLBACK))
    without = run(Generator(reply))

    assert with_fallback.line_id == FALLBACK.line_id
    assert with_fallback.policy is None
    assert without.no_reply_reason == "generation_failed_no_fallback"


def test_ng_violation_also_falls_back() -> None:
    result = run(Generator("등대는 무너졌대요"), fallback=lines(FALLBACK))

    assert result.fallback == "fallback_line"
    assert [(v.code, v.rule_id) for v in result.policy.violations] == [("NG", "NG_01")]


# --- 기능 스위치 · 퍼즐 질문 경로 ---


def respond(message: str, generator, **kwargs):
    runtime = runtime_with_hints()
    return respond_to_player_message(
        message,
        case_id="case_test",
        state=make_state(),
        client=make_client(),
        runtime=runtime,
        npc_pack=make_pack(),
        npc_id=NPC_ID,
        line_source=LineSource(approved=False),
        hint_source=server_hint_source(lambda case_id: runtime),
        general_generator=generator,
        **kwargs,
    )


def test_generation_is_off_by_default() -> None:
    generator = Generator(SAFE)

    outcome = respond("오늘 날씨 좋다", generator)

    assert outcome.no_reply_reason == "generation_disabled"
    assert generator.inputs == []


def test_generation_cannot_turn_on_without_policy_rules() -> None:
    generator = Generator(SAFE)

    with pytest.raises(GeneralGenerationDisabledError):
        respond("오늘 날씨 좋다", generator, generation_enabled=True)
    assert generator.inputs == []


def test_enabled_generation_with_rules_returns_generated_reply() -> None:
    outcome = respond(
        "오늘 날씨 좋다",
        Generator(SAFE),
        generation_enabled=True,
        policy_rules=RULES,
    )

    assert outcome.reply == NpcReply("generated", SAFE)
    assert outcome.policy is not None and outcome.policy.passed


def test_enabled_blocked_generation_returns_approved_line() -> None:
    outcome = respond(
        "오늘 날씨 좋다",
        Generator(BLOCKED),
        generation_enabled=True,
        policy_rules=RULES,
        fallback_lines=lines(FALLBACK),
    )

    assert outcome.reply == NpcReply("approved_line", FALLBACK.text, FALLBACK.line_id)
    assert outcome.fallback == "fallback_line"
    assert "가상정답" not in repr(outcome)


def test_enabled_blocked_generation_without_fallback_has_no_reply() -> None:
    outcome = respond(
        "오늘 날씨 좋다",
        Generator(BLOCKED),
        generation_enabled=True,
        policy_rules=RULES,
    )

    assert outcome.reply is None
    assert outcome.no_reply_reason == "policy_blocked_no_fallback"


def test_puzzle_question_never_reaches_generator_even_when_enabled() -> None:
    generator = Generator(SAFE)

    for message in ("정답 알려 줘", "소화전 어떻게 열어?", "힌트 줘"):
        respond(message, generator, generation_enabled=True, policy_rules=RULES)

    assert generator.inputs == []
