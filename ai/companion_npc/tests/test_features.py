"""P2-B — 특성 추출 · 오프라인 재생 · 대리 라벨."""

import copy
import json
from datetime import datetime, timedelta, timezone

import pytest
from conftest import BACKEND_CASES, FIXTURE_CASES
from pydantic import ValidationError

from companion_npc.adapters import convert_case, load_case_sources
from companion_npc.contracts.npc_context import InteractionRecord, NpcContext
from companion_npc.features import (
    FEATURE_SPECS,
    FeatureConfig,
    FeatureVector,
    extract_features,
)
from companion_npc.features.extract import FeatureInputError, FutureObservationError
from companion_npc.features.fingerprint import AnswerFingerprinter
from companion_npc.features.labels import HelpAnnotation, label_replay, proxy_label_name
from companion_npc.features.replay import (
    LoggedInteraction,
    ReplayInputError,
    replay_features,
    replay_session,
)
from companion_npc.features.schema import FEATURE_NAMES, FeatureRowSchema

SESSION = "11111111-2222-4333-8444-555555555555"
CASE = "case_fixture_lighthouse"
T0 = datetime(2026, 10, 24, 3, 0, 0)  # backend 처럼 timezone 없는 UTC
END = (T0 + timedelta(minutes=8)).replace(tzinfo=timezone.utc)
KEY = b"test-only-fingerprint-key-000000"
RAW_ANSWERS = ["7351", "8642", "0412", "NORTH"]


@pytest.fixture(scope="module")
def pack():
    sources = load_case_sources(FIXTURE_CASES, CASE)
    return convert_case(sources.client, sources.server, client_ref="x").pack


def _state(completed=(), clues=(), attempts=None, flags=None):
    return {
        "current_zone_id": "ZONE_KEEPER_HOUSE",
        "completed_puzzle_ids": list(completed),
        "acquired_clue_ids": list(clues),
        "hint_levels": {},
        "attempt_counts": dict(attempts or {}),
        "flags": dict(flags or {}),
    }


def _row(n, seconds, puzzle, answer, result, attempt, state, changes=()):
    return {
        "id": f"00000000-0000-4000-8000-{n:012d}",
        "play_session_id": SESSION,
        "client_event_id": f"c0000000-0000-4000-8000-{n:012d}",
        "client_timestamp": None,
        "interaction_type": "submit_answer",
        "target_id": puzzle,
        "payload_json": {"answer": answer},
        "result_type": result,
        "response_json": {
            "result_type": result,
            "state": state,
            "state_changes": list(changes),
            "message": None,
            "attempt_count": attempt,
            "ui_actions": [],
        },
        "created_at": (T0 + timedelta(seconds=seconds)).isoformat(),
    }


DONE = [
    {"type": "puzzle_completed", "puzzle_id": "PUZZLE_DRAWER"},
    {"type": "clue_acquired", "clue_id": "CLUE_LENS_NOTE"},
    {"type": "flag_updated", "flag": "drawer_open", "value": True},
]
AFTER_DRAWER = dict(
    completed=["PUZZLE_DRAWER"], clues=["CLUE_LENS_NOTE"], flags={"drawer_open": True}
)


def _rows():
    return [
        _row(1, 0, "PUZZLE_DRAWER", "7351", "incorrect", 1, _state(attempts={"PUZZLE_DRAWER": 1})),
        _row(2, 40, "PUZZLE_DRAWER", "7351", "incorrect", 2, _state(attempts={"PUZZLE_DRAWER": 2})),
        _row(3, 90, "PUZZLE_DRAWER", "8642", "incorrect", 3, _state(attempts={"PUZZLE_DRAWER": 3})),
        _row(4, 180, "PUZZLE_DRAWER", "0412", "correct", 4,
             _state(attempts={"PUZZLE_DRAWER": 4}, **AFTER_DRAWER), DONE),
        _row(5, 300, "PUZZLE_LENS", "NORTH", "incorrect", 1,
             _state(attempts={"PUZZLE_DRAWER": 4, "PUZZLE_LENS": 1}, **AFTER_DRAWER)),
    ]  # fmt: skip


def _replay(pack, rows=None, **kwargs):
    kwargs.setdefault("fingerprinter", AnswerFingerprinter(KEY))
    return replay_session(
        rows if rows is not None else _rows(),
        play_session_id=SESSION,
        case_id=CASE,
        pack=pack,
        observation_end=END,
        **kwargs,
    )


def _post(result, index):
    return next(
        p
        for p in result.decision_points
        if p.phase == "post_event" and p.event_index == index
    )


# ── 실제 계산 ────────────────────────────────────────────────
def test_feature_values_after_third_wrong_answer(pack):
    vector = extract_features(_post(_replay(pack), 2).context, pack, phase="post_event")
    v = vector.values
    assert vector.meta.target_source == "last_attempt"
    assert v["target_known"] == 1 and v["target_from_focus"] == 0
    assert v["target_attempt_count"] == 3
    assert v["target_consecutive_incorrect"] == 3
    assert v["target_repeat_wrong_max"] == 2  # "7351" 두 번
    assert v["target_distinct_wrong"] == 2
    assert v["since_last_interaction_sec"] == 0
    assert v["mean_gap_recent_sec"] == 45  # (40 + 50) / 2
    assert v["events_in_rate_window"] == 3
    assert v["progress_puzzle_ratio"] == 0 and v["pack_puzzle_count"] == 4
    assert vector.status["since_last_progress_sec"] == "unobservable"
    assert vector.status["target_hint_level"] == "unobservable"  # Hint API 없음
    assert vector.status["since_last_npc_utterance_sec"] == "unobservable"


def test_feature_values_after_progress(pack):
    v = extract_features(_post(_replay(pack), 4).context, pack).values
    assert v["since_last_progress_sec"] == 120  # 03:00 정답 → 05:00 오답
    assert v["progress_puzzle_ratio"] == 0.25
    assert v["progress_clue_ratio"] == pytest.approx(1 / 3)
    assert v["flags_true_count"] == 1
    assert v["target_consecutive_incorrect"] == 1  # 대상이 PUZZLE_LENS 로 바뀌었다
    assert v["target_grants_clue_count"] == 0


# ── 1. 온라인 · 오프라인 일치 ────────────────────────────────────
def test_wire_round_trip_gives_same_features(pack):
    for point in _replay(pack).decision_points:
        offline = extract_features(point.context, pack, phase=point.phase)
        online = extract_features(
            NpcContext.model_validate_json(point.context.model_dump_json()),
            pack,
            phase=point.phase,
        )
        assert online == offline


def test_live_records_give_same_features_as_log_records(pack):
    # 실시간 경로는 zone_id · 오브젝트 target_id 를 관측하고 resolved_puzzle_id 는 주지 않는다고 가정
    result = _replay(pack)
    hosts = {o.puzzle_id: o for o in pack.objects if o.puzzle_id}
    for point in result.decision_points:
        live = [
            InteractionRecord.model_validate(
                r.model_dump()
                | {
                    "source": "live",
                    "zone_id": hosts[r.resolved_puzzle_id].zone_id,
                    "target_id": hosts[r.resolved_puzzle_id].object_id,
                    "resolved_puzzle_id": None,
                    "inferred_object_id": None,
                }
            )
            for r in point.context.recent_interactions
        ]
        live_context = point.context.model_copy(update={"recent_interactions": live})
        assert (
            extract_features(live_context, pack).values
            == extract_features(point.context, pack).values
        )


def test_replay_features_uses_same_function(pack):
    result = _replay(pack)
    assert replay_features(result, pack) == [
        extract_features(p.context, pack, phase=p.phase) for p in result.decision_points
    ]


# ── 2. 미래 이벤트 ───────────────────────────────────────────
def test_future_events_do_not_change_past_features(pack):
    full = _replay(pack)
    for cut in range(1, len(_rows())):
        partial = _replay(pack, _rows()[:cut])
        for point in partial.decision_points:
            if point.phase != "post_event":
                continue
            twin = _post(full, point.event_index)
            assert extract_features(point.context, pack) == extract_features(
                twin.context, pack
            )


def test_context_with_future_event_is_rejected(pack):
    point = _post(_replay(pack), 1)
    early = point.context.model_copy(
        update={"requested_at": point.context.requested_at - timedelta(seconds=1)}
    )
    with pytest.raises(FutureObservationError):
        extract_features(early, pack)


def test_ticks_see_only_past_events(pack):
    result = _replay(pack)
    for point in result.decision_points:
        last_seen = point.context.recent_interactions[-1]
        assert last_seen == result.timeline[point.event_index]
        assert all(
            r.occurred_at <= point.context.requested_at
            for r in point.context.recent_interactions
        )


def test_tick_uses_state_after_previous_event(pack):
    result = _replay(pack)
    ticks = [
        p for p in result.decision_points if p.phase == "tick" and p.event_index == 0
    ]
    assert [p.context.requested_at - result.timeline[0].occurred_at for p in ticks] == [
        timedelta(seconds=30)
    ]  # 00:00 다음 이벤트가 00:40 이라 tick 은 00:30 하나
    assert ticks[0].context.state == _post(result, 0).context.state
    assert ticks[0].context.trigger.type == "idle_tick"


# ── 3. 관측되지 않은 zone · 대상 ───────────────────────────────
def test_log_records_mark_unobserved_fields(pack):
    record = _replay(pack).timeline[0]
    assert record.source == "event_log"
    assert record.zone_id is None and record.target_id is None
    assert record.resolved_puzzle_id == "PUZZLE_DRAWER"  # 로그의 target_id 는 puzzle_id
    assert (
        record.inferred_object_id == "OBJ_DESK_DRAWER"
    )  # 추정값 — 관측값 칸에 넣지 않음


def test_inferred_object_is_not_used_for_features(pack):
    point = _post(_replay(pack), 2)
    stripped = point.context.model_copy(
        update={
            "recent_interactions": [
                r.model_copy(update={"inferred_object_id": None})
                for r in point.context.recent_interactions
            ]
        }
    )
    assert extract_features(stripped, pack) == extract_features(point.context, pack)


def test_record_contract_rules():
    base = {
        "client_event_id": "e",
        "occurred_at": "2026-10-24T03:00:00+00:00",
        "action": "input",
        "target_type": "object",
        "result_type": "incorrect",
    }
    with pytest.raises(ValidationError, match="zone_id"):
        InteractionRecord.model_validate(base)  # live 인데 zone 없음
    InteractionRecord.model_validate(base | {"source": "event_log"})
    with pytest.raises(ValidationError, match="inferred_object_id"):
        InteractionRecord.model_validate(
            base | {"zone_id": "Z", "target_id": "OBJ", "inferred_object_id": "OBJ2"}
        )


def test_no_target_makes_target_features_not_applicable(pack):
    context = _post(_replay(pack), 0).context.model_copy(
        update={"recent_interactions": []}
    )
    vector = extract_features(context, pack)
    assert vector.values["target_known"] == 0
    target_names = [
        s.name
        for s in FEATURE_SPECS
        if s.group == "target" and s.name != "target_known"
    ]
    assert all(vector.status[n] == "not_applicable" for n in target_names)
    assert vector.status["since_last_interaction_sec"] == "unobservable"


def test_focus_outside_pack_falls_back(pack):
    context = NpcContext.model_validate(
        _post(_replay(pack), 2).context.model_dump()
        | {"focus": {"puzzle_id": "PUZZLE_NOT_IN_PACK"}}
    )
    assert extract_features(context, pack).meta.target_source == "last_attempt"
    focused = NpcContext.model_validate(
        context.model_dump() | {"focus": {"puzzle_id": "PUZZLE_LENS"}}
    )
    vector = extract_features(focused, pack)
    assert (
        vector.meta.target_source == "focus"
        and vector.values["target_attempt_count"] == 0
    )


def test_pack_mismatch_rejected(pack):
    context = _post(_replay(pack), 0).context.model_copy(update={"pack_id": "other"})
    with pytest.raises(FeatureInputError):
        extract_features(context, pack)


# ── 4. 답 원문 · 민감 정보 ───────────────────────────────────
def _assert_no_answers(text: str):
    for answer in RAW_ANSWERS:
        assert answer not in text, answer


def test_no_raw_answer_in_outputs(pack):
    result = _replay(pack)
    vectors = replay_features(result, pack)
    labels = label_replay(result, END, 120)
    _assert_no_answers(json.dumps([v.model_row() for v in vectors]))
    _assert_no_answers(json.dumps([v.model_dump(mode="json") for v in vectors]))
    _assert_no_answers(
        json.dumps([p.context.model_dump(mode="json") for p in result.decision_points])
    )
    _assert_no_answers(json.dumps([r.model_dump(mode="json") for r in result.timeline]))
    _assert_no_answers(json.dumps([lab.model_dump() for lab in labels]))


def test_correct_answer_has_no_fingerprint(pack):
    timeline = _replay(pack).timeline
    assert (
        timeline[3].result_type == "correct" and timeline[3].answer_fingerprint is None
    )
    assert all(r.answer_fingerprint for r in timeline if r.result_type == "incorrect")


def test_without_key_repeat_features_are_unobservable(pack):
    result = _replay(pack, fingerprinter=None)
    assert all(r.answer_fingerprint is None for r in result.timeline)
    vector = extract_features(_post(result, 2).context, pack)
    assert vector.status["target_repeat_wrong_max"] == "unobservable"
    assert (
        vector.values["target_consecutive_incorrect"] == 3
    )  # 지문과 무관한 특성은 그대로


def test_fingerprints_differ_across_sessions():
    fp = AnswerFingerprinter(KEY)
    assert fp.fingerprint("s1", "7351") == fp.fingerprint("s1", " 7 3 5 1 ")
    assert fp.fingerprint("s1", "7351") != fp.fingerprint("s2", "7351")
    assert "test-only" not in repr(fp)
    with pytest.raises(ValueError):
        AnswerFingerprinter(b"short")


def test_errors_and_repr_do_not_echo_answer(pack):
    bad = _rows()
    bad[0]["result_type"] = "wrong"  # 잘못된 값
    with pytest.raises(ReplayInputError) as info:
        _replay(pack, bad)
    _assert_no_answers(str(info.value))
    _assert_no_answers(repr(LoggedInteraction.model_validate(_rows()[0])))


def test_other_session_row_rejected(pack):
    rows = _rows()
    rows[1]["play_session_id"] = "99999999-2222-4333-8444-555555555555"
    with pytest.raises(ReplayInputError, match="row 1"):
        _replay(pack, rows)


# ── 5. 결측값과 known ───────────────────────────────────────
def test_known_flags_match_values(pack):
    for vector in replay_features(_replay(pack), pack):
        row = vector.model_row()
        for name in FEATURE_NAMES:
            assert row[f"{name}__known"] == int(row[name] is not None)
            assert (vector.status[name] == "observed") == (row[name] is not None)


def test_inconsistent_vector_rejected(pack):
    data = replay_features(_replay(pack), pack)[0].model_dump(mode="json")
    data["status"]["target_known"] = "unobservable"  # 값은 있는데 상태는 미관측
    with pytest.raises(ValidationError):
        FeatureVector.model_validate(data)
    data = replay_features(_replay(pack), pack)[0].model_dump(mode="json")
    del data["values"]["zone_dwell_sec"]
    with pytest.raises(ValidationError):
        FeatureVector.model_validate(data)


def test_config_switches_unlock_sources(pack):
    config = FeatureConfig(hint_api_available=True, npc_log_available=True)
    vector = extract_features(_post(_replay(pack), 2).context, pack, config)
    assert vector.values["target_hint_level"] == 0
    assert (
        vector.status["since_last_npc_utterance_sec"] == "not_applicable"
    )  # 아직 말한 적 없음
    assert vector.values["npc_max_hint_level_on_target"] == 0


# ── 6. 시나리오가 달라도 같은 스키마 ────────────────────────────
@pytest.mark.skipif(
    not (BACKEND_CASES / "case_001.client.json").is_file(), reason="no backend"
)
def test_same_columns_across_scenarios(pack):
    sources = load_case_sources(BACKEND_CASES, "case_001")
    pack_001 = convert_case(sources.client, sources.server, client_ref="x").pack
    row = {"current_zone_id": "ZONE_SECRET_CORRIDOR"}
    context = NpcContext.model_validate(
        {
            "request_id": "r",
            "requested_at": "2026-10-24T03:00:00+00:00",
            "play_session_id": SESSION,
            "case_id": "case_001",
            "pack_id": pack_001.pack_id,
            "trigger": {"type": "idle_tick", "source": "timer"},
            "state": _state() | row,
            "timing": {"session_active_sec": 10},
        }
    )
    columns = list(extract_features(context, pack_001).model_row())
    lighthouse = list(replay_features(_replay(pack), pack)[0].model_row())
    assert columns == lighthouse == FeatureRowSchema().columns


def test_rows_contain_no_ids(pack):
    for vector in replay_features(_replay(pack), pack):
        assert all(
            v is None or isinstance(v, (int, float))
            for v in vector.model_row().values()
        )
        assert not {"case_id", "puzzle_id", "play_session_id"} & set(vector.model_row())


# ── 라벨 ────────────────────────────────────────────────────
def test_proxy_label_values(pack):
    result = _replay(pack)
    labels = {
        (p.phase, p.event_index, p.context.requested_at): lab
        for p, lab in zip(result.decision_points, label_replay(result, END, 120))
    }
    at = lambda s: (T0 + timedelta(seconds=s)).replace(tzinfo=timezone.utc)  # noqa: E731
    assert labels[("post_event", 0, at(0))].value == 1  # 다음 진전은 03:00 — 120초 밖
    assert labels[("post_event", 2, at(90))].value == 0  # 90초 뒤 정답
    assert (
        labels[("post_event", 4, at(300))].value == 1
    )  # 05:00 → 07:00 진전 없음, 관측 끝 08:00
    late = labels[("tick", 4, at(390))]  # 06:30 + 120 > 08:00
    assert late.status == "censored" and late.value is None
    assert all(
        lab.is_proxy and lab.name == "no_progress_within_120s"
        for lab in labels.values()
    )


def test_same_timestamp_next_event_goes_to_label_side(pack):
    rows = _rows()[:3]
    solved = copy.deepcopy(_rows()[3])
    solved["created_at"] = rows[2]["created_at"]  # 세 번째 오답과 같은 시각에 정답
    result = _replay(pack, rows + [solved])
    point = _post(result, 2)
    assert solved["client_event_id"] not in {
        r.client_event_id for r in point.context.recent_interactions
    }
    assert (
        label_replay(result, END, 120)[result.decision_points.index(point)].value == 0
    )


def test_horizon_is_configurable():
    assert proxy_label_name(120) == "no_progress_within_120s"
    assert proxy_label_name(60) == "no_progress_within_60s"


def test_help_annotation_contract():
    base = {
        "annotation_id": "a1",
        "play_session_id": SESSION,
        "decision_at": "2026-10-24T03:01:30+00:00",
        "needs_help": True,
        "confidence": "medium",
        "method": "replay_review",
        "annotator_role": "reviewer",
        "annotated_at": "2026-10-25T00:00:00+00:00",
    }
    HelpAnnotation.model_validate(base)
    with pytest.raises(ValidationError):
        HelpAnnotation.model_validate(base | {"needs_help": None})  # 보류인데 확신도
    with pytest.raises(ValidationError):
        HelpAnnotation.model_validate(
            base | {"annotated_at": "2026-10-24T00:00:00+00:00"}
        )


# ── 재생 세부 ────────────────────────────────────────────────
def test_legacy_row_without_state_is_skipped(pack):
    rows = _rows()
    del rows[1]["response_json"]["state"]
    result = _replay(pack, rows)
    assert result.skipped_without_state == 1
    assert not [p for p in result.decision_points if p.event_index == 1]
    assert len(result.timeline) == 5  # 라벨 계산에는 남는다


def test_duplicate_event_dropped(pack):
    rows = _rows()
    result = _replay(pack, rows + [copy.deepcopy(rows[0])])
    assert result.duplicates_dropped == 1 and len(result.timeline) == 5


def test_legacy_state_change_format(pack):
    rows = _rows()
    rows[3]["response_json"]["state_changes"] = [
        {"type": "puzzle_completed", "target_id": "PUZZLE_DRAWER"}
    ]
    record = _replay(pack, rows).timeline[3]
    assert record.state_changes[0].target_id == "PUZZLE_DRAWER"


def test_replay_is_deterministic(pack):
    first = [p.context.model_dump_json() for p in _replay(pack).decision_points]
    second = [p.context.model_dump_json() for p in _replay(pack).decision_points]
    assert first == second


def test_unobservable_sources_are_never_zero(pack):
    # 원천이 없는 특성이 0 으로 채워지면 "없음"과 "0번"이 섞인다
    no_source = {
        "target_hint_level",
        "since_last_npc_utterance_sec",
        "npc_max_hint_level_on_target",
        "inspected_objects_since_progress",
        "zone_dwell_sec",
    }
    for key in (AnswerFingerprinter(KEY), None):
        for vector in replay_features(_replay(pack, fingerprinter=key), pack):
            row = vector.model_row()
            for name in no_source:
                assert row[name] is None and row[f"{name}__known"] == 0, name
            if key is None and vector.values["target_attempt_count"]:
                assert row["target_repeat_wrong_max"] is None
            if vector.status["since_last_progress_sec"] == "unobservable":
                assert row["since_last_progress_sec"] is None
