"""격리 MySQL 에서 관리자 게임 통계의 사건 완주 · 4 · 5스테이지 진입(11/16 세진)을 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

실제 beta_events 행(나주가 남기는 모양 그대로)을 넣고 `GET /api/v1/admin/stats/game` 응답을 본다:
사건 완주 = run_state released · dawn(같은 회차 둘이면 한 번), S3_RIFT 완료만으로는 미완주, CLIFF progress · GUT rite = 4 · 5스테이지 진입,
include_internal=false 면 테스트 계정 기록을 뺀다, 계정에 이어지지 않는 기록은 기존대로 센다.
"""

import os
from datetime import timedelta
from uuid import uuid4

import pytest

from app.models.beta_event import BetaEvent
from app.services.admin_query import kst_day_start_utc, kst_today
from tests.test_admin_api_mysql import DAY, HOUR, get_json, mysql_run, sign_in
from tests.test_admin_is_test_mysql import SeedT

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

MINUTE = timedelta(minutes=1)


def test_case_completion_and_cliff_gut_entries_on_real_rows():
    async def scenario(sessions):
        target = kst_today() - 2 * DAY
        start = kst_day_start_utc(target)
        async with sessions() as db:
            seed = SeedT(db)
            admin = seed.user("운영자", start - 30 * DAY, role="admin")
            finisher = seed.user("완주회원", start - 10 * DAY)
            rift_only = seed.user("틈까지만", start - 10 * DAY)
            no_start = seed.user("시작기록없음", start - 10 * DAY)
            tester = seed.tester("팀테스트", start - 10 * DAY)
            await seed.save()

        rows: list[BetaEvent] = []

        def add(
            kind, phase, at, *, user=None, objective=None, run=None, tab=None, data=None
        ):
            rows.append(
                BetaEvent(
                    event_id=str(uuid4()),
                    received_at=at,
                    client_ts=at,
                    event_type=kind,
                    phase=phase,
                    objective_id=objective,
                    run_id=run,
                    tab_id=tab,
                    page="naju",
                    app_user_id=user.id if user else None,
                    data=data or {},
                )
            )

        live = {"origin": "live"}
        t = start + HOUR
        # 완주 회원: 시작 → CLIFF 진입(두 번) → GUT 진입 → released → dawn(같은 회차)
        add("run_state", "start", t, user=finisher, run="run-fin")
        add(
            "objective_state",
            "progress",
            t + 10 * MINUTE,
            user=finisher,
            objective="CLIFF",
            data={"stage": "vision"},
        )
        add(
            "objective_state",
            "progress",
            t + 12 * MINUTE,
            user=finisher,
            objective="CLIFF",
            data={"stage": "crossed"},
        )
        add("objective_state", "rite", t + 20 * MINUTE, user=finisher, objective="GUT")
        add(
            "run_state",
            "released",
            t + 40 * MINUTE,
            user=finisher,
            run="run-fin",
            data=live,
        )
        add(
            "run_state",
            "dawn",
            t + 42 * MINUTE,
            user=finisher,
            run="run-fin",
            data=live,
        )
        # 3스테이지 끝(S3_RIFT)까지만 + CLIFF 진입, 엔딩 없음. 복원된 dawn 은 완주가 아니다
        add("run_state", "start", t, user=rift_only, run="run-rift")
        add("objective_state", "focus", t + MINUTE, user=rift_only, objective="S3_GO")
        add(
            "objective_state",
            "complete",
            t + 5 * MINUTE,
            user=rift_only,
            objective="S3_RIFT",
            data=live,
        )
        add(
            "objective_state",
            "progress",
            t + 6 * MINUTE,
            user=rift_only,
            objective="CLIFF",
        )
        add(
            "run_state",
            "dawn",
            t + 7 * MINUTE,
            user=rift_only,
            run="run-rift",
            data={"origin": "restored"},
        )
        # 시작 기록 없이 dawn — 완주로 세지만 시간은 없다
        add(
            "run_state",
            "dawn",
            t + 30 * MINUTE,
            user=no_start,
            run="run-nostart",
            data=live,
        )
        # 계정에 이어지지 않는 탭 기록 — 기존 규칙대로 센다
        add(
            "run_state",
            "released",
            t + 50 * MINUTE,
            tab="tab-x",
            run="run-tab",
            data=live,
        )
        # 내부(테스트) 계정 — 기본 조회에서 빠진다
        add("run_state", "start", t, user=tester, run="run-test")
        add("objective_state", "progress", t + MINUTE, user=tester, objective="CLIFF")
        add("objective_state", "rite", t + 2 * MINUTE, user=tester, objective="GUT")
        add(
            "run_state",
            "released",
            t + 10 * MINUTE,
            user=tester,
            run="run-test",
            data=live,
        )
        async with sessions() as db:
            db.add_all(rows)
            await db.commit()

        sign_in(admin)
        base = await get_json(
            "/api/v1/admin/stats/game", date=target.isoformat(), days=1
        )
        assert base["include_internal"] is False
        assert base["case_completed_people"] == 3  # 완주회원 · 시작기록없음 · 탭
        assert (
            base["completed_runs"] == 3
        )  # run-fin(released+dawn 한 번) · run-nostart · run-tab
        assert (
            base["avg_completion_minutes"] == 40.0
        )  # run-fin: 시작 → 가장 이른 엔딩(released)
        # 11/17 정식 집계: 임시 필드는 비고, CLIFF progress · GUT rite(과거 표식)는 stages 4 · 5 진입으로
        assert base["entry_only_stages"] == []
        stages = {s["stage"]: s for s in base["stages"]}
        assert set(stages) == {1, 2, 3, 4, 5}
        assert (stages[4]["entered"], stages[4]["completed"]) == (2, 0)
        assert (stages[5]["entered"], stages[5]["completed"]) == (1, 0)
        assert stages[3]["completed"] == 1  # S3_RIFT 는 3스테이지 완료로만
        assert base["median_completion_minutes"] == 40.0  # 같은 표본(run-fin 하나)
        assert "avg_completion_minutes" not in base["unavailable"]
        assert "median_completion_minutes" not in base["unavailable"]

        everyone = await get_json(
            "/api/v1/admin/stats/game",
            date=target.isoformat(),
            days=1,
            include_internal="true",
        )
        assert everyone["include_internal"] is True
        assert everyone["case_completed_people"] == 4
        assert everyone["completed_runs"] == 4
        assert everyone["entry_only_stages"] == []
        every_stage = {s["stage"]: s for s in everyone["stages"]}
        assert (every_stage[4]["entered"], every_stage[5]["entered"]) == (3, 2)
        # 테스트 계정 회차(start → released 10분)가 평균에 든다: (40 + 10) / 2
        assert everyone["avg_completion_minutes"] == 25.0
        # 중앙값: [40, 10] → 짝수 개 가운데 둘의 평균
        assert everyone["median_completion_minutes"] == 25.0

        # 완주가 없는 날: 평균 · 중앙값 모두 null, 사유는 두 키에 같은 코드(기존 키 그대로)
        empty_day = (target - 5 * DAY).isoformat()
        nothing = await get_json("/api/v1/admin/stats/game", date=empty_day, days=1)
        assert nothing["avg_completion_minutes"] is None
        assert nothing["median_completion_minutes"] is None
        assert nothing["unavailable"]["avg_completion_minutes"] == "no_completed_run"
        assert nothing["unavailable"]["median_completion_minutes"] == "no_completed_run"
        assert nothing["case_completed_people"] == 0 and nothing["completed_runs"] == 0
        assert nothing["entry_only_stages"] == []
        assert [
            (s["stage"], s["entered"], s["completed"]) for s in nothing["stages"]
        ] == [(stage, 0, 0) for stage in (1, 2, 3, 4, 5)]

    mysql_run(scenario)


def test_formal_stage_four_five_with_legacy_markers_on_real_rows():
    """#170 이후 정식 ID 와 그 전 CLIFF · GUT 표식이 섞인 실제 beta_events — 진입은 사람 단위 합집합, 완료는 끝 목표 complete 만."""

    async def scenario(sessions):
        target = kst_today() - 2 * DAY
        start = kst_day_start_utc(target)
        async with sessions() as db:
            seed = SeedT(db)
            admin = seed.user("운영자45", start - 30 * DAY, role="admin")
            legacy = seed.user("예전표식만", start - 10 * DAY)
            formal = seed.user("정식만", start - 10 * DAY)
            both = seed.user("둘다", start - 10 * DAY)
            torch = seed.user("횃불중", start - 10 * DAY)
            tester = seed.tester("시험45", start - 10 * DAY)
            await seed.save()

        rows: list[BetaEvent] = []

        def add(kind, phase, at, user, *, objective=None, run=None, data=None):
            rows.append(
                BetaEvent(
                    event_id=str(uuid4()),
                    received_at=at,
                    client_ts=at,
                    event_type=kind,
                    phase=phase,
                    objective_id=objective,
                    run_id=run,
                    page="naju",
                    app_user_id=user.id,
                    data=data or {},
                )
            )

        live = {"origin": "live"}
        t = start + HOUR
        # 정식 ID 이전 모양: CLIFF progress · GUT rite · CLIFF/GUT complete 만
        add(
            "objective_state",
            "progress",
            t,
            legacy,
            objective="CLIFF",
            data={"stage": "crossed"},
        )
        add(
            "objective_state",
            "complete",
            t + MINUTE,
            legacy,
            objective="CLIFF",
            data=live,
        )
        add("objective_state", "rite", t + 2 * MINUTE, legacy, objective="GUT")
        add(
            "objective_state",
            "complete",
            t + 3 * MINUTE,
            legacy,
            objective="GUT",
            data=live,
        )
        # #170 이후 정식 ID — 두 회차에 걸쳐(사람 단위로 한 명)
        for run, offset in (("run-f1", 0), ("run-f2", 30)):
            at = t + offset * MINUTE
            add("run_state", "start", at, formal, run=run)
            add("objective_state", "available", at + MINUTE, formal, objective="P14")
            add(
                "objective_state",
                "complete",
                at + 2 * MINUTE,
                formal,
                objective="P14",
                data=live,
            )
            add(
                "objective_state",
                "complete",
                at + 3 * MINUTE,
                formal,
                objective="S4_SERPENT",
                data=live,
            )
            add(
                "objective_state",
                "complete",
                at + 4 * MINUTE,
                formal,
                objective="S5_RINGS",
                data=live,
            )
            add(
                "objective_state",
                "complete",
                at + 5 * MINUTE,
                formal,
                objective="P16",
                data=live,
            )
            add("run_state", "released", at + 10 * MINUTE, formal, run=run, data=live)
            add("run_state", "dawn", at + 11 * MINUTE, formal, run=run, data=live)
        # 과거 표식 + 정식 ID 같은 사람 — 한 명으로, 4 완료(S4_SERPENT)
        add(
            "objective_state",
            "progress",
            t,
            both,
            objective="CLIFF",
            data={"stage": "vision"},
        )
        add("objective_state", "focus", t + MINUTE, both, objective="P15")
        add(
            "objective_state",
            "complete",
            t + 2 * MINUTE,
            both,
            objective="S4_SERPENT",
            data=live,
        )
        add("objective_state", "rite", t + 3 * MINUTE, both, objective="GUT")
        # 횃불 켜는 중(P16 progress · 꺼짐) — 5 진입, 미완료. available 없이 complete 된 걸음도 진입
        add("objective_state", "complete", t, torch, objective="S5_RINGS", data=live)
        add(
            "objective_state",
            "progress",
            t + MINUTE,
            torch,
            objective="P16",
            data={"lit": 2},
        )
        add(
            "puzzle_attempt",
            "fail",
            t + 2 * MINUTE,
            torch,
            objective="P16",
            data={"source": "inferred", "how": "blow_out", "lit_before": 2},
        )
        add("objective_state", "rite", t + 3 * MINUTE, torch, objective="GUT")
        # 내부(테스트) 계정 — 4 · 5 완료, 기본 조회에서 빠진다
        add("objective_state", "available", t, tester, objective="P14")
        add(
            "objective_state",
            "complete",
            t + MINUTE,
            tester,
            objective="S4_SERPENT",
            data=live,
        )
        add(
            "objective_state",
            "complete",
            t + 2 * MINUTE,
            tester,
            objective="P16",
            data=live,
        )
        async with sessions() as db:
            db.add_all(rows)
            await db.commit()

        sign_in(admin)

        def table(body):
            return {s["stage"]: (s["entered"], s["completed"]) for s in body["stages"]}

        def puzzles(body):
            return {p["objective_id"]: p for p in body["puzzles"]}

        base = await get_json(
            "/api/v1/admin/stats/game", date=target.isoformat(), days=1
        )
        assert base["entry_only_stages"] == []
        stages = table(base)
        assert set(stages) == {1, 2, 3, 4, 5}
        # 4 진입: 예전표식만 · 정식만 · 둘다 = 3(둘다는 CLIFF + P15 여도 한 명), 완료: 정식만 · 둘다 = 2(CLIFF complete 는 안 셈)
        assert stages[4] == (3, 2)
        # 5 진입: 예전표식만 · 정식만 · 둘다 · 횃불중 = 4, 완료: 정식만(P16) = 1 — GUT rite · complete · P16 progress 는 완료 아님
        assert stages[5] == (4, 1)
        rows_p = puzzles(base)
        assert {
            o: rows_p[o]["judge"]
            for o in ("P14", "P15", "P16", "S4_POUCH", "S4_SERPENT", "S5_RINGS")
        } == {
            "P14": "screen",
            "P15": "screen",
            "P16": "screen",
            "S4_POUCH": "step",
            "S4_SERPENT": "step",
            "S5_RINGS": "step",
        }
        p16 = rows_p["P16"]
        assert (p16["attempts"], p16["wrong"], p16["completed_people"]) == (1, 1, 1)
        assert rows_p["S4_SERPENT"]["completed_people"] == 2
        assert rows_p["S5_RINGS"]["completed_people"] == 2
        # 과거 표식은 그대로 남는다(퍼즐 표의 완료 행 — 화면이 숨긴다)
        assert rows_p["CLIFF"]["completed_people"] == 1
        assert rows_p["GUT"]["completed_people"] == 1
        # 사건 완주는 run_state 기준 그대로 — 정식만 한 명, 두 회차(released+dawn 은 회차당 한 번), 10분
        assert base["case_completed_people"] == 1 and base["completed_runs"] == 2
        assert base["avg_completion_minutes"] == 10.0
        assert base["median_completion_minutes"] == 10.0

        everyone = await get_json(
            "/api/v1/admin/stats/game",
            date=target.isoformat(),
            days=1,
            include_internal="true",
        )
        assert everyone["entry_only_stages"] == []
        assert table(everyone)[4] == (4, 3) and table(everyone)[5] == (5, 2)
        assert puzzles(everyone)["P16"]["completed_people"] == 2

    mysql_run(scenario)
