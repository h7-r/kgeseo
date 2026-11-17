"""관리자 게임 통계 — 사건 완주(released · dawn) · 4 · 5스테이지 진입(11/16 세진, 미르 · 해랑 승인 방향). DB 없이.

실제 저장 · include_internal · 응답은 `test_admin_game_stats_mysql.py`(격리 MySQL)가 본다.
"""

from datetime import datetime, timedelta

from app.services.admin_stats import (
    ENDING_PHASES,
    LEGACY_STAGE_ENTRY,
    STAGE_END,
    GameEvent,
    aggregate_game,
)

T0 = datetime(2026, 11, 16, 1, 0)


def ev(kind, phase=None, objective=None, *, person="u:a", run=None, at=None, data=None):
    return GameEvent(
        event_type=kind,
        phase=phase,
        objective_id=objective,
        person=person,
        run_id=run,
        at=at,
        data=data or {},
    )


def stages_of(result):
    return {stage: (entered, completed) for stage, entered, completed in result.stages}


def test_rules_are_the_agreed_ones():
    assert ENDING_PHASES == {"released", "dawn"}
    # 11/11~ 굵은 표식은 4 · 5 진입 근거로만(11/17 정식 집계 전환)
    assert LEGACY_STAGE_ENTRY == {("CLIFF", "progress"): 4, ("GUT", "rite"): 5}
    # 1~3스테이지 끝은 그대로(3 = 시공간 틈은 스테이지 완료일 뿐), 4 · 5 는 구렁이상 틈 · 다섯 횃불
    assert STAGE_END == {
        1: "S1_SMOKE",
        2: "C_SOCKET",
        3: "S3_RIFT",
        4: "S4_SERPENT",
        5: "P16",
    }


def test_rift_without_ending_is_not_case_completion():
    result = aggregate_game(
        [
            ev("run_state", "start", run="r1", at=T0),
            ev("objective_state", "available", "S3_GO"),
            ev("objective_state", "complete", "S3_RIFT", data={"origin": "live"}),
        ]
    )
    assert stages_of(result)[3] == (1, 1)  # 3스테이지 완료는 그대로 센다
    assert result.case_completed_people == 0
    assert result.completed_runs == 0 and result.avg_completion_minutes is None


def test_released_and_dawn_each_count_as_completion():
    result = aggregate_game(
        [
            ev("run_state", "start", person="u:a", run="ra", at=T0),
            ev(
                "run_state",
                "released",
                person="u:a",
                run="ra",
                at=T0 + timedelta(minutes=30),
                data={"origin": "live"},
            ),
            ev("run_state", "start", person="u:b", run="rb", at=T0),
            ev(
                "run_state",
                "dawn",
                person="u:b",
                run="rb",
                at=T0 + timedelta(minutes=50),
                data={"origin": "live"},
            ),
        ]
    )
    assert result.case_completed_people == 2
    assert result.completed_runs == 2
    assert result.avg_completion_minutes == 40.0


def test_released_then_dawn_in_one_run_counts_once_from_the_earliest_ending():
    result = aggregate_game(
        [
            ev("run_state", "start", run="r1", at=T0),
            ev(
                "run_state",
                "released",
                run="r1",
                at=T0 + timedelta(minutes=40),
                data={"origin": "live"},
            ),
            ev(
                "run_state",
                "dawn",
                run="r1",
                at=T0 + timedelta(minutes=42),
                data={"origin": "live"},
            ),
            # 같은 기록이 다시 와도(재전송 · 다른 탭) 한 번
            ev(
                "run_state",
                "dawn",
                run="r1",
                at=T0 + timedelta(minutes=43),
                data={"origin": "live"},
            ),
        ]
    )
    assert result.case_completed_people == 1
    assert result.completed_runs == 1
    assert result.avg_completion_minutes == 40.0


def test_same_person_two_completed_runs():
    result = aggregate_game(
        [
            ev("run_state", "released", run="r1", at=T0),
            ev("run_state", "released", run="r2", at=T0 + timedelta(hours=1)),
        ]
    )
    assert result.case_completed_people == 1  # 사람
    assert result.completed_runs == 2  # 회차


def test_ending_without_start_counts_but_has_no_duration():
    result = aggregate_game(
        [ev("run_state", "dawn", run="r1", at=T0, data={"origin": "live"})]
    )
    assert result.completed_runs == 1 and result.case_completed_people == 1
    assert result.avg_completion_minutes is None


def test_unidentifiable_or_non_live_endings():
    result = aggregate_game(
        [
            # run_id 없음 — 사람으로는 세지만 회차 · 시간은 셀 수 없다(기존 규칙)
            ev("run_state", "released", person="u:a", run=None, at=T0),
            # 시각 없음 — 회차로는 센다, 시간은 못 잰다
            ev("run_state", "dawn", person="u:b", run="rb", at=None),
            # 라이브가 아닌 기록(복원 등)은 완주로 세지 않는다
            ev(
                "run_state",
                "dawn",
                person="u:c",
                run="rc",
                at=T0,
                data={"origin": "restored"},
            ),
            # 엔딩이 아닌 run_state
            ev("run_state", "restart", person="u:d", run="rd", at=T0),
            ev("run_state", "quit", person="u:d", run="rd", at=T0),
            ev("run_state", None, person="u:d", run="rd", at=T0),
        ]
    )
    assert result.case_completed_people == 2
    assert result.completed_runs == 1
    assert result.avg_completion_minutes is None


def test_cliff_and_gut_entries_are_people_once():
    result = aggregate_game(
        [
            ev(
                "objective_state",
                "progress",
                "CLIFF",
                person="u:a",
                data={"stage": "vision"},
            ),
            ev(
                "objective_state",
                "progress",
                "CLIFF",
                person="u:a",
                data={"stage": "crossed"},
            ),
            ev(
                "objective_state", "progress", "CLIFF", person="u:b"
            ),  # data.stage 없음 → 그래도 진입
            ev("objective_state", "rite", "GUT", person="u:a"),
            ev("objective_state", "rite", "GUT", person="u:a"),
        ]
    )
    # 정식 stages 4 · 5 의 진입으로 센다(사람 단위), 완료는 아니다. 임시 필드는 []
    assert stages_of(result)[4] == (2, 0) and stages_of(result)[5] == (1, 0)
    assert result.entry_only_stages == []
    # 1~3스테이지는 영향 없음
    assert all(stages_of(result)[stage] == (0, 0) for stage in (1, 2, 3))


def test_wrong_shapes_do_not_count_as_stage_entries():
    result = aggregate_game(
        [
            ev("objective_state", "rite", "CLIFF"),
            ev("objective_state", "progress", "GUT"),
            ev("objective_state", "progress", "cliff"),
            ev("objective_state", "progress", None),
            ev("puzzle_attempt", "progress", "CLIFF"),
            ev("run_state", "rite", "GUT", run="r1", at=T0),
        ]
    )
    assert stages_of(result)[4] == (0, 0) and stages_of(result)[5] == (0, 0)


def test_stages_one_to_three_unchanged_with_new_events_present():
    events = [
        ev("objective_state", "available", "P01"),
        ev("objective_state", "complete", "S1_SMOKE"),
        ev("objective_state", "available", "P03", person="u:b"),
        ev("objective_state", "complete", "C_SOCKET", person="u:b"),
        ev("objective_state", "focus", "S3_GO", person="u:c"),
    ]
    base = aggregate_game(events)
    with_new = aggregate_game(
        events
        + [
            ev("objective_state", "progress", "CLIFF", person="u:c"),
            ev("objective_state", "rite", "GUT", person="u:c"),
            ev("run_state", "dawn", person="u:c", run="r", at=T0),
        ]
    )
    assert base.stages[:3] == with_new.stages[:3]
    assert stages_of(base) == {
        1: (1, 1),
        2: (1, 1),
        3: (1, 0),
        4: (0, 0),
        5: (0, 0),
    }


def test_empty():
    result = aggregate_game([])
    assert result.case_completed_people == 0 and result.completed_runs == 0
    assert result.entry_only_stages == []
    assert stages_of(result) == {stage: (0, 0) for stage in (1, 2, 3, 4, 5)}


# --- 중앙값(평균과 같은 표본) ---


def runs(*minutes, prefix="r"):
    """회차마다 start → released(minutes 분 뒤)."""

    events = []
    for index, value in enumerate(minutes):
        run = f"{prefix}{index}"
        person = f"u:{prefix}{index}"
        events.append(ev("run_state", "start", person=person, run=run, at=T0))
        events.append(
            ev(
                "run_state",
                "released",
                person=person,
                run=run,
                at=T0 + timedelta(minutes=value),
                data={"origin": "live"},
            )
        )
    return events


def test_median_single_run():
    result = aggregate_game(runs(37))
    assert result.median_completion_minutes == 37.0 == result.avg_completion_minutes


def test_median_odd_count_is_the_middle_value():
    result = aggregate_game(runs(50, 10, 30))
    assert result.median_completion_minutes == 30.0
    assert result.avg_completion_minutes == 30.0


def test_median_even_count_is_mean_of_the_two_middle_values():
    result = aggregate_game(runs(10, 40, 20, 30))
    assert result.median_completion_minutes == 25.0


def test_median_resists_an_extreme_run_while_average_does_not_change_meaning():
    result = aggregate_game(runs(30, 32, 34, 600))
    assert result.median_completion_minutes == 33.0
    assert result.avg_completion_minutes == 174.0  # (30+32+34+600)/4 — 평균 규칙 그대로


def test_median_uses_minutes_with_one_decimal_like_average():
    events = runs(10) + [
        ev("run_state", "start", person="u:x", run="rx", at=T0),
        ev(
            "run_state",
            "dawn",
            person="u:x",
            run="rx",
            at=T0 + timedelta(minutes=10, seconds=50),
            data={"origin": "live"},
        ),
    ]
    result = aggregate_game(events)
    # 표본 [10.0, 10.8333…] → 중앙값 10.41666… → 10.4, 평균도 같은 값
    assert result.median_completion_minutes == 10.4 == result.avg_completion_minutes


def test_median_sample_excludes_runs_without_start_and_negative_durations():
    events = runs(20) + [
        # 시작 기록 없는 엔딩 회차 — 완주 회차에는 들지만 시간 표본에는 없다
        ev("run_state", "dawn", person="u:n", run="rn", at=T0, data={"origin": "live"}),
        # 엔딩이 시작보다 앞선(음수) 회차 — 시간 표본에서 뺀다
        ev("run_state", "start", person="u:m", run="rm", at=T0 + timedelta(hours=2)),
        ev(
            "run_state",
            "released",
            person="u:m",
            run="rm",
            at=T0 + timedelta(hours=1),
            data={"origin": "live"},
        ),
    ]
    result = aggregate_game(events)
    assert result.completed_runs == 3
    assert result.median_completion_minutes == 20.0 == result.avg_completion_minutes


def test_median_released_and_dawn_in_one_run_use_the_earliest_ending():
    events = [
        ev("run_state", "start", run="r1", at=T0),
        ev(
            "run_state",
            "dawn",
            run="r1",
            at=T0 + timedelta(minutes=50),
            data={"origin": "live"},
        ),
        ev(
            "run_state",
            "released",
            run="r1",
            at=T0 + timedelta(minutes=45),
            data={"origin": "live"},
        ),
        ev("run_state", "start", person="u:b", run="r2", at=T0),
        ev(
            "run_state",
            "released",
            person="u:b",
            run="r2",
            at=T0 + timedelta(minutes=15),
            data={"origin": "live"},
        ),
    ]
    result = aggregate_game(events)
    assert result.median_completion_minutes == 30.0  # [45, 15] → (15+45)/2
    assert result.completed_runs == 2


def test_median_null_when_no_valid_duration():
    for events in (
        [],
        [
            ev("run_state", "dawn", run="r1", at=T0, data={"origin": "live"})
        ],  # 시작 없음
        [ev("run_state", "start", run="r1", at=T0)],  # 엔딩 없음
    ):
        result = aggregate_game(events)
        assert result.median_completion_minutes is None
        assert result.avg_completion_minutes is None


def test_average_is_unchanged_by_adding_median():
    """평균 값은 중앙값 추가 전 규칙과 같다(가장 이른 엔딩 · 같은 표본)."""

    result = aggregate_game(
        [
            ev("run_state", "start", person="u:a", run="ra", at=T0),
            ev(
                "run_state",
                "released",
                person="u:a",
                run="ra",
                at=T0 + timedelta(minutes=30),
                data={"origin": "live"},
            ),
            ev("run_state", "start", person="u:b", run="rb", at=T0),
            ev(
                "run_state",
                "dawn",
                person="u:b",
                run="rb",
                at=T0 + timedelta(minutes=50),
                data={"origin": "live"},
            ),
        ]
    )
    assert result.avg_completion_minutes == 40.0
    assert result.median_completion_minutes == 40.0


# --- 4 · 5스테이지 정식 집계(11/17) — 임시 필드는 비고, 모르는 ID 는 어디에도 붙지 않는다 ---


def test_entry_only_stages_is_empty_and_unknown_ids_attach_nowhere():
    result = aggregate_game(
        [
            ev("objective_state", "progress", "CLIFF"),
            ev("objective_state", "rite", "GUT"),
            # 계약에 없는 ID(가상) — 어떤 스테이지에도 붙지 않는다
            ev("objective_state", "complete", "S4_UNKNOWN", data={"origin": "live"}),
            ev("objective_state", "available", "S5_UNKNOWN"),
        ]
    )
    assert result.entry_only_stages == []
    assert [stage for stage, _, _ in result.stages] == [1, 2, 3, 4, 5]
    assert stages_of(result)[4] == (1, 0) and stages_of(result)[5] == (1, 0)
