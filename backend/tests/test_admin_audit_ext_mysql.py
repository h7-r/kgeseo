"""격리 MySQL 에서 관리자 감사 기록 확장(11/16 세진, revision 63566bb6005b)을 본다.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_ISOLATED=1` · `ADMIN_API_MYSQL_URL` · `ADMIN_API_MYSQL_DATADIR`,
`test_admin_api_` 접두사의 빈 schema, 3306 이 아닌 포트, 접속 뒤 `@@datadir` 대조, 끝나면 표를 지운다).

- migration: 바로 앞 head 까지 만든 뒤 쌓인 기록이 upgrade 뒤에도 그대로이고 새 열 넷은 NULL, 새 열은 NULL 허용 · 기본값 없음,
  예전 코드처럼 새 열 없이 넣어도 들어간다, downgrade 는 열만 지우고 행은 남는다
- API: 실제 관리자 요청이 IP · UA · 대상 표기를 남기고, `/admin/audit-logs` 가 기존 필드 그대로에 새 필드를 덧붙이며
  IP 원문은 내보내지 않는다. 공지 대상(notice) 기록도 쓰고 읽힌다
"""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.v1 import admin as admin_api
from app.models.account_data import AdminAuditLog
from app.services.admin_audit import capture_audit_request
from app.services.local_auth import utc_now
from tests.test_admin_api_mysql import DAY, HOUR, Seed, get_json, mysql_run, sign_in
from tests.test_admin_is_test_mysql import _isolated_url, _migration, _run_revisions
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, script

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

REVISION = "63566bb6005b"
NEW_COLUMNS = ("client_ip", "user_agent", "target_type", "target_id")


def test_migration_keeps_old_rows_adds_nullable_columns_and_downgrades_cleanly():
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
                assert script().get_revision(REVISION).down_revision == "e7a1b2c3d4f5"
                initialized = True

                # 바로 앞 head(e7a1b2c3d4f5)까지 — 확장 전에 쌓인 기록 둘
                await connection.run_sync(_run_revisions, stop_before=REVISION)
                old = [
                    (str(uuid4()), "read_user", str(uuid4())),
                    (str(uuid4()), "list_users", None),
                ]
                for admin_id, action, target in old:
                    await connection.execute(
                        text(
                            "INSERT INTO admin_audit_logs (admin_user_id, action, target_user_id, created_at) "
                            "VALUES (:a, :act, :t, NOW(6))"
                        ),
                        {"a": admin_id, "act": action, "t": target},
                    )

                await connection.run_sync(_migration, REVISION, "upgrade")
                columns = dict(
                    (
                        name,
                        (column_type, nullable, default),
                    )
                    for name, column_type, nullable, default in (
                        await connection.execute(
                            text(
                                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
                                "FROM information_schema.COLUMNS "
                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_audit_logs'"
                            )
                        )
                    ).all()
                )
                assert columns["client_ip"] == ("varchar(45)", "YES", None)
                assert columns["user_agent"] == ("varchar(512)", "YES", None)
                assert columns["target_type"] == ("varchar(32)", "YES", None)
                assert columns["target_id"] == ("varchar(64)", "YES", None)
                # 기존 열은 그대로
                assert columns["target_user_id"] == ("char(36)", "YES", None)
                assert columns["action"][1] == "NO"

                kept = (
                    await connection.execute(
                        text(
                            "SELECT admin_user_id, action, target_user_id, client_ip, user_agent, target_type, target_id "
                            "FROM admin_audit_logs ORDER BY id"
                        )
                    )
                ).all()
                assert [tuple(row[:3]) for row in kept] == old
                assert all(row[3:] == (None, None, None, None) for row in kept)

                # 예전 코드(배포 전환 사이)처럼 새 열 없이 넣어도 들어가고 NULL
                await connection.execute(
                    text(
                        "INSERT INTO admin_audit_logs (admin_user_id, action, target_user_id, created_at) "
                        "VALUES (:a, 'list_users', NULL, NOW(6))"
                    ),
                    {"a": str(uuid4())},
                )
                # 새 열을 다 채운 기록 — 최대 길이(UA 512 · id 64)도 들어간다
                notice_id = str(uuid4())
                await connection.execute(
                    text(
                        "INSERT INTO admin_audit_logs (admin_user_id, action, target_user_id, created_at, "
                        "client_ip, user_agent, target_type, target_id) "
                        "VALUES (:a, 'update_notice', NULL, NOW(6), :ip, :ua, 'notice', :tid)"
                    ),
                    {
                        "a": str(uuid4()),
                        "ip": "2001:db8:85a3:8d3:1319:8a2e:370:7348",
                        "ua": "u" * 512,
                        "tid": notice_id,
                    },
                )
                setting_key = "k" * 64
                await connection.execute(
                    text(
                        "INSERT INTO admin_audit_logs (admin_user_id, action, created_at, target_type, target_id) "
                        "VALUES (:a, 'update_setting', NOW(6), 'setting', :tid)"
                    ),
                    {"a": str(uuid4()), "tid": setting_key},
                )
                assert (
                    await connection.execute(
                        text("SELECT COUNT(*) FROM admin_audit_logs")
                    )
                ).scalar_one() == 5

                # downgrade 는 열만 지운다 — 다섯 행과 기존 열 값은 그대로
                await connection.run_sync(_migration, REVISION, "downgrade")
                remaining = {
                    row[0]
                    for row in (
                        await connection.execute(
                            text(
                                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_audit_logs'"
                            )
                        )
                    ).all()
                }
                assert remaining == {
                    "id",
                    "admin_user_id",
                    "action",
                    "target_user_id",
                    "created_at",
                }
                after = (
                    await connection.execute(
                        text(
                            "SELECT admin_user_id, action, target_user_id FROM admin_audit_logs ORDER BY id"
                        )
                    )
                ).all()
                assert len(after) == 5
                assert [tuple(row) for row in after[:2]] == old
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


def test_admin_requests_record_ip_ua_target_and_list_masks_ip():
    async def scenario(sessions):
        now = utc_now()
        async with sessions() as db:
            seed = Seed(db)
            admin = seed.user("운영자", now - 10 * DAY, role="admin")
            member = seed.user("가나다", now - 5 * DAY, email="member@example.com")
            await seed.save()
            # 확장 전 모양의 기록(새 열 없음)
            db.add(
                AdminAuditLog(
                    admin_user_id=admin.id,
                    action="list_users",
                    target_user_id=None,
                    created_at=now - HOUR,
                )
            )
            await db.commit()
        sign_in(admin)

        # 실제 관리자 요청 — httpx ASGITransport 의 연결 주소는 127.0.0.1, UA 는 httpx 기본값
        await get_json(f"/api/v1/admin/users/{member.id}")

        # 공지 API 가 쓸 모양 그대로(라우터 의존성이 잡은 요청 정보 + notice 대상)
        notice_id = str(uuid4())

        class _Req:
            client = type("C", (), {"host": "198.51.100.40"})()
            headers = {"user-agent": "UA/notice"}

        async with sessions() as db:
            await capture_audit_request(_Req())  # type: ignore[arg-type]
            await admin_api._audit(
                db,
                admin,
                "update_notice",
                None,
                target_type="notice",
                target_id=notice_id,
            )

        async with sessions() as db:
            stored = {
                row.action: row
                for row in (
                    await db.execute(select(AdminAuditLog).order_by(AdminAuditLog.id))
                ).scalars()
            }
        read = stored["read_user"]
        assert (read.target_user_id, read.target_type, read.target_id) == (
            member.id,
            "user",
            member.id,
        )
        assert read.client_ip == "127.0.0.1"
        assert read.user_agent and read.user_agent.startswith("python-httpx/")
        notice = stored["update_notice"]
        assert (notice.target_type, notice.target_id, notice.client_ip) == (
            "notice",
            notice_id,
            "198.51.100.40",
        )
        legacy = stored["list_users"]
        assert all(getattr(legacy, name) is None for name in NEW_COLUMNS)

        body = await get_json("/api/v1/admin/audit-logs")
        by_action = {log["action"]: log for log in body["logs"]}
        assert set(by_action) == {"update_notice", "read_user", "list_users"}
        # 기존 필드 그대로
        assert by_action["read_user"]["admin"] == {
            "user_id": admin.id,
            "nickname": "운영자",
        }
        assert by_action["read_user"]["target"] == {
            "user_id": member.id,
            "nickname": "가나다",
        }
        # 덧붙은 필드 — IP 는 앞 두 자리만
        assert by_action["read_user"]["target_type"] == "user"
        assert by_action["read_user"]["client_ip_display"] == "127.0.*.*"
        assert by_action["update_notice"]["target"] is None
        assert (
            by_action["update_notice"]["target_type"],
            by_action["update_notice"]["target_id"],
            by_action["update_notice"]["client_ip_display"],
            by_action["update_notice"]["user_agent"],
        ) == ("notice", notice_id, "198.51.*.*", "UA/notice")
        assert all(
            by_action["list_users"][name] is None
            for name in (
                "target_type",
                "target_id",
                "client_ip_display",
                "user_agent",
            )
        )
        assert "198.51.100.40" not in str(body) and "127.0.0.1" not in str(body)

    mysql_run(scenario)
