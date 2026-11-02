"""AI 생성 일반 대화 정책 검사 — ANSWER · LEAK_CLUE · LEAK_HINT · NG · U_ASSERT (PM v0.4.3)."""

import pytest

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.hint import server_hint_source
from app.services.npc_generation_policy import (
    NgRule,
    OpenTopicRule,
    PolicyRules,
    check_generated_line,
    policy_keywords,
    policy_normalize,
    strip_particle,
)
from tests.test_puzzle_question import make_state

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
HINT_1 = "등대 꼭대기 렌즈 방향을 확인해 보세요"
HINT_2 = "렌즈를 북동쪽으로 돌리면 됩니다"
CLUE_HIDDEN_BODY = "관리인 일지에는 마지막 점등 날짜가 적혀 있었다"
EMPTY_RULES = PolicyRules(ng=(), open_topics=())


def make_runtime() -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "0.1",
            "case_id": "case_test",
            "puzzles": [
                {
                    "puzzle_id": "PZ_A",
                    "accepted_answers": ["북동쪽"],
                    "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                    "hints": [
                        {"level": 1, "text": HINT_1},
                        {"level": 2, "text": HINT_2},
                    ],
                },
                {
                    "puzzle_id": "PZ_SHORT",
                    "accepted_answers": ["7"],
                    "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                },
                {
                    "puzzle_id": "PZ_DONE",
                    "accepted_answers": ["완료된정답"],
                    "on_correct": {"grant_clue_ids": [], "set_flags": {}},
                },
            ],
            "clue_combinations": [],
            "clues": [
                {"clue_id": "CLUE_OPEN", "title": "찢어진 편지"},
                {
                    "clue_id": "CLUE_HIDDEN",
                    "title": "관리인 일지",
                    "body": CLUE_HIDDEN_BODY,
                },
            ],
        }
    )


def state(**overrides) -> dict:
    defaults = {"completed_puzzle_ids": ["PZ_DONE"], "acquired_clue_ids": ["CLUE_OPEN"]}
    return make_state(**(defaults | overrides))


def check(text: str, *, rules=EMPTY_RULES, st=None, public=(), hint_source=None):
    runtime = make_runtime()
    return check_generated_line(
        text,
        case_id="case_test",
        runtime=runtime,
        state=st or state(),
        hint_source=hint_source or server_hint_source(lambda case_id: runtime),
        rules=rules,
        public_texts=public,
    )


def codes(result) -> list[tuple[str, str]]:
    return [(v.code, v.rule_id) for v in result.violations]


# --- 정규화 ---


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("소화전을", "소화전"),
        ("등대에서", "등대"),
        ("관리인의", "관리인"),
        ("렌즈로", "렌즈"),
        ("물이", "물이"),  # 떼면 1글자가 남아 떼지 않는다
        ("편지", "편지"),
    ],
)
def test_strip_particle(token: str, expected: str) -> None:
    assert strip_particle(token) == expected


def test_policy_normalize_removes_spaces_punctuation_and_particles() -> None:
    assert policy_normalize("  소화전을 열어 봐... ") == "소화전열어봐"
    assert policy_normalize("ＡＢＣ를!") == "abc"


def test_policy_keywords() -> None:
    assert policy_keywords("등대의 렌즈를 봐") == {"등대", "렌즈"}


def test_clean_line_passes() -> None:
    assert check("오늘 바람이 꽤 차갑네요.").passed


# --- ANSWER ---


@pytest.mark.parametrize(
    "text", ["북동쪽이에요", "북 동 쪽으로 가 봐", "북동쪽을 봐요!"]
)
def test_open_puzzle_answer_is_blocked(text: str) -> None:
    assert ("ANSWER", "PZ_A") in codes(check(text))


def test_short_answer_is_blocked_conservatively() -> None:
    assert ("ANSWER", "PZ_SHORT") in codes(check("7시쯤 됐나 봐요"))


def test_completed_puzzle_answer_is_not_answer_violation() -> None:
    assert ("ANSWER", "PZ_DONE") not in codes(check("완료된정답 얘기 했었죠"))


def test_unnormalizable_answer_is_unverified() -> None:
    raw = make_runtime().model_dump()
    raw["puzzles"][0]["accepted_answers"] = ["!!!"]
    runtime = PuzzleRuntimeDefinition.model_validate(raw)

    result = check_generated_line(
        "안녕하세요",
        case_id="case_test",
        runtime=runtime,
        state=state(),
        hint_source=server_hint_source(lambda case_id: runtime),
        rules=EMPTY_RULES,
    )

    assert ("UNVERIFIED", "PZ_A") in codes(result)


# --- LEAK_CLUE · LEAK_HINT ---


def test_unacquired_clue_run_of_eight_is_leak() -> None:
    assert ("LEAK_CLUE", "CLUE_HIDDEN") in codes(
        check("거기 마지막 점등 날짜가 적혀 있던데요")
    )


def test_unacquired_clue_two_keywords_is_leak() -> None:
    assert ("LEAK_CLUE", "CLUE_HIDDEN") in codes(check("관리인이 쓴 일지 봤어요?"))


def test_one_keyword_is_not_leak() -> None:
    assert ("LEAK_CLUE", "CLUE_HIDDEN") not in codes(check("관리인은 바빠 보였어요"))


def test_public_keywords_do_not_count_toward_overlap() -> None:
    result = check("관리인이 쓴 일지 봤어요?", public=["관리인 일지"])

    assert ("LEAK_CLUE", "CLUE_HIDDEN") not in codes(result)


def test_acquired_clue_is_not_leak() -> None:
    result = check(
        "관리인이 쓴 일지 봤어요?",
        st=state(acquired_clue_ids=["CLUE_OPEN", "CLUE_HIDDEN"]),
    )

    assert ("LEAK_CLUE", "CLUE_HIDDEN") not in codes(result)


def test_locked_hint_levels_are_leaks() -> None:
    result = check("꼭대기 렌즈 방향을 확인해 봐요")

    assert ("LEAK_HINT", "PZ_A:1") in codes(result)


def test_unlocked_hint_level_is_not_leak_but_next_level_is() -> None:
    unlocked = state(hint_levels={"PZ_A": 1})

    level_one = codes(check("꼭대기 렌즈 방향을 확인해 봐요", st=unlocked))
    level_two = codes(check("렌즈를 북쪽 말고 돌리면 됩니다", st=unlocked))

    assert ("LEAK_HINT", "PZ_A:1") not in level_one
    assert ("LEAK_HINT", "PZ_A:2") in level_two


def test_unreadable_hint_source_is_unverified() -> None:
    def broken(case_id: str, puzzle_id: str, level: int) -> str | None:
        raise RuntimeError("source down")

    result = check("안녕하세요", hint_source=broken)

    assert not result.passed
    assert ("UNVERIFIED", "PZ_A:1") in codes(result)


def test_odd_hint_level_is_unverified() -> None:
    result = check("안녕하세요", st=state(hint_levels={"PZ_A": "1"}))

    assert ("UNVERIFIED", "hint_level:PZ_A") in codes(result)


# --- NG ---


def test_ng_patterns_block() -> None:
    rules = PolicyRules(
        ng=(NgRule("NG_01", "(가상) 금지 문장 원문", ("범인은 관리인",)),),
        open_topics=(),
    )

    assert ("NG", "NG_01") in codes(check("사실 범인은 관리인이에요", rules=rules))
    assert check("관리인은 친절해요", rules=rules).passed


def test_ng_text_is_used_when_patterns_are_missing() -> None:
    rules = PolicyRules(ng=(NgRule("NG_02", "등대는 무너졌다"),), open_topics=())

    assert ("NG", "NG_02") in codes(check("등대는 무너졌다고 들었어요", rules=rules))


def test_empty_ng_rule_is_unverified() -> None:
    rules = PolicyRules(ng=(NgRule("NG_03", "  ", ("", " ")),), open_topics=())

    assert ("UNVERIFIED", "NG_03") in codes(check("안녕하세요", rules=rules))


# --- U_ASSERT ---


U_RULE = OpenTopicRule(
    "U_01", "관리인의 정체", ("관리인이 범인",), ("일지도", "모르겠", "아닐까")
)


def test_u_topic_assertion_without_hedge_is_blocked() -> None:
    rules = PolicyRules(ng=(), open_topics=(U_RULE,))

    assert ("U_ASSERT", "U_01") in codes(check("관리인이 범인이에요", rules=rules))


@pytest.mark.parametrize(
    "text", ["관리인이 범인일지도 몰라요", "관리인이 범인 아닐까요?"]
)
def test_u_topic_with_hedge_passes(text: str) -> None:
    rules = PolicyRules(ng=(), open_topics=(U_RULE,))

    assert check(text, rules=rules).passed


def test_hedge_is_not_matched_after_particle_stripping() -> None:
    # "일지도"에서 "도"를 떼면 "일지"가 되어 "관리인 일지"와 겹친다 — 유보 표현으로 보면 안 된다.
    rules = PolicyRules(ng=(), open_topics=(U_RULE,))

    result = check("관리인 일지를 보니 관리인이 범인이에요", rules=rules)

    assert ("U_ASSERT", "U_01") in codes(result)


def test_u_rule_without_hedges_blocks_any_match() -> None:
    rules = PolicyRules(
        ng=(), open_topics=(OpenTopicRule("U_02", "주제", ("관리인이 범인",)),)
    )

    assert ("U_ASSERT", "U_02") in codes(check("관리인이 범인일지도", rules=rules))


def test_u_rule_without_patterns_is_unverified() -> None:
    rules = PolicyRules(ng=(), open_topics=(OpenTopicRule("U_03", "주제", ()),))

    assert ("UNVERIFIED", "U_03") in codes(check("안녕하세요", rules=rules))


# --- 안전한 거부 · 결과 ---


def test_missing_rules_are_never_a_pass() -> None:
    result = check("안녕하세요", rules=None)

    assert not result.passed
    assert codes(result) == [("UNVERIFIED", "ng_rules"), ("UNVERIFIED", "open_rules")]


def test_codes_follow_pm_order() -> None:
    rules = PolicyRules(
        ng=(NgRule("NG_01", "x", ("등대는 무너",)),), open_topics=(U_RULE,)
    )
    text = "북동쪽! 관리인 일지 · 등대는 무너졌고 관리인이 범인이에요"

    order = [code for code, _ in codes(check(text, rules=rules))]

    assert order == ["ANSWER", "LEAK_CLUE", "NG", "U_ASSERT"]


def test_result_holds_only_codes_and_rule_ids() -> None:
    rules = PolicyRules(ng=(NgRule("NG_01", "x", ("범인은 관리인",)),), open_topics=())
    text = "범인은 관리인이고 답은 북동쪽, 마지막 점등 날짜가 적혀"

    dumped = repr(check(text, rules=rules))

    for secret in ("북동쪽", "범인은", "점등", "관리인", HINT_2):
        assert secret not in dumped
