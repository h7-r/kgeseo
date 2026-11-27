"""격리 MySQL 에서 비밀번호 찾기 · 변경(계약 password_reset_v0.1, 11/25)을 실제 요청으로 본다.

의존성을 갈아 끼우지 않고 진짜 가입 · 로그인 쿠키로 부른다. 메일만 `mailer.outbox` 로 받아 본다.
- 찾기: 가입 여부를 드러내지 않음(없는 · 소셜 전용 · 탈퇴 계정도 같은 답, 소셜 전용은 로그인 안내 메일 · 나머지는 메일 없음) · 재발송 대기 · 시간당 한도 ·
  새 코드가 앞 코드를 무효로 · 틀린 코드 5번이면 맞는 코드도 거절 · 만료 · 증표 한 번만 · 규칙 위반이면 증표 유지 ·
  저장되면 모든 세션 끊김 · 로그인 잠금 해제 · 옛 비밀번호 거절 · 원문 코드 · 증표는 DB 에 없음
- 변경: 틀린 지금 비밀번호(실패 집계) · 같은 비밀번호 · 규칙 위반 · 소셜 전용 403 · 이 창 세션은 남고 다른 세션만 끊김 ·
  진행 중이던 찾기 증표 무효
- 탈퇴하면 코드 행이 지워진다

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`).
"""

import asyncio
import os
import re
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import Response
from sqlalchemy import delete, func, select, text, update

from app.main import app
from app.models.account_data import LoginThrottle, UserSession
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.password_reset import PasswordResetCode
from app.services import local_auth, mailer, password_reset, user_session
from app.services.local_auth import utc_now
from app.services.request_rate_limit import (
    SlidingWindowLimiter,
    get_request_rate_limiter,
)
from app.services.user_session import current_user
from tests.test_admin_api_mysql import mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

ORIGIN = {"Origin": "http://localhost:5173"}
PASSWORD = "Zebra-Moon-2491"
NEW_PASSWORD = "Harbor-Lamp-7316"
REQUEST = "/api/v1/auth/password-reset/request"
VERIFY = "/api/v1/auth/password-reset/verify"
COMPLETE = "/api/v1/auth/password-reset/complete"
CHANGE = "/api/v1/me/password"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=ORIGIN,
    )


@pytest.fixture(autouse=True)
def real_auth_and_outbox(monkeypatch):
    # 다른 시험이 남긴 세션 바꿔치기가 있으면 진짜 쿠키 판정을 보지 못한다
    app.dependency_overrides.pop(current_user, None)
    limiter = SlidingWindowLimiter()
    app.dependency_overrides[get_request_rate_limiter] = lambda: limiter
    sent: list[mailer.Mail] = []
    monkeypatch.setattr(mailer, "outbox", sent.append)
    yield sent
    app.dependency_overrides.pop(get_request_rate_limiter, None)


async def register(http: httpx.AsyncClient, email: str, nickname: str) -> None:
    response = await http.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": PASSWORD,
            "nickname": nickname,
            "consent": {"terms": True, "privacy": True, "age": True},
        },
    )
    assert response.status_code == 201, response.text


async def login(email: str, password: str) -> httpx.Response:
    async with client() as http:
        return await http.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        )


def code_in(mail: mailer.Mail) -> str:
    found = re.findall(r"\b\d{6}\b", mail.text)
    assert len(found) == 1, mail.text
    return found[0]


async def age_codes(sessions, user_id: str, by: timedelta) -> None:
    """재발송 대기를 지나게 한다(시각을 뒤로 민다)."""
    async with sessions() as db:
        await db.execute(
            text(
                "UPDATE password_reset_codes SET created_at = "
                "DATE_SUB(created_at, INTERVAL :sec SECOND) WHERE app_user_id = :user"
            ),
            {"sec": int(by.total_seconds()), "user": user_id},
        )
        await db.commit()


def test_password_reset_flow(real_auth_and_outbox):
    sent = real_auth_and_outbox

    async def scenario(sessions):
        email = f"{uuid4().hex[:10]}@example.com"
        async with client() as member, client() as other_device:
            await register(member, email, "찾기회원")
            assert (
                await other_device.post(
                    "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
                )
            ).status_code == 200
            async with sessions() as db:
                user = await db.scalar(select(AppUser).where(AppUser.email == email))

            # 가입 여부를 드러내지 않는다 — 같은 답, 메일은 가입된 이메일에만
            async with client() as anon:
                known = await anon.post(REQUEST, json={"email": email.upper()})
                unknown = await anon.post(REQUEST, json={"email": "nobody@example.com"})
            assert known.status_code == unknown.status_code == 200
            assert known.json() == unknown.json() == {"status": "accepted"}
            assert known.headers["cache-control"] == "no-store"
            assert [mail.to for mail in sent] == [email]
            first_code = code_in(sent[0])

            # 60초 안 재요청은 같은 답, 메일 없음
            async with client() as anon:
                again = await anon.post(REQUEST, json={"email": email})
            assert again.status_code == 200 and len(sent) == 1

            # 새 코드를 받으면 앞 코드는 못 쓴다
            await age_codes(sessions, user.id, timedelta(seconds=61))
            async with client() as anon:
                assert (
                    await anon.post(REQUEST, json={"email": email})
                ).status_code == 200
                assert len(sent) == 2
                second_code = code_in(sent[1])
                if first_code != second_code:
                    stale = await anon.post(
                        VERIFY, json={"email": email, "code": first_code}
                    )
                    assert stale.status_code == 401
                    assert stale.json()["detail"]["code"] == "invalid_reset_code"

                # 틀린 코드 5번 → 맞는 코드도 거절(새 코드를 받아야 한다). 없는 계정과 같은 답
                wrong = "000000" if second_code != "000000" else "111111"
                for _ in range(5 if first_code == second_code else 4):
                    response = await anon.post(
                        VERIFY, json={"email": email, "code": wrong}
                    )
                    assert response.status_code == 401
                burned = await anon.post(
                    VERIFY, json={"email": email, "code": second_code}
                )
                assert burned.status_code == 401
                nobody = await anon.post(
                    VERIFY, json={"email": "nobody@example.com", "code": second_code}
                )
                assert nobody.status_code == 401 and nobody.json() == burned.json()

            # 만료된 코드
            await age_codes(sessions, user.id, timedelta(seconds=61))
            async with client() as anon:
                await anon.post(REQUEST, json={"email": email})
            expired_code = code_in(sent[-1])
            async with sessions() as db:
                await db.execute(
                    update(PasswordResetCode)
                    .where(PasswordResetCode.app_user_id == user.id)
                    .values(expires_at=utc_now() - timedelta(seconds=1))
                )
                await db.commit()
            async with client() as anon:
                assert (
                    await anon.post(VERIFY, json={"email": email, "code": expired_code})
                ).status_code == 401

            # 로그인 실패로 잠긴 상태에서 찾기를 끝내면 잠금이 풀린다
            for _ in range(5):
                await login(email, "Wrong-Pass-1234")
            assert (await login(email, PASSWORD)).status_code == 429

            # 정상 흐름
            await age_codes(sessions, user.id, timedelta(seconds=61))
            async with client() as anon:
                await anon.post(REQUEST, json={"email": email})
                code = code_in(sent[-1])
                verified = await anon.post(VERIFY, json={"email": email, "code": code})
                assert verified.status_code == 200, verified.text
                token = verified.json()["reset_token"]
                # 같은 코드는 두 번 증표를 주지 않는다
                assert (
                    await anon.post(VERIFY, json={"email": email, "code": code})
                ).status_code == 401
                # 규칙 위반이면 422, 증표는 그대로 쓸 수 있다
                weak = await anon.post(
                    COMPLETE, json={"reset_token": token, "new_password": "short"}
                )
                assert (
                    weak.status_code == 422
                    and weak.json()["detail"]["code"] == "invalid_password"
                )
                done = await anon.post(
                    COMPLETE, json={"reset_token": token, "new_password": NEW_PASSWORD}
                )
                assert done.status_code == 204, done.text
                reused = await anon.post(
                    COMPLETE, json={"reset_token": token, "new_password": NEW_PASSWORD}
                )
                assert reused.status_code == 401
                assert reused.json()["detail"]["code"] == "invalid_reset_token"

            # 모든 기기에서 로그아웃 · 옛 비밀번호 거절 · 새 비밀번호 로그인(잠금도 풀림)
            assert (await member.get("/api/v1/me")).status_code == 401
            assert (await other_device.get("/api/v1/me")).status_code == 401
            assert (await login(email, PASSWORD)).status_code == 401
            assert (await login(email, NEW_PASSWORD)).status_code == 200

            # 원문 코드 · 증표는 DB 에 없다
            async with sessions() as db:
                rows = (await db.scalars(select(PasswordResetCode))).all()
                assert rows and all(len(row.code_hash) == 64 for row in rows)
                stored = " ".join(f"{row.code_hash} {row.token_hash}" for row in rows)
                assert token not in stored and code not in stored

    mysql_run(scenario)


def test_request_social_only_notice_withdrawn_and_hourly_limit(
    real_auth_and_outbox,
):
    sent = real_auth_and_outbox

    async def scenario(sessions):
        social_email = f"s{uuid4().hex[:9]}@example.com"
        social_id = str(uuid4())
        now = utc_now()
        async with sessions() as db:
            social = AppUser(
                id=social_id,
                email=social_email,
                nickname="소셜회원",
                role="user",
                created_at=now,
                updated_at=now,
            )
            db.add(social)
            await db.flush()
            db.add(
                AuthIdentity(
                    id=str(uuid4()),
                    app_user_id=social.id,
                    provider="google",
                    provider_subject="g-1",
                    password_hash=None,
                    created_at=now,
                    updated_at=now,
                )
            )
            await db.commit()

        member_email = f"m{uuid4().hex[:9]}@example.com"
        async with client() as member:
            await register(member, member_email, "한도회원")
        async with sessions() as db:
            member_id = await db.scalar(
                select(AppUser.id).where(AppUser.email == member_email)
            )

        async with client() as anon:
            # 소셜 전용 — 코드 대신 「Google 로 로그인」 안내 한 통, 같은 재발송 한도(60초)를 따른다(미르 11/26)
            for _ in range(2):
                assert (
                    await anon.post(REQUEST, json={"email": social_email})
                ).status_code == 200
            assert len(sent) == 1
            notice = sent.pop()
            assert notice.to == social_email
            assert "Google" in notice.text
            assert re.search(r"\b\d{6}\b", notice.text) is None
            async with sessions() as db:
                rows = (
                    await db.scalars(
                        select(PasswordResetCode).where(
                            PasswordResetCode.app_user_id == social_id
                        )
                    )
                ).all()
                # 기록 행은 만들자마자 만료 — 확인(②)에 쓸 수 없다
                assert len(rows) == 1 and rows[0].expires_at <= rows[0].created_at
            assert (
                await anon.post(VERIFY, json={"email": social_email, "code": "000000"})
            ).status_code == 401
            # 시간당 5통
            for _ in range(7):
                assert (
                    await anon.post(REQUEST, json={"email": member_email})
                ).status_code == 200
                await age_codes(sessions, member_id, timedelta(seconds=61))
        assert len(sent) == 5

        # 탈퇴하면 코드 행이 지워지고, 그 이메일로는 메일이 가지 않는다
        async with client() as member:
            assert (
                await member.post(
                    "/api/v1/auth/login",
                    json={"email": member_email, "password": PASSWORD},
                )
            ).status_code == 200
            assert (
                await member.post("/api/v1/me/withdrawal", json={"password": PASSWORD})
            ).status_code == 204
        async with sessions() as db:
            left = await db.scalar(
                select(func.count())
                .select_from(PasswordResetCode)
                .where(PasswordResetCode.app_user_id == member_id)
            )
            assert left == 0
        async with client() as anon:
            assert (
                await anon.post(REQUEST, json={"email": member_email})
            ).status_code == 200
        assert len(sent) == 5

    mysql_run(scenario)


def test_change_password_keeps_this_session_only(real_auth_and_outbox):
    sent = real_auth_and_outbox

    async def scenario(sessions):
        email = f"c{uuid4().hex[:9]}@example.com"
        async with client() as member, client() as other_device:
            await register(member, email, "변경회원")
            assert (
                await other_device.post(
                    "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
                )
            ).status_code == 200

            # 진행 중이던 찾기 증표는 변경 뒤 못 쓴다
            async with client() as anon:
                await anon.post(REQUEST, json={"email": email})
                token = (
                    await anon.post(
                        VERIFY, json={"email": email, "code": code_in(sent[-1])}
                    )
                ).json()["reset_token"]

            wrong = await member.post(
                CHANGE,
                json={
                    "current_password": "Wrong-Pass-1234",
                    "new_password": NEW_PASSWORD,
                },
            )
            assert (
                wrong.status_code == 401
                and wrong.json()["detail"]["code"] == "invalid_password"
            )
            async with sessions() as db:
                failures = await db.scalar(select(func.sum(LoginThrottle.failed_count)))
                assert failures and failures >= 1
            same = await member.post(
                CHANGE, json={"current_password": PASSWORD, "new_password": PASSWORD}
            )
            assert (
                same.status_code == 422
                and same.json()["detail"]["code"] == "same_password"
            )
            weak = await member.post(
                CHANGE, json={"current_password": PASSWORD, "new_password": "short"}
            )
            assert (
                weak.status_code == 422
                and weak.json()["detail"]["code"] == "invalid_password"
            )

            done = await member.post(
                CHANGE,
                json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            )
            assert done.status_code == 204, done.text
            assert (await member.get("/api/v1/me")).status_code == 200
            assert (await other_device.get("/api/v1/me")).status_code == 401
            assert (await login(email, PASSWORD)).status_code == 401
            assert (await login(email, NEW_PASSWORD)).status_code == 200
            async with client() as anon:
                stale = await anon.post(
                    COMPLETE,
                    json={"reset_token": token, "new_password": "Other-River-5821"},
                )
                assert stale.status_code == 401

        # 소셜 전용 회원은 비밀번호가 없다
        now = utc_now()
        async with sessions() as db:
            social = AppUser(
                id=str(uuid4()),
                email=f"g{uuid4().hex[:9]}@example.com",
                nickname="구글회원",
                role="user",
                created_at=now,
                updated_at=now,
            )
            db.add(social)
            await db.flush()
            db.add(
                AuthIdentity(
                    id=str(uuid4()),
                    app_user_id=social.id,
                    provider="google",
                    provider_subject="g-2",
                    password_hash=None,
                    created_at=now,
                    updated_at=now,
                )
            )
            db.add(
                UserSession(
                    id=str(uuid4()),
                    app_user_id=social.id,
                    token_hash=user_session.hash_session_token("social-token"),
                    created_at=now,
                    expires_at=now + timedelta(days=1),
                )
            )
            await db.commit()
        async with client() as social_client:
            social_client.cookies.set(user_session.SESSION_COOKIE, "social-token")
            refused = await social_client.post(
                CHANGE,
                json={
                    "current_password": "Anything-1234",
                    "new_password": NEW_PASSWORD,
                },
            )
        assert (
            refused.status_code == 403
            and refused.json()["detail"]["code"] == "no_local_password"
        )

    mysql_run(scenario)


def test_hardening_concurrency_daily_caps_token_survival_and_login_race(
    real_auth_and_outbox,
):
    """11/25 검토 반영 — 동시 요청 · 하루 한도 · 남의 요청이 증표를 죽이지 못함 · 재설정과 겹친 로그인."""
    sent = real_auth_and_outbox

    async def scenario(sessions):
        email = f"h{uuid4().hex[:9]}@example.com"
        async with client() as member:
            await register(member, email, "경합회원")
        async with sessions() as db:
            user_id = await db.scalar(select(AppUser.id).where(AppUser.email == email))

        # 같은 이메일로 동시에 여러 번 — 한 통만 간다(잠금 읽기로 센다)
        async with client() as anon:
            answers = await asyncio.gather(
                *(anon.post(REQUEST, json={"email": email}) for _ in range(6))
            )
        assert {answer.status_code for answer in answers} == {200}
        assert len(sent) == 1

        # 증표를 받은 뒤 남이 새 코드를 요청해도 그 증표는 살아 있다
        async with client() as anon:
            token = (
                await anon.post(
                    VERIFY, json={"email": email, "code": code_in(sent[-1])}
                )
            ).json()["reset_token"]
        await age_codes(sessions, user_id, timedelta(seconds=61))
        async with client() as attacker:
            assert (
                await attacker.post(REQUEST, json={"email": email})
            ).status_code == 200
        assert len(sent) == 2

        # 재설정과 겹친 로그인: 옛 해시로 확인한 로그인은 새 비밀번호가 커밋된 뒤 세션을 받지 못한다
        async with sessions() as db:
            old_hash = await local_auth.local_password_hash(db, user_id)
        async with client() as anon:
            done = await anon.post(
                COMPLETE, json={"reset_token": token, "new_password": NEW_PASSWORD}
            )
        assert done.status_code == 204
        async with sessions() as db:
            before = await db.scalar(
                select(func.count())
                .select_from(UserSession)
                .where(UserSession.app_user_id == user_id)
            )
            with pytest.raises(user_session.PasswordChangedDuringLoginError):
                await user_session.start_session(
                    db, Response(), user_id, verified_password_hash=old_hash
                )
            after = await db.scalar(
                select(func.count())
                .select_from(UserSession)
                .where(UserSession.app_user_id == user_id)
            )
        assert before == after

        # 하루 10통 한도(시간당 5통을 넘기도록 한 시간씩 민다)
        for _ in range(12):
            await age_codes(sessions, user_id, timedelta(hours=1, seconds=1))
            async with client() as anon:
                await anon.post(REQUEST, json={"email": email})
        async with sessions() as db:
            recent = await db.scalar(
                select(func.count())
                .select_from(PasswordResetCode)
                .where(
                    PasswordResetCode.app_user_id == user_id,
                    PasswordResetCode.created_at > utc_now() - timedelta(days=1),
                )
            )
        assert recent <= 10

        # 코드 확인 실패는 가입 여부와 상관없이 이메일마다 세고, 하루 20번이면 맞는 코드도 거절한다
        nobody = "nobody-h@example.com"
        async with client() as anon:
            for _ in range(3):
                assert (
                    await anon.post(VERIFY, json={"email": nobody, "code": "123456"})
                ).status_code == 401
        async with sessions() as db:
            row = await db.get(
                LoginThrottle, password_reset.verify_throttle_key(nobody)
            )
            assert row is not None and row.failed_count == 3

        await age_codes(sessions, user_id, timedelta(days=2))
        async with sessions() as db:
            await db.execute(
                delete(PasswordResetCode).where(
                    PasswordResetCode.app_user_id == user_id
                )
            )
            await db.commit()
        async with client() as anon:
            await anon.post(REQUEST, json={"email": email})
            good = code_in(sent[-1])
            wrong = "000000" if good != "000000" else "111111"
            for _ in range(20):
                await anon.post(VERIFY, json={"email": email, "code": wrong})
                # 코드 하나는 5번이면 죽으므로 새 코드를 받아 이어 센다
                await age_codes(sessions, user_id, timedelta(hours=1, seconds=1))
                async with sessions() as db:
                    await db.execute(
                        delete(PasswordResetCode).where(
                            PasswordResetCode.app_user_id == user_id
                        )
                    )
                    await db.commit()
                await anon.post(REQUEST, json={"email": email})
            good = code_in(sent[-1])
            locked = await anon.post(VERIFY, json={"email": email, "code": good})
        assert locked.status_code == 401

    mysql_run(scenario)
