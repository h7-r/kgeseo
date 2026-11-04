"""명시적으로 격리 확인된 빈 테스트 DB에서만 PM v0.4.13 승인 계약을 검증한다.

실행 조건 · 안전 장치는 `test_npc_turn_idempotency_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`).

- 실행자 열 migration(b3f7c2e9a4d1): 이전 기록 보존(actor NULL) · 수정 · 삭제 거부 트리거 유지
- 내부 CLI 기록(actor/reviewer 분리) → G3 판정 PASS · 정책 검사 미정이면 일반 팩 미사용(reply null)
- G3 승인 · 철회와 같은 client_event_id 재전송의 동시성

승인 기록은 이 격리 DB에만 넣는 테스트 기록이다(운영 · 개발 DB 기록이 아니다). CLI 시나리오는 PM v0.4.13 §3의
등록 내용(actor · reviewer · reason)을 그대로 시험한다.
"""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.npc import get_general_pack_policy
from app.core.config import settings
from app.main import app
from app.repositories.approval_history import ApprovalHistoryRepository
from app.schemas.gate_review import ApprovalTarget
from app.services.approval_history import REQUIRED_GATES, gate_decisions
from app.services.dialogue_pack_policy import DEFAULT_DIALOGUE_PACK_POLICY
from app.services.npc_line_supply import general_pack_gate_reasons
from app.services.publication_approval import check_target_approval, snapshot_source
from scripts import record_gate_review as cli
from tests.pack_policy_stub import passing_test_policy
from tests.test_content_release_mysql import mysql_run
from tests.test_npc_case_access_mysql import event_count
from tests.test_npc_general_pack import OFFICIAL, OFFICIAL_FINGERPRINT
from tests.test_npc_general_pack_mysql import (
    PACK,
    Http,
    blocked_session,
    body,
    expected,
    pack_review,
)
from tests.test_npc_turn_idempotency_mysql import drop_remaining_tables, script

pytestmark = pytest.mark.skipif(
    os.environ.get("NPC_IDEMPOTENCY_MYSQL_ISOLATED") != "1",
    reason="explicit isolated NPC idempotency MySQL test database required",
)

ACTOR_REVISION = "b3f7c2e9a4d1"
PACK_TARGET = ApprovalTarget(
    target_type="dialogue_pack", target_id="general_default", content_version=1
)
PM_REASON = "PM 11/3 메시지로 G3 승인"
TRIGGER_SIGNAL = 1644  # SIGNAL SQLSTATE '45000'


@pytest.fixture(autouse=True)
def official_pack_configured(monkeypatch):
    monkeypatch.setattr(settings, "npc_general_pack", OFFICIAL)


class PackPolicy:
    def __init__(self, policy) -> None:
        self.policy = policy

    def __enter__(self):
        app.dependency_overrides[get_general_pack_policy] = lambda: self.policy

    def __exit__(self, *exc):
        app.dependency_overrides.pop(get_general_pack_policy, None)


def upgrade_to(connection, stop_before: str | None) -> None:
    """base부터 차례로 적용한다. `stop_before`를 주면 그 revision 직전에서 멈춘다."""

    revisions = list(reversed(list(script().walk_revisions())))
    with Operations.context(MigrationContext.configure(connection)):
        for revision in revisions:
            if revision.revision == stop_before:
                return
            revision.module.upgrade()


def upgrade_one(connection, name: str) -> None:
    with Operations.context(MigrationContext.configure(connection)):
        script().get_revision(name).module.upgrade()


def partial_run(scenario) -> None:
    """실행자 열 이전 schema에서 시작한다(이전 기록을 넣고 migration을 적용하는 시나리오)."""

    async def execute():
        url = make_url(os.environ["NPC_IDEMPOTENCY_MYSQL_URL"])
        assert url.drivername == "mysql+aiomysql"
        assert url.host in {"127.0.0.1", "localhost"}
        assert url.port is not None and url.port != 3306
        assert url.database and url.database.startswith("test_npc_idem_")
        expected_dir = Path(os.environ["NPC_IDEMPOTENCY_MYSQL_DATADIR"]).resolve()
        engine = create_async_engine(url, hide_parameters=True)
        initialized = False
        try:
            async with engine.begin() as connection:
                database, datadir = (
                    await connection.execute(text("SELECT DATABASE(), @@datadir"))
                ).one()
                assert database == url.database
                assert Path(datadir).resolve() == expected_dir
                assert not (await connection.execute(text("SHOW TABLES"))).all()
                await connection.run_sync(lambda c: upgrade_to(c, ACTOR_REVISION))
                initialized = True
            await scenario(engine)
        finally:
            if initialized:
                async with engine.begin() as connection:
                    await connection.run_sync(drop_remaining_tables)
            await engine.dispose()

    asyncio.run(execute())


LEGACY_INSERT = text(
    "INSERT INTO npc_approval_reviews (review_id, target_type, target_id, "
    "content_version, gate, target_hash, decision, reviewer, reviewed_at, reason, "
    "supersedes) VALUES (:id, 'dialogue_pack', 'general_default', 1, :gate, :hash, "
    "'approved', :reviewer, :at, NULL, NULL)"
)


def signal_errno(error: DBAPIError) -> int | None:
    args = getattr(error.orig, "args", ())
    return args[0] if args and isinstance(args[0], int) else None


# ── migration: 이전 기록 보존 · 트리거 유지 ──


def test_mysql_actor_migration_keeps_existing_history_and_append_only_triggers():
    async def scenario(engine):
        legacy_ids = {gate: str(uuid4()) for gate in ("G1", "G2", "G3")}
        async with engine.begin() as connection:
            # 실행자 열 이전의 기록(그때 schema 그대로)
            for gate, review_id in legacy_ids.items():
                await connection.execute(
                    LEGACY_INSERT,
                    {
                        "id": review_id,
                        "gate": gate,
                        "hash": OFFICIAL_FINGERPRINT,
                        "reviewer": "가상 이전 검토자",
                        "at": "2026-10-30 00:00:00.000",
                    },
                )
            before = (
                await connection.execute(
                    text("SELECT * FROM npc_approval_reviews ORDER BY review_id")
                )
            ).all()
            await connection.run_sync(lambda c: upgrade_one(c, ACTOR_REVISION))

        async with engine.begin() as connection:
            columns = (
                await connection.execute(
                    text(
                        "SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE FROM "
                        "information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                        "AND TABLE_NAME = 'npc_approval_reviews' AND COLUMN_NAME = 'actor'"
                    )
                )
            ).all()
            assert [tuple(c) for c in columns] == [("actor", "YES", "varchar(100)")]
            after = (
                await connection.execute(
                    text(
                        "SELECT review_id, target_type, target_id, content_version, "
                        "gate, target_hash, decision, reviewer, reviewed_at, reason, "
                        "supersedes, actor FROM npc_approval_reviews ORDER BY review_id"
                    )
                )
            ).all()
            # 이전 값은 그대로이고 actor만 NULL로 붙는다.
            assert [tuple(row)[:-1] for row in after] == [tuple(r) for r in before]
            assert {row[-1] for row in after} == {None}
            triggers = (
                await connection.execute(
                    text(
                        "SELECT TRIGGER_NAME, EVENT_MANIPULATION FROM "
                        "information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() "
                        "AND EVENT_OBJECT_TABLE = 'npc_approval_reviews' "
                        "ORDER BY TRIGGER_NAME"
                    )
                )
            ).all()
            assert [tuple(t) for t in triggers] == [
                ("npc_approval_reviews_no_delete", "DELETE"),
                ("npc_approval_reviews_no_update", "UPDATE"),
            ]

        # 이전 기록을 고치거나(actor 채우기 포함) 지울 수 없다.
        for statement in (
            "UPDATE npc_approval_reviews SET actor = '세진' WHERE review_id = :id",
            "UPDATE npc_approval_reviews SET reviewer = 'x' WHERE review_id = :id",
            "DELETE FROM npc_approval_reviews WHERE review_id = :id",
        ):
            with pytest.raises(DBAPIError) as caught:
                async with engine.begin() as connection:
                    await connection.execute(text(statement), {"id": legacy_ids["G3"]})
            assert signal_errno(caught.value) == TRIGGER_SIGNAL

        # 저장소 조회 · 관문 판정은 이전 기록에도 그대로 동작한다.
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            records = await ApprovalHistoryRepository(db).records(PACK_TARGET)
        assert {r.actor for r in records} == {None}
        assert {r.reviewer for r in records} == {"가상 이전 검토자"}
        assert (
            gate_decisions(
                records,
                OFFICIAL_FINGERPRINT,
                required=REQUIRED_GATES["dialogue_pack"],
            )
            == ()
        )
        assert gate_decisions(records, OFFICIAL_FINGERPRINT) == ()

    partial_run(scenario)


# ── 내부 CLI: actor/reviewer 분리 기록 → G3 PASS · 정책 미정이면 미사용 ──


def cli_args(*extra: str) -> object:
    return cli.parse_args(
        [
            "--target-type",
            "dialogue_pack",
            "--target-id",
            "general_default",
            "--target-version",
            "1",
            "--gate",
            "G3",
            "--decision",
            "approved",
            "--actor",
            "세진",
            "--reviewer",
            "황미르",
            "--reason",
            PM_REASON,
            "--target-hash",
            OFFICIAL_FINGERPRINT,
            *extra,
        ]
    )


def test_mysql_cli_records_actor_and_reviewer_and_policy_keeps_pack_unused():
    db_name = make_url(os.environ["NPC_IDEMPOTENCY_MYSQL_URL"]).database

    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        lines: list[str] = []

        # 읽기 전용 확인: 기록 없음
        assert await cli.run(cli_args("--db"), sessions, db_name, lines.append) is None
        async with sessions() as db:
            assert await ApprovalHistoryRepository(db).records(PACK_TARGET) == ()

        record = await cli.run(
            cli_args("--commit", "--confirm-db", db_name),
            sessions,
            db_name,
            lines.append,
        )
        assert (record.actor, record.reviewer, record.reason) == (
            "세진",
            "황미르",
            PM_REASON,
        )
        assert (record.gate, record.target_hash) == ("G3", OFFICIAL_FINGERPRINT)
        assert any("g3_after=PASS" in line for line in lines)
        # 게시 케이스(case_test)가 있는데 CLI 저장소에 게시본이 없다 → 정책 검사 UNVERIFIED(PM v0.4.14)
        assert any("policy=UNVERIFIED(policy_unverified)" in line for line in lines)

        async with sessions() as db:
            row = (
                await db.execute(
                    text(
                        "SELECT actor, reviewer, reason FROM npc_approval_reviews "
                        "WHERE review_id = :id"
                    ),
                    {"id": record.review_id},
                )
            ).one()
            records = await ApprovalHistoryRepository(db).records(PACK_TARGET)
        assert tuple(row) == ("세진", "황미르", PM_REASON)
        assert (
            general_pack_gate_reasons(PACK, snapshot_source(PACK_TARGET, records)) == ()
        )

        # 새 기록의 actor도 고칠 수 없다.
        with pytest.raises(DBAPIError) as caught:
            async with sessions() as db, db.begin():
                await db.execute(
                    text(
                        "UPDATE npc_approval_reviews SET actor = '황미르' "
                        "WHERE review_id = :id"
                    ),
                    {"id": record.review_id},
                )
        assert signal_errno(caught.value) == TRIGGER_SIGNAL

        request = body()
        with PackPolicy(DEFAULT_DIALOGUE_PACK_POLICY):
            async with Http(sessions) as http:
                pending = await http.turn(session_id, request)
        assert pending["reply"] is None  # G3는 있으나 정책 검사 미정
        assert (pending["fallback_reason"], pending["content_mode"]) == (
            "NPC_CONTENT_WITHDRAWN",
            "generic",
        )

        with PackPolicy(passing_test_policy):
            async with Http(sessions) as http:
                spoken = await http.turn(session_id, body())
        assert spoken["reply"]["line_id"].startswith("GENERIC_PAUSE_")

        # 같은 기록을 다시 넣는 재실행은 새 기록 한 건이다(append-only). 해시가 다르면 기록하지 않는다.
        with pytest.raises(cli.CliInputError, match="target_hash mismatch"):
            await cli.run(
                cli.parse_args(
                    [
                        *[a for a in cli_args_list() if a != OFFICIAL_FINGERPRINT],
                        "sha256:" + "0" * 64,
                        "--commit",
                        "--confirm-db",
                        db_name,
                    ]
                ),
                sessions,
                db_name,
                lines.append,
            )
        async with sessions() as db:
            assert len(await ApprovalHistoryRepository(db).records(PACK_TARGET)) == 1

    mysql_run(scenario)


def cli_args_list() -> list[str]:
    return [
        "--target-type",
        "dialogue_pack",
        "--target-id",
        "general_default",
        "--target-version",
        "1",
        "--gate",
        "G3",
        "--decision",
        "approved",
        "--actor",
        "세진",
        "--reviewer",
        "황미르",
        "--reason",
        PM_REASON,
        "--target-hash",
        OFFICIAL_FINGERPRINT,
    ]


def test_mysql_cli_refuses_commit_before_actor_migration():
    db_name = make_url(os.environ["NPC_IDEMPOTENCY_MYSQL_URL"]).database

    async def scenario(engine):
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        with pytest.raises(cli.CliInputError, match=ACTOR_REVISION):
            await cli.run(
                cli_args("--commit", "--confirm-db", db_name),
                sessions,
                db_name,
                lambda *_: None,
            )
        async with engine.connect() as connection:
            count = (
                await connection.execute(
                    text("SELECT COUNT(*) FROM npc_approval_reviews")
                )
            ).scalar()
        assert count == 0

    partial_run(scenario)


# ── G3만으로 승인 · 철회와 재전송의 동시성 ──


def test_mysql_g3_only_approval_racing_a_resend_never_shows_another_line():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        request = body()
        with PackPolicy(passing_test_policy):
            async with Http(sessions) as http:
                first = await http.turn(session_id, request)
                assert first["reply"] is None  # 아직 승인 없음

                # G3 승인(G1 · G2 없음)과 같은 요청의 재전송을 동시에
                approval, resend = await asyncio.gather(
                    pack_review(sessions, "G3"), http.turn(session_id, request)
                )
                assert resend["reply"] in (None, expected(request))
                assert resend["npc_event_id"] == first["npc_event_id"]
                after = await http.turn(session_id, request)
                assert after["reply"] == expected(request)

                # G3 철회와 재전송을 동시에 → 대사가 있거나 없거나, 다른 대사는 없다
                withdrawal, racing = await asyncio.gather(
                    pack_review(
                        sessions,
                        "G3",
                        decision="hold",
                        reason="(가상) 철회",
                        supersedes=approval.review_id,
                    ),
                    http.turn(session_id, request),
                )
                assert racing["reply"] in (None, expected(request))
                final = await http.turn(session_id, request)
                assert final["reply"] is None
                for response in (first, resend, after, racing, final):
                    assert (response["fallback_reason"], response["content_mode"]) == (
                        "NPC_CONTENT_WITHDRAWN",
                        "generic",
                    )
        assert await event_count(sessions, session_id) == 1

    mysql_run(scenario)


def test_mysql_g3_only_pack_with_default_policy_stays_null_after_resend():
    async def scenario(sessions):
        session_id = await blocked_session(sessions)
        await pack_review(sessions, "G3")
        request = body()
        with PackPolicy(DEFAULT_DIALOGUE_PACK_POLICY):
            async with Http(sessions) as http:
                first = await http.turn(session_id, request)
                again = await http.turn(session_id, request)
        assert first["reply"] is None and again == first
        assert first["content_mode"] == "generic"

    mysql_run(scenario)


def test_mysql_check_target_approval_uses_required_gates_per_target_type():
    async def scenario(sessions):
        case_target = PACK_TARGET.model_copy(
            update={"target_type": "case_content", "target_id": "case_test"}
        )
        await pack_review(sessions, "G3")
        await pack_review(
            sessions, "G3", target_type="case_content", fingerprint=OFFICIAL_FINGERPRINT
        )
        # 일반 팩: G3만으로 관문 판정 통과(정책 검사는 별도) · 케이스: G1 · G2가 여전히 필요
        assert (
            await check_target_approval(sessions, PACK_TARGET, OFFICIAL_FINGERPRINT)
            == ()
        )
        assert await check_target_approval(
            sessions,
            case_target.model_copy(update={"target_id": "general_default"}),
            OFFICIAL_FINGERPRINT,
        ) == ("G1:missing", "G2:missing")

    mysql_run(scenario)
