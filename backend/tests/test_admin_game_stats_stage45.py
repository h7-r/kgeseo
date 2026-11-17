"""관리자 게임 통계 — 4 · 5스테이지 정식 집계 전환(11/17 세진, #170 운영 기록 · 나주 ID 대응표 v1.2 9절). DB 없이.

- 정식 목표: 4 = P14 · P15 · S4_POUCH · S4_SERPENT(끝 S4_SERPENT), 5 = S5_RINGS · P16(끝 P16)
- 진입 = 그 스테이지 목표의 available · focus · complete(1~3 과 같은 규칙) ∪ 정식 ID 이전 표식(CLIFF progress · GUT rite), 사람 단위 합집합
- 완료 = 스테이지 끝 목표의 live complete 만. CLIFF · GUT complete · GUT rite · P16 progress 로는 완료가 아니다
- entry_only_stages = [](필드는 남는다). 사건 완주 · 평균 · 중앙값 · 1~3스테이지는 그대로

실제 저장 · include_internal · 응답은 `test_admin_game_stats_mysql.py`(격리 MySQL)가 본다.
"""

from datetime import datetime, timedelta

import pytest

from app.services.admin_stats import (
    OBJECTIVE_STAGE,
    STAGE_END,
    STAGE_OBJECTIVES,
    GameEvent,
    aggregate_game,
    judge_of,
)

T0 = datetime(2026, 11, 17, 1, 0)
LIVE = {"origin": "live"}


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


def puzzle(result, objective):
    return next(p for p in result.puzzles if p["objective_id"] == objective)


def test_formal_objectives_and_stage_ends_are_the_agreed_ones():
    assert STAGE_OBJECTIVES[4] == ("P14", "P15", "S4_POUCH", "S4_SERPENT")
    assert STAGE_OBJECTIVES[5] == ("S5_RINGS", "P16")
    assert (STAGE_END[4], STAGE_END[5]) == ("S4_SERPENT", "P16")
    # 1~3 은 그대로
    assert [STAGE_END[s] for s in (1, 2, 3)] == ["S1_SMOKE", "C_SOCKET", "S3_RIFT"]
    # 판정 종류: 화면 판정 퍼즐 · 판정 없는 걸음
    assert {o: judge_of(o) for o in ("P14", "P15", "P16")} == dict.fromkeys(
        ("P14", "P15", "P16"), "screen"
    )
    assert {
        o: judge_of(o) for o in ("S4_POUCH", "S4_SERPENT", "S5_RINGS")
    } == dict.fromkeys(("S4_POUCH", "S4_SERPENT", "S5_RINGS"), "step")
    # CLIFF · GUT 는 정식 목표가 아니다(어느 스테이지에도 속하지 않음)
    assert "CLIFF" not in OBJECTIVE_STAGE and "GUT" not in OBJECTIVE_STAGE


@pytest.mark.parametrize("phase", ["available", "focus"])
def test_1_formal_available_or_focus_enters_the_stage(phase):
    result = aggregate_game(
        [
            ev("objective_state", phase, "P14", person="u:a"),
            ev("objective_state", phase, "S5_RINGS", person="u:b"),
        ]
    )
    assert stages_of(result)[4] == (1, 0) and stages_of(result)[5] == (1, 0)


def test_2_completion_without_available_still_counts_as_entry():
    result = aggregate_game([ev("objective_state", "complete", "P15", data=LIVE)])
    assert stages_of(result)[4] == (1, 0)
    assert puzzle(result, "P15")["completed_people"] == 1


def test_3_s4_serpent_completes_stage_four():
    result = aggregate_game(
        [
            ev("objective_state", "available", "P14"),
            ev("objective_state", "complete", "P14", data=LIVE),
            ev("objective_state", "complete", "S4_POUCH", data=LIVE),
            ev("objective_state", "complete", "S4_SERPENT", data=LIVE),
            ev("objective_state", "complete", "S4_POUCH", person="u:b", data=LIVE),
        ]
    )
    assert stages_of(result)[4] == (2, 1)  # u:b 는 진입만(끝 걸음 미완료)


def test_4_p16_completes_stage_five():
    result = aggregate_game(
        [
            ev("objective_state", "available", "S5_RINGS"),
            ev("objective_state", "complete", "S5_RINGS", data=LIVE),
            ev("objective_state", "complete", "P16", data=LIVE),
        ]
    )
    assert stages_of(result)[5] == (1, 1)
    assert puzzle(result, "P16")["completed_people"] == 1


def test_5_p16_progress_and_blow_out_alone_are_not_completion():
    result = aggregate_game(
        [
            ev("objective_state", "focus", "P16"),
            ev("objective_state", "progress", "P16", data={"lit": 1}),
            ev("objective_state", "progress", "P16", data={"lit": 2}),
            ev(
                "puzzle_attempt",
                "fail",
                "P16",
                data={"source": "inferred", "how": "blow_out", "lit_before": 2},
            ),
            ev("objective_state", "rite", "GUT"),
        ]
    )
    assert stages_of(result)[5] == (1, 0)
    p16 = puzzle(result, "P16")
    # 횃불이 꺼진 것은 시도 · 틀림으로 센다(기존 puzzle_attempt 규칙), 완료는 아니다
    assert (p16["attempts"], p16["wrong"], p16["completed_people"]) == (1, 1, 0)


def test_6_legacy_cliff_gut_only_records_keep_their_entries():
    result = aggregate_game(
        [
            ev(
                "objective_state",
                "progress",
                "CLIFF",
                person="u:a",
                data={"stage": "vision"},
            ),
            ev("objective_state", "progress", "CLIFF", person="u:b"),
            ev("objective_state", "rite", "GUT", person="u:a"),
        ]
    )
    assert stages_of(result)[4] == (2, 0) and stages_of(result)[5] == (1, 0)


def test_7_legacy_complete_markers_never_count_as_formal_completion():
    result = aggregate_game(
        [
            ev("objective_state", "progress", "CLIFF"),
            ev("objective_state", "complete", "CLIFF", data=LIVE),
            ev("objective_state", "rite", "GUT"),
            ev("objective_state", "complete", "GUT", data=LIVE),
        ]
    )
    assert stages_of(result)[4] == (1, 0) and stages_of(result)[5] == (1, 0)
    # 표식 자체는 그대로 남는다(퍼즐 표의 완료 행 — 화면은 CLIFF · GUT 를 숨긴다)
    assert puzzle(result, "CLIFF")["completed_people"] == 1
    assert puzzle(result, "GUT")["completed_people"] == 1


def test_8_legacy_and_formal_records_of_one_person_count_once():
    result = aggregate_game(
        [
            ev("objective_state", "progress", "CLIFF"),
            ev("objective_state", "available", "P14"),
            ev("objective_state", "focus", "P15"),
            ev("objective_state", "rite", "GUT"),
            ev("objective_state", "available", "S5_RINGS"),
        ]
    )
    assert stages_of(result)[4] == (1, 0) and stages_of(result)[5] == (1, 0)


def test_9_many_runs_of_one_person_are_one_person():
    events = []
    for run in ("r1", "r2", "r3"):
        events += [
            ev("run_state", "start", run=run, at=T0),
            ev("objective_state", "available", "P14", run=run),
            ev("objective_state", "complete", "S4_SERPENT", run=run, data=LIVE),
            ev("objective_state", "complete", "P16", run=run, data=LIVE),
        ]
    result = aggregate_game(events)
    assert stages_of(result)[4] == (1, 1) and stages_of(result)[5] == (1, 1)
    assert puzzle(result, "S4_SERPENT")["completed_people"] == 1


def test_restored_completion_counts_as_entry_but_not_completion():
    """1~3 과 같은 규칙 — 복원된 complete 는 「본 것」(진입)이지만 완료로는 세지 않는다."""

    result = aggregate_game(
        [ev("objective_state", "complete", "S4_SERPENT", data={"origin": "restored"})]
    )
    assert stages_of(result)[4] == (1, 0)


def test_10_entry_only_stages_is_always_empty():
    assert aggregate_game([]).entry_only_stages == []
    assert (
        aggregate_game(
            [
                ev("objective_state", "progress", "CLIFF"),
                ev("objective_state", "rite", "GUT"),
            ]
        ).entry_only_stages
        == []
    )


def test_11_stages_one_to_three_unchanged_by_late_events():
    early = [
        ev("objective_state", "available", "P01"),
        ev("objective_state", "complete", "S1_SMOKE", data=LIVE),
        ev("objective_state", "available", "P03", person="u:b"),
        ev("objective_state", "complete", "C_SOCKET", person="u:b", data=LIVE),
        ev("objective_state", "complete", "S3_RIFT", person="u:c", data=LIVE),
    ]
    late = [
        ev("objective_state", "available", "P14", person="u:c"),
        ev("objective_state", "complete", "S4_SERPENT", person="u:c", data=LIVE),
        ev("objective_state", "complete", "P16", person="u:c", data=LIVE),
        ev("objective_state", "progress", "CLIFF", person="u:d"),
    ]
    assert aggregate_game(early).stages[:3] == aggregate_game(early + late).stages[:3]
    assert [stage for stage, _, _ in aggregate_game(early).stages] == [1, 2, 3, 4, 5]


def test_12_13_endings_average_and_median_unchanged_by_stage_rules():
    endings = [
        ev("run_state", "start", person="u:a", run="ra", at=T0),
        ev(
            "run_state",
            "released",
            person="u:a",
            run="ra",
            at=T0 + timedelta(minutes=40),
            data=LIVE,
        ),
        ev(
            "run_state",
            "dawn",
            person="u:a",
            run="ra",
            at=T0 + timedelta(minutes=42),
            data=LIVE,
        ),
        ev("run_state", "start", person="u:b", run="rb", at=T0),
        ev(
            "run_state",
            "dawn",
            person="u:b",
            run="rb",
            at=T0 + timedelta(minutes=20),
            data=LIVE,
        ),
    ]
    stage_events = [
        ev(
            "objective_state", "complete", "P16", person="u:c", data=LIVE
        ),  # 엔딩 없이 P16 만
        ev("objective_state", "rite", "GUT", person="u:a"),
        ev("objective_state", "complete", "S4_SERPENT", person="u:b", data=LIVE),
    ]
    base = aggregate_game(endings)
    mixed = aggregate_game(endings + stage_events)
    for result in (base, mixed):
        assert result.case_completed_people == 2  # released+dawn 한 회차는 한 번
        assert result.completed_runs == 2
        assert result.avg_completion_minutes == 30.0  # (40 + 20) / 2, 이른 엔딩
        assert result.median_completion_minutes == 30.0
    # P16 완료는 5스테이지 완료일 뿐 사건 완주가 아니다(사건 완주는 run_state released · dawn)
    assert stages_of(mixed)[5] == (2, 1)


def test_puzzle_table_has_the_six_formal_objectives_with_the_same_shape():
    result = aggregate_game(
        [
            ev("puzzle_attempt", "fail", "P14", data={"source": "inferred"}),
            ev("help_event", "request", "P15"),
            ev("puzzle_attempt", "incorrect", "P01"),
        ]
    )
    for objective in ("P14", "P15", "S4_POUCH", "S4_SERPENT", "S5_RINGS", "P16"):
        row = puzzle(result, objective)
        assert set(row) == {
            "objective_id",
            "judge",
            "attempts",
            "wrong",
            "hint_requests",
            "completed_people",
        }
    assert (puzzle(result, "P14")["attempts"], puzzle(result, "P14")["wrong"]) == (1, 1)
    assert puzzle(result, "P15")["hint_requests"] == 1
    assert (puzzle(result, "P01")["attempts"], puzzle(result, "P01")["wrong"]) == (1, 1)
    # 표 차례: 1~3 목표 뒤에 4 · 5 목표
    ids = [p["objective_id"] for p in result.puzzles]
    assert ids.index("S3_RIFT") < ids.index("P14") < ids.index("P16")
