"""격리 MySQL 에서 공지사항 API v0.2(11/16 세진, revision 734021834040)를 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

- migration: 열 형식(MEDIUMTEXT · VARCHAR(200) · utf8mb4 · is_pinned NOT NULL DEFAULT 0 · FK ON DELETE SET NULL), 한글 200자 제목 ·
  4바이트 문자 20,000자 본문 저장, 작성 관리자 삭제 시 created_by NULL, downgrade 는 notices 만 지운다
- 공개: 게시된 것만(초안 · 예약 · 삭제 제외) · 고정 먼저 정렬 · 쪽 나눔(기본 6) · 분류 · 예약 시각이 지나면 게시 · Cache-Control
- 관리자: 상태 계산 · 상태 필터 · 소프트 삭제 · 감사 기록(target_type="notice")
- 옛 공지 이전: 실제 DB 에서 두 번 실행해도 한 번만 들어가고, 지운 공지를 되살리지 않는다
"""

import asyncio
import os
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.v1 import notices as public_api
from app.core.config import settings
from app.main import app
from app.models.account_data import AdminAuditLog
from app.models.notice import Notice
from app.services.local_auth import utc_now
from scripts import import_legacy_notices as legacy
from tests.test_admin_api_mysql import DAY, HOUR, Seed, mysql_run, sign_in
from tests.test_admin_is_test_mysql import _isolated_url, _migration, _run_revisions
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, script

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

REVISION = "734021834040"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": settings.cors_origins[0]},
    )


def test_migration_column_types_utf8mb4_limits_fk_and_downgrade():
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
                assert script().get_revision(REVISION).down_revision == "63566bb6005b"
                initialized = True

                await connection.run_sync(_run_revisions, stop_before=REVISION)
                audit_before = (
                    await connection.execute(
                        text("SELECT COUNT(*) FROM admin_audit_logs")
                    )
                ).scalar_one()
                await connection.run_sync(_migration, REVISION, "upgrade")

                columns = {
                    name: (column_type, nullable, default)
                    for name, column_type, nullable, default in (
                        await connection.execute(
                            text(
                                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
                                "FROM information_schema.COLUMNS "
                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'"
                            )
                        )
                    ).all()
                }
                assert columns == {
                    "id": ("char(36)", "NO", None),
                    "category": ("varchar(16)", "NO", None),
                    "title": ("varchar(200)", "NO", None),
                    "body": ("mediumtext", "NO", None),
                    "is_pinned": ("tinyint(1)", "NO", "0"),
                    "published_at": ("datetime(6)", "YES", None),
                    "created_by": ("char(36)", "YES", None),
                    "created_at": ("datetime(6)", "NO", None),
                    "updated_at": ("datetime(6)", "NO", None),
                    "deleted_at": ("datetime(6)", "YES", None),
                }
                charset = (
                    await connection.execute(
                        text(
                            "SELECT CCSA.CHARACTER_SET_NAME FROM information_schema.TABLES T "
                            "JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY CCSA "
                            "ON CCSA.COLLATION_NAME = T.TABLE_COLLATION "
                            "WHERE T.TABLE_SCHEMA = DATABASE() AND T.TABLE_NAME = 'notices'"
                        )
                    )
                ).scalar_one()
                assert charset == "utf8mb4"
                delete_rule = (
                    await connection.execute(
                        text(
                            "SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS "
                            "WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'"
                        )
                    )
                ).scalar_one()
                assert delete_rule == "SET NULL"

                # 작성 관리자 · 최대 길이(한글 200자 제목 · 4바이트 이모지 20,000자 = 80,000바이트 본문)
                admin_id = str(uuid4())
                await connection.execute(
                    text(
                        "INSERT INTO app_users (id, email, nickname, role, created_at, updated_at) "
                        "VALUES (:id, 'n-admin@example.com', '공지관리자', 'admin', NOW(6), NOW(6))"
                    ),
                    {"id": admin_id},
                )
                notice_id = str(uuid4())
                title = "가" * 200
                body = "😀" * 20_000
                await connection.execute(
                    text(
                        "INSERT INTO notices (id, category, title, body, created_by, created_at, updated_at) "
                        "VALUES (:id, 'update', :title, :body, :by, NOW(6), NOW(6))"
                    ),
                    {"id": notice_id, "title": title, "body": body, "by": admin_id},
                )
                stored = (
                    await connection.execute(
                        text(
                            "SELECT title, body, is_pinned, published_at, deleted_at, OCTET_LENGTH(body) "
                            "FROM notices WHERE id = :id"
                        ),
                        {"id": notice_id},
                    )
                ).one()
                assert stored == (title, body, 0, None, None, 80_000)
                # 관리자를 지워도 공지는 남고 작성자만 NULL
                await connection.execute(
                    text("DELETE FROM app_users WHERE id = :id"), {"id": admin_id}
                )
                assert (
                    await connection.execute(
                        text("SELECT created_by FROM notices WHERE id = :id"),
                        {"id": notice_id},
                    )
                ).scalar_one() is None

                await connection.run_sync(_migration, REVISION, "downgrade")
                tables = {
                    row[0]
                    for row in (await connection.execute(text("SHOW TABLES"))).all()
                }
                assert "notices" not in tables and "admin_audit_logs" in tables
                assert (
                    await connection.execute(
                        text("SELECT COUNT(*) FROM admin_audit_logs")
                    )
                ).scalar_one() == audit_before
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


def test_public_and_admin_flows_on_real_database(monkeypatch):
    async def scenario(sessions):
        now = utc_now()
        async with sessions() as db:
            seed = Seed(db)
            admin = seed.user("공지관리자", now - 10 * DAY, role="admin")
            await seed.save()
        sign_in(admin)

        async def create(**body):
            payload = {"category": "update", "title": "t", "body": "b", **body}
            async with _client() as http:
                response = await http.post("/api/v1/admin/notices", json=payload)
            assert response.status_code == 201, response.text
            return response.json()

        def iso(delta):
            return (now + delta).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"

        # 게시 8건(그중 고정 2건 — 하나는 가장 오래됨), 초안 · 예약 · 삭제 각 1건
        published = []
        for index in range(6):
            published.append(
                await create(
                    title=f"게시{index}", published_at=iso(-(index + 2) * HOUR)
                )
            )
        old_pinned = await create(
            title="오래된 고정", is_pinned=True, published_at=iso(-30 * DAY)
        )
        new_pinned = await create(
            title="최근 고정",
            category="maintenance",
            is_pinned=True,
            published_at=iso(-1 * DAY),
        )
        draft = await create(title="초안")
        scheduled = await create(title="예약", published_at=iso(2 * HOUR))
        gone = await create(
            title="삭제될 공지", published_at=iso(-timedelta(minutes=90))
        )
        assert (old_pinned["is_pinned"], old_pinned["status"]) == (True, "published")
        assert (draft["status"], scheduled["status"], gone["status"]) == (
            "draft",
            "scheduled",
            "published",
        )
        async with _client() as http:
            assert (
                await http.delete(f"/api/v1/admin/notices/{gone['id']}")
            ).status_code == 204

        async with _client() as http:
            first = await http.get("/api/v1/notices")
            second = await http.get("/api/v1/notices", params={"page": 2})
            only_maintenance = await http.get(
                "/api/v1/notices", params={"category": "maintenance"}
            )
            hidden = [
                (await http.get(f"/api/v1/notices/{item['id']}")).status_code
                for item in (draft, scheduled, gone)
            ]
            shown = await http.get(f"/api/v1/notices/{published[0]['id']}")
        assert first.headers["Cache-Control"] == "public, max-age=60"
        page1 = first.json()
        assert (
            page1["page"],
            page1["page_size"],
            page1["total"],
            page1["total_pages"],
        ) == (
            1,
            6,
            8,
            2,
        )
        # 고정 먼저(그 안에서는 최근 게시 먼저), 그다음 최근 게시 먼저
        assert [item["title"] for item in page1["items"]] == [
            "최근 고정",
            "오래된 고정",
            "게시0",
            "게시1",
            "게시2",
            "게시3",
        ]
        assert [item["title"] for item in second.json()["items"]] == ["게시4", "게시5"]
        assert set(page1["items"][0]) == {
            "id",
            "category",
            "title",
            "is_pinned",
            "published_at",
        }
        assert [item["id"] for item in only_maintenance.json()["items"]] == [
            new_pinned["id"]
        ]
        assert hidden == [404, 404, 404]
        detail = shown.json()
        assert (detail["body"], detail["title"]) == ("b", "게시0")
        assert detail["published_at"].endswith("Z") is False  # UTC naive ISO

        # 예약 시각이 지나면(별도 작업 없이) 그 순간부터 게시
        monkeypatch.setattr(public_api, "utc_now", lambda: now + 3 * HOUR)
        async with _client() as http:
            later = (await http.get("/api/v1/notices", params={"page_size": 50})).json()
            scheduled_detail = await http.get(f"/api/v1/notices/{scheduled['id']}")
        assert later["total"] == 9 and scheduled_detail.status_code == 200
        assert later["items"][2]["title"] == "예약"  # 고정 둘 다음, 가장 최근 게시

        # 관리자 목록: 삭제 제외 · 상태 필터
        async with _client() as http:
            every = (await http.get("/api/v1/admin/notices")).json()
            drafts = (
                await http.get("/api/v1/admin/notices", params={"status": "draft"})
            ).json()
            sched = (
                await http.get("/api/v1/admin/notices", params={"status": "scheduled"})
            ).json()
            deleted_detail = await http.get(f"/api/v1/admin/notices/{gone['id']}")
        assert len(every["items"]) == 10 and every["next_offset"] is None
        assert gone["id"] not in {item["id"] for item in every["items"]}
        assert [item["id"] for item in drafts["items"]] == [draft["id"]]
        assert [item["id"] for item in sched["items"]] == [scheduled["id"]]
        assert deleted_detail.status_code == 404
        assert every["items"][0]["created_by"] == {
            "user_id": admin.id,
            "nickname": "공지관리자",
        }

        # 수정: 초안을 게시로, 고정 해제
        async with _client() as http:
            patched = await http.patch(
                f"/api/v1/admin/notices/{draft['id']}",
                json={"published_at": iso(-1 * HOUR), "body": "고친 본문"},
            )
        assert patched.json()["status"] == "published"

        async with sessions() as db:
            row = await db.get(Notice, gone["id"])
            assert (
                row is not None and row.deleted_at is not None
            )  # 소프트 삭제(행은 남음)
            audits = (
                await db.execute(
                    select(
                        AdminAuditLog.action,
                        AdminAuditLog.target_type,
                        AdminAuditLog.target_id,
                        AdminAuditLog.target_user_id,
                    ).order_by(AdminAuditLog.id)
                )
            ).all()
        actions = [a[0] for a in audits]
        assert actions.count("create_notice") == 11
        assert actions.count("delete_notice") == 1
        assert actions.count("update_notice") == 1
        assert all(a[1] == "notice" and a[3] is None for a in audits)
        assert ("delete_notice", "notice", gone["id"], None) in audits

        # 감사 기록 조회 필터에 공지 action 이 든다
        async with _client() as http:
            filtered = (
                await http.get(
                    "/api/v1/admin/audit-logs", params={"action": "delete_notice"}
                )
            ).json()
        assert [log["target_id"] for log in filtered["logs"]] == [gone["id"]]

        # 옛 공지 이전 — 사람이 준 본문이 있는 한 건만, 두 번 실행해도 한 번만. 지운 것은 되살리지 않는다
        notices = legacy.parse_legacy_notices(
            legacy.DEFAULT_SOURCE.read_text(encoding="utf-8")
        )
        planned = legacy.plan(notices, {notices[1].legacy_key: "운영팀이 쓴 본문"})
        candidates = [item for item in planned if item.is_candidate]
        assert len(candidates) == 1
        async with sessions() as db:
            assert [
                len(x) for x in await legacy.import_candidates(db, candidates, now)
            ] == [1, 0]
        async with sessions() as db:
            assert [
                len(x) for x in await legacy.import_candidates(db, candidates, now)
            ] == [0, 1]
        legacy_id = candidates[0].notice.notice_id
        async with _client() as http:
            assert (
                await http.delete(f"/api/v1/admin/notices/{legacy_id}")
            ).status_code == 204
        async with sessions() as db:
            assert [
                len(x) for x in await legacy.import_candidates(db, candidates, now)
            ] == [0, 1]
            count = (
                (await db.execute(select(Notice).where(Notice.id == legacy_id)))
                .scalars()
                .all()
            )
            assert len(count) == 1 and count[0].deleted_at is not None

    mysql_run(scenario)


def test_public_category_filter_then_paginate_with_pinned_first():
    """해랑 확인 요청(11/16): 분류 필터를 먼저 걸고 쪽을 나눈다 · total/total_pages 는 필터 결과 기준 · 기본 6 ·
    고정 공지는 필터 결과 전체의 맨 앞(쪽마다 반복 안 함) · 목록에는 body 없음 · 잘못된 분류는 422."""

    async def scenario(sessions):
        now = utc_now()
        rows = []

        def add(category, title, published, *, pinned=False, deleted=False):
            rows.append(
                Notice(
                    id=str(uuid4()),
                    category=category,
                    title=title,
                    body=f"{title} 본문",
                    is_pinned=pinned,
                    published_at=published,
                    created_by=None,
                    created_at=now,
                    updated_at=now,
                    deleted_at=now if deleted else None,
                )
            )

        # maintenance 게시 7(고정 2 — 하나는 가장 오래됨) · event 게시 2(고정 1) · update 게시 1 ·
        # info 는 초안 · 예약 · 삭제뿐(공개 0)
        for index in range(5):
            add("maintenance", f"점검{index}", now - (index + 1) * HOUR)
        add("maintenance", "점검-고정-오래됨", now - 40 * DAY, pinned=True)
        add("maintenance", "점검-고정-최근", now - 2 * DAY, pinned=True)
        add("event", "이벤트-고정", now - 10 * DAY, pinned=True)
        add("event", "이벤트", now - 30 * HOUR)
        add("update", "업데이트", now - 3 * DAY)
        add("info", "안내-초안", None)
        add("info", "안내-예약", now + DAY)
        add("info", "안내-삭제", now - DAY, deleted=True)
        async with sessions() as db:
            db.add_all(rows)
            await db.commit()

        async def page(**params):
            async with _client() as http:
                response = await http.get("/api/v1/notices", params=params)
            return response

        everything = (await page()).json()
        assert (
            everything["total"],
            everything["total_pages"],
            everything["page_size"],
        ) == (
            10,
            2,
            6,
        )
        # 전체: 고정 셋이 1쪽 맨 앞(최근 게시 순), 2쪽에는 고정이 다시 나오지 않는다
        assert [i["title"] for i in everything["items"][:3]] == [
            "점검-고정-최근",
            "이벤트-고정",
            "점검-고정-오래됨",
        ]
        second_all = (await page(page=2)).json()
        assert not any(i["is_pinned"] for i in second_all["items"])
        assert len(everything["items"]) + len(second_all["items"]) == 10

        expected = {
            "maintenance": (7, 2),
            "event": (2, 1),
            "update": (1, 1),
            "info": (0, 0),
        }
        for category, (total, pages) in expected.items():
            first = (await page(category=category)).json()
            assert (first["total"], first["total_pages"], first["page"]) == (
                total,
                pages,
                1,
            ), category
            assert all(i["category"] == category for i in first["items"])
            for item in first["items"]:
                assert set(item) == {
                    "id",
                    "category",
                    "title",
                    "is_pinned",
                    "published_at",
                }

        maintenance_1 = (await page(category="maintenance")).json()
        maintenance_2 = (await page(category="maintenance", page=2)).json()
        assert [i["title"] for i in maintenance_1["items"]] == [
            "점검-고정-최근",
            "점검-고정-오래됨",
            "점검0",
            "점검1",
            "점검2",
            "점검3",
        ]
        assert [i["title"] for i in maintenance_2["items"]] == ["점검4"]
        assert (await page(category="event")).json()["items"][0][
            "title"
        ] == "이벤트-고정"
        # 필터 결과 밖의 쪽은 빈 목록(200)
        beyond = await page(category="event", page=5)
        assert beyond.status_code == 200 and beyond.json()["items"] == []
        # 상세에만 본문
        async with _client() as http:
            detail = (
                await http.get(f"/api/v1/notices/{maintenance_1['items'][0]['id']}")
            ).json()
        assert detail["body"] == "점검-고정-최근 본문"

        for bad in ("Maintenance", "점검", "", "notice", "maintenance,event"):
            response = await page(category=bad)
            assert response.status_code == 422, bad
            assert response.json()["detail"]["code"] == "invalid_query"
            assert response.headers["Cache-Control"] == "no-store"

    mysql_run(scenario)
