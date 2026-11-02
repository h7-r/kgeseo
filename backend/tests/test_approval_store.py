import asyncio
import io
import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError, OperationalError

from alembic import command
from app.api.v1.npc import get_npc_approval_source
from app.models.content_review import ContentReview
from app.services import approval_store
from app.services.approval_history import (
    ApprovalSourceUnavailableError,
    DuplicateReviewError,
    ReviewRecord,
    UnknownSupersedesError,
)
from app.services.approval_store import (
    InvalidReviewSubjectError,
    append_review,
    load_approval_source,
)
from app.services.content_publication import publish_with_stored_approvals
from app.services.npc_line_supply import general_pack_approved
from app.services.pinned_content import PinnedContentStore
from app.services.publication_gate import GateCheck, _approval_check
from tests.test_content_publication import sealed
from tests.test_npc_line_supply import general_pack
from tests.test_play_session_content_pin import alembic_config
from tests.test_publication_gate import CASE_ID

# 가상 테스트 데이터. 실제 승인자 · 실제 승인 기록이 아니다.
BACKEND_DIR = Path(__file__).resolve().parents[1]
NEW_REVISION = "e2a7c4f9b1d3"
PREVIOUS_HEAD = "c9e1a4b7d2f0"


def record(
    gate: str,
    decision: str,
    fingerprint: str,
    at: str = "2026-11-03T01:02:03.456Z",
    **extra: Any,
) -> ReviewRecord:
    if decision != "approved":
        extra.setdefault("reason", "(가상) 사유")
    return ReviewRecord(
        review_id=str(uuid.uuid4()),
        gate=gate,
        target_hash=fingerprint,
        decision=decision,
        reviewer="reviewer-test",
        reviewed_at=at,
        **extra,
    )


def approvals(fingerprint: str, gates=("G1", "G2", "G3")) -> list[ReviewRecord]:
    return [record(gate, "approved", fingerprint) for gate in gates]


class _Result:
    def __init__(self, rows: list[ContentReview]) -> None:
        self._rows = rows

    def scalars(self):
        return iter(self._rows)


class FakeReviewDb:
    """content_reviews 행을 메모리에 두는 가짜 세션. 실제 MySQL 동작은 scripts.verify_approval_store가 본다."""

    def __init__(self, rows: list[ContentReview] | None = None) -> None:
        self.rows = list(rows or [])
        self.added: list[ContentReview] = []
        self.statements: list[Any] = []
        self.execute_error: Exception | None = None
        self.commit_error: Exception | None = None
        self.commit_count = 0
        self.rollback_count = 0

    async def execute(self, statement: Any) -> _Result:
        self.statements.append(statement)
        if self.execute_error is not None:
            raise self.execute_error
        params = statement.compile().params
        return _Result(
            [
                row
                for row in self.rows
                if row.subject_id == params["subject_id_1"]
                and row.subject_version == params["subject_version_1"]
            ]
        )

    async def scalar(self, statement: Any) -> str | None:
        [review_id] = statement.compile().params.values()
        ids = {row.review_id for row in [*self.rows, *self.added]}
        return review_id if review_id in ids else None

    def add(self, row: ContentReview) -> None:
        self.added.append(row)

    async def commit(self) -> None:
        if self.commit_error is not None:
            raise self.commit_error
        self.rows += self.added
        self.added = []
        self.commit_count += 1

    async def rollback(self) -> None:
        self.added = []
        self.rollback_count += 1


def stored(
    *records: ReviewRecord, subject: tuple[str, int] = (CASE_ID, 1)
) -> FakeReviewDb:
    return FakeReviewDb([approval_store._to_row(*subject, r) for r in records])


def publish(db: FakeReviewDb, bundle, store: PinnedContentStore | None = None):
    store = store or PinnedContentStore()
    report = asyncio.run(
        publish_with_stored_approvals(db, store, bundle, ng_checker=lambda text: False)
    )
    return report, store


def approval_reasons(report) -> tuple[str, ...]:
    return next(c for c in report.checks if c.code == "APPROVALS").reasons


# ── 게시 게이트 연동 ──


def test_no_stored_approvals_blocks_publication() -> None:
    bundle, _ = sealed()

    report, store = publish(stored(), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G1:missing", "G2:missing", "G3:missing")
    assert store.versions(CASE_ID) == ()


def test_stored_approvals_for_exact_fingerprint_publish() -> None:
    bundle, fingerprint = sealed()
    db = stored(*approvals(fingerprint))

    report, store = publish(db, bundle)

    assert report.outcome == "published"
    assert store.versions(CASE_ID) == (1,)
    # 공유 잠금으로 읽고, 판정이 끝나면 트랜잭션을 끝낸다.
    assert db.statements[0]._for_update_arg.read is True
    assert db.rollback_count == 1


def test_approvals_for_another_fingerprint_are_not_reused() -> None:
    bundle, _ = sealed()
    _, other_fingerprint = sealed(answer="가상다른정답")

    report, store = publish(stored(*approvals(other_fingerprint)), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == tuple(
        f"{gate}:stale target_hash" for gate in ("G1", "G2", "G3")
    )
    assert store.versions(CASE_ID) == ()


def test_approvals_stored_for_another_version_are_not_reused() -> None:
    bundle, fingerprint = sealed()

    report, _ = publish(stored(*approvals(fingerprint), subject=(CASE_ID, 2)), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G1:missing", "G2:missing", "G3:missing")


def test_missing_gate_blocks_publication() -> None:
    bundle, fingerprint = sealed()

    report, store = publish(stored(*approvals(fingerprint, ("G1", "G2"))), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G3:missing",)
    assert store.versions(CASE_ID) == ()


def test_withdrawn_approval_blocks_and_keeps_history() -> None:
    bundle, fingerprint = sealed()
    g1, g2, g3 = approvals(fingerprint)
    withdrawal = record(
        "G2",
        "rejected",
        fingerprint,
        at="2026-11-03T05:00:00.000Z",
        supersedes=g2.review_id,
    )
    db = stored(g1, g2, g3, withdrawal)

    report, store = publish(db, bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G2:rejected",)
    assert store.versions(CASE_ID) == ()
    # 철회는 새 기록이다. 처음 승인 기록은 그대로 남는다.
    assert [row.decision for row in db.rows if row.gate == "G2"] == [
        "approved",
        "rejected",
    ]


def test_reapproval_after_withdrawal_needs_reason_and_supersedes() -> None:
    bundle, fingerprint = sealed()
    g1, g2, g3 = approvals(fingerprint)
    withdrawal = record(
        "G2",
        "hold",
        fingerprint,
        at="2026-11-03T05:00:00.000Z",
        supersedes=g2.review_id,
    )
    bare = record("G2", "approved", fingerprint, at="2026-11-03T06:00:00.000Z")
    proper = record(
        "G2",
        "approved",
        fingerprint,
        at="2026-11-03T06:00:00.000Z",
        reason="(가상) 보완 확인",
        supersedes=withdrawal.review_id,
    )

    bare_report, _ = publish(stored(g1, g2, g3, withdrawal, bare), bundle)
    proper_report, _ = publish(stored(g1, g2, g3, withdrawal, proper), bundle)

    assert approval_reasons(bare_report) == ("G2:invalid history",)
    assert proper_report.outcome == "published"


def test_database_error_is_treated_as_not_approved() -> None:
    bundle, fingerprint = sealed()
    db = stored(*approvals(fingerprint))
    db.execute_error = OperationalError("SELECT", {}, Exception("connection lost"))

    report, store = publish(db, bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("approval source unavailable",)
    assert store.versions(CASE_ID) == ()
    assert db.rollback_count == 1


def test_corrupted_stored_row_is_treated_as_not_approved() -> None:
    bundle, fingerprint = sealed()
    db = stored(*approvals(fingerprint))
    db.rows[0].decision = "approve"  # 계약에 없는 결정 값

    report, _ = publish(db, bundle)

    assert approval_reasons(report) == ("approval source unavailable",)


def test_unreadable_server_header_publishes_without_approvals() -> None:
    bundle, _ = sealed()
    db = stored()

    report, _ = publish(db, type(bundle)(**{**bundle.__dict__, "server": b"{"}))

    assert report.outcome == "rejected"
    assert db.statements == []


def test_loaded_source_answers_only_its_own_key() -> None:
    _, fingerprint = sealed()
    source = asyncio.run(
        load_approval_source(stored(*approvals(fingerprint)), CASE_ID, 1)
    )

    assert len(source(CASE_ID, 1)) == 3
    for key in ((CASE_ID, 2), ("other_case", 1)):
        with pytest.raises(ApprovalSourceUnavailableError):
            source(*key)


def test_gate_turns_unavailable_source_into_fail() -> None:
    def broken(case_id: str, version: int):
        raise ApprovalSourceUnavailableError()

    assert _approval_check(broken, CASE_ID, 1, "sha256:" + "0" * 64) == GateCheck(
        "APPROVALS", "FAIL", ("approval source unavailable",)
    )


def _unavailable(subject_id: str, version: int):
    raise ApprovalSourceUnavailableError()


def test_npc_runtime_treats_unavailable_source_as_not_approved() -> None:
    bundle, fingerprint = sealed()
    report, store = publish(stored(*approvals(fingerprint)), bundle)
    pinned = store.get_version(CASE_ID, 1)
    pack = general_pack()

    assert pinned.is_approved(_unavailable) is False
    assert general_pack_approved(pack, _unavailable) is False


# ── 저장(추가만) ──


def test_append_stores_record_that_round_trips() -> None:
    _, fingerprint = sealed()
    db = FakeReviewDb()
    original = record("G1", "approved", fingerprint, at="2026-11-03T01:02:03.007Z")

    asyncio.run(append_review(db, CASE_ID, 1, original))
    source = asyncio.run(load_approval_source(db, CASE_ID, 1))

    assert source(CASE_ID, 1) == (original,)
    assert db.commit_count == 1
    assert db.rows[0].recorded_at is not None


def test_duplicate_review_id_is_rejected_without_writing() -> None:
    _, fingerprint = sealed()
    first = record("G1", "approved", fingerprint)
    db = stored(first)

    with pytest.raises(DuplicateReviewError):
        asyncio.run(append_review(db, CASE_ID, 1, first))

    assert len(db.rows) == 1
    assert db.rollback_count == 1


def test_concurrent_duplicate_caught_by_primary_key_is_duplicate() -> None:
    # 확인 시점에는 없었지만 commit 때 PK 충돌(다른 요청이 먼저 저장)
    _, fingerprint = sealed()
    first = record("G1", "approved", fingerprint)

    class RacingDb(FakeReviewDb):
        async def commit(self) -> None:
            self.rows.append(approval_store._to_row(CASE_ID, 1, first))
            raise IntegrityError("INSERT", {}, Exception("Duplicate entry"))

    db = RacingDb()
    with pytest.raises(DuplicateReviewError):
        asyncio.run(append_review(db, CASE_ID, 1, first))
    assert db.rollback_count == 1


def test_unknown_supersedes_is_rejected() -> None:
    _, fingerprint = sealed()
    orphan = record("G1", "rejected", fingerprint, supersedes=str(uuid.uuid4()))
    db = FakeReviewDb()

    with pytest.raises(UnknownSupersedesError):
        asyncio.run(append_review(db, CASE_ID, 1, orphan))

    assert db.rows == []


@pytest.mark.parametrize(
    ("subject_id", "version"),
    [("", 1), (" ", 1), ("x" * 129, 1), (CASE_ID, 0), (CASE_ID, True), (CASE_ID, "1")],
)
def test_invalid_subject_is_rejected(subject_id: Any, version: Any) -> None:
    _, fingerprint = sealed()

    with pytest.raises(InvalidReviewSubjectError):
        asyncio.run(
            append_review(
                FakeReviewDb(),
                subject_id,
                version,
                record("G1", "approved", fingerprint),
            )
        )


def test_only_review_records_are_stored() -> None:
    with pytest.raises(TypeError):
        asyncio.run(append_review(FakeReviewDb(), CASE_ID, 1, {"gate": "G1"}))


def test_store_offers_no_update_or_delete() -> None:
    public = {name for name in dir(approval_store) if not name.startswith("_")}
    assert not {n for n in public if re.match(r"(update|delete|remove|edit)", n)}


# ── 운영 기본값 · 마이그레이션 ──


def test_runtime_defaults_never_approve() -> None:
    # 승인 기록을 만드는 곳은 approval_store.append_review 정의뿐이다(자동 승인 · 시드 없음).
    callers = [
        path
        for path in (BACKEND_DIR / "app").rglob("*.py")
        if "append_review(" in path.read_text(encoding="utf-8")
    ]
    assert callers == [BACKEND_DIR / "app" / "services" / "approval_store.py"]
    assert get_npc_approval_source() is None


def test_content_reviews_revision_is_the_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    assert script.get_heads() == [NEW_REVISION]
    assert script.get_revision(NEW_REVISION).down_revision == PREVIOUS_HEAD


def test_offline_sql_creates_and_drops_only_content_reviews() -> None:
    upgrade_sql = io.StringIO()
    command.upgrade(
        alembic_config(upgrade_sql), f"{PREVIOUS_HEAD}:{NEW_REVISION}", sql=True
    )
    downgrade_sql = io.StringIO()
    command.downgrade(
        alembic_config(downgrade_sql), f"{NEW_REVISION}:{PREVIOUS_HEAD}", sql=True
    )

    up = upgrade_sql.getvalue()
    down = downgrade_sql.getvalue()
    assert "CREATE TABLE content_reviews" in up
    assert "FOREIGN KEY(supersedes) REFERENCES content_reviews (review_id)" in up
    assert "CREATE INDEX ix_content_reviews_subject" in up
    assert "DROP TABLE content_reviews" in down
    for statement in ("ALTER TABLE", "DROP TABLE play_sessions"):
        assert statement not in up
    assert "ALTER TABLE" not in down
