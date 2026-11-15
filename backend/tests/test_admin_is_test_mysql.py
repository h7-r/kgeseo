"""격리 MySQL 에서 팀 테스트 계정 표시 is_test 와 내부 계정 제외(미르 11/13 최종 정책)를 본다.

내부 계정 = role == "admin" OR is_test == true. include_internal=false(기본)면 회원 · 게스트 · 게임(beta_events) 통계 모두에서 뺀다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

- migration: NOT NULL · DEFAULT 0, 기존 회원 false, 이전 코드처럼 열을 빼고 넣어도 가입된다(false), downgrade 는 열만 지운다
- 회원 통계: 관리자 · 테스트 계정 제외(기본) / 포함(true). 관리자이면서 테스트 계정은 한 번만(excluded 는 admins 쪽). 과거 날짜도 현재 값으로 다시 센다
- 게스트 통계: 관리자 · 테스트 계정으로 승계된 게스트를 뺀다 — 일반 회원에게 승계된 게스트 · 승계 없는 게스트는 남는다(생성 당시 소유자 판정은 그대로)
- 게임 집계(beta_events): 관리자 · 테스트 계정의 기록과 그 계정으로 승계된 게스트 기록은 뺀다, 계정에 이어지지 않는 기록은 남는다
"""

import asyncio
import hashlib
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, Table, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.models.app_user import AppUser
from app.models.beta_event import BetaEvent
from app.models.guest_session import GuestSession, GuestSessionTransfer
from app.services.admin_query import kst_day_start_utc, kst_range, kst_today
from app.services.local_auth import utc_now
from scripts import set_test_account as cli
from tests.test_admin_api_mysql import DAY, HOUR, get_json, mysql_run, sign_in
from tests.test_admin_api_phase2_mysql import MINUTE, Seed2
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, script

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

REVISION = "f3c8a1d6e2b7"


class SeedT(Seed2):
    """테스트 계정 · 승계 기록(게스트 세션 id 를 돌려준다) · beta_events 를 더 넣는다."""

    def tester(self, nickname, created_at, *, role: str = "user") -> AppUser:
        user = self.user(nickname, created_at, role=role)
        user.is_test = True
        return user

    def transfer_with_id(self, guest: str, user: AppUser, at) -> str:
        guest_session = GuestSession(
            id=str(uuid4()),
            anonymous_session_id=guest,
            token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
            created_at=at - DAY,
            expires_at=at + DAY,
        )
        self.groups[2].append(guest_session)
        self.groups[3].append(
            GuestSessionTransfer(
                id=str(uuid4()),
                guest_session_id=guest_session.id,
                anonymous_session_id=guest,
                app_user_id=user.id,
                play_session_count=1,
                transferred_at=at,
            )
        )
        return guest_session.id

    def guest_then_transfer(self, start, user: AppUser) -> str:
        """게스트로 만들고(05:00) 그날 승계(06:00) · 승계 뒤 이어 함(07:00) — 생성 당시 소유자는 게스트(다섯 조건 충족)."""

        guest = self.guest()
        self.transferred_play(
            start + 5 * HOUR, guest=guest, user=user, reused_until=start + 7 * HOUR
        )
        self.transfer(guest, user, start + 6 * HOUR)
        return guest

    def event(
        self,
        at,
        *,
        user: AppUser | None = None,
        guest_session_id: str | None = None,
        participant_code: str | None = None,
        tab_id: str | None = None,
    ) -> None:
        self.groups[3].append(
            BetaEvent(
                event_id=str(uuid4()),
                received_at=at,
                client_ts=at,
                event_type="stage_reached",
                phase="character_open",
                participant_code=participant_code,
                tab_id=tab_id,
                app_user_id=user.id if user else None,
                guest_session_id=guest_session_id,
                data={},
            )
        )


# --- migration ---


def _isolated_url():
    url = make_url(os.environ["ADMIN_API_MYSQL_URL"])
    assert url.drivername == "mysql+aiomysql"
    assert url.host in {"127.0.0.1", "localhost"}
    assert url.port is not None and url.port != 3306
    assert url.database and url.database.startswith("test_admin_api_")
    return url


def _run_revisions(connection, *, stop_before: str | None) -> None:
    revisions = list(reversed(list(script().walk_revisions())))
    with Operations.context(MigrationContext.configure(connection)):
        for revision in revisions:
            if revision.revision == stop_before:
                return
            revision.module.upgrade()


def _migration(connection, name: str, action: str) -> None:
    with Operations.context(MigrationContext.configure(connection)):
        getattr(script().get_revision(name).module, action)()


def _legacy_app_users() -> Table:
    """이전 판 코드가 아는 app_users — 지금 모델에서 is_test 만 뺀 표 정의(이전 코드의 ORM INSERT 와 같은 열 목록)."""

    return Table(
        "app_users",
        MetaData(),
        *(
            column._copy()
            for column in AppUser.__table__.columns
            if column.name != "is_test"
        ),
    )


def test_migration_defaults_existing_and_legacy_inserts_to_false_and_downgrades_cleanly():
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
                assert script().get_heads() == [REVISION]
                assert script().get_revision(REVISION).down_revision == "a3f9c2e7b1d4"
                initialized = True
                # 바로 앞 head 까지 — is_test 열이 없던 때의 회원 둘
                await connection.run_sync(_run_revisions, stop_before=REVISION)
                for nickname in ("기존회원1", "기존관리자"):
                    await connection.execute(
                        text(
                            "INSERT INTO app_users (id, email, nickname, role, created_at, updated_at) "
                            "VALUES (:id, :email, :nickname, :role, NOW(6), NOW(6))"
                        ),
                        {
                            "id": str(uuid4()),
                            "email": f"{uuid4().hex[:10]}@example.com",
                            "nickname": nickname,
                            "role": "admin" if "관리자" in nickname else "user",
                        },
                    )
                await connection.run_sync(_migration, REVISION, "upgrade")
                column = (
                    await connection.execute(
                        text(
                            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS "
                            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'is_test'"
                        )
                    )
                ).one()
                assert column == (
                    "tinyint(1)",
                    "NO",
                    "0",
                )  # NOT NULL · DEFAULT 0(false)
                existing = (
                    await connection.execute(text("SELECT is_test FROM app_users"))
                ).all()
                assert [row[0] for row in existing] == [0, 0]
                # 이전 판 코드(배포 전환 사이 · 복구 뒤)가 열을 모른 채 가입시켜도 들어가고 false 다
                now = utc_now()
                await connection.execute(
                    _legacy_app_users()
                    .insert()
                    .values(
                        id=str(uuid4()),
                        email="legacy@example.com",
                        nickname="이전코드가입",
                        created_at=now,
                        updated_at=now,
                    )
                )
                # 열을 적지 않은 원시 INSERT 도 false
                await connection.execute(
                    text(
                        "INSERT INTO app_users (id, email, nickname, role, created_at, updated_at) "
                        "VALUES (:id, 'raw@example.com', '원시가입', 'user', NOW(6), NOW(6))"
                    ),
                    {"id": str(uuid4())},
                )
                inserted = dict(
                    (
                        await connection.execute(
                            text(
                                "SELECT nickname, is_test FROM app_users "
                                "WHERE nickname IN ('이전코드가입', '원시가입')"
                            )
                        )
                    ).all()
                )
                assert inserted == {"이전코드가입": 0, "원시가입": 0}
                # 이전 판 코드의 조회(열 목록에 is_test 없음)도 그대로 된다
                legacy = _legacy_app_users()
                assert (
                    await connection.execute(
                        select(legacy.c.role).where(legacy.c.nickname == "이전코드가입")
                    )
                ).scalar_one() == "user"
                # downgrade 는 열만 지운다(회원 행은 그대로)
                await connection.run_sync(_migration, REVISION, "downgrade")
                assert not (
                    await connection.execute(
                        text(
                            "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                            "AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'is_test'"
                        )
                    )
                ).all()
                assert (
                    await connection.execute(text("SELECT COUNT(*) FROM app_users"))
                ).scalar_one() == 4
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


# --- 통계 ---


def test_stats_exclude_internal_accounts_and_guests_transferred_to_them():
    async def scenario(sessions):
        target = kst_today() - 3 * DAY
        start = kst_day_start_utc(target)
        async with sessions() as db:
            seed = SeedT(db)
            normal = seed.user("일반회원", start - 10 * DAY)
            seed.login(normal, start + HOUR)
            seed.play(start + 2 * HOUR, user=normal)
            tester = seed.tester("팀테스트", start + 30 * MINUTE)  # 그날 가입
            seed.login(tester, start + HOUR)
            seed.play(start + 2 * HOUR, user=tester)
            admin = seed.user("운영자", start - 30 * DAY, role="admin")
            seed.login(admin, start + HOUR)
            seed.play(start + 3 * HOUR, user=admin)
            # 관리자이면서 테스트 계정 — 로그인 · 플레이 둘 다 해도 포함 때 한 번만, 제외 수는 관리자 쪽에만
            both = seed.tester("운영테스트", start - 30 * DAY, role="admin")
            seed.login(both, start + HOUR)
            seed.play(start + 3 * HOUR, user=both)
            # 게스트 — 승계 없음 · 일반 회원 · 테스트 계정 · 관리자 · 관리자이면서 테스트 계정에게 승계(모두 생성 당시 게스트)
            plain = seed.guest()
            seed.play(start + 4 * HOUR, guest=plain)
            seed.guest_then_transfer(start, normal)
            seed.guest_then_transfer(start, tester)
            seed.guest_then_transfer(start, admin)
            seed.guest_then_transfer(start, both)
            await seed.save()
        sign_in(admin)
        month_start, month_end = kst_range(target.replace(day=1), target)
        normal_in_month = int(month_start <= normal.created_at < month_end)

        # ORM 으로 만든 새 회원은 기본 false
        async with sessions() as db:
            flags = dict(
                (await db.execute(select(AppUser.nickname, AppUser.is_test))).all()
            )
        assert flags == {
            "일반회원": False,
            "팀테스트": True,
            "운영자": False,
            "운영테스트": True,
        }

        async def summary(**params):
            return await get_json(
                "/api/v1/admin/stats/summary", date=target.isoformat(), **params
            )

        body = await summary()
        assert body["excluded"] == {"admins": 2, "test_accounts": 1}
        assert body["members"] == {
            "total": 1,
            "signups_on_date": 0,  # 그날 가입한 팀테스트는 빠진다
            "signups_in_month": normal_in_month,
        }
        assert (
            body["activity"]
            == {
                "members_dau": 1,  # 일반회원만
                "members_mau": 1,
                "guests_dau": 2,  # 승계 없음 · 일반 회원에게 승계 — 내부 계정에게 승계된 셋은 빠진다
                "guests_mau": 2,
            }
        )
        assert body["play_sessions"] == {
            "created_on_date": 3,
            "created_on_date_by_member": 1,
            "created_on_date_by_guest": 2,
        }

        everyone = await summary(include_internal="true")
        assert everyone["include_internal"] is True
        assert everyone["excluded"] == {"admins": 0, "test_accounts": 0}
        assert everyone["members"]["total"] == 4
        assert everyone["members"]["signups_on_date"] == 1
        assert (
            everyone["activity"]
            == {
                "members_dau": 4,  # 일반회원 · 팀테스트 · 운영자 · 운영테스트(로그인 · 플레이 둘 다 — 한 번)
                "members_mau": 4,
                "guests_dau": 5,
                "guests_mau": 5,
            }
        )
        assert (
            everyone["play_sessions"]
            == {
                "created_on_date": 9,
                "created_on_date_by_member": 4,
                "created_on_date_by_guest": 5,  # 승계된 게스트 세션은 생성 당시 소유자대로 게스트 쪽
            }
        )

        def day_of(traffic):
            (row,) = traffic["daily"]
            return (
                row["members_dau"],
                row["guests_dau"],
                row["signups"],
                row["play_sessions_created"],
            )

        traffic = await get_json(
            "/api/v1/admin/stats/traffic", date=target.isoformat(), days=1
        )
        assert day_of(traffic) == (1, 2, 0, 3)
        traffic = await get_json(
            "/api/v1/admin/stats/traffic",
            date=target.isoformat(),
            days=1,
            include_internal="true",
        )
        assert day_of(traffic) == (4, 5, 1, 9)

        members = await get_json("/api/v1/admin/stats/members", date=target.isoformat())
        assert members["totals"]["total"] == 1
        assert members["signups_on_date"] == []
        assert [row["user_id"] for row in members["recent_signups"]] == [normal.id]
        assert members["by_region"] == [{"label": "naju", "count": 1}]
        members = await get_json(
            "/api/v1/admin/stats/members",
            date=target.isoformat(),
            include_internal="true",
        )
        assert members["totals"]["total"] == 4
        assert [row["user_id"] for row in members["signups_on_date"]] == [tester.id]

        # 서버 명령: 없는 회원 · 확인만은 아무것도 바꾸지 않는다
        async with sessions() as db:
            assert await cli.apply(db, str(uuid4()), False, execute=True) is None
        async with sessions() as db:
            dry = await cli.apply(db, tester.id, False, execute=False)
        assert dry == cli.Outcome(tester.id, "user", True, True, False)
        assert (await summary())["members"]["total"] == 1

        # 표시를 풀면 과거 날짜 통계도 지금 값으로 다시 센다 — 팀테스트와 그 게스트가 다시 든다(관리자 승계 게스트는 그대로 빠짐)
        async with sessions() as db:
            cleared = await cli.apply(db, tester.id, False, execute=True)
        assert cleared == cli.Outcome(tester.id, "user", True, False, True)
        body = await summary()
        assert body["excluded"] == {"admins": 2, "test_accounts": 0}
        assert body["members"]["total"] == 2
        assert body["members"]["signups_on_date"] == 1
        assert body["activity"]["members_dau"] == 2
        assert body["activity"]["guests_dau"] == 3
        assert body["play_sessions"]["created_on_date_by_member"] == 2
        assert body["play_sessions"]["created_on_date_by_guest"] == 3

        # 다시 지정하면 다시 빠진다 · 같은 값으로 또 지정하면 쓰지 않는다
        async with sessions() as db:
            marked = await cli.apply(db, tester.id, True, execute=True)
        assert marked == cli.Outcome(tester.id, "user", False, True, True)
        async with sessions() as db:
            again = await cli.apply(db, tester.id, True, execute=True)
        assert again == cli.Outcome(tester.id, "user", True, True, False)
        body = await summary()
        assert body["members"]["total"] == 1
        assert body["activity"]["guests_dau"] == 2

        # 관리자는 is_test 를 풀어도 role 로 계속 빠진다(제외 판정은 role OR is_test)
        async with sessions() as db:
            await cli.apply(db, both.id, False, execute=True)
        body = await summary()
        assert body["excluded"] == {"admins": 2, "test_accounts": 1}
        assert body["members"]["total"] == 1
        assert body["activity"] == {
            "members_dau": 1,
            "members_mau": 1,
            "guests_dau": 2,
            "guests_mau": 2,
        }

    mysql_run(scenario)


def test_game_stats_drop_records_linked_to_internal_accounts_only():
    async def scenario(sessions):
        target = kst_today() - 3 * DAY
        start = kst_day_start_utc(target)
        async with sessions() as db:
            seed = SeedT(db)
            admin = seed.user("운영자", start - 30 * DAY, role="admin")
            normal = seed.user("일반회원", start - 10 * DAY)
            tester = seed.tester("팀테스트", start - 10 * DAY)
            both = seed.tester("운영테스트", start - 10 * DAY, role="admin")
            linked = {
                user.id: seed.transfer_with_id(seed.guest(), user, start + 6 * HOUR)
                for user in (normal, tester, admin, both)
            }
            # 로그인한 기록 — 회원 id 로 이어진다
            seed.event(start + HOUR, user=normal, participant_code="P001")
            seed.event(start + HOUR, user=tester, participant_code="T001")
            seed.event(start + HOUR, user=admin, participant_code="A001")
            seed.event(start + HOUR, user=both)
            # 로그인 전 게스트 기록 — 각 계정에게 승계된 게스트, 그리고 승계 기록 없는 게스트
            for guest_session_id in linked.values():
                seed.event(start + 2 * HOUR, guest_session_id=guest_session_id)
            seed.event(start + 2 * HOUR, guest_session_id=str(uuid4()))
            # 계정도 게스트도 없는 기록 — 팀(테스트 · 관리자)의 참여 코드라도 판단하지 않고 남긴다
            seed.event(start + 3 * HOUR, participant_code="T001", tab_id="tab-test")
            seed.event(start + 3 * HOUR, participant_code="A001", tab_id="tab-admin")
            await seed.save()
        sign_in(admin)

        def opened(body):
            return dict((step["phase"], step["people"]) for step in body["funnel"])[
                "character_open"
            ]

        body = await get_json(
            "/api/v1/admin/stats/game", date=target.isoformat(), days=1
        )
        assert body["include_internal"] is False
        # 일반회원(+ 승계된 게스트) · 승계 없는 게스트 · 탭 둘 = 4
        assert body["people"] == 4 and opened(body) == 4
        everyone = await get_json(
            "/api/v1/admin/stats/game",
            date=target.isoformat(),
            days=1,
            include_internal="true",
        )
        # + 팀테스트 · 운영자 · 운영테스트(각자 승계된 게스트와 합쳐 한 사람씩)
        assert everyone["include_internal"] is True
        assert everyone["people"] == 7 and opened(everyone) == 7

        # 원본 기록은 그대로 — 11줄 모두 남아 있고 내보내기 API 도 전부 준다
        async with sessions() as db:
            assert len((await db.execute(select(BetaEvent.id))).all()) == 11
        exported = await get_json("/api/v1/admin/beta-events")
        assert len(exported["events"]) == 11

    mysql_run(scenario)
