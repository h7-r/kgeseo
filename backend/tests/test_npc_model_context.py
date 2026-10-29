"""AI 일반 대화용 model_context — 공개된 정보만 (PM v0.4.3)."""

import json

import pytest

from app.schemas.puzzle_runtime import PuzzleRuntimeDefinition
from app.services.npc_generation_policy import NgRule, OpenTopicRule, PolicyRules
from app.services.npc_model_context import (
    ALWAYS_UNSUPPORTED,
    RECENT_LIMIT,
    RevealableItem,
    build_model_context,
)
from tests.test_puzzle_question import make_client, make_runtime, make_state

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
RULES = PolicyRules(
    ng=(NgRule("NG_01", "(가상) 금지 왜곡 문장", ("금지패턴",)),),
    open_topics=(
        OpenTopicRule("U_01", "관리인의 정체", ("관리인정체패턴",), ("일지도",)),
    ),
)


def runtime_with_secrets() -> PuzzleRuntimeDefinition:
    raw = make_runtime().model_dump()
    raw["puzzles"][0]["hints"] = [
        {"level": 1, "text": "(가상) 1단계 힌트 원문"},
        {"level": 2, "text": "(가상) 2단계 정답 원문"},
    ]
    raw["clues"][0].update(summary="(가상) 편지 요약", body="(가상) 편지 본문")
    raw["clues"][1].update(summary="(가상) 미획득 지도 요약")
    return PuzzleRuntimeDefinition.model_validate(raw)


def build(state=None, **kwargs):
    return build_model_context(
        make_client(), runtime_with_secrets(), state or make_state(), **kwargs
    )


def test_public_zone_objects_puzzles_and_clues_are_included() -> None:
    state = make_state(hint_levels={"PZ_A": 1})

    context = build(state).context

    assert context.zone_name == "zone a"
    assert context.visible_object_names == ("소화전 함", "벽시계", "탁상 램프")
    assert [(p.puzzle_id, p.status, p.hint_level) for p in context.puzzles] == [
        ("PZ_DONE", "completed", 0),
        ("PZ_A", "open", 1),
    ]
    assert [(c.title, c.summary, c.body) for c in context.clues] == [
        ("찢어진 편지", "(가상) 편지 요약", "(가상) 편지 본문")
    ]


def test_unpublished_content_and_secrets_are_excluded() -> None:
    dumped = json.dumps(
        build(policy_rules=RULES).context.to_model_input(), ensure_ascii=False
    )

    for secret in (
        "가상정답",  # 정답
        "비밀 금고",  # 숨은 Object
        "PZ_B",  # 숨은 호스트의 퍼즐
        "PZ_C",  # 다른 Zone
        "낡은 지도",  # 미획득 단서
        "미획득 지도 요약",
        "힌트 원문",  # 정식 힌트 원문
        "정답 원문",
        "CLUE_",  # 내부 단서 ID
        "NUDGE",
        "금지",  # NG 목록
        "관리인정체패턴",  # U patterns
        "일지도",  # U hedges
    ):
        assert secret not in dumped, secret


def test_completed_or_hidden_hosts_follow_session_state() -> None:
    revealed = make_state(object_states={"ZONE_A": {"OBJ_SAFE": {"visible": True}}})

    ids = [p.puzzle_id for p in build(revealed).context.puzzles]

    assert "PZ_B" in ids


def test_unknown_zone_gives_no_zone_or_objects() -> None:
    context = build(make_state(current_zone_id=None)).context

    assert context.zone_name is None
    assert context.visible_object_names == ()


def test_odd_stored_hint_level_is_not_passed_through() -> None:
    context = build(make_state(hint_levels={"PZ_A": "2"})).context

    assert [p.hint_level for p in context.puzzles if p.puzzle_id == "PZ_A"] == [0]


# --- reveal_when ---


@pytest.mark.parametrize(
    ("condition", "included"),
    [
        ({"always": True}, True),
        ({"clue_acquired": "CLUE_LETTER"}, True),
        ({"clue_acquired": "CLUE_MAP"}, False),
        ({"bogus": 1}, False),  # 모르는 조건
        ({"always": True, "clue_acquired": "CLUE_LETTER"}, False),  # 키 2개
        (None, False),  # 조건 없음
        ({"scene_reached": "SCENE_1"}, False),  # 판정할 상태 없음
        ({"all": []}, False),
    ],
)
def test_injected_items_need_revealed_reveal_when(condition, included: bool) -> None:
    built = build(
        revealable_items=[RevealableItem("fact", "F1", "(가상) 사실", condition)]
    )

    assert (built.context.facts == ("(가상) 사실",)) is included
    assert built.excluded_items == (0 if included else 1)


# --- 최근 20개 ---


def test_recent_limit_per_kind() -> None:
    raw = make_runtime().model_dump()
    raw["clues"] = [
        {"clue_id": f"CLUE_{i:02d}", "title": f"단서{i:02d}"} for i in range(25)
    ]
    raw["puzzles"][0]["requires_clue_ids"] = []
    runtime = PuzzleRuntimeDefinition.model_validate(raw)
    state = make_state(acquired_clue_ids=[f"CLUE_{i:02d}" for i in range(25)])
    items = [
        RevealableItem(kind, f"{kind}{i}", f"{kind}-{i:02d}", {"always": True})
        for kind in ("fact", "discovery")
        for i in range(25)
    ]

    context = build_model_context(
        make_client(), runtime, state, revealable_items=items
    ).context

    assert RECENT_LIMIT == 20
    assert [c.title for c in context.clues] == [f"단서{i:02d}" for i in range(5, 25)]
    assert context.facts == tuple(f"fact-{i:02d}" for i in range(5, 25))
    assert context.discoveries == tuple(f"discovery-{i:02d}" for i in range(5, 25))


# --- 스키마 미지원 ---


def test_unsupported_fields_are_recorded_not_guessed() -> None:
    built = build()

    assert set(ALWAYS_UNSUPPORTED) <= set(built.unsupported)
    assert {"puzzle.name", "facts", "required_discoveries", "uncertain_topics"} <= set(
        built.unsupported
    )
    assert built.context.facts == ()
    assert built.context.uncertain_topics == ()
    assert all(p.name is None for p in built.context.puzzles)


def test_injected_titles_items_and_topics_fill_supported_slots() -> None:
    built = build(
        puzzle_titles={"PZ_A": "물의 문"},
        revealable_items=[],
        policy_rules=RULES,
    )

    assert "puzzle.name" not in built.unsupported
    assert "facts" not in built.unsupported
    assert "uncertain_topics" not in built.unsupported
    assert built.context.uncertain_topics == ("관리인의 정체",)
    assert [p.name for p in built.context.puzzles if p.puzzle_id == "PZ_A"] == [
        "물의 문"
    ]
