"""격리 MySQL 에서 회원 최근 로그인 last_login_at(11/16 세진, revision 744dc740f81f)을 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

- migration: 열 형식 · 색인 없음 · 기존 회원 백필(MAX(user_sessions.created_at), 만료 · 철회 무관) · 세션 없는 회원 NULL ·
  회원 수 · updated_at 그대로 · downgrade 는 열만 지움
- 실제 요청: 이메일 가입 · 로그인은 갱신(세션 created_at 과 같은 값), 실패 · 잠김 · /me · 로그아웃은 그대로, updated_at 그대로,
  게스트 승계 성공 · 실패 모두 로그인과 갱신 유지, 갱신 실패면 세션도 남지 않음(원자성), 관리자 목록 · 상세 응답
- 동시 로그인: 늦게 커밋된 이른 시각이 앞선 값을 되돌리지 않는다(행 잠금 뒤 WHERE 재평가)
"""

import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi import Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.main import app
from app.models.account_data import UserSession
from app.models.app_user import AppUser
from app.models.guest_session import GuestSessionTransfer
from app.services import guest_session, user_session
from app.services.local_auth import utc_now
from tests.test_admin_api_mysql import DAY, Seed, mysql_run, sign_in
from tests.test_admin_is_test_mysql import _isolated_url, _migration, _run_revisions
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, script

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

REVISION = "744dc740f81f"
PASSWORD = "Zebra-Moon-2491"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": settings.cors_origins[0]},
    )


def test_migration_backfills_from_last_session_and_downgrades_cleanly():
    async def execute():
        url = _isolated_url()
        expected = Path(os.environ["ADMIN_API_MYSQL_DATADIR"]).resolve()
        engine = create_async_engine(url, hide_parameters=True)
        initialized = False
        try:
            async with engine.begin() as connection:
                database, datadir = (
                    await connection.execute(text("SELECT DATABASE(), @@datadir"))
                ).one()
                assert database == url.database
                assert Path(datadir).resolve() == expected
                assert not (await connection.execute(text("SHOW TABLES"))).all()
                heads = script().get_heads()
                assert len(heads) == 1
                assert REVISION in [
                    rev.revision for rev in script().iterate_revisions(heads[0], "base")
                ]
                assert script().get_revision(REVISION).down_revision == "734021834040"
                initialized = True

                await connection.run_sync(_run_revisions, stop_before=REVISION)
                updated = datetime(2026, 10, 1, 9, 30, 0, 111111)
                users = {name: str(uuid4()) for name in ("many", "none", "one")}
                for name, user_id in users.items():
                    await connection.execute(
                        text(
                            "INSERT INTO app_users (id, email, nickname, role, created_at, updated_at) "
                            "VALUES (:id, :email, :nick, 'user', :at, :at)"
                        ),
                        {
                            "id": user_id,
                            "email": f"{name}@example.com",
                            "nick": f"백필{name}",
                            "at": updated,
                        },
                    )
                t1 = datetime(2026, 11, 1, 1, 0, 0, 1)
                t2 = datetime(
                    2026, 11, 10, 2, 0, 0, 222222
                )  # 가장 최근 — 철회 · 만료된 세션
                t3 = datetime(2026, 11, 5, 3, 0, 0, 333333)
                sessions = [
                    (users["many"], t1, t1 + 14 * DAY, None),
                    (users["many"], t2, t2 - DAY, t2 + timedelta(hours=1)),
                    (users["many"], t3, t3 + 14 * DAY, None),
                    (users["one"], t3, t3 + 14 * DAY, None),
                ]
                for user_id, created, expires, revoked in sessions:
                    await connection.execute(
                        text(
                            "INSERT INTO user_sessions (id, app_user_id, token_hash, created_at, expires_at, revoked_at) "
                            "VALUES (:id, :u, :h, :c, :e, :r)"
                        ),
                        {
                            "id": str(uuid4()),
                            "u": user_id,
                            "h": uuid4().hex + uuid4().hex,
                            "c": created,
                            "e": expires,
                            "r": revoked,
                        },
                    )

                await connection.run_sync(_migration, REVISION, "upgrade")
                column = (
                    await connection.execute(
                        text(
                            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS "
                            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' "
                            "AND COLUMN_NAME = 'last_login_at'"
                        )
                    )
                ).one()
                assert tuple(column) == ("datetime(6)", "YES", None)
                indexed = (
                    await connection.execute(
                        text(
                            "SELECT COUNT(*) FROM information_schema.STATISTICS "
                            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' "
                            "AND COLUMN_NAME = 'last_login_at'"
                        )
                    )
                ).scalar_one()
                assert indexed == 0
                rows = {
                    row[0]: (row[1], row[2])
                    for row in (
                        await connection.execute(
                            text("SELECT id, last_login_at, updated_at FROM app_users")
                        )
                    ).all()
                }
                assert len(rows) == 3
                assert rows[users["many"]] == (
                    t2,
                    updated,
                )  # 철회 · 만료와 무관하게 마지막 생성
                assert rows[users["one"]] == (t3, updated)
                assert rows[users["none"]] == (None, updated)

                await connection.run_sync(_migration, REVISION, "downgrade")
                remaining = {
                    row[0]
                    for row in (
                        await connection.execute(
                            text(
                                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users'"
                            )
                        )
                    ).all()
                }
                assert "last_login_at" not in remaining
                assert (
                    await connection.execute(text("SELECT COUNT(*) FROM app_users"))
                ).scalar_one() == 3
                assert (
                    await connection.execute(text("SELECT COUNT(*) FROM user_sessions"))
                ).scalar_one() == 4
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


def test_login_paths_on_real_database(monkeypatch):
    async def scenario(sessions):
        async def user_row(email):
            async with sessions() as db:
                return (
                    await db.execute(select(AppUser).where(AppUser.email == email))
                ).scalar_one()

        async def latest_session(user_id):
            async with sessions() as db:
                return (
                    (
                        await db.execute(
                            select(UserSession)
                            .where(UserSession.app_user_id == user_id)
                            .order_by(UserSession.created_at.desc())
                        )
                    )
                    .scalars()
                    .first()
                )

        email = "login-flow@example.com"
        async with _client() as http:
            # 이메일 가입 → 갱신(세션 created_at 과 같은 값), updated_at 은 가입 시각 그대로
            registered = await http.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": PASSWORD,
                    "nickname": "최근로그인",
                    "consent": {"terms": True, "privacy": True, "age": True},
                },
            )
            assert registered.status_code == 201, registered.text
            user = await user_row(email)
            first = await latest_session(user.id)
            assert user.last_login_at == first.created_at
            assert user.updated_at == user.created_at

            # 쿠키로 /me · 로그아웃 → 그대로
            assert (await http.get("/api/v1/me")).status_code == 200
            assert (await user_row(email)).last_login_at == first.created_at
            assert (await http.post("/api/v1/me/logout")).status_code == 204
            assert (await user_row(email)).last_login_at == first.created_at

        async with _client() as http:
            # 이메일 로그인 → 더 최근 값으로, updated_at 그대로
            logged_in = await http.post(
                "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
            )
            assert logged_in.status_code == 200, logged_in.text
            after_login = await user_row(email)
            second = await latest_session(user.id)
            assert after_login.last_login_at == second.created_at > first.created_at
            assert after_login.updated_at == user.updated_at

            # 실패 다섯 번 → 잠김(429) — 그동안 그대로
            for _ in range(5):
                failed = await http.post(
                    "/api/v1/auth/login",
                    json={"email": email, "password": "Wrong-Pass-77"},
                )
                assert failed.status_code == 401
            locked = await http.post(
                "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
            )
            assert locked.status_code == 429
            assert (await user_row(email)).last_login_at == second.created_at

        # 게스트 승계 성공 — 게스트 쿠키를 받고 가입하면 승계 기록이 남고 last_login_at 도 갱신
        guest_email = "guest-flow@example.com"
        async with _client() as http:
            assert (await http.post("/api/v1/anonymous-sessions")).status_code == 201
            registered = await http.post(
                "/api/v1/auth/register",
                json={
                    "email": guest_email,
                    "password": PASSWORD,
                    "nickname": "게스트승계",
                    "consent": {"terms": True, "privacy": True, "age": True},
                },
            )
            assert registered.status_code == 201, registered.text
        guest_user = await user_row(guest_email)
        async with sessions() as db:
            transfers = (
                (
                    await db.execute(
                        select(GuestSessionTransfer).where(
                            GuestSessionTransfer.app_user_id == guest_user.id
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert len(transfers) == 1
        assert (
            guest_user.last_login_at == (await latest_session(guest_user.id)).created_at
        )

        # 게스트 승계 실패 — 로그인 · 갱신은 그대로 성공
        failing_email = "guest-fail@example.com"

        async def broken_transfer(*_args, **_kwargs):
            raise RuntimeError("transfer failed")

        monkeypatch.setattr(guest_session, "_transfer", broken_transfer)
        async with _client() as http:
            assert (await http.post("/api/v1/anonymous-sessions")).status_code == 201
            registered = await http.post(
                "/api/v1/auth/register",
                json={
                    "email": failing_email,
                    "password": PASSWORD,
                    "nickname": "승계실패",
                    "consent": {"terms": True, "privacy": True, "age": True},
                },
            )
            assert registered.status_code == 201, registered.text
        failing_user = await user_row(failing_email)
        assert (
            failing_user.last_login_at
            == (await latest_session(failing_user.id)).created_at
        )
        monkeypatch.undo()

        # 원자성 — 갱신이 실패하면 새 세션도 남지 않는다
        before_sessions = await latest_session(user.id)
        before_value = (await user_row(email)).last_login_at

        def broken_update(user_id, now):
            return text(
                "UPDATE app_users SET no_such_column = 1 WHERE id = :id"
            ).bindparams(id=user_id)

        monkeypatch.setattr(user_session, "last_login_update", broken_update)
        async with sessions() as db:
            with pytest.raises(Exception):
                await user_session.start_session(db, Response(), user.id)
        monkeypatch.undo()
        assert (await latest_session(user.id)).id == before_sessions.id
        assert (await user_row(email)).last_login_at == before_value

        # 관리자 목록 · 상세
        async with sessions() as db:
            seed = Seed(db)
            admin = seed.user("운영자", utc_now() - 10 * DAY, role="admin")
            await seed.save()
        sign_in(admin)
        async with _client() as http:
            listed = (await http.get("/api/v1/admin/users", params={"q": email})).json()
            detail = (await http.get(f"/api/v1/admin/users/{user.id}")).json()
        (row,) = listed["users"]
        expected = before_value.isoformat()
        assert row["last_login_at"] == expected
        assert detail["user"]["last_login_at"] == expected
        assert detail["user"]["last_session_started_at"] == expected
        # 상세의 로그인 수단 · 지역은 목록과 같은 값(이메일 가입 → local, 지역은 고르지 않음)
        assert detail["user"]["providers"] == row["providers"] == ["local"]
        assert detail["user"]["region"] == row["region"] is None

    mysql_run(scenario)


def test_concurrent_logins_never_move_last_login_backwards():
    async def scenario(sessions):
        async with sessions() as db:
            seed = Seed(db)
            member = seed.user("동시로그인", utc_now() - DAY)
            await seed.save()
        earlier = datetime(2026, 11, 16, 1, 0, 0, 1)
        later = datetime(2026, 11, 16, 1, 0, 0, 2)

        async def value():
            async with sessions() as db:
                return (
                    await db.get(AppUser, member.id, populate_existing=True)
                ).last_login_at

        # 1) 늦은 시각이 먼저 커밋 → 이른 시각은 쓰지 못한다
        async with sessions() as db:
            await db.execute(user_session.last_login_update(member.id, later))
            await db.commit()
        async with sessions() as db:
            result = await db.execute(
                user_session.last_login_update(member.id, earlier)
            )
            await db.commit()
        assert result.rowcount == 0 and await value() == later

        # 2) 진짜로 겹칠 때: 앞 트랜잭션이 더 최근 값으로 행을 잠근 채 있는 동안 이른 값이 기다렸다가 다시 판단해 쓰지 않는다
        newest = datetime(2026, 11, 16, 2, 0, 0, 0)
        older = datetime(2026, 11, 16, 1, 30, 0, 0)
        first = sessions()
        second = sessions()
        try:
            await first.execute(user_session.last_login_update(member.id, newest))

            async def late_older():
                result = await second.execute(
                    user_session.last_login_update(member.id, older)
                )
                await second.commit()
                return result.rowcount

            waiting = asyncio.create_task(late_older())
            await asyncio.sleep(0.5)
            assert not waiting.done()  # 행 잠금에 막혀 있다
            await first.commit()
            assert await waiting == 0
        finally:
            await first.close()
            await second.close()
        assert await value() == newest

    mysql_run(scenario)


def test_simultaneous_logins_of_one_member_both_succeed():
    """같은 회원의 로그인 둘이 정말 동시에 — 데드락 없이 둘 다 세션을 받고, last_login_at 은 둘 중 늦은 시각."""

    async def scenario(sessions):
        async with sessions() as db:
            seed = Seed(db)
            member = seed.user("동시둘", utc_now() - DAY)
            await seed.save()

        async def login():
            async with sessions() as db:
                await user_session.start_session(db, Response(), member.id)

        for _ in range(5):
            await asyncio.gather(login(), login())
        async with sessions() as db:
            created = (
                (
                    await db.execute(
                        select(UserSession.created_at).where(
                            UserSession.app_user_id == member.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            value = (await db.get(AppUser, member.id)).last_login_at
        assert len(created) == 10
        assert value == max(created)

    mysql_run(scenario)
