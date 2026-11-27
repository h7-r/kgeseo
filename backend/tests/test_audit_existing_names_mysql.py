"""격리 MySQL 에서 기존 이름 정책 점검(scripts.audit_existing_names) — 묶음 조회 · 읽기 전용 · 집계 · 개인정보 미출력.

실행 조건 · 안전 장치는 `test_admin_api_mysql.py` 와 같다(`ADMIN_API_MYSQL_*`). 회원 · 캐릭터는 모두 가상 값이다.
"""

import os
import re
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, select, text, update

from app.models.account_data import UserCharacter
from app.models.app_user import AppUser
from app.services.local_auth import utc_now
from scripts import audit_existing_names as audit
from tests.test_admin_api_mysql import mysql_run

pytestmark = pytest.mark.skipif(
    os.environ.get("ADMIN_API_MYSQL_ISOLATED") != "1",
    reason="explicit isolated admin API MySQL test database required",
)

# (닉네임, 조사관명 또는 None, role, is_test, 탈퇴)
PEOPLE = [
    ("한서진", "조사_관", "user", False, False),  # 둘 다 정상
    (
        "운영진",
        "운영진",
        "user",
        False,
        False,
    ),  # 둘 다 공유 정책만 거부 → 로비는 계정 닉네임(이것도 위반)
    ("미르", "개발자", "user", False, False),  # 조사관명만 거부 → 계정 닉네임(정상)
    (
        "황보지은",
        None,
        "user",
        False,
        False,
    ),  # 옛 목록 오탐 이름 — 지금 정상 · 캐릭터 없음
    ("김철수", "김 철수", "user", False, False),  # 조사관명은 공백 허용
    ("존나", None, "user", False, False),  # 금칙어 · 캐릭터 없음
    ("해랑", "Agent_007", "admin", False, False),  # 관리자(정상 이름)
    ("시험계정", "ㅋㅋ조사관", "user", True, False),  # 테스트 계정 · 자모 조사관명
    ("탈퇴#0123456789abcdef", None, "user", False, True),  # 탈퇴 — 제외
]


async def seed(sessions):
    now = utc_now()
    ids = []
    async with sessions() as db:
        for i, (nickname, character, role, is_test, withdrawn) in enumerate(PEOPLE):
            uid = str(uuid4())
            ids.append(uid)
            db.add(
                AppUser(
                    id=uid,
                    email=f"audit{i}-{uid[:6]}@example.com",
                    nickname=nickname,
                    role=role,
                    is_test=is_test,
                    created_at=now - timedelta(days=10),
                    updated_at=now,
                    deleted_at=now if withdrawn else None,
                )
            )
        await db.flush()
        for uid, (_, character, *_rest) in zip(ids, PEOPLE):
            if character is not None:
                db.add(
                    UserCharacter(
                        app_user_id=uid,
                        display_name=character,
                        appearance_json={},
                        updated_at=now,
                    )
                )
        await db.commit()
    return ids


async def state(sessions):
    async with sessions() as db:
        users = (
            await db.execute(
                select(
                    AppUser.id, AppUser.nickname, AppUser.email, AppUser.updated_at
                ).order_by(AppUser.id)
            )
        ).all()
        chars = (
            await db.execute(
                select(
                    UserCharacter.app_user_id,
                    UserCharacter.display_name,
                    UserCharacter.updated_at,
                ).order_by(UserCharacter.app_user_id)
            )
        ).all()
    return [tuple(r) for r in users], [tuple(r) for r in chars]


@pytest.fixture
def on_test_db(monkeypatch):
    import app.db.session as session_module

    class KeepEngine:
        async def dispose(self):
            pass

    def install(sessions):
        monkeypatch.setattr(session_module, "AsyncSessionLocal", sessions)
        monkeypatch.setattr(session_module, "engine", KeepEngine())

    return install


def numbers(out: str, label: str) -> str:
    match = re.search(rf"^{re.escape(label)}: (.*)$", out, re.M)
    assert match, label
    return match.group(1)


@pytest.mark.parametrize("batch", [1, 2, 500])
def test_mysql_audit_counts_with_any_batch_size(on_test_db, capsys, batch):
    async def scenario(sessions):
        on_test_db(sessions)
        ids = await seed(sessions)
        before = await state(sessions)
        statements = []
        engine = sessions.kw["bind"].sync_engine

        def record(conn, cursor, statement, parameters, context, many):
            statements.append(
                statement.lstrip().split()[0].upper()
                + " "
                + statement.lstrip().split()[1].upper()
            )

        event.listen(engine, "before_cursor_execute", record)
        try:
            code = await audit._run(audit.parse_args(["--batch-size", str(batch)]))
        finally:
            event.remove(engine, "before_cursor_execute", record)
        out = capsys.readouterr().out

        assert code == audit.EXIT_OK
        assert await state(sessions) == before  # 바뀐 것 없음
        # 첫 문장은 읽기 전용 트랜잭션 선언, 나머지는 모두 SELECT · 끝의 ROLLBACK 뿐
        assert statements[0] == "SET TRANSACTION"
        assert all(s.startswith(("SELECT", "ROLLBACK")) for s in statements[1:]), (
            statements
        )
        assert numbers(out, "Total rows") == "9"
        assert numbers(out, "Excluded").startswith("1 ")
        assert numbers(out, "Scanned").startswith("8 (member 6 · admin 1 · test 1)")
        assert (
            "Invalid: 2 (member 2 · admin 0 · test 0)"
            in out.split("[Account Nicknames]")[1].split("[Character Names]")[0]
        )  # 운영진 · 존나
        assert (
            "Invalid: 2 (member 2 · admin 0 · test 0)"
            in out.split("[Character Names]")[1]
        )  # 운영진 · 개발자
        assert (
            numbers(out, "Allowed by the old built-in fallback list but invalid now")
            == "nicknames 2 · characters 2"
        )
        assert numbers(out, "Character name shown") == "4"
        assert (
            numbers(out, "Fallback to account nickname")
            == "2 (of which the account nickname is also invalid: 1)"
        )
        assert (
            numbers(out, "No character (account nickname shown)")
            == "2 (of which invalid: 1)"
        )
        assert "Violations found: yes" in out and "Completed: PASS" in out
        for nickname, character, *_ in PEOPLE:
            assert nickname not in out
            if character:
                assert character not in out
        for uid in ids:
            assert uid not in out and uid[:8] not in out
        assert "@example.com" not in out

    mysql_run(scenario)


class WritesBetweenBatches:
    """점검 세션을 감싸 첫 묶음 조회 직후 다른 세션의 쓰기(커밋)를 끼워 넣는다. `read_committed` 면 점검 세션의
    세션 기본 격리 수준을 READ COMMITTED 로 바꿔 둔다(이 연결의 세션 값만 — 전역 설정은 건드리지 않는다)."""

    def __init__(self, sessions, writes, *, read_committed):
        self.sessions, self.writes, self.read_committed = sessions, writes, read_committed
        self.wrote = False

    def __call__(self):
        outer = self

        class Scope:
            async def __aenter__(self):
                self.cm = outer.sessions()
                self.db = await self.cm.__aenter__()
                if outer.read_committed:
                    await self.db.execute(
                        text("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                    )
                self.selects = 0
                return self

            async def execute(self, statement, *args, **kwargs):
                result = await self.db.execute(statement, *args, **kwargs)
                if str(statement).lstrip().upper().startswith("SELECT"):
                    self.selects += 1
                    if self.selects == 1:
                        await outer.writes()
                        outer.wrote = True
                return result

            async def rollback(self):
                await self.db.rollback()

            async def __aexit__(self, *exc):
                return await self.cm.__aexit__(*exc)

        return Scope()


@pytest.mark.parametrize("read_committed", [False, True])
def test_mysql_all_batches_read_one_snapshot(on_test_db, capsys, read_committed):
    # 첫 묶음 뒤에 다른 세션이 뒤쪽 회원들을 탈퇴 처리하고 새 회원(위반 닉네임)을 넣어 커밋해도,
    # 집계는 점검 시작 때의 스냅숏 그대로여야 한다 — 세션 기본값이 READ COMMITTED 인 환경에서도.
    async def scenario(sessions):
        ids = await seed(sessions)
        first = min(ids)

        async def writes():
            async with sessions() as other:
                await other.execute(
                    update(AppUser)
                    .where(AppUser.id > first, AppUser.deleted_at.is_(None))
                    .values(deleted_at=utc_now())
                )
                other.add(  # 늦게 들어온 회원 — 예약어 닉네임(집계에 들어가면 위반이 3 이 된다)
                    AppUser(
                        id="ffffffff-ffff-4fff-bfff-ffffffffffff",
                        email="audit-late@example.com",
                        nickname="관리자",
                        role="user",
                        is_test=False,
                        created_at=utc_now(),
                        updated_at=utc_now(),
                    )
                )
                await other.commit()

        wrapped = WritesBetweenBatches(sessions, writes, read_committed=read_committed)
        on_test_db(wrapped)
        code = await audit._run(audit.parse_args(["--batch-size", "1"]))
        out = capsys.readouterr().out
        assert code == audit.EXIT_OK and wrapped.wrote
        async with sessions() as db:  # 쓰기는 실제로 들어갔다
            total = len((await db.execute(select(AppUser.id))).all())
            alive = len(
                (
                    await db.execute(
                        select(AppUser.id).where(AppUser.deleted_at.is_(None))
                    )
                ).all()
            )
        first_alive = 0 if PEOPLE[ids.index(first)][4] else 1
        assert (total, alive) == (10, first_alive + 1)
        # 그래도 집계는 시작 시점(9 행 · 탈퇴 1 · 닉네임 위반 2) 그대로
        assert numbers(out, "Total rows") == "9"
        assert numbers(out, "Excluded").startswith("1 ")
        assert numbers(out, "Scanned").startswith("8 ")
        assert (
            "Invalid: 2 (member 2 · admin 0 · test 0)"
            in out.split("[Account Nicknames]")[1].split("[Character Names]")[0]
        )

    mysql_run(scenario)


def test_mysql_audit_on_an_empty_database(on_test_db, capsys):
    async def scenario(sessions):
        on_test_db(sessions)
        code = await audit._run(audit.parse_args([]))
        out = capsys.readouterr().out
        assert code == audit.EXIT_OK
        assert numbers(out, "Total rows") == "0"
        assert "Violations found: no" in out and "Completed: PASS" in out

    mysql_run(scenario)


def test_mysql_database_error_exits_4_without_details(monkeypatch, capsys):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    import app.db.session as session_module

    broken = create_async_engine(
        "mysql+aiomysql://nobody:secret-pw@127.0.0.1:1/none", hide_parameters=True
    )
    monkeypatch.setattr(session_module, "AsyncSessionLocal", async_sessionmaker(broken))
    monkeypatch.setattr(session_module, "engine", broken)
    assert audit.main([]) == audit.EXIT_DB
    out = capsys.readouterr().out
    assert "Completed: FAIL (database error:" in out and "secret-pw" not in out
