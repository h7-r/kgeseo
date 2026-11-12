"""관리자 API v0.2 2단계(11/12 해랑) — DB 없이 보는 것: 게임 집계 규칙 · 달 경계 · 권한 · `invalid_query`.

실제 집계는 격리 MySQL 검사(`tests/test_admin_api_mysql.py`)에 붙인다.
"""

from datetime import date, datetime, timedelta

import pytest

from app.main import app
from app.models.app_user import AppUser
from app.services.admin_query import kst_today
from app.services.admin_stats import (
    FUNNEL_PHASES,
    OBJECTIVE_STAGE,
    STAGE_END,
    STAGE_OBJECTIVES,
    GameEvent,
    aggregate_game,
    guest_links,
    judge_of,
    kst_days,
    month_firsts,
    next_month_first,
    person_key,
    previous_month_first,
)
from app.services.user_session import current_user

NEW_ROUTES = [
    "/api/v1/admin/stats/traffic",
    "/api/v1/admin/stats/active-sessions",
    "/api/v1/admin/stats/members",
    "/api/v1/admin/stats/game",
    "/api/v1/admin/security/summary",
]


def as_user(role: str) -> None:
    user = AppUser(
        id="00000000-0000-4000-8000-000000000001",
        email="a@example.com",
        nickname="가나",
        role=role,
    )
    app.dependency_overrides[current_user] = lambda: user


@pytest.fixture(autouse=True)
def clear_user_override():
    yield
    app.dependency_overrides.pop(current_user, None)


# --- 스테이지 표는 objectives.ts 와 같아야 한다 ---


def test_stage_table_covers_every_objective_once():
    listed = [o for objectives in STAGE_OBJECTIVES.values() for o in objectives]
    assert len(listed) == len(set(listed))
    for stage, end in STAGE_END.items():
        assert OBJECTIVE_STAGE[end] == stage


def test_judge_kinds():
    assert judge_of("P01") == "server"
    assert judge_of("P07") == "screen"
    assert judge_of("S1_FIRE") == "step"


def test_person_key_prefers_member_then_guest_then_tab():
    assert person_key("u1", "g1", "t1") == "u:u1"
    assert person_key(None, "g1", "t1") == "g:g1"
    assert person_key(None, None, "t1") == "t:t1"
    assert person_key(None, None, None) == "t:?"


def test_guest_who_later_logged_in_counts_as_that_member():
    # guest_session_transfers: (게스트, 회원). 로그인 전 게스트 기록을 그 회원으로 센다
    transfers = [("g1", "u1"), ("g2", "u2"), ("g2", "u2"), ("g3", "u3"), ("g3", "u4")]
    links = guest_links(transfers)
    assert links == {
        "g1": "u1",
        "g2": "u2",
    }  # g3 는 회원 둘에 걸려 임의로 합치지 않는다
    assert person_key(None, "g1", None, links) == "u:u1"
    assert person_key(None, "g3", None, links) == "g:g3"
    assert (
        person_key(None, "g9", None, links) == "g:g9"
    )  # 회원이 된 적 없는 게스트는 그대로
    assert person_key("u5", "g1", None, links) == "u:u5"  # 회원 id 가 있으면 그게 우선
    assert person_key(None, "g1", None, None) == "g:g1"  # 표가 없으면 옛 셈법
    assert guest_links([("", "u1"), ("g1", "")]) == {}


# --- 게임 집계: 사람 단위 완료 · 건수 단위 시도 ---


def ev(kind, phase, objective=None, person="u:a", run=None, at=None, data=None):
    return GameEvent(
        event_type=kind,
        phase=phase,
        objective_id=objective,
        person=person,
        run_id=run,
        at=at,
        data=data or {},
    )


def test_aggregate_counts_people_once_and_attempts_each():
    t0 = datetime(2026, 11, 12, 1, 0)
    events = [
        ev("stage_reached", "character_open"),
        ev("stage_reached", "character_open"),  # 같은 사람 두 번 → 1
        ev("stage_reached", "naju_controllable", person="u:b"),
        ev("objective_state", "available", "P01"),
        ev("objective_state", "complete", "P01"),
        ev("objective_state", "complete", "P01"),  # 같은 사람 → 완료 1
        ev(
            "objective_state",
            "complete",
            "P01",
            person="u:b",
            data={"origin": "restored"},
        ),  # 복원 → 안 센다
        ev("puzzle_attempt", "incorrect", "P01"),
        ev("puzzle_attempt", "fail", "P01"),
        ev("puzzle_attempt", "correct", "P01"),
        ev("puzzle_attempt", "sent_back", "P08", person="u:b"),  # 시도 1 · 오답 0
        ev("help_event", "request", "P01"),
        ev("help_event", "shown", "P01"),  # 요청만 센다
        ev("objective_state", "complete", "S1_SMOKE"),  # 1스테이지 완료
        ev("run_state", "start", run="r1", at=t0),
        ev("run_state", "dawn", run="r1", at=t0 + timedelta(minutes=45)),
        ev("run_state", "start", run="r2", at=t0),  # 새벽까지 못 감
    ]
    result = aggregate_game(events)
    assert result.people == 2
    assert dict(result.funnel)["character_open"] == 1
    assert dict(result.funnel)["naju_controllable"] == 1
    assert [p for p, _ in result.funnel] == list(FUNNEL_PHASES)
    stage1 = next(s for s in result.stages if s[0] == 1)
    assert stage1 == (1, 2, 1)  # 복원 완료도 「본 것」이라 진입에는 든다
    p01 = next(p for p in result.puzzles if p["objective_id"] == "P01")
    assert p01["attempts"] == 3 and p01["wrong"] == 2 and p01["hint_requests"] == 1
    assert p01["completed_people"] == 1 and p01["judge"] == "server"
    p08 = next(p for p in result.puzzles if p["objective_id"] == "P08")
    assert p08["attempts"] == 1 and p08["wrong"] == 0
    assert result.avg_completion_minutes == 45.0 and result.completed_runs == 1


def test_aggregate_empty():
    result = aggregate_game([])
    assert result.people == 0 and result.avg_completion_minutes is None
    assert all(
        entered == 0 and completed == 0 for _, entered, completed in result.stages
    )
    # 퍼즐 표는 표에 있는 목표를 0 으로라도 다 보인다
    assert {p["objective_id"] for p in result.puzzles} == set(OBJECTIVE_STAGE)


# --- 날짜 · 달 경계 ---


def test_kst_days_oldest_first():
    assert kst_days(date(2026, 11, 12), 3) == [
        date(2026, 11, 10),
        date(2026, 11, 11),
        date(2026, 11, 12),
    ]
    assert kst_days(date(2026, 11, 12), 1) == [date(2026, 11, 12)]


def test_month_helpers_cross_year():
    assert previous_month_first(date(2026, 1, 15)) == date(2025, 12, 1)
    assert next_month_first(date(2026, 12, 3)) == date(2027, 1, 1)
    assert month_firsts(date(2026, 2, 20), 3) == [
        date(2025, 12, 1),
        date(2026, 1, 1),
        date(2026, 2, 1),
    ]


# --- 권한: 매 요청 관리자 role ---


@pytest.mark.parametrize("path", NEW_ROUTES)
def test_new_routes_refuse_without_session(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", NEW_ROUTES)
def test_new_routes_refuse_normal_user(client, path, db_session):
    as_user("user")
    response = client.get(path)
    assert response.status_code == 403
    assert db_session.execute_calls == [] and db_session.added == []


# --- 쿼리 값 오류는 invalid_query ---


def future_kst() -> str:
    return (kst_today() + timedelta(days=1)).isoformat()


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/admin/stats/traffic?days=0",
        "/api/v1/admin/stats/traffic?days=93",
        "/api/v1/admin/stats/traffic?include_internal=maybe",
        "/api/v1/admin/stats/members?months=0",
        "/api/v1/admin/stats/members?months=25",
        "/api/v1/admin/stats/game?days=93",
        "/api/v1/admin/stats/game?date=2026-13-01",
    ],
)
def test_invalid_query_values(client, path, db_session):
    as_user("admin")
    response = client.get(path)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_query"
    assert db_session.execute_calls == []


def test_future_date_is_invalid(client, db_session):
    as_user("admin")
    response = client.get("/api/v1/admin/stats/traffic?date=" + future_kst())
    assert response.status_code == 422 and db_session.execute_calls == []
