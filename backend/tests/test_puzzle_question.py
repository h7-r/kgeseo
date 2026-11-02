"""퍼즐 풀이 질문 판별기 (PM v0.4.3 · 규칙 기반)."""

from dataclasses import asdict

import pytest

from app.schemas.case_content import CaseClientContent
from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.puzzle_question import (
    PublicPuzzleContext,
    classify_puzzle_question,
    normalize_compact,
    public_puzzle_contexts,
    sentence_form,
    signal_a_categories,
)

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.


def obj(object_id: str, name: str, target: str | None, *, visible: bool = True) -> dict:
    return {
        "object_id": object_id,
        "object_name": name,
        "object_type": "prop",
        "visible": visible,
        "enabled": True,
        "interaction": {"type": "input", "target_id": target} if target else None,
    }


def make_client() -> CaseClientContent:
    return CaseClientContent.model_validate(
        {
            "case_id": "case_test",
            "entry_zone_id": "ZONE_A",
            "zones": [
                {
                    "zone_id": "ZONE_A",
                    "zone_name": "zone a",
                    "zone_type": "room",
                    "description": "",
                    "objects": [
                        obj("OBJ_CABINET", "소화전 함", "PZ_A"),
                        obj("OBJ_SAFE", "비밀 금고", "PZ_B", visible=False),
                        obj("OBJ_CLOCK", "벽시계", "PZ_DONE"),
                        obj("OBJ_LAMP", "탁상 램프", None),
                    ],
                    "navigation": [],
                },
                {
                    "zone_id": "ZONE_B",
                    "zone_name": "zone b",
                    "zone_type": "room",
                    "description": "",
                    "objects": [obj("OBJ_DRAWER", "서랍장", "PZ_C")],
                    "navigation": [],
                },
            ],
        }
    )


def puzzle(puzzle_id: str, requires: list[str] | None = None) -> dict:
    return {
        "puzzle_id": puzzle_id,
        "accepted_answers": ["가상정답" + puzzle_id],
        "requires_clue_ids": requires or [],
        "on_correct": {"grant_clue_ids": [], "set_flags": {}},
    }


def make_runtime() -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition.model_validate(
        {
            "schema_version": "0.1",
            "case_id": "case_test",
            "puzzles": [
                puzzle("PZ_A", ["CLUE_LETTER", "CLUE_MAP"]),
                puzzle("PZ_B"),
                puzzle("PZ_C"),
                puzzle("PZ_DONE"),
            ],
            "clue_combinations": [],
            "clues": [
                {"clue_id": "CLUE_LETTER", "title": "찢어진 편지"},
                {"clue_id": "CLUE_MAP", "title": "낡은 지도"},
            ],
        }
    )


def make_state(**overrides) -> dict:
    state = {
        "current_zone_id": "ZONE_A",
        "completed_puzzle_ids": ["PZ_DONE"],
        "completed_inspect_ids": [],
        "acquired_clue_ids": ["CLUE_LETTER"],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
        "object_states": {},
    }
    state.update(overrides)
    return state


def contexts(**state_overrides):
    return public_puzzle_contexts(
        make_client(), make_runtime(), make_state(**state_overrides)
    )


def classify(text: str, **state_overrides):
    return classify_puzzle_question(text, contexts(**state_overrides))


# --- 정규화 ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("뭐 넣어?", "뭐넣어"),
        ("ＡＢＣ  힌트!!", "abc힌트"),
        ("어떻게​ 열어", "어떻게열어"),
        ("  막혔어...  ", "막혔어"),
    ],
)
def test_normalize_compact(text: str, expected: str) -> None:
    assert normalize_compact(text) == expected


@pytest.mark.parametrize(
    ("text", "form"),
    [
        ("이거 뭐야", "question"),
        ("열 수 있을까", "question"),
        ("그거 맞나요", "question"),
        ("문 열렸어?", "question"),
        ("예쁘다", "statement"),
        ("멋지네요", "statement"),
        ("그렇구나", "statement"),
        ("좋아요.", "statement"),
        ("그거 말이야", "ambiguous"),
        ("음", "ambiguous"),
    ],
)
def test_sentence_form(text: str, form: str) -> None:
    assert sentence_form(text) == form


# --- 신호 A ---


@pytest.mark.parametrize(
    ("text", "category"),
    [
        ("정답이 뭐야", "answer_request"),
        ("답 좀 알려 줘", "answer_request"),
        ("비밀번호 알아?", "answer_request"),
        ("암호 같은데", "answer_request"),
        ("순서가 있나", "procedure"),
        ("몇 번 돌려야 해", "procedure"),
        ("여기 뭐 넣어야 해", "procedure"),
        ("이거 어떻게 열어", "procedure"),
        ("어떻게 풀지", "procedure"),
        ("이제 뭘 해야 돼", "procedure"),
        ("열쇠 어디 있어", "location"),
        ("완전 막혔어", "stuck"),
        ("잘 모르겠어", "stuck"),
        ("힌트 줘", "hint"),
    ],
)
def test_signal_a_is_puzzle_question(text: str, category: str) -> None:
    diagnosis = classify(text)

    assert category in diagnosis.signal_a
    assert diagnosis.is_puzzle_question
    assert diagnosis.reason == "signal_a"


@pytest.mark.parametrize(
    "text", ["대답해 줘", "답답하다", "답장 왔어", "고마워 보답할게"]
)
def test_everyday_words_with_answer_syllable_are_not_signal_a(text: str) -> None:
    assert "answer_request" not in signal_a_categories(text)


def test_answer_inside_exception_still_counts_when_said_separately() -> None:
    assert signal_a_categories("대답 말고 답 알려 줘") == ("answer_request",)


def test_signal_a_ignores_spacing_and_punctuation() -> None:
    assert signal_a_categories("뭐...넣...어?") == ("procedure",)


# --- 신호 B ---


def test_signal_b_question_is_puzzle_question() -> None:
    diagnosis = classify("소화전 이거 왜 이래?")

    assert diagnosis.reason == "signal_b_question"
    assert diagnosis.is_puzzle_question
    assert diagnosis.signal_b == ("host_object",)
    assert diagnosis.puzzle_id == "PZ_A"


def test_signal_b_statement_is_general_conversation() -> None:
    diagnosis = classify("소화전 색이 예쁘네")

    assert diagnosis.reason == "signal_b_statement"
    assert not diagnosis.is_puzzle_question


def test_ambiguous_signal_b_is_puzzle_question() -> None:
    diagnosis = classify("소화전 말이야")

    assert diagnosis.reason == "signal_b_ambiguous"
    assert diagnosis.is_puzzle_question


def test_acquired_clue_keyword_is_signal_b() -> None:
    diagnosis = classify("찢어진 편지 뭐였지?")

    assert diagnosis.signal_b == ("clue_keyword",)
    assert diagnosis.puzzle_id == "PZ_A"


def test_injected_public_title_is_signal_b() -> None:
    found = public_puzzle_contexts(
        make_client(), make_runtime(), make_state(), puzzle_titles={"PZ_A": "물의 문"}
    )

    assert classify_puzzle_question("물의 문은 뭐야?", found).signal_b == (
        "puzzle_title",
    )


def test_no_signal_question_is_general_conversation() -> None:
    diagnosis = classify("오늘 날씨 어때?")

    assert diagnosis.reason == "no_signal"
    assert not diagnosis.is_puzzle_question


# --- 미공개 정보 제외 ---


@pytest.mark.parametrize(
    ("text", "state"),
    [
        ("비밀 금고 뭐야?", {}),  # 숨은 Object
        ("낡은 지도 뭐야?", {}),  # 미획득 단서
        ("벽시계 뭐야?", {}),  # 완료한 퍼즐
        ("서랍장 뭐야?", {}),  # 다른 Zone
        ("탁상 램프 뭐야?", {}),  # 퍼즐과 무관한 Object
        ("찢어진 편지 뭐였지?", {"acquired_clue_ids": []}),
    ],
)
def test_unpublished_context_is_not_signal_b(text: str, state: dict) -> None:
    assert classify(text, **state).signal_b == ()


def test_revealed_object_state_makes_host_public() -> None:
    revealed = {"ZONE_A": {"OBJ_SAFE": {"visible": True}}}

    diagnosis = classify("비밀 금고 뭐야?", object_states=revealed)

    assert diagnosis.puzzle_id == "PZ_B"


def test_contexts_use_only_current_zone_open_puzzles() -> None:
    assert [c.puzzle_id for c in contexts()] == ["PZ_A"]


# --- 대상 퍼즐 ---


def test_two_matched_puzzles_do_not_pick_one() -> None:
    both = (
        PublicPuzzleContext("PZ_A", (("소화전", "host_object"),)),
        PublicPuzzleContext("PZ_B", (("금고", "host_object"),)),
    )

    diagnosis = classify_puzzle_question("소화전이랑 금고 뭐야?", both)

    assert diagnosis.matched_puzzle_count == 2
    assert diagnosis.puzzle_id is None


def test_signal_a_without_b_has_no_target() -> None:
    assert classify("힌트 줘").puzzle_id is None


def test_single_syllable_names_are_not_terms() -> None:
    single = public_puzzle_contexts(
        make_client(), make_runtime(), make_state(), puzzle_titles={"PZ_A": "문"}
    )

    assert ("문", "puzzle_title") not in single[0].terms


# --- 진단에 원문 없음 ---


def test_diagnosis_holds_no_message_or_terms() -> None:
    diagnosis = classify("소화전 찢어진 편지 비밀번호 뭐야?")
    dumped = str(asdict(diagnosis))

    for secret in ("소화전", "찢어진", "편지", "비밀번호", "뭐야"):
        assert secret not in dumped
