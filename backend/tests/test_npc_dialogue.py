"""NPC 플레이어 메시지 응답 · 자동 개입 권한 (PM v0.4.3)."""

from copy import deepcopy

import pytest

from app.schemas.npc import ApprovedNpcLine
from app.schemas.npc_content import NpcContentPack
from app.services.hint import server_hint_source
from app.services.npc_dialogue import (
    PM_GENERIC_PUZZLE_LINES,
    GeneralGenerationDisabledError,
    NpcDialogueOutcome,
    NpcReply,
    SuggestHint,
    respond_to_player_message,
)
from app.services.npc_intervention import (
    NEVER_AUTO_ACTIONS,
    InvalidInterventionLevelError,
    allowed_auto_actions,
    is_auto_action_allowed,
)
from app.services.puzzle_question import classify_puzzle_question
from tests.test_puzzle_question import make_client, make_runtime, make_state

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
NPC_ID = "NPC_TEST"
NUDGE_A = "(가상) 그 함 주변을 한 번 더 보자."
NUDGE_A_LOCKED = "(가상) 아직 열리지 않은 대사."
NUDGE_GENERAL = "(가상) 천천히 둘러봐도 괜찮아."
HINT_A_1 = "(가상) 1단계 원문"
HINT_A_2 = "(가상) 2단계 정답 원문"


def dev_only_generic_approval(line_id: str) -> bool:
    """개발 · 테스트 전용. 실제 승인 기록이 아니다(운영 기본값은 승인 없음)."""

    return line_id in PM_GENERIC_PUZZLE_LINES


def runtime_with_hints():
    runtime = make_runtime()
    raw = runtime.model_dump()
    raw["puzzles"][0]["hints"] = [
        {"level": 1, "text": HINT_A_1},
        {"level": 2, "text": HINT_A_2},
    ]
    return type(runtime).model_validate(raw)


def make_pack() -> NpcContentPack:
    return NpcContentPack.model_validate(
        {
            "schema_version": "npc-pack 0.1",
            "case_id": "case_test",
            "npc_id": NPC_ID,
            "status": "draft",
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
                            "line_id": "NUDGE_A_LOCKED",
                            "text": NUDGE_A_LOCKED,
                            "reveal_when": {"clue_acquired": "CLUE_MAP"},
                        },
                        {
                            "line_id": "NUDGE_A_01",
                            "text": NUDGE_A,
                            "reveal_when": {"clue_acquired": "CLUE_LETTER"},
                        },
                    ],
                    "hints": [{"level": 1}, {"level": 2}],
                }
            ],
        }
    )


class LineSource:
    """검증된 게시 절차를 흉내 낸다. approved=False 면 지금 BE(pinned_content)와 같다."""

    def __init__(self, *, approved: bool) -> None:
        self.approved = approved
        self.pack = make_pack()

    def __call__(self, case_id: str, npc_id: str, line_id: str):
        for nudge in self.pack.general_nudges:
            if nudge.line_id == line_id:
                return ApprovedNpcLine(
                    line_id=line_id,
                    kind="nudge",
                    text=nudge.text,
                    approved=self.approved,
                )
        for entry in self.pack.puzzles:
            for nudge in entry.nudges:
                if nudge.line_id == line_id:
                    return ApprovedNpcLine(
                        line_id=line_id,
                        kind="nudge",
                        text=nudge.text,
                        approved=self.approved,
                        puzzle_id=entry.puzzle_id,
                    )
        return None


class SpyGenerator:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, *args, **kwargs) -> str:
        self.calls += 1
        return "(생성된 문장)"


def respond(
    message: str,
    *,
    approved: bool = True,
    state=None,
    runtime=None,
    generic_line_approval=dev_only_generic_approval,
    **kwargs,
) -> NpcDialogueOutcome:
    runtime = runtime or runtime_with_hints()
    return respond_to_player_message(
        message,
        case_id="case_test",
        state=state or make_state(),
        client=make_client(),
        runtime=runtime,
        npc_pack=make_pack(),
        npc_id=NPC_ID,
        line_source=LineSource(approved=approved),
        hint_source=server_hint_source(lambda case_id: runtime),
        generic_line_approval=generic_line_approval,
        **kwargs,
    )


# --- reply.source 계약 ---


def test_reply_source_allows_only_pm_values() -> None:
    NpcReply("generated", "안녕")
    NpcReply("approved_line", "안녕", "NUDGE_X")

    for source in ("approved_nudge", "generic_puzzle_line", "generation_disabled"):
        with pytest.raises(ValueError):
            NpcReply(source, "안녕", "NUDGE_X")  # type: ignore[arg-type]


@pytest.mark.parametrize("line_id", [None, "", "   "])
def test_approved_line_requires_line_id(line_id) -> None:
    with pytest.raises(ValueError):
        NpcReply("approved_line", "안녕", line_id)


def test_blank_reply_text_is_rejected() -> None:
    with pytest.raises(ValueError):
        NpcReply("generated", "  ")


def test_outcome_requires_exactly_one_of_reply_or_reason() -> None:
    diagnosis = classify_puzzle_question("안녕", ())

    with pytest.raises(ValueError):
        NpcDialogueOutcome(None, None, None, diagnosis)
    with pytest.raises(ValueError):
        NpcDialogueOutcome(
            NpcReply("generated", "안녕"), "generation_disabled", None, diagnosis
        )
    with pytest.raises(ValueError):
        NpcDialogueOutcome(None, "generation_disabled", SuggestHint("PZ_A"), diagnosis)


# --- 퍼즐 질문 ---


def test_puzzle_question_returns_revealed_approved_nudge_verbatim() -> None:
    spy = SpyGenerator()

    outcome = respond("소화전 어떻게 열어?", general_generator=spy)

    assert outcome.reply == NpcReply("approved_line", NUDGE_A, "NUDGE_A_01")
    assert outcome.suggest_hint is None
    assert spy.calls == 0


def test_puzzle_question_never_calls_generator_even_if_enabled() -> None:
    spy = SpyGenerator()

    outcome = respond("정답 알려 줘", general_generator=spy, generation_enabled=True)

    assert outcome.diagnosis.is_puzzle_question
    assert spy.calls == 0


def test_unapproved_nudge_is_not_treated_as_approved() -> None:
    outcome = respond("소화전 어떻게 열어?", approved=False)

    assert outcome.reply is not None
    assert outcome.reply.line_id == "NPC_GENERIC_PUZZLE_02"


def test_unrevealed_nudge_is_skipped() -> None:
    outcome = respond("소화전 어떻게 열어?", state=make_state(acquired_clue_ids=[]))

    # 두 nudge 모두 공개 조건이 닫혀 있다. 대상은 호스트 이름으로 정해진다.
    assert outcome.reply is not None
    assert outcome.reply.line_id == "NPC_GENERIC_PUZZLE_02"
    assert outcome.suggest_hint == SuggestHint("PZ_A")


def test_generic_line_with_hint_suggestion_for_single_target() -> None:
    outcome = respond("소화전 어떻게 열어?", approved=False)

    assert outcome.reply == NpcReply(
        "approved_line",
        PM_GENERIC_PUZZLE_LINES["NPC_GENERIC_PUZZLE_02"],
        "NPC_GENERIC_PUZZLE_02",
    )
    assert outcome.suggest_hint == SuggestHint("PZ_A")


def test_no_target_uses_general_nudge_or_generic_without_suggestion() -> None:
    with_nudge = respond("힌트 줘")
    without = respond("힌트 줘", approved=False)

    assert with_nudge.reply == NpcReply(
        "approved_line", NUDGE_GENERAL, "NUDGE_GENERAL_01"
    )
    assert without.reply is not None
    assert without.reply.line_id == "NPC_GENERIC_PUZZLE_01"
    assert without.suggest_hint is None


def test_several_candidate_puzzles_get_no_suggestion() -> None:
    revealed = {"ZONE_A": {"OBJ_SAFE": {"visible": True}}}

    outcome = respond(
        "소화전이랑 금고 어떻게 열어?",
        approved=False,
        state=make_state(object_states=revealed),
    )

    assert outcome.diagnosis.matched_puzzle_count == 2
    assert outcome.suggest_hint is None
    assert outcome.reply is not None
    assert outcome.reply.line_id == "NPC_GENERIC_PUZZLE_01"


def test_puzzle_without_server_hint_gets_no_suggestion() -> None:
    outcome = respond("소화전 어떻게 열어?", approved=False, runtime=make_runtime())

    assert outcome.reply is not None
    assert outcome.reply.line_id == "NPC_GENERIC_PUZZLE_01"
    assert outcome.suggest_hint is None


def test_generic_03_is_not_selected_by_current_rule() -> None:
    messages = ("소화전 어떻게 열어?", "힌트 줘", "정답 뭐야", "소화전 말이야")
    for message in messages:
        for runtime in (runtime_with_hints(), make_runtime()):
            outcome = respond(message, approved=False, runtime=runtime)
            assert outcome.reply is not None
            assert outcome.reply.line_id != "NPC_GENERIC_PUZZLE_03"


# --- 기본 안내의 운영 노출 ---


@pytest.mark.parametrize("approval", [None, lambda line_id: False])
def test_generic_line_is_not_served_without_approval(approval) -> None:
    outcome = respond(
        "소화전 어떻게 열어?", approved=False, generic_line_approval=approval
    )

    assert outcome.reply is None
    assert outcome.no_reply_reason == "generic_line_unapproved"
    assert outcome.unserved_line_id == "NPC_GENERIC_PUZZLE_02"
    assert outcome.suggest_hint is None


def test_approval_is_checked_per_line_id() -> None:
    only_01 = respond(
        "소화전 어떻게 열어?",
        approved=False,
        generic_line_approval=lambda line_id: line_id == "NPC_GENERIC_PUZZLE_01",
    )

    assert only_01.reply is None
    assert only_01.unserved_line_id == "NPC_GENERIC_PUZZLE_02"


def test_approved_nudge_does_not_need_generic_approval() -> None:
    outcome = respond("소화전 어떻게 열어?", generic_line_approval=None)

    assert outcome.reply == NpcReply("approved_line", NUDGE_A, "NUDGE_A_01")


def test_pm_generic_lines_are_kept_verbatim() -> None:
    assert PM_GENERIC_PUZZLE_LINES == {
        "NPC_GENERIC_PUZZLE_01": (
            "그건 직접 살펴봐야 알 수 있을 것 같아요. 아직 안 본 곳이 있는지 둘러볼까요?"
        ),
        "NPC_GENERIC_PUZZLE_02": (
            "답을 바로 알려 드릴 수는 없어요. 막혔다면 힌트를 열어 볼까요?"
        ),
        "NPC_GENERIC_PUZZLE_03": (
            "지금까지 찾은 단서를 다시 한번 맞춰 보면 길이 보일지도 몰라요."
        ),
    }


# --- 힌트 · 상태 ---


@pytest.mark.parametrize("hint_levels", [{}, {"PZ_A": 1}, {"PZ_A": 2}])
def test_reply_never_contains_hint_text_or_changes_state(hint_levels: dict) -> None:
    state = make_state(hint_levels=hint_levels)
    before = deepcopy(state)

    for message in ("소화전 어떻게 열어?", "힌트 줘", "정답이 뭐야", "소화전 예쁘네"):
        outcome = respond(message, state=state, approved=False)
        text = outcome.reply.text if outcome.reply else ""
        assert HINT_A_1 not in text
        assert HINT_A_2 not in text

    assert state == before


# --- 일반 대화 ---


def test_general_conversation_does_not_generate_or_build_a_reply() -> None:
    spy = SpyGenerator()

    outcome = respond("소화전 색이 예쁘네", general_generator=spy)

    assert outcome.reply is None
    assert outcome.no_reply_reason == "generation_disabled"
    assert spy.calls == 0


def test_enabling_general_generation_is_refused() -> None:
    spy = SpyGenerator()

    with pytest.raises(GeneralGenerationDisabledError):
        respond("오늘 날씨 좋다", general_generator=spy, generation_enabled=True)
    assert spy.calls == 0


# --- 자동 개입 권한 ---


def test_allowed_auto_actions_per_intervention_level() -> None:
    assert allowed_auto_actions(0) == frozenset()
    assert allowed_auto_actions(1) == {"nudge"}
    assert allowed_auto_actions(2) == {"nudge", "hint_guidance"}


@pytest.mark.parametrize("level", [0, 1, 2])
def test_no_level_allows_hint_text_unlock_or_answer(level: int) -> None:
    for action in NEVER_AUTO_ACTIONS:
        assert not is_auto_action_allowed(level, action)


@pytest.mark.parametrize("level", [-1, 3, True, False])
def test_invalid_intervention_level_is_rejected(level) -> None:
    with pytest.raises(InvalidInterventionLevelError):
        allowed_auto_actions(level)
