"""격리 MySQL 에서 관리자 API v0.2 1단계(11/12)를 본다 — 통계 요약 · 감사 기록 조회 · 회원 검색.

실행 조건은 `test_npc_turn_idempotency_mysql.py`와 같은 안전 장치를 따른다(기존 앱 DB 설정은 쓰지 않는다).
- `ADMIN_API_MYSQL_ISOLATED=1`
- `ADMIN_API_MYSQL_URL`: mysql+aiomysql, localhost 또는 127.0.0.1, 3306 이 아닌 명시 포트, `test_admin_api_` 접두사 DB
- `ADMIN_API_MYSQL_DATADIR`: 그 테스트 인스턴스의 실제 데이터 디렉터리(접속 뒤 `@@datadir` 와 대조)
전체 migration 체인을 적용하고, 끝나면 표를 직접 지운다. 이 PR 은 migration 을 더하지 않는다(기존 표 읽기만).
"""

import asyncio
import hashlib
import os
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import get_db
from app.main import app
from app.models.account_data import AdminAuditLog, UserSession
from app.models.anonymous_session import AnonymousSession
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.play_session import PlaySession
from app.services.admin_query import kst_day_start_utc, kst_range, kst_today
from app.services.local_auth import utc_now
from app.services.user_session import current_user
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, upgrade_chain

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

US = timedelta(microseconds=1)
HOUR = timedelta(hours=1)
DAY = timedelta(days=1)


def mysql_run(scenario) -> None:
    async def execute():
        url = make_url(os.environ["ADMIN_API_MYSQL_URL"])
        assert url.drivername == "mysql+aiomysql"
        assert url.host in {"127.0.0.1", "localhost"}
        assert url.port is not None and url.port != 3306
        assert url.database and url.database.startswith("test_admin_api_")
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
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )


def sign_in(user: AppUser) -> None:
    """매 요청 role 검사는 실제 `current_admin` 이 한다 — 세션 쿠키 확인만 그 사용자로 바꾼다."""

    app.dependency_overrides[current_user] = lambda: user


class Seed:
    """시험 데이터를 넣는다. 시각은 모두 UTC naive(저장 형식 그대로)."""

    def __init__(self, db) -> None:
        self.db = db
        # 표에 관계(relationship)가 없어 넣는 순서를 SQLAlchemy 가 FK 로 맞추지 않는다 — 부모 표부터 차례로 넣는다
        self.groups: list[list] = [[], [], []]
        self.anonymous = str(uuid4())
        self.groups[0].append(
            AnonymousSession(
                id=self.anonymous,
                created_at=utc_now() - 400 * DAY,
                expires_at=utc_now() + DAY,
            )
        )

    def user(
        self,
        nickname: str,
        created_at: datetime,
        *,
        role: str = "user",
        email: str | None = None,
    ) -> AppUser:
        user = AppUser(
            id=str(uuid4()),
            email=email or f"{uuid4().hex[:10]}@example.com",
            nickname=nickname,
            role=role,
            region="naju",
            created_at=created_at,
            updated_at=created_at,
        )
        self.groups[1].append(user)
        return user

    def identity(self, user: AppUser, provider: str) -> None:
        self.groups[2].append(
            AuthIdentity(
                id=str(uuid4()),
                app_user_id=user.id,
                provider=provider,
                provider_subject=uuid4().hex,
                password_hash="pbkdf2$secret" if provider == "local" else None,
                created_at=user.created_at,
                updated_at=user.created_at,
            )
        )

    def login(self, user: AppUser, at: datetime) -> None:
        self.groups[2].append(
            UserSession(
                id=str(uuid4()),
                app_user_id=user.id,
                token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
                created_at=at,
                expires_at=at + 14 * DAY,
            )
        )

    def guest(self) -> str:
        guest_id = str(uuid4())
        self.groups[0].append(
            AnonymousSession(
                id=guest_id,
                created_at=utc_now() - 400 * DAY,
                expires_at=utc_now() + DAY,
            )
        )
        return guest_id

    def play(
        self, at: datetime, *, user: AppUser | None = None, guest: str | None = None
    ) -> None:
        self.groups[2].append(
            PlaySession(
                id=str(uuid4()),
                anonymous_session_id=guest or self.anonymous,
                case_id="naju-angam-01",
                state_json={},
                created_at=at,
                updated_at=at,
                hint_balance=0,
                help_used=0,
                owner_user_id=user.id if user else None,
                owner_anonymous_session_id=guest,
            )
        )

    async def save(self) -> None:
        for group in self.groups:
            self.db.add_all(group)
            await self.db.flush()
        await self.db.commit()


async def get_json(path: str, **params) -> dict:
    async with client() as http:
        response = await http.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_stats_summary_counts_kst_day_dedupes_members_and_separates_guests():
    async def scenario(sessions):
        target = kst_today() - 3 * DAY
        start = kst_day_start_utc(target)  # target 00:00 KST = 전날 15:00 UTC
        end = start + DAY
        async with sessions() as db:
            seed = Seed(db)
            prev = seed.user("전날로그인", start - 40 * DAY)
            seed.login(prev, start - US)  # 15:00 UTC 1µs 전 — 전날(KST)
            first = seed.user("자정가입", start)  # 00:00 KST 정각 가입 · 로그인
            seed.login(first, start)
            both = seed.user("둘다", start - 5 * DAY)
            seed.login(both, start + HOUR)
            seed.play(start + 2 * HOUR, user=both)  # 로그인 · 플레이 둘 다 — 한 번만
            late = seed.user("막차", start - 2 * DAY)
            seed.play(end - US, user=late)  # 23:59:59.999999 KST
            nextday = seed.user("다음날", end)  # 다음 날 00:00 KST
            seed.play(end, user=nextday)
            edge = seed.user("30일끝", start - 60 * DAY)
            seed.login(edge, start - 29 * DAY)  # 30일 창의 첫날 00:00 KST
            outside = seed.user("30일밖", start - 60 * DAY)
            seed.login(outside, start - 29 * DAY - US)
            seed.user("한번도안옴", start - 3 * DAY)
            admin = seed.user("운영자", start + 3 * HOUR, role="admin")
            seed.login(admin, start + HOUR)
            seed.play(start + HOUR, user=admin)
            g1, g2, g3 = seed.guest(), seed.guest(), seed.guest()
            seed.play(start + HOUR, guest=g1)
            seed.play(start + 5 * HOUR, guest=g1)  # 같은 게스트 두 번 — 게스트 DAU 1
            seed.play(start - 10 * DAY, guest=g2)
            seed.play(start - US, guest=g3)  # 전날 — MAU 만
            seed.play(start + 4 * HOUR)  # 소유자 없는 옛 세션 — 게스트 쪽 세션 수에만
            await seed.save()
            members = [prev, first, both, late, nextday, edge, outside]
            all_created = [u.created_at for u in members] + [start - 3 * DAY]
        sign_in(admin)

        month_start, month_end = kst_range(target.replace(day=1), target)
        in_month = sum(1 for at in all_created if month_start <= at < month_end)

        body = await get_json("/api/v1/admin/stats/summary", date=target.isoformat())
        assert body["date"] == target.isoformat()
        assert body["timezone"] == "Asia/Seoul"
        assert body["include_internal"] is False
        assert body["range_utc"]["day"] == [start.isoformat(), end.isoformat()]
        assert body["range_utc"]["last_30_days"][0] == (start - 29 * DAY).isoformat()
        assert body["excluded"] == {"admins": 1, "test_accounts": 0}
        assert body["members"] == {
            "total": 8,
            "signups_on_date": 1,
            "signups_in_month": in_month,
        }
        assert body["activity"] == {
            "members_dau": 3,  # 자정가입 · 둘다(한 번) · 막차
            "members_mau": 5,  # + 전날로그인 · 30일끝
            "guests_dau": 1,
            "guests_mau": 3,
        }
        assert body["play_sessions"] == {
            "created_on_date": 5,
            "created_on_date_by_member": 2,
            "created_on_date_by_guest": 3,
        }
        assert body["unavailable"] == {
            "lobby_concurrent": "lobby_metrics_not_connected"
        }

        # 관리자 포함 — 회원 통계 전체에 같은 규칙
        inside = await get_json(
            "/api/v1/admin/stats/summary",
            date=target.isoformat(),
            include_internal="true",
        )
        assert inside["include_internal"] is True
        assert inside["excluded"] == {"admins": 0, "test_accounts": 0}
        assert inside["members"]["total"] == 9
        assert inside["members"]["signups_on_date"] == 2
        assert inside["activity"]["members_dau"] == 4
        assert inside["activity"]["members_mau"] == 6
        assert inside["activity"]["guests_dau"] == 1
        assert inside["play_sessions"] == {
            "created_on_date": 6,
            "created_on_date_by_member": 3,
            "created_on_date_by_guest": 3,
        }

        # 전날(KST)로 보면 15:00 UTC 1µs 전 로그인이 그날로 들어간다
        before = await get_json(
            "/api/v1/admin/stats/summary", date=(target - DAY).isoformat()
        )
        assert before["activity"]["members_dau"] == 1  # 전날로그인
        assert before["activity"]["guests_dau"] == 1  # g3

    mysql_run(scenario)


def test_user_search_is_nickname_partial_and_email_exact_only():
    async def scenario(sessions):
        now = utc_now()
        async with sessions() as db:
            seed = Seed(db)
            minsoo = seed.user("가나다라", now - 3 * DAY, email="minsoo@example.com")
            seed.identity(minsoo, "local")
            seed.identity(minsoo, "google")
            seed.login(minsoo, now - 2 * DAY)
            seed.login(minsoo, now - HOUR)
            kimchi = seed.user(
                "Kimchi", now - 2 * DAY, email="kimchi.lover@example.com"
            )
            seed.user("다른사람", now - DAY, email="ab@example.org")
            admin = seed.user(
                "운영자", now - 10 * DAY, role="admin", email="ops@example.com"
            )
            await seed.save()
        sign_in(admin)

        async def nicknames(**params) -> list[str]:
            body = await get_json("/api/v1/admin/users", **params)
            return [user["nickname"] for user in body["users"]]

        assert await nicknames(q="나다") == ["가나다라"]
        assert await nicknames(q="KIM") == ["Kimchi"]  # 대소문자 무시
        assert await nicknames(q="minsoo@example.com") == ["가나다라"]
        assert await nicknames(q="  MinSoo@Example.COM ") == [
            "가나다라"
        ]  # 정규화한 완전 일치
        # 이메일 부분 검색은 안 된다
        assert await nicknames(q="minsoo@") == []
        assert await nicknames(q="@example.com") == []
        assert await nicknames(q="example.com") == []
        assert (
            await nicknames(q="minsoo") == []
        )  # 닉네임 검색은 이메일 칸을 보지 않는다
        assert await nicknames(q="%") == []  # LIKE 와일드카드는 글자 그대로

        body = await get_json("/api/v1/admin/users")
        assert [user["nickname"] for user in body["users"]] == [
            "다른사람",
            "Kimchi",
            "가나다라",
            "운영자",
        ]
        assert body["next_offset"] is None
        row = body["users"][2]
        # 기존 필드는 그대로, 추가 필드
        assert set(row) == {
            "user_id",
            "email",
            "nickname",
            "role",
            "created_at",
            "stage",
            "save_updated_at",
            "region",
            "providers",
            "last_login_at",
            "last_session_started_at",
        }
        # 목록 이메일은 아직 전체(「베타 기록」 화면이 이것으로 시험 계정을 거른다 — 서버 가림은 베타 뒤)
        assert row["email"] == "minsoo@example.com"
        assert body["users"][0]["email"] == "ab@example.org"
        assert row["providers"] == ["google", "local"]
        assert row["last_login_at"] is None
        assert row["last_session_started_at"] == (now - HOUR).isoformat()
        assert row["region"] == "naju" and row["stage"] is None
        assert (
            body["users"][1]["providers"] == []
            and body["users"][1]["last_session_started_at"] is None
        )
        assert "password_hash" not in str(body) and "provider_subject" not in str(body)

        paged = await get_json("/api/v1/admin/users", limit="1")
        assert len(paged["users"]) == 1 and paged["next_offset"] == 1

        # 상세는 지금처럼 전체 이메일
        detail = await get_json(f"/api/v1/admin/users/{minsoo.id}")
        assert detail["user"]["email"] == "minsoo@example.com"
        assert set(detail["user"]) == {
            "user_id",
            "email",
            "nickname",
            "role",
            "created_at",
            "stage",
            "save_updated_at",
        }

        # 목록 조회 한 번에 감사 기록 한 행 — 검색어는 남지 않는다(컬럼도 없다)
        async with sessions() as db:
            listed = await db.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "list_users")
            )
        assert listed == 11
        _ = kimchi

    mysql_run(scenario)


def test_audit_logs_list_filter_and_record_their_own_reading():
    async def scenario(sessions):
        now = utc_now()
        async with sessions() as db:
            seed = Seed(db)
            admin = seed.user("운영자", now - 10 * DAY, role="admin")
            other_admin = seed.user("부운영자", now - 10 * DAY, role="admin")
            member = seed.user("가나다", now - 5 * DAY, email="member@example.com")
            await seed.save()
            gone = str(uuid4())
            # 사라진 사용자(감사 기록에는 FK 가 없다) · 40일 전 기록
            db.add(
                AdminAuditLog(
                    admin_user_id=gone,
                    action="read_user",
                    target_user_id=gone,
                    created_at=now - HOUR,
                )
            )
            db.add(
                AdminAuditLog(
                    admin_user_id=other_admin.id,
                    action="list_users",
                    target_user_id=None,
                    created_at=now - 40 * DAY,
                )
            )
            await db.commit()
        sign_in(admin)

        await get_json("/api/v1/admin/users")
        await get_json(f"/api/v1/admin/users/{member.id}")

        first = await get_json("/api/v1/admin/audit-logs")
        actions = [log["action"] for log in first["logs"]]
        # 방금 한 감사 기록 조회는 이 응답에 없다(결과를 만든 뒤 기록한다)
        assert actions == ["read_user", "list_users", "read_user"]
        read, listed, orphan = first["logs"]
        assert read["admin"] == {"user_id": admin.id, "nickname": "운영자"}
        assert read["target"] == {"user_id": member.id, "nickname": "가나다"}
        assert listed["target"] is None
        assert orphan["admin"] == {"user_id": gone, "nickname": None}
        assert orphan["target"] == {"user_id": gone, "nickname": None}
        for log in first["logs"]:
            # 저장된 다섯 컬럼 + 닉네임만 — IP · User-Agent · 이메일 키가 없다
            assert set(log) == {"id", "created_at", "action", "admin", "target"}
            assert set(log["admin"]) == {"user_id", "nickname"}
        assert "member@example.com" not in str(first)
        assert first["next_offset"] is None

        # 다음 조회부터 앞 조회가 보인다
        second = await get_json("/api/v1/admin/audit-logs")
        assert second["logs"][0]["action"] == "list_audit_logs"
        assert second["logs"][0]["admin"]["user_id"] == admin.id
        assert second["logs"][0]["target"] is None

        only_reads = await get_json("/api/v1/admin/audit-logs", action="read_user")
        assert [log["action"] for log in only_reads["logs"]] == [
            "read_user",
            "read_user",
        ]

        by_admin = await get_json("/api/v1/admin/audit-logs", admin_user_id=admin.id)
        assert {log["admin"]["user_id"] for log in by_admin["logs"]} == {admin.id}

        # 대상 필터로 조회하면 그 조회의 기록도 그 대상으로 남는다
        targeted = await get_json("/api/v1/admin/audit-logs", target_user_id=member.id)
        assert [log["action"] for log in targeted["logs"]] == ["read_user"]
        again = await get_json("/api/v1/admin/audit-logs", target_user_id=member.id)
        assert [log["action"] for log in again["logs"]] == [
            "list_audit_logs",
            "read_user",
        ]

        # 기본은 최근 30일 — 40일 전 기록은 기간을 넓혀야 보인다
        old_day = (kst_today() - 40 * DAY).isoformat()
        assert all(log["admin"]["user_id"] != other_admin.id for log in second["logs"])
        widened = await get_json(
            "/api/v1/admin/audit-logs", **{"from": old_day, "to": old_day}
        )
        assert [log["admin"]["nickname"] for log in widened["logs"]] == ["부운영자"]

        # 쪽을 넘겨도 같은 기록이 되풀이되지 않는다 — 조회마다 맨 앞에 끼어드는 자기 기록만큼 다음 시작이 밀린다
        snapshot = await get_json("/api/v1/admin/audit-logs", limit="50")
        expected = [log["id"] for log in snapshot["logs"]]
        seen: list[int] = []
        offset = 0
        while True:
            page = await get_json(
                "/api/v1/admin/audit-logs", limit="1", offset=str(offset)
            )
            seen += [log["id"] for log in page["logs"]]
            if page["next_offset"] is None:
                break
            offset = page["next_offset"]
        # 첫 쪽 앞에는 snapshot 조회의 기록이 하나 더 끼어 있다
        assert seen[1:] == expected
        assert len(seen) == len(set(seen))

        async with sessions() as db:
            reads_recorded = await db.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "list_audit_logs")
            )
        assert reads_recorded == 7 + 1 + len(seen)  # 감사 기록 조회 한 번에 한 행

    mysql_run(scenario)


def test_admin_routes_refuse_normal_member_on_real_database():
    async def scenario(sessions):
        async with sessions() as db:
            seed = Seed(db)
            member = seed.user("회원", utc_now() - DAY)
            await seed.save()
        sign_in(member)
        async with client() as http:
            for path in (
                "/api/v1/admin/stats/summary",
                "/api/v1/admin/audit-logs",
                "/api/v1/admin/users?q=회원",
            ):
                response = await http.get(path)
                assert response.status_code == 403, path
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(AdminAuditLog)) == 0

    mysql_run(scenario)
