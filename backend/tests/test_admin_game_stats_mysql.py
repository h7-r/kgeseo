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
        assert base["entry_only_stages"] == [
            {"stage": 4, "entered": 2},
            {"stage": 5, "entered": 1},
        ]
        stages = {s["stage"]: s for s in base["stages"]}
        assert set(stages) == {1, 2, 3}  # 기존 1~3 그대로
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
        assert everyone["entry_only_stages"] == [
            {"stage": 4, "entered": 3},
            {"stage": 5, "entered": 2},
        ]
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
        # 임시 집계 필드는 세부 목표가 없는 지금 빈 배열이 아니다
        assert nothing["entry_only_stages"] == [
            {"stage": 4, "entered": 0},
            {"stage": 5, "entered": 0},
        ]

    mysql_run(scenario)
