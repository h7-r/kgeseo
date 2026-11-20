"""격리 MySQL 에서 문의 접수 응답의 `is_member` 를 본다(11/20 — FE 요청 검토 4절).

화면은 로그인으로 보여도 서버 세션이 만료됐으면 문의는 비회원으로 저장된다. 응답의 `is_member` 는 화면 표시 · 요청 본문이
아니라 **실제 저장된 `inquiries.app_user_id`** 로 정해져야 한다. 그래서 의존성을 갈아 끼우지 않고 진짜 세션 쿠키로 부른다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`).
"""

import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.main import app
from app.models.account_data import UserSession
from app.models.inquiry import Inquiry
from app.services import user_session
from app.services.local_auth import utc_now
from app.services.request_rate_limit import (
    SlidingWindowLimiter,
    get_request_rate_limiter,
)
from app.services.user_session import optional_current_user
from tests.test_admin_api_mysql import DAY, Seed, client, mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

ORIGIN = {"Origin": "http://localhost:5173"}
PATH = "/api/v1/inquiries"
RESPONSE_KEYS = {"id", "number", "created_at", "is_member"}


def payload(title: str, email: str) -> dict:
    return {"category": "account", "title": title, "body": "본문", "email": email}


async def submit(title: str, email: str, token: str | None) -> httpx.Response:
    async with client() as http:
        if token is not None:
            http.cookies.set(user_session.SESSION_COOKIE, token)
        return await http.post(PATH, json=payload(title, email), headers=ORIGIN)


def session_row(user_id: str, token: str, *, expires_in, revoked: bool = False):
    now = utc_now()
    return UserSession(
        id=str(uuid4()),
        app_user_id=user_id,
        token_hash=user_session.hash_session_token(token),
        created_at=now - DAY,
        expires_at=now + expires_in,
        revoked_at=now if revoked else None,
    )


def test_is_member_follows_the_stored_account_link_not_the_client():
    # 다른 시험이 남긴 의존성 바꿔치기가 있으면 진짜 쿠키 판정을 보지 못한다
    app.dependency_overrides.pop(optional_current_user, None)
    limiter = SlidingWindowLimiter()
    app.dependency_overrides[get_request_rate_limiter] = lambda: limiter

    async def scenario(sessions):
        async with sessions() as db:
            seed = Seed(db)
            member = seed.user("문의회원", utc_now() - 10 * DAY)
            await seed.save()
            db.add_all(
                [
                    session_row(member.id, "live-token", expires_in=DAY),
                    # 화면에는 로그인 표시가 남아 있지만 서버 세션은 끝난 경우들
                    session_row(member.id, "expired-token", expires_in=-DAY),
                    session_row(
                        member.id, "revoked-token", expires_in=DAY, revoked=True
                    ),
                ]
            )
            await db.commit()

        cases = [
            ("유효 세션", "live-token", True),
            ("쿠키 없음", None, False),
            ("만료 세션", "expired-token", False),
            ("폐기 세션", "revoked-token", False),
            ("모르는 토큰", "unknown-token", False),
        ]
        answers = {}
        for title, token, expected in cases:
            # 비회원 경우에도 회원 이메일을 적는다 — 이메일이 같아도 회원 연결로 보지 않는다
            response = await submit(title, member.email, token)
            assert response.status_code == 201, (title, response.text)
            body = response.json()
            # 4 · 6: 기존 필드 유지, 새 필드는 is_member 하나 — 회원 id · 이메일 · 닉네임 · 세션 값은 나가지 않는다
            assert set(body) == RESPONSE_KEYS, title
            assert body["is_member"] is expected, title
            assert (
                body["number"].startswith("INQ-") and body["id"] and body["created_at"]
            )
            for secret in (member.id, member.email, member.nickname, token or "-"):
                if secret != "-":
                    assert secret not in response.text, title
            # 접수가 세션을 바꾸지 않는다(인증 정책 그대로 — 만료 세션도 401 · 쿠키 삭제 없이 비회원 접수)
            assert "set-cookie" not in response.headers, title
            assert response.headers["cache-control"] == "no-store"
            answers[body["id"]] = (title, expected)

        # 5: 응답과 DB 저장 결과가 같다
        async with sessions() as db:
            rows = (await db.execute(select(Inquiry))).scalars().all()
        assert {row.id for row in rows} == set(answers)
        for row in rows:
            title, expected = answers[row.id]
            assert row.title == title
            assert (row.app_user_id is not None) is expected, title
            if expected:
                assert row.app_user_id == member.id

    try:
        mysql_run(scenario)
    finally:
        app.dependency_overrides.pop(get_request_rate_limiter, None)
