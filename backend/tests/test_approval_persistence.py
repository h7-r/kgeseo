"""영속화 경계 검증. 실제 MySQL 검증은 별도 opt-in 테스트에서 수행한다."""

import asyncio
import importlib.util
from datetime import datetime
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError

from app.models.npc_approval_review import NpcApprovalReview, _immutable_review
from app.repositories.approval_history import ApprovalHistoryRepository, to_record
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services.approval_history import (
    DuplicateReviewError,
    ReviewRecord,
    UnknownSupersedesError,
    gate_decisions,
)
from app.services.gate_review import (
    AdminAuthenticationRequired,
    VerifiedAdmin,
    create_gate_review,
)
from app.services.pinned_content import PinnedContentStore
from app.services.publication_approval import (
    check_target_approval,
    evaluate_publication_with_db_reviews,
    snapshot_source,
)
from tests.test_publication_gate import CASE_ID, hint_source, no_idmap_files

FP = "sha256:" + "a" * 64
TARGET = ApprovalTarget(
    target_type="case_content", target_id="case_test", content_version=1
)


def record(**kwargs):
    return ReviewRecord(
        **(
            {
                "review_id": str(uuid4()),
                "gate": "G1",
                "target_hash": FP,
                "decision": "approved",
                "reviewer": "검토자",
                "reviewed_at": "2026-10-29T00:00:00.123Z",
            }
            | kwargs
        )
    )


def request(**kwargs):
    return GateReviewCreate(
        **(
            TARGET.model_dump()
            | {"gate": "G1", "target_hash": FP, "decision": "approved"}
            | kwargs
        )
    )


def session():
    db = MagicMock()
    for method in ("execute", "get", "flush", "commit", "rollback"):
        setattr(db, method, AsyncMock())
    db.get.return_value = None
    db.execute.return_value = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = []
    return db


def run(awaitable):
    return asyncio.run(awaitable)


class FakeTransaction:
    """`async with db.begin()` 대역. 종료 시 받은 예외 종류를 남긴다."""

    def __init__(self) -> None:
        self.exits: list[type[BaseException] | None] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, kind, error, traceback):
        self.exits.append(kind)
        return False


class FakeSessions:
    """세션 팩토리 대역. 판정이 쓰는 세션은 호출자 세션과 다른 새 세션이다."""

    def __init__(self, db) -> None:
        self.db = db
        self.opened = 0
        self.transaction = FakeTransaction()
        db.begin = MagicMock(return_value=self.transaction)

    def __call__(self):
        self.opened += 1
        return self

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *_exc):
        return False


@pytest.mark.parametrize(
    "field,value",
    [
        ("review_id", str(uuid4())),
        ("reviewed_at", "2026-01-01T00:00:00.000Z"),
        ("reviewer", "client-admin"),
        ("target_type", "other"),
        ("target_id", " "),
        ("content_version", True),
        ("content_version", 0),
        ("target_hash", "A" * 64),
        ("decision", "revoked"),
        ("gate", "G4"),
    ],
)
def test_request_rejects_server_fields_and_invalid_scope(field, value):
    with pytest.raises(ValidationError):
        request(**{field: value})


def test_roundtrip_and_binary_mysql_identity():
    original = record()
    row = NpcApprovalReview(
        **TARGET.model_dump(),
        **original.model_dump(exclude={"reviewed_at"}),
        reviewed_at=datetime(2026, 10, 29, 0, 0, 0, 123000),
    )
    assert to_record(row) == original
    assert NpcApprovalReview.__table__.c.reviewed_at.type.fsp == 3
    assert (
        NpcApprovalReview.__table__.c.review_id.type.dialect_impl(
            mysql.dialect()
        ).collation
        == "utf8mb4_bin"
    )


def test_repository_locks_empty_scope_and_queries_all_hashes():
    db = session()
    repository = ApprovalHistoryRepository(db)
    run(repository.lock_target(TARGET))
    run(repository.records(TARGET, current=True))
    statements = [
        str(call.args[0].compile(dialect=mysql.dialect()))
        for call in db.execute.call_args_list
    ]
    assert "ON DUPLICATE KEY UPDATE" in statements[0]
    assert all("FOR UPDATE" in sql for sql in statements[1:])
    assert "target_hash =" not in statements[-1]
    assert set(db.execute.call_args_list[-1].args[0].compile().params.values()) == {
        "case_content",
        "case_test",
        1,
    }
    db.commit.assert_not_called()


def test_repository_appends_without_commit():
    db = session()
    item = record()
    run(ApprovalHistoryRepository(db).append(TARGET, item))
    assert to_record(db.add.call_args.args[0]) == item
    db.flush.assert_awaited_once()
    db.commit.assert_not_called()
    db.rollback.assert_not_called()


def test_duplicate_and_unknown_reference_rejected():
    db = session()
    db.get.return_value = object()
    with pytest.raises(DuplicateReviewError):
        run(ApprovalHistoryRepository(db).append(TARGET, record()))
    db.add.assert_not_called()
    db = session()
    with pytest.raises(UnknownSupersedesError):
        run(
            ApprovalHistoryRepository(db).append(
                TARGET, record(supersedes=str(uuid4()))
            )
        )
    db.add.assert_not_called()


def test_duplicate_pk_race_translated_and_other_error_preserved():
    for code in (1062, 1452):
        db = session()
        db.flush.side_effect = IntegrityError(
            "insert", {}, Exception(code, "test error")
        )
        expected = DuplicateReviewError if code == 1062 else IntegrityError
        with pytest.raises(expected):
            run(ApprovalHistoryRepository(db).append(TARGET, record()))
        db.rollback.assert_not_called()


@pytest.mark.parametrize("admin", [None, "admin", {"reviewer": "admin"}])
def test_unverified_admin_never_writes(admin):
    db = session()
    with pytest.raises(AdminAuthenticationRequired):
        run(create_gate_review(db, request(), admin=admin))
    db.execute.assert_not_called()
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_server_generates_identity_and_monotonic_milliseconds(monkeypatch):
    from app.services import gate_review

    class FrozenTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 29, tzinfo=tz)

    monkeypatch.setattr(gate_review, "datetime", FrozenTime)
    db = session()
    previous = record(reviewed_at="2026-10-29T00:00:00.000Z")
    row = NpcApprovalReview(
        **TARGET.model_dump(),
        **previous.model_dump(exclude={"reviewed_at"}),
        reviewed_at=datetime(2026, 10, 29),
    )
    db.execute.return_value.scalars.return_value.all.return_value = [row]
    db.get.side_effect = [None, row]
    new = run(
        create_gate_review(
            db,
            request(reason="재승인", supersedes=previous.review_id),
            admin=VerifiedAdmin("운영자"),
        )
    )
    assert new.review_id != previous.review_id
    assert new.reviewed_at == "2026-10-29T00:00:00.001Z"
    assert new.reviewer == "운영자"
    db.commit.assert_awaited_once()
    db.rollback.assert_not_called()


@pytest.mark.parametrize("failure", ["execute", "flush", "commit"])
def test_service_rolls_back_database_errors(failure):
    db = session()
    getattr(db, failure).side_effect = RuntimeError("database failure")
    with pytest.raises(RuntimeError):
        run(create_gate_review(db, request(), admin=VerifiedAdmin("admin")))
    db.rollback.assert_awaited_once()


def test_service_rolls_back_invalid_record_and_cancellation():
    db = session()
    with pytest.raises(ValidationError):
        run(
            create_gate_review(
                db, request(decision="hold"), admin=VerifiedAdmin("admin")
            )
        )
    db.rollback.assert_awaited_once()
    db = session()
    db.execute.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        run(create_gate_review(db, request(), admin=VerifiedAdmin("admin")))
    db.rollback.assert_awaited_once()


def test_existing_history_rules_are_not_strengthened():
    db = session()
    previous = record()
    db.get.side_effect = [None, object()]  # 기존 메모리 저장소와 같은 전역 존재 검사
    invalid_history = record(
        supersedes=previous.review_id, reviewed_at="2026-10-29T00:00:01.000Z"
    )
    run(ApprovalHistoryRepository(db).append(TARGET, invalid_history))
    assert gate_decisions([previous, invalid_history], FP)[0] == "G1:invalid history"


def test_snapshot_is_version_scoped_and_publication_requires_db_approval():
    files, fingerprint = no_idmap_files()
    target = ApprovalTarget(
        target_type="case_content", target_id=CASE_ID, content_version=1
    )
    records = tuple(
        record(gate=gate, target_hash=fingerprint) for gate in ("G1", "G2", "G3")
    )
    source = snapshot_source(target, records)
    assert source(CASE_ID, 1) == records
    assert source(CASE_ID, 2) == ()
    assert source("other", 1) == ()
    db = session()
    rows = [
        NpcApprovalReview(
            **target.model_dump(),
            **r.model_dump(exclude={"reviewed_at"}),
            reviewed_at=datetime(2026, 10, 29, 0, 0, 0, 123000),
        )
        for r in records
    ]
    db.execute.return_value.scalars.return_value.all.return_value = rows
    sessions = FakeSessions(db)
    result = run(
        evaluate_publication_with_db_reviews(
            sessions,
            case_id=CASE_ID,
            content_version=1,
            **files,
            hint_source=hint_source,
            ng_checker=lambda _: False,
            store=PinnedContentStore(),
        )
    )
    assert result.approved and result.registered
    # 판정 전용 세션 · 트랜잭션을 열고 정상 종료(commit)했다. 세션 메서드로 직접 commit · rollback하지 않는다.
    assert sessions.opened == 1 and sessions.transaction.exits == [None]
    db.commit.assert_not_called()
    db.rollback.assert_not_called()
    # 콘텐츠 내부 approvals가 아니라 DB 이력을 신뢰한다. DB가 비면 실패한다.
    db.execute.return_value.scalars.return_value.all.return_value = []
    result = run(
        evaluate_publication_with_db_reviews(
            sessions,
            case_id=CASE_ID,
            content_version=1,
            **files,
            hint_source=hint_source,
            ng_checker=lambda _: False,
        )
    )
    assert not result.approved
    assert result.check("APPROVALS").status == "FAIL"


def test_publication_db_failure_rolls_back_and_does_not_approve():
    db = session()
    db.execute.side_effect = RuntimeError("offline")
    sessions = FakeSessions(db)
    store = PinnedContentStore()
    with pytest.raises(RuntimeError):
        run(check_target_approval(sessions, TARGET, FP))
    with pytest.raises(RuntimeError):
        files, _ = no_idmap_files()
        run(
            evaluate_publication_with_db_reviews(
                sessions,
                case_id=CASE_ID,
                content_version=1,
                **files,
                hint_source=hint_source,
                ng_checker=lambda _: False,
                store=store,
            )
        )
    # 판정 전용 트랜잭션이 오류와 함께 끝났다(begin 블록이 rollback). 승인 결과 · 등록은 없다.
    assert sessions.transaction.exits == [RuntimeError, RuntimeError]
    assert store.versions(CASE_ID) == ()


def test_no_admin_http_write_route_is_exposed(client):
    assert (
        client.post(
            "/api/v1/admin/gate-reviews", json=request().model_dump()
        ).status_code
        == 404
    )
    assert (
        client.post("/admin/gate-reviews", json=request().model_dump()).status_code
        == 404
    )


def test_orm_update_and_delete_are_rejected():
    with pytest.raises(ValueError, match="append-only"):
        _immutable_review()


def test_migration_extends_only_integration_and_guards_bulk_writes():
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/d2a6f8b1c903_add_npc_approval_reviews.py"
    )
    spec = importlib.util.spec_from_file_location("approval_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "c9e1a4b7d2f0"
    sql = StringIO()
    context = MigrationContext.configure(
        dialect_name="mysql", opts={"as_sql": True, "output_buffer": sql}
    )
    with Operations.context(context):
        migration.upgrade()
    ddl = sql.getvalue()
    assert "CREATE TABLE npc_approval_reviews" in ddl
    assert "DATETIME(3)" in ddl
    assert "BEFORE UPDATE ON npc_approval_reviews" in ddl
    assert "BEFORE DELETE ON npc_approval_reviews" in ddl
    assert ddl.count("SIGNAL SQLSTATE '45000'") == 2
