"""NPC 상황 대사 선택 · 쿨다운 · 기록 (계약 v0.4.16 §4 · §5 · §8 · §9 · §10).

선택 엔진(`npc_situation`)은 순수 함수로, 턴 서비스 연결(우선순위 · 기록 · 재전송 · 잠금)은 HTTP로 확인한다.
실제 DB 저장 · 동시 요청은 `test_npc_situation_turn_mysql.py`가 격리 MySQL에서 확인한다.
가상 테스트 데이터다. 실제 나주 콘텐츠 · 실제 승인 기록이 아니다.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.models.interaction_event import InteractionEvent
from app.services.npc import NpcContentUnsafeError
from app.services.npc_case_access import CaseNpcAccess
from app.services.npc_decision import DecisionSignals, NpcDecision, RuleConfig
from app.services.npc_dialogue import NpcReply, SuggestHint
from app.services.npc_situation import (
    CONTENT_WITHDRAWN,
    COOLDOWN,
    GLOBAL_GAP,
    NO_LINE,
    PREEMPTED_BY_PUZZLE,
    QUIET_LIMIT,
    QUIET_OTHER_COOLDOWN,
    QUIET_PUZZLE_COOLDOWN,
    SituationConfig,
    SituationRequest,
    run_situation_turn,
    situation_history,
)
from app.services.npc_turn import NpcTurnResult
from app.services.pinned_content import PinnedContentStore
from tests.test_npc_case_access import (  # noqa: F401 — pytest fixture
    BLOCKED,
    Reader,
    approved_access,
    reader_override,
)
from tests.test_npc_generic_pause import (  # noqa: F401 — pytest fixture
    general,
    pack_approval,
    pause_pack,
)
from tests.test_npc_turn import (
    FP,
    HINT_1,
    NUDGE_GENERAL,
    approved,
    bundle,
    content,
)
from tests.test_npc_turn_http import (  # noqa: F401 — HTTP 대역 fixture
    SESSION_ID,
    URL,
    answer_events,
    approve_all,
    auto_body,
    overrides,
    session_row,
    stored,
)

T = datetime(2026, 11, 7, 3, 0, 0)
STATE = {
    "current_zone_id": "ZONE_A",
    "completed_puzzle_ids": ["PZ_DONE"],
    "completed_inspect_ids": [],
    "acquired_clue_ids": ["CLUE_LETTER"],
    "hint_levels": {},
    "attempt_counts": {},
    "flags": {},
    "object_states": {},
}
CODES = [
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
]


def line(line_id: str, focus: str | None = None) -> dict[str, Any]:
    raw: dict[str, Any] = {"line_id": line_id, "text": f"(가상) {line_id} 대사"}
    if focus is not None:
        raw["focus_object_id"] = focus
    return raw


def situations() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for code in CODES:
        if code == "STEP_ARRIVED":
            lines = [
                line("SIT_STEP_A", "OBJ_STEP_A"),
                line("SIT_STEP_B", "OBJ_STEP_B"),
                line("SIT_STEP_ANY"),
            ]
        elif code == "NO_PROGRESS":
            lines = [line("SIT_NO_PROGRESS_01"), line("SIT_NO_PROGRESS_02")]
        elif code == "STEP_DONE":
            # 조건 없는 대사가 없는 코드: 다른 Object 대사로 폴백하지 않는다.
            lines = [line("SIT_STEP_DONE_A", "OBJ_STEP_A")]
        else:
            lines = [line(f"SIT_{code}_01")]
        entry: dict[str, Any] = {"code": code, "lines": lines}
        if code == "BREATH_LOW":
            entry["cooldown_seconds"] = 45  # 계약 §10-6 콘텐츠 값
        entries.append(entry)
    return entries


def general_nudges() -> list[dict[str, Any]]:
    return [
        {
            "line_id": "NUDGE_GENERAL_01",
            "text": NUDGE_GENERAL,
            "reveal_when": {"always": True},
        },
        {
            "line_id": "NUDGE_QUIET_A_01",
            "text": "(가상) 이 구역 잡담 하나",
            "reveal_when": {"always": True},
            "zone_id": "ZONE_A",
        },
        {
            "line_id": "NUDGE_QUIET_A_02",
            "text": "(가상) 이 구역 잡담 둘",
            "reveal_when": {"always": True},
            "zone_id": "ZONE_A",
        },
        {
            "line_id": "NUDGE_QUIET_B_01",
            "text": "(가상) 다른 구역 잡담",
            "reveal_when": {"always": True},
            "zone_id": "ZONE_B",
        },
        {
            "line_id": "NUDGE_QUIET_C_LOCKED",
            "text": "(가상) 아직 못 본 것에 대한 잡담",
            "reveal_when": {"clue_acquired": "CLUE_HIDDEN"},
            "zone_id": "ZONE_C",
        },
    ]


def situation_content(**kw: Any):
    extra = {"situations": situations(), "general_nudges": general_nudges()} | kw
    return content(**extra)


NO_SIGNALS = DecisionSignals(False, None, None, None)
SILENT_PUZZLE = NpcTurnResult("auto", None, "not_needed", None)


def reply_event(
    code: str,
    line_id: str,
    seconds_ago: float,
    *,
    focus: str | None = None,
    now: datetime = T,
) -> InteractionEvent:
    return InteractionEvent(
        id=str(uuid.uuid4()),
        play_session_id=SESSION_ID,
        client_event_id=str(uuid.uuid4()),
        interaction_type="npc_turn",
        target_id=None,
        payload_json={
            "trigger": "auto",
            "focus_object_id": focus,
            "message_sha256": None,
            "situation": {"code": code, "zone_id": None, "value": None},
        },
        result_type="replied",
        response_json={
            "situation_code": code,
            "situation_replied": True,
            "line_id": line_id,
            "auto_intervened": False,
        },
        created_at=now - timedelta(seconds=seconds_ago),
    )


def turn(
    code: str,
    *,
    focus: str | None = None,
    zone: str | None = None,
    events: list[Any] = (),
    state: dict[str, Any] = STATE,
    signals: DecisionSignals = NO_SIGNALS,
    puzzle: NpcTurnResult = SILENT_PUZZLE,
    turn_content: Any = None,
) -> NpcTurnResult:
    return run_situation_turn(
        puzzle,
        SituationRequest(code, focus, zone),
        events=list(events),
        state=state,
        content=turn_content or situation_content(),
        now=T,
        signals=signals,
        rule_config=RuleConfig(),
    )


def line_id(result: NpcTurnResult) -> str | None:
    return result.reply.line_id if result.reply else None


# --- 1 · 선택 ---


@pytest.mark.parametrize("code", CODES)
def test_each_code_selects_its_own_approved_line(code: str) -> None:
    focus = "OBJ_STEP_A" if code == "STEP_DONE" else None
    result = turn(code, focus=focus)

    expected = {
        "STEP_ARRIVED": "SIT_STEP_ANY",
        "NO_PROGRESS": "SIT_NO_PROGRESS_01",
        "STEP_DONE": "SIT_STEP_DONE_A",
    }.get(code, f"SIT_{code}_01")
    assert line_id(result) == expected
    assert result.reply.source == "approved_line"
    assert result.reply.text == f"(가상) {expected} 대사"
    assert result.suggest_hint is None
    assert result.situation_code == code
    assert result.situation_replied is True
    assert result.situation_reason is None


def test_quiet_selects_from_general_nudges() -> None:
    result = turn("QUIET")

    assert line_id(result) == "NUDGE_GENERAL_01"
    assert result.situation_replied is True


def test_same_object_line_is_preferred() -> None:
    assert line_id(turn("STEP_ARRIVED", focus="OBJ_STEP_A")) == "SIT_STEP_A"
    assert line_id(turn("STEP_ARRIVED", focus="OBJ_STEP_B")) == "SIT_STEP_B"


def test_other_object_lines_are_never_selected() -> None:
    # 다른 Object 대사는 건너뛰고 조건 없는 대사로 간다.
    assert line_id(turn("STEP_ARRIVED", focus="OBJ_OTHER")) == "SIT_STEP_ANY"
    assert line_id(turn("STEP_ARRIVED")) == "SIT_STEP_ANY"
    # 조건 없는 대사가 없으면 다른 Object 대사로 폴백하지 않고 말하지 않는다.
    for focus in ("OBJ_OTHER", None):
        result = turn("STEP_DONE", focus=focus)
        assert result.reply is None
        assert result.no_reply_reason == NO_LINE


def test_object_without_own_line_falls_back_to_unconditioned_line() -> None:
    assert line_id(turn("BREATH_LOW", focus="OBJ_STEP_A")) == "SIT_BREATH_LOW_01"


def test_quiet_prefers_same_zone_then_zoneless() -> None:
    assert line_id(turn("QUIET", zone="ZONE_A")) == "NUDGE_QUIET_A_01"
    assert line_id(turn("QUIET", zone="ZONE_B")) == "NUDGE_QUIET_B_01"
    # 구역 대사가 없는 구역 · 구역 없음 → 구역 조건 없는 대사만(다른 구역 대사 아님)
    assert line_id(turn("QUIET", zone="ZONE_Z")) == "NUDGE_GENERAL_01"
    assert line_id(turn("QUIET")) == "NUDGE_GENERAL_01"


def test_quiet_keeps_reveal_when() -> None:
    # 그 구역 대사가 아직 공개되지 않았으면 구역 조건 없는 대사로 간다.
    assert line_id(turn("QUIET", zone="ZONE_C")) == "NUDGE_GENERAL_01"
    revealed = STATE | {"acquired_clue_ids": ["CLUE_LETTER", "CLUE_HIDDEN"]}
    assert line_id(turn("QUIET", zone="ZONE_C", state=revealed)) == (
        "NUDGE_QUIET_C_LOCKED"
    )
    # 공개된 대사가 하나도 없으면 말하지 않는다.
    hidden = [
        nudge | {"reveal_when": {"clue_acquired": "CLUE_HIDDEN"}}
        for nudge in general_nudges()
    ]
    result = turn("QUIET", turn_content=situation_content(general_nudges=hidden))
    assert result.reply is None and result.no_reply_reason == NO_LINE


def test_rotation_avoids_the_previous_line() -> None:
    first = turn("NO_PROGRESS")
    second = turn(
        "NO_PROGRESS", events=[reply_event("NO_PROGRESS", "SIT_NO_PROGRESS_01", 120)]
    )
    third = turn(
        "NO_PROGRESS",
        events=[
            reply_event("NO_PROGRESS", "SIT_NO_PROGRESS_01", 300),
            reply_event("NO_PROGRESS", "SIT_NO_PROGRESS_02", 120),
        ],
    )
    quiet = turn(
        "QUIET",
        zone="ZONE_A",
        events=[reply_event("QUIET", "NUDGE_QUIET_A_01", 200)],
    )

    assert [line_id(first), line_id(second), line_id(third)] == [
        "SIT_NO_PROGRESS_01",
        "SIT_NO_PROGRESS_02",
        "SIT_NO_PROGRESS_01",
    ]
    assert line_id(quiet) == "NUDGE_QUIET_A_02"
    # 후보가 하나뿐이면 같은 대사를 다시 낸다(피할 대사가 없다).
    again = turn(
        "BREATH_LOW", events=[reply_event("BREATH_LOW", "SIT_BREATH_LOW_01", 120)]
    )
    assert line_id(again) == "SIT_BREATH_LOW_01"


# --- 2 · 쿨다운 · 횟수 ---


def test_default_cooldown_is_60s_per_code_and_object() -> None:
    blocked = turn(
        "SENT_BACK", events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 59)]
    )
    ready = turn("SENT_BACK", events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 60)])
    other_object = turn(
        "SENT_BACK",
        focus="OBJ_STEP_A",
        events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 30)],
    )
    other_code = turn(
        "OFF_OBJECTIVE", events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 30)]
    )

    assert blocked.reply is None and blocked.no_reply_reason == COOLDOWN
    assert blocked.situation_reason == COOLDOWN
    assert line_id(ready) == "SIT_SENT_BACK_01"
    # 쿨다운은 (code, focus_object_id)마다 · 코드마다 따로다.
    assert line_id(other_object) == "SIT_SENT_BACK_01"
    assert line_id(other_code) == "SIT_OFF_OBJECTIVE_01"


def test_content_cooldown_overrides_default() -> None:
    # BREATH_LOW cooldown_seconds=45(콘텐츠 값)
    blocked = turn(
        "BREATH_LOW", events=[reply_event("BREATH_LOW", "SIT_BREATH_LOW_01", 44)]
    )
    ready = turn(
        "BREATH_LOW", events=[reply_event("BREATH_LOW", "SIT_BREATH_LOW_01", 45)]
    )
    custom = situations()
    custom[1]["cooldown_seconds"] = 90  # SENT_BACK
    longer = turn(
        "SENT_BACK",
        events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 75)],
        turn_content=situation_content(situations=custom),
    )

    assert blocked.no_reply_reason == COOLDOWN
    assert line_id(ready) == "SIT_BREATH_LOW_01"
    assert longer.no_reply_reason == COOLDOWN


def test_global_gap_between_situation_lines_is_20s() -> None:
    blocked = turn(
        "BREATH_LOW", events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 19)]
    )
    ready = turn(
        "BREATH_LOW", events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 20)]
    )
    after_quiet = turn(
        "BREATH_LOW", events=[reply_event("QUIET", "NUDGE_GENERAL_01", 5)]
    )

    assert blocked.reply is None and blocked.no_reply_reason == GLOBAL_GAP
    assert line_id(ready) == "SIT_BREATH_LOW_01"
    assert after_quiet.no_reply_reason == GLOBAL_GAP


def test_quiet_cooldown_is_180s_regardless_of_object() -> None:
    blocked = turn(
        "QUIET",
        focus="OBJ_STEP_A",
        events=[reply_event("QUIET", "NUDGE_GENERAL_01", 179)],
    )
    ready = turn("QUIET", events=[reply_event("QUIET", "NUDGE_GENERAL_01", 180)])

    assert blocked.no_reply_reason == COOLDOWN
    assert line_id(ready) == "NUDGE_GENERAL_01"


def test_quiet_is_limited_to_five_per_session() -> None:
    four = [reply_event("QUIET", "NUDGE_GENERAL_01", 3000 - i * 500) for i in range(4)]
    five = [*four, reply_event("QUIET", "NUDGE_GENERAL_01", 600)]

    assert line_id(turn("QUIET", events=four)) == "NUDGE_GENERAL_01"
    capped = turn("QUIET", events=five)
    assert capped.reply is None and capped.no_reply_reason == QUIET_LIMIT
    # 다른 상황 코드는 QUIET 상한과 무관하다.
    assert line_id(turn("SENT_BACK", events=five)) == "SIT_SENT_BACK_01"


def test_quiet_waits_for_puzzle_and_other_situation_cooldowns() -> None:
    shown_recently = DecisionSignals(False, None, None, None, 179.0)
    shown_long_ago = DecisionSignals(False, None, None, None, 180.0)
    declined_recently = DecisionSignals(False, None, None, None, 900.0, 599.0)

    assert turn("QUIET", signals=shown_recently).no_reply_reason == (
        QUIET_PUZZLE_COOLDOWN
    )
    assert line_id(turn("QUIET", signals=shown_long_ago)) == "NUDGE_GENERAL_01"
    assert turn("QUIET", signals=declined_recently).no_reply_reason == (
        QUIET_PUZZLE_COOLDOWN
    )
    # 다른 상황 대사의 코드 쿨다운(60초 · BREATH_LOW 45초)이 남아 있으면 잡담하지 않는다.
    other = turn("QUIET", events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 59)])
    breath_done = turn(
        "QUIET", events=[reply_event("BREATH_LOW", "SIT_BREATH_LOW_01", 45)]
    )
    assert other.no_reply_reason == QUIET_OTHER_COOLDOWN
    assert line_id(breath_done) == "NUDGE_GENERAL_01"
    # 반대로 다른 상황 코드는 QUIET 쿨다운(180초)을 기다리지 않는다(20초 간격만).
    after_quiet = turn(
        "SENT_BACK", events=[reply_event("QUIET", "NUDGE_GENERAL_01", 21)]
    )
    assert line_id(after_quiet) == "SIT_SENT_BACK_01"


def test_silent_turns_do_not_consume_cooldown() -> None:
    # 말하지 않은 상황 턴(대사 없음 · 쿨다운)은 이력에 들어가지 않는다.
    silent = reply_event("SENT_BACK", "SIT_SENT_BACK_01", 5)
    silent.response_json = silent.response_json | {"situation_replied": False}
    puzzle_reply = reply_event("SENT_BACK", "NUDGE_A_01", 5)
    puzzle_reply.response_json = {"line_id": "NUDGE_A_01", "auto_intervened": True}

    assert situation_history([silent, puzzle_reply]) == []
    assert line_id(turn("SENT_BACK", events=[silent, puzzle_reply])) == (
        "SIT_SENT_BACK_01"
    )


def test_custom_server_defaults_are_injectable() -> None:
    config = SituationConfig(default_cooldown_sec=10, global_gap_sec=0)
    result = run_situation_turn(
        SILENT_PUZZLE,
        SituationRequest("SENT_BACK", None, None),
        events=[reply_event("SENT_BACK", "SIT_SENT_BACK_01", 11)],
        state=STATE,
        content=situation_content(),
        now=T,
        signals=NO_SIGNALS,
        rule_config=RuleConfig(),
        config=config,
    )
    assert line_id(result) == "SIT_SENT_BACK_01"


# --- 3 · 퍼즐 우선 · 응답 ---


def test_puzzle_auto_intervention_wins() -> None:
    decision = NpcDecision(True, 1, "repeated_incorrect", "PZ_A", 6)
    nudge = NpcTurnResult(
        "auto", NpcReply("approved_line", "(가상)", "NUDGE_A_01"), None, None, decision
    )
    guidance = NpcTurnResult("auto", None, "x", SuggestHint("PZ_A"), decision)

    for puzzle in (nudge, guidance):
        result = turn("REPEATED_MISTAKE", puzzle=puzzle)
        assert result.reply == puzzle.reply
        assert result.suggest_hint == puzzle.suggest_hint
        assert result.situation_replied is False
        assert result.situation_reason == PREEMPTED_BY_PUZZLE
        assert result.situation_code == "REPEATED_MISTAKE"


def test_puzzle_decision_without_anything_to_show_lets_situation_speak() -> None:
    decision = NpcDecision(True, 1, "idle_too_long", "PZ_A", 300)
    empty = NpcTurnResult("auto", None, "no_approved_line", None, decision)

    result = turn("NO_PROGRESS", puzzle=empty)

    assert line_id(result) == "SIT_NO_PROGRESS_01"
    assert result.suggest_hint is None
    assert result.decision == decision  # 퍼즐 판단 기록은 그대로 남긴다


def test_code_without_lines_has_no_reply() -> None:
    no_entry = turn("SENT_BACK", turn_content=situation_content(situations=[]))
    missing = turn("SENT_BACK", turn_content=situation_content(situations=None))

    for result in (no_entry, missing):
        assert result.reply is None
        assert result.suggest_hint is None
        assert result.no_reply_reason == NO_LINE


def test_unapproved_content_is_never_served() -> None:
    unapproved = situation_content(case_approved=False)
    for code in [*CODES, "QUIET"]:
        result = turn(code, focus="OBJ_STEP_A", turn_content=unapproved)
        assert result.reply is None, code
        assert result.no_reply_reason == NO_LINE


def test_line_text_is_checked_for_protected_text_before_reply() -> None:
    unsafe = situations()
    unsafe[1]["lines"] = [{"line_id": "SIT_SENT_BACK_01", "text": HINT_1}]
    with pytest.raises(NpcContentUnsafeError):
        turn("SENT_BACK", turn_content=situation_content(situations=unsafe))


def test_line_source_serves_situation_lines_only_with_approval() -> None:
    pinned = bundle(situations=situations())
    source_ok = pinned.line_source(approved(("case_test", 1), FP).source())
    source_none = pinned.line_source(None)

    served = source_ok("case_test", "NPC_TEST", "SIT_BREATH_LOW_01")
    assert served.kind == "situation" and served.approved is True
    assert served.reveal_when is None and served.puzzle_id is None
    assert source_none("case_test", "NPC_TEST", "SIT_BREATH_LOW_01").approved is False
    # 다른 승인 대상(fingerprint)의 승인은 쓰지 않는다.
    other = pinned.line_source(
        approved(("case_test", 1), "sha256:" + "f" * 64).source()
    )
    assert other("case_test", "NPC_TEST", "SIT_BREATH_LOW_01").approved is False


# --- 4 · 턴 서비스(HTTP) ---


def use_situation_bundle(values: dict[str, Any], **npc_extra: Any) -> None:
    store = PinnedContentStore()
    store.add(
        bundle(
            **(
                {"situations": situations(), "general_nudges": general_nudges()}
                | npc_extra
            )
        )
    )
    values["store"] = store


def sit_body(code: str, **kw: Any) -> dict[str, Any]:
    situation = {"code": code} | kw.pop("situation_extra", {})
    return auto_body(situation=situation, **kw)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_http_situation_reply_has_no_hint_and_records_code_without_text(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    approve_all(overrides)
    use_situation_bundle(overrides)
    db_session.get_result = session_row()

    response = client.post(URL, json=sit_body("BREATH_LOW", focus_object_id=None))

    assert response.status_code == 200
    data = response.json()
    assert data["reply"] == {
        "source": "approved_line",
        "text": "(가상) SIT_BREATH_LOW_01 대사",
        "line_id": "SIT_BREATH_LOW_01",
    }
    assert data["suggest_hint"] is None
    assert data["content_mode"] == "case"
    event = stored(db_session)
    record = event.response_json
    assert event.result_type == "replied"
    assert record["situation_code"] == "BREATH_LOW"
    assert record["situation_replied"] is True
    assert record["situation_reason"] is None
    assert record["line_id"] == "SIT_BREATH_LOW_01"
    # 상황 대사는 자동 개입 제안이 아니다(퍼즐 횟수 · 쿨다운에 들어가지 않는다).
    assert record["auto_intervened"] is False
    assert record["suggest_hint_puzzle_id"] is None
    assert "(가상) SIT_BREATH_LOW_01 대사" not in str(record)
    assert "(가상)" not in str(event.payload_json)


def test_http_situation_turn_locks_the_session_after_closing_open_reads(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    approve_all(overrides)
    use_situation_bundle(overrides)
    db_session.get_result = session_row()

    client.post(URL, json=sit_body("QUIET"))
    situation_options = list(db_session.get_options)
    log = list(db_session.operation_log)
    db_session.get_options.clear()
    db_session.operation_log.clear()
    db_session.added.clear()
    client.post(URL, json=auto_body(client_event_id=str(uuid.uuid4())))

    # 상황 턴: 열린 읽기 트랜잭션을 끝내고(rollback) 세션 행을 배타 잠금으로 먼저 읽는다.
    assert situation_options[0] == {"with_for_update": True}
    assert log[:2] == ["rollback", "get"]
    # 상황이 없는 턴은 기존 그대로(잠금 없음).
    assert db_session.get_options[0] == {}
    assert db_session.operation_log[0] == "get"


def test_http_cooldown_comes_from_stored_events(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    approve_all(overrides)
    use_situation_bundle(overrides)
    db_session.get_result = session_row()
    now = utc_now()
    overrides["events"] = [reply_event("SENT_BACK", "SIT_SENT_BACK_01", 30, now=now)]

    blocked = client.post(URL, json=sit_body("SENT_BACK", focus_object_id=None))
    record = stored(db_session).response_json

    assert blocked.json()["reply"] is None
    assert blocked.json()["suggest_hint"] is None
    assert stored(db_session).result_type == "no_reply"
    assert record["situation_code"] == "SENT_BACK"
    assert record["situation_replied"] is False
    assert record["situation_reason"] == COOLDOWN
    assert record["no_reply_reason"] == COOLDOWN


def test_http_limits_survive_a_new_store_and_process(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    # 서버 재시작: 새 콘텐츠 저장소 · 새 요청이어도 이력은 저장된 이벤트에서 다시 읽는다.
    approve_all(overrides)
    now = utc_now()
    history = [
        reply_event("QUIET", "NUDGE_GENERAL_01", 3000 - i * 500, now=now)
        for i in range(5)
    ]
    for attempt in range(2):
        use_situation_bundle(overrides)  # 매번 새 저장소(메모리 상태 없음)
        overrides["events"] = list(history)
        db_session.get_result = session_row()
        db_session.added.clear()
        response = client.post(
            URL, json=sit_body("QUIET", client_event_id=str(uuid.uuid4()))
        )
        assert response.json()["reply"] is None, attempt
        assert stored(db_session).response_json["situation_reason"] == QUIET_LIMIT


def test_http_puzzle_auto_intervention_wins_over_situation(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    approve_all(overrides)
    use_situation_bundle(overrides)
    overrides["events"] = answer_events(6)
    db_session.get_result = session_row()

    response = client.post(URL, json=sit_body("REPEATED_MISTAKE"))

    assert response.json()["reply"]["line_id"] == "NUDGE_A_01"
    record = stored(db_session).response_json
    assert record["auto_intervened"] is True
    assert record["situation_replied"] is False
    assert record["situation_reason"] == PREEMPTED_BY_PUZZLE


def test_http_replay_returns_the_same_situation_reply(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    approve_all(overrides)
    use_situation_bundle(overrides)
    db_session.get_result = session_row()
    first_body = sit_body("NO_PROGRESS", situation_extra={"value": 30})
    first = client.post(URL, json=first_body)
    event = stored(db_session)

    db_session.added.clear()
    db_session.scalar_result = event
    # 재전송 사이에 다른 대사가 나갔어도(이력이 바뀌어도) 처음 응답 그대로다.
    overrides["events"] = [event]
    again = client.post(URL, json=first_body)
    conflict = client.post(URL, json=sit_body("NO_PROGRESS"))
    other_code = client.post(URL, json=sit_body("QUIET"))

    assert first.json()["reply"]["line_id"] == "SIT_NO_PROGRESS_01"
    assert again.status_code == 200
    assert again.json() == first.json()
    assert db_session.added == []
    # 계약 §8-6은 422라고 적었지만 기존 재전송 충돌(409)을 유지한다(팀 결정 대기).
    for changed in (conflict, other_code):
        assert changed.status_code == 409


def test_http_replay_drops_text_when_approval_is_withdrawn(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    approve_all(overrides)
    use_situation_bundle(overrides)
    db_session.get_result = session_row()
    first_body = sit_body("SENT_BACK")
    client.post(URL, json=first_body)
    event = stored(db_session)

    db_session.added.clear()
    db_session.scalar_result = event
    overrides["approval"] = None
    again = client.post(URL, json=first_body)

    assert again.status_code == 200
    assert again.json()["reply"] is None
    assert again.json()["suggest_hint"] is None


def test_http_unapproved_content_has_no_situation_reply(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    use_situation_bundle(overrides)  # 승인 이력 없음(기본 차단)
    db_session.get_result = session_row()

    for code in [*CODES, "QUIET"]:
        db_session.added.clear()
        response = client.post(
            URL,
            json=sit_body(
                code, client_event_id=str(uuid.uuid4()), focus_object_id="OBJ_STEP_A"
            ),
        )
        assert response.status_code == 200
        assert response.json()["reply"] is None, code
        assert stored(db_session).response_json["situation_reason"] == NO_LINE


# --- 5 · 긴급 차단(blocked) — 계약 v0.4.16 §5 「게시 중단: reply: null」 ---

WITHDRAWN = "NPC_CONTENT_WITHDRAWN"


def blocked_setup(overrides, general, reader_override, db_session):  # noqa: F811
    approve_all(overrides)
    use_situation_bundle(overrides)
    pack = pause_pack()
    general(pack, pack_approval(pack))  # 승인된 「잠시 멈춤」 팩이 있어도
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()


@pytest.mark.parametrize("code", [*CODES, "QUIET"])
def test_blocked_situation_turn_has_null_reply_and_consumes_nothing(
    client,
    db_session,
    overrides,  # noqa: F811
    general,  # noqa: F811
    reader_override,  # noqa: F811
    code,
) -> None:
    blocked_setup(overrides, general, reader_override, db_session)

    response = client.post(
        URL,
        json=sit_body(
            code, focus_object_id="OBJ_STEP_A", situation_extra={"zone_id": "ZONE_A"}
        ),
    )

    assert response.status_code == 200
    assert response.json() == {
        "npc_event_id": response.json()["npc_event_id"],
        "reply": None,
        "suggest_hint": None,
        "fallback_reason": WITHDRAWN,
        "content_mode": "generic",
    }
    event = stored(db_session)
    record = event.response_json
    assert event.result_type == "no_reply"
    assert record["line_id"] is None
    assert record["situation_code"] == code
    assert record["situation_replied"] is False
    assert record["situation_reason"] == CONTENT_WITHDRAWN
    assert "(가상)" not in str(record)
    # 쿨다운 · QUIET 횟수를 쓰지 않는다.
    assert situation_history([event]) == []


def test_blocked_keeps_pause_line_for_turns_without_situation(
    client,
    db_session,
    overrides,  # noqa: F811
    general,  # noqa: F811
    reader_override,  # noqa: F811
) -> None:
    blocked_setup(overrides, general, reader_override, db_session)

    auto = client.post(URL, json=auto_body(client_event_id=str(uuid.uuid4())))
    message = client.post(
        URL,
        json={
            "client_event_id": str(uuid.uuid4()),
            "trigger": "player_message",
            "message": "(가상) 안녕",
        },
    )

    # 상황이 없는 턴의 v0.4.12 「잠시 멈춤」 대사는 그대로다.
    for response in (auto, message):
        assert response.json()["reply"]["line_id"].startswith("GENERIC_PAUSE_")
        assert response.json()["fallback_reason"] == WITHDRAWN


def test_block_committed_during_situation_turn_drops_the_line(
    client,
    db_session,
    overrides,  # noqa: F811
    general,  # noqa: F811
    reader_override,  # noqa: F811
) -> None:
    blocked_setup(overrides, general, reader_override, db_session)
    reader_override(Reader(approved_access(), BLOCKED))

    response = client.post(URL, json=sit_body("BREATH_LOW"))

    assert response.json()["reply"] is None
    assert response.json()["fallback_reason"] == WITHDRAWN
    assert stored(db_session).response_json["situation_replied"] is False


def test_resend_after_block_does_not_show_the_situation_or_pause_line(
    client,
    db_session,
    overrides,  # noqa: F811
    general,  # noqa: F811
    reader_override,  # noqa: F811
) -> None:
    blocked_setup(overrides, general, reader_override, db_session)
    reader_override(Reader(approved_access()))
    first_body = sit_body("BREATH_LOW")
    before = client.post(URL, json=first_body).json()
    event = stored(db_session)
    assert before["reply"]["line_id"] == "SIT_BREATH_LOW_01"

    reader_override(Reader(BLOCKED))
    db_session.added.clear()
    db_session.scalar_result = event
    again = client.post(URL, json=first_body).json()

    assert again["reply"] is None
    assert again["fallback_reason"] == WITHDRAWN
    assert again["content_mode"] == "generic"
    assert "SIT_BREATH_LOW_01" not in str(again)
    assert db_session.added == []


def test_situation_lines_resume_after_unblock_without_cooldown(
    client,
    db_session,
    overrides,  # noqa: F811
    general,  # noqa: F811
    reader_override,  # noqa: F811
) -> None:
    blocked_setup(overrides, general, reader_override, db_session)
    blocked_events = []
    for _ in range(6):
        db_session.added.clear()
        client.post(URL, json=sit_body("QUIET", client_event_id=str(uuid.uuid4())))
        blocked_events.append(stored(db_session))

    reader_override(Reader(approved_access()))
    overrides["events"] = blocked_events
    db_session.added.clear()
    resumed = client.post(
        URL, json=sit_body("QUIET", client_event_id=str(uuid.uuid4()))
    )

    # 차단 중 6번의 QUIET는 횟수(5회) · 쿨다운 · 20초 간격을 쓰지 않았다.
    assert resumed.json()["reply"]["line_id"] == "NUDGE_GENERAL_01"


def test_suspended_publication_keeps_serving_situation_lines(
    client,
    db_session,
    overrides,  # noqa: F811
    reader_override,  # noqa: F811
) -> None:
    # v0.4.6: suspended(새 세션 생성만 중지)는 진행 중 세션의 케이스 대사를 막지 않는다. 바꾸지 않았다.
    approve_all(overrides)
    use_situation_bundle(overrides)
    reader_override(
        Reader(
            CaseNpcAccess(approved(("case_test", 1), FP).source(), basis=("suspended",))
        )
    )
    db_session.get_result = session_row()

    response = client.post(URL, json=sit_body("BREATH_LOW"))

    assert response.json()["reply"]["line_id"] == "SIT_BREATH_LOW_01"
    assert response.json()["fallback_reason"] is None
