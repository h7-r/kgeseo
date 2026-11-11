"""격리 MySQL 에서 베타 분석 기록(11/11)의 migration · 저장 · 중복 건너뛰기 · 게스트 주인 · 내보내기를 본다.

실행 조건은 `test_npc_turn_idempotency_mysql.py`와 같은 안전 장치를 따른다(기존 앱 DB 설정은 쓰지 않는다).
- `BETA_EVENTS_MYSQL_ISOLATED=1`
- `BETA_EVENTS_MYSQL_URL`: mysql+aiomysql, localhost 또는 127.0.0.1, 3306 이 아닌 명시 포트, `test_beta_events_` 접두사 DB
- `BETA_EVENTS_MYSQL_DATADIR`: 그 테스트 인스턴스의 실제 데이터 디렉터리(접속 뒤 `@@datadir` 와 대조)
전체 migration 체인을 적용하고, 끝나면 새 revision 은 실제 downgrade 로 지우고 나머지 표는 직접 지운다.
"""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import get_db
from app.main import app
from app.models.account_data import AdminAuditLog
from app.models.app_user import AppUser
from app.models.beta_event import BetaEvent
from app.models.guest_session import GuestSession
from app.services.guest_session import GUEST_COOKIE
from app.services.local_auth import utc_now
from app.services.user_session import current_user
from tests.test_npc_turn_idempotency_mysql import (
    drop_remaining_tables,
    script,
    upgrade_chain,
)

pytestmark = [
    pytest.mark.skipif(
        os.environ.get("BETA_EVENTS_MYSQL_ISOLATED") != "1",
        reason="explicit isolated beta events MySQL test database required",
    ),
    pytest.mark.real_play_auth,
]

REVISION = "a3f9c2e7b1d4"
ORIGIN = "http://localhost:5175"  # 기본 CORS_ORIGINS(개발) 안의 값
PATH = "/api/v1/beta-events"


def event(**overrides):
    base = {
        "event_id": str(uuid4()),
        "type": "objective_state",
        "phase": "complete",
        "pc": "B-7KQ2XM",
        "run_id": str(uuid4()),
        "run_index": 0,
        "tab_id": str(uuid4()),
        "seq": 1,
        "client_ts": "2026-11-13T14:01:02.345+09:00",
        "objective_id": "P03",
        "page": "naju",
        "build": "abc1234",
        "data": {"active_ms": 812345, "origin": "live", "메모": "장독대"},
    }
    return {**base, **overrides}


def downgrade_new_revision(connection) -> None:
    with Operations.context(MigrationContext.configure(connection)):
        script().get_revision(REVISION).module.downgrade()


def mysql_run(scenario) -> None:
    async def execute():
        url = make_url(os.environ["BETA_EVENTS_MYSQL_URL"])
        assert url.drivername == "mysql+aiomysql"
        assert url.host in {"127.0.0.1", "localhost"}
        assert url.port is not None and url.port != 3306
        assert url.database and url.database.startswith("test_beta_events_")
        expected = Path(os.environ["BETA_EVENTS_MYSQL_DATADIR"]).resolve()
        engine = create_async_engine(url, hide_parameters=True)
        initialized = False
        try:
            async with engine.begin() as connection:
                database, datadir = (
                    await connection.execute(text("SELECT DATABASE(), @@datadir"))
                ).one()
                assert database == url.database
                assert Path(datadir).resolve() == expected
                assert not (await connection.execute(text("SHOW TABLES"))).all(), (
                    "test schema must be empty"
                )
                await connection.run_sync(upgrade_chain)
                initialized = True
            sessions = async_sessionmaker(engine, expire_on_commit=False)

            async def override_get_db():
                async with sessions() as db:
                    yield db

            app.dependency_overrides[get_db] = override_get_db
            try:
                await scenario(sessions)
            finally:
                app.dependency_overrides.pop(get_db, None)
                app.dependency_overrides.pop(current_user, None)
        finally:
            if initialized:
                async with engine.begin() as connection:
                    # 새 revision 의 downgrade 는 실제로 실행해 검증한다.
                    await connection.run_sync(downgrade_new_revision)
                    tables = {
                        row[0]
                        for row in (await connection.execute(text("SHOW TABLES"))).all()
                    }
                    assert "beta_events" not in tables
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


def client(cookies: dict[str, str] | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": ORIGIN},
        cookies=cookies,
    )


async def count(sessions) -> int:
    async with sessions() as db:
        return await db.scalar(select(func.count()).select_from(BetaEvent))


def test_batches_are_saved_once_and_resends_are_skipped():
    async def scenario(sessions):
        first = [event(), event(type="activity_snapshot", phase=None), event()]
        async with client() as http:
            response = await http.post(PATH, json={"events": first})
            assert response.status_code == 200, response.text
            assert response.json() == {
                "accepted": 3,
                "duplicates": 0,
                "disabled": False,
                "ignored": 0,
            }
            # 같은 기록 셋 + 새 기록 하나(묶음 안의 중복도 하나로)
            again = [*first, event(), first[0]]
            response = await http.post(PATH, json={"events": again})
            assert response.json() == {
                "accepted": 1,
                "duplicates": 4,
                "disabled": False,
                "ignored": 0,
            }
            # 페이지를 떠날 때의 text/plain 본문
            response = await http.post(
                PATH,
                content=httpx.Request("POST", "/", json={"events": [event()]}).content,
                headers={"Content-Type": "text/plain;charset=UTF-8"},
            )
            assert response.json()["accepted"] == 1
        assert await count(sessions) == 5
        async with sessions() as db:
            row = await db.scalar(
                select(BetaEvent).where(BetaEvent.event_id == first[0]["event_id"])
            )
        # +09:00 은 UTC 로 바꿔 저장한다. 한글 data 도 그대로.
        assert row.client_ts == datetime(2026, 11, 13, 5, 1, 2, 345000)
        assert row.data["메모"] == "장독대"
        assert row.participant_code == "B-7KQ2XM"
        assert row.app_user_id is None and row.guest_session_id is None
        assert row.received_at <= utc_now()

    mysql_run(scenario)


def test_guest_cookie_owner_is_recorded_and_body_ids_are_ignored():
    async def scenario(sessions):
        async with client() as http:
            created = await http.post("/api/v1/anonymous-sessions")
            assert created.status_code == 201, created.text
            token = created.cookies.get(GUEST_COOKIE)
            assert token
        async with client({GUEST_COOKIE: token}) as http:
            response = await http.post(
                PATH,
                json={"events": [event(app_user_id="someone", guest_session_id="x")]},
            )
            assert response.status_code == 200, response.text
        async with sessions() as db:
            guest = await db.scalar(select(GuestSession))
            row = await db.scalar(select(BetaEvent))
        assert row.guest_session_id == guest.id
        assert row.app_user_id is None

    mysql_run(scenario)


def test_bad_batch_saves_nothing():
    async def scenario(sessions):
        async with client() as http:
            response = await http.post(
                PATH, json={"events": [event(), event(type="nope")]}
            )
            assert response.status_code == 422
        assert await count(sessions) == 0

    mysql_run(scenario)


def test_admin_export_pages_and_audits():
    async def scenario(sessions):
        async with client() as http:
            await http.post(
                PATH, json={"events": [event(seq=index) for index in range(5)]}
            )
            await http.post(PATH, json={"events": [event(pc="B-OTHER1")]})
        admin = AppUser(
            id=str(uuid4()), email="a@example.com", nickname="가나", role="admin"
        )
        app.dependency_overrides[current_user] = lambda: admin
        async with client() as http:
            first = (await http.get("/api/v1/admin/beta-events?limit=4")).json()
            assert len(first["events"]) == 4
            rest = (
                await http.get(
                    f"/api/v1/admin/beta-events?after_id={first['next_after_id']}"
                )
            ).json()
            assert len(rest["events"]) == 2 and rest["next_after_id"] is None
            only = (await http.get("/api/v1/admin/beta-events?pc=B-OTHER1")).json()
            assert [row["participant_code"] for row in only["events"]] == ["B-OTHER1"]
        ids = [row["id"] for row in first["events"] + rest["events"]]
        assert ids == sorted(ids)
        async with sessions() as db:
            audits = await db.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "export_beta_events")
            )
        assert audits == 3

    mysql_run(scenario)
