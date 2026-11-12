"""관리자 API v0.2 1단계(11/12) — DB 없이 보는 것: KST 경계 · 이메일 가림 · 검색어 규칙 · 권한 · `invalid_query`.

실제 집계 · 검색 · 감사 기록은 `tests/test_admin_api_mysql.py`(격리 MySQL)가 본다.
"""

from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.main import app
from app.models.app_user import AppUser
from app.services.admin_query import (
    kst_day_start_utc,
    kst_range,
    kst_today,
    like_contains,
    mask_email,
    parse_user_search,
)
from app.services.user_session import current_user

NEW_ROUTES = ["/api/v1/admin/stats/summary", "/api/v1/admin/audit-logs"]


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


# --- KST 날짜 → UTC 범위(§2.4) ---


def test_kst_day_is_utc_15_to_15():
    assert kst_day_start_utc(date(2026, 11, 14)) == datetime(2026, 11, 13, 15, 0)
    assert kst_range(date(2026, 11, 14), date(2026, 11, 14)) == (
        datetime(2026, 11, 13, 15, 0),
        datetime(2026, 11, 14, 15, 0),
    )


def test_kst_today_turns_at_15_utc():
    assert kst_today(datetime(2026, 11, 13, 14, 59, 59, 999999)) == date(2026, 11, 13)
    assert kst_today(datetime(2026, 11, 13, 15, 0)) == date(2026, 11, 14)


def test_kst_month_and_year_boundaries():
    # 그 달 1일 00:00 KST ~ 기준일 끝(다음 날 00:00 KST)
    assert kst_range(date(2026, 11, 1), date(2026, 11, 14)) == (
        datetime(2026, 10, 31, 15, 0),
        datetime(2026, 11, 14, 15, 0),
    )
    assert kst_range(date(2027, 1, 1), date(2027, 1, 1))[0] == datetime(
        2026, 12, 31, 15, 0
    )
    # 최근 30일(기준일 포함 30개 날짜)
    first = date(2026, 11, 14) - timedelta(days=29)
    assert kst_range(first, date(2026, 11, 14))[0] == datetime(2026, 10, 15, 15, 0)


# --- 목록 이메일 가림(§2.5 — 화면 maskEmail 과 같은 결과) ---


@pytest.mark.parametrize(
    ("email", "masked"),
    [
        ("minsoo@example.com", "mi***@example.com"),
        ("abc@example.com", "ab***@example.com"),
        ("ab@example.org", "a***@example.org"),
        ("a@example.org", "a***@example.org"),
        ("no-at-sign", "***"),
        ("@example.com", "***"),
        ("a@b@example.com", "a@***@example.com"),
    ],
)
def test_mask_email(email, masked):
    assert mask_email(email) == masked


# --- 검색어(§3.1 q) — 닉네임 부분 일치 · 이메일 완전 일치만 ---


def test_search_without_at_is_nickname_only():
    search = parse_user_search("  가나다 ")
    assert search.nickname == "가나다" and search.email is None


def test_search_with_at_is_exact_normalized_email_only():
    search = parse_user_search("  MinSoo@Example.COM ")
    assert search.email == "minsoo@example.com" and search.nickname is None
    # 도메인 조각도 이메일 완전 일치로만 본다 — 부분 검색이 되지 않는다
    partial = parse_user_search("@example.com")
    assert partial.email == "@example.com" and partial.nickname is None


@pytest.mark.parametrize("term", ["", "   ", "x" * 65])
def test_search_length_is_limited(term):
    with pytest.raises(HTTPException) as caught:
        parse_user_search(term)
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "invalid_query"


def test_like_pattern_escapes_wildcards():
    assert like_contains("a%b_c\\d") == "%a\\%b\\_c\\\\d%"


# --- 권한: 매 요청 관리자 role ---


@pytest.mark.parametrize("path", NEW_ROUTES)
def test_new_routes_refuse_without_session(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", [*NEW_ROUTES, "/api/v1/admin/users?q=가나"])
def test_new_routes_refuse_normal_user(client, path, db_session):
    as_user("user")
    response = client.get(path)
    assert response.status_code == 403
    assert response.json() == {"detail": "Admin only."}
    # 막힌 요청은 DB 를 조회하지도, 감사 기록을 쓰지도 않는다
    assert db_session.execute_calls == [] and db_session.added == []


# --- 새 쿼리 값 오류는 invalid_query(입력값을 되돌려 보내지 않는다) ---


def future_kst() -> str:
    return (kst_today() + timedelta(days=1)).isoformat()


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/admin/users?q=" + "x" * 65,
        "/api/v1/admin/users?limit=51",
        "/api/v1/admin/users?limit=0",
        "/api/v1/admin/stats/summary?date=2026-13-01",
        "/api/v1/admin/stats/summary?date=20261114",
        "/api/v1/admin/stats/summary?include_internal=yes",
        "/api/v1/admin/stats/summary?date=2020-01-01",
        "/api/v1/admin/audit-logs?action=delete_user",
        "/api/v1/admin/audit-logs?target_user_id=someone@example.com",
        "/api/v1/admin/audit-logs?admin_user_id=1",
        "/api/v1/admin/audit-logs?from=2026-11-10&to=2026-11-01",
        "/api/v1/admin/audit-logs?from=2026-01-01&to=2026-11-01",
        "/api/v1/admin/audit-logs?limit=51",
        "/api/v1/admin/audit-logs?offset=-1",
    ],
)
def test_bad_queries_are_invalid_query(client, path, db_session):
    as_user("admin")
    response = client.get(path)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "invalid_query"
    assert response.headers["cache-control"] == "no-store"
    # 검증은 DB 조회 · 감사 기록보다 먼저
    assert db_session.execute_calls == [] and db_session.added == []


def test_future_stats_date_is_refused(client):
    as_user("admin")
    response = client.get(f"/api/v1/admin/stats/summary?date={future_kst()}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_query"


def test_invalid_query_does_not_echo_search_term(client):
    as_user("admin")
    secret = "victim.email.address@example.com" + "x" * 40
    response = client.get("/api/v1/admin/users", params={"q": secret})
    assert response.status_code == 422
    assert "victim" not in response.text
