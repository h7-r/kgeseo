import asyncio
import io
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy.exc import OperationalError

from alembic import command
from app.api.v1.npc import get_npc_case_access_reader
from app.schemas.gate_review import ApprovalTarget, GateReviewCreate
from app.services import content_publication
from app.services.approval_history import (
    ApprovalSourceUnavailableError,
    ReviewRecord,
)
from app.services.content_publication import publish_with_stored_approvals
from app.services.gate_review import AdminAuthenticationRequired, create_gate_review
from app.services.npc_line_supply import general_pack_approved
from app.services.pinned_content import PinnedContentStore
from app.services.publication_gate import GateCheck, _approval_check
from tests.test_content_publication import sealed
from tests.test_npc_line_supply import general_pack
from tests.test_play_session_content_pin import alembic_config
from tests.test_publication_gate import CASE_ID

# 가상 테스트 데이터. 실제 승인자 · 실제 승인 기록이 아니다.
# DB 잠금 · 동시성 자체는 tests/test_stored_approval_publication_mysql.py가 실제 MySQL로 본다.
BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR / "app"
LEGACY_REVISION = "e2a7c4f9b1d3"
PREVIOUS_HEAD = "c9e1a4b7d2f0"
TARGET = ApprovalTarget(
    target_type="case_content", target_id=CASE_ID, content_version=1
)


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


class FakeHistory:
    """`locked_approval_history` 대역. 대상별 기록을 돌려주고 잠금 구간 · 오류를 흉내 낸다."""

    def __init__(self, records: dict[ApprovalTarget, list[ReviewRecord]]) -> None:
        self.records = records
        self.targets: list[ApprovalTarget] = []
        self.locked = False
        self.enter_error: Exception | None = None
        self.exit_error: Exception | None = None

    @asynccontextmanager
    async def __call__(self, sessions: Any, target: ApprovalTarget):
        self.targets.append(target)
        if self.enter_error is not None:
            raise self.enter_error
        self.locked = True
        try:
            yield object(), tuple(self.records.get(target, ()))
        finally:
            self.locked = False
        if self.exit_error is not None:
            raise self.exit_error


class LockCheckingStore(PinnedContentStore):
    """등록이 승인 잠금 안에서 일어나는지 기록한다."""

    def __init__(self, history: FakeHistory) -> None:
        super().__init__()
        self.history = history
        self.added_while_locked: list[bool] = []

    def add(self, bundle) -> None:
        self.added_while_locked.append(self.history.locked)
        super().add(bundle)


def history(*records: ReviewRecord, target: ApprovalTarget = TARGET) -> FakeHistory:
    return FakeHistory({target: list(records)})


def publish(
    monkeypatch: pytest.MonkeyPatch, fake: FakeHistory, bundle
) -> tuple[Any, LockCheckingStore]:
    monkeypatch.setattr(content_publication, "locked_approval_history", fake)
    store = LockCheckingStore(fake)
    report = asyncio.run(
        publish_with_stored_approvals(
            "sessions", store, bundle, ng_checker=lambda text: False
        )
    )
    return report, store


def approval_reasons(report) -> tuple[str, ...]:
    return next(c for c in report.checks if c.code == "APPROVALS").reasons


# ── 단일 판정 경로(npc_approval_reviews · case_content) ──


def test_no_approvals_blocks_publication(monkeypatch) -> None:
    bundle, _ = sealed()

    report, store = publish(monkeypatch, history(), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G1:missing", "G2:missing", "G3:missing")
    assert store.versions(CASE_ID) == ()


def test_exact_fingerprint_publishes_inside_the_approval_lock(monkeypatch) -> None:
    bundle, fingerprint = sealed()
    fake = history(*approvals(fingerprint))

    report, store = publish(monkeypatch, fake, bundle)

    assert report.outcome == "published"
    assert store.versions(CASE_ID) == (1,)
    # 판정 대상은 server.json 머리의 (case_content, case_id, content_version)이다.
    assert fake.targets == [TARGET]
    # 저장소 등록은 승인 대상 잠금을 잡은 채로 한다(그 사이 철회가 끼어들지 않는다).
    assert store.added_while_locked == [True]


def test_approvals_for_another_fingerprint_are_not_reused(monkeypatch) -> None:
    bundle, _ = sealed()
    _, other_fingerprint = sealed(answer="가상다른정답")

    report, store = publish(monkeypatch, history(*approvals(other_fingerprint)), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == tuple(
        f"{gate}:stale target_hash" for gate in ("G1", "G2", "G3")
    )
    assert store.versions(CASE_ID) == ()


@pytest.mark.parametrize(
    "other",
    [
        ApprovalTarget(
            target_type="case_content", target_id=CASE_ID, content_version=2
        ),
        ApprovalTarget(
            target_type="dialogue_pack", target_id=CASE_ID, content_version=1
        ),
    ],
)
def test_approvals_for_another_target_are_not_reused(monkeypatch, other) -> None:
    bundle, fingerprint = sealed()

    report, store = publish(
        monkeypatch, history(*approvals(fingerprint), target=other), bundle
    )

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G1:missing", "G2:missing", "G3:missing")
    assert store.versions(CASE_ID) == ()


def test_missing_gate_blocks_publication(monkeypatch) -> None:
    bundle, fingerprint = sealed()

    report, store = publish(
        monkeypatch, history(*approvals(fingerprint, ("G1", "G2"))), bundle
    )

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G3:missing",)
    assert store.versions(CASE_ID) == ()


def test_withdrawn_approval_blocks_publication(monkeypatch) -> None:
    bundle, fingerprint = sealed()
    g1, g2, g3 = approvals(fingerprint)
    withdrawal = record(
        "G2",
        "rejected",
        fingerprint,
        at="2026-11-03T05:00:00.000Z",
        supersedes=g2.review_id,
    )

    report, store = publish(monkeypatch, history(g1, g2, g3, withdrawal), bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("G2:rejected",)
    assert store.versions(CASE_ID) == ()


def test_reapproval_after_withdrawal_needs_reason_and_supersedes(monkeypatch) -> None:
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

    bare_report, _ = publish(monkeypatch, history(g1, g2, g3, withdrawal, bare), bundle)
    proper_report, _ = publish(
        monkeypatch, history(g1, g2, g3, withdrawal, proper), bundle
    )

    assert approval_reasons(bare_report) == ("G2:invalid history",)
    assert proper_report.outcome == "published"


def test_approval_lookup_failure_blocks_publication(monkeypatch) -> None:
    bundle, fingerprint = sealed()
    fake = history(*approvals(fingerprint))
    fake.enter_error = OperationalError("SELECT", {}, Exception("connection lost"))

    report, store = publish(monkeypatch, fake, bundle)

    assert report.outcome == "rejected"
    assert approval_reasons(report) == ("approval source unavailable",)
    assert store.versions(CASE_ID) == ()


def test_commit_failure_after_registration_keeps_the_report(monkeypatch) -> None:
    # 판정 · 등록은 잠금 안에서 커밋된 이력으로 끝났다. 잠금 행 트랜잭션 commit만 실패한 경우다.
    bundle, fingerprint = sealed()
    fake = history(*approvals(fingerprint))
    fake.exit_error = OperationalError("COMMIT", {}, Exception("connection lost"))

    report, store = publish(monkeypatch, fake, bundle)

    assert report.outcome == "published"
    assert store.versions(CASE_ID) == (1,)


def test_non_database_errors_are_not_turned_into_reports(monkeypatch) -> None:
    bundle, fingerprint = sealed()
    fake = history(*approvals(fingerprint))
    fake.enter_error = RuntimeError("unexpected")

    with pytest.raises(RuntimeError):
        publish(monkeypatch, fake, bundle)


def test_unreadable_server_header_publishes_without_approvals(monkeypatch) -> None:
    bundle, fingerprint = sealed()
    fake = history(*approvals(fingerprint))

    report, _ = publish(
        monkeypatch, fake, type(bundle)(**{**bundle.__dict__, "server": b"{"})
    )

    assert report.outcome == "rejected"
    assert fake.targets == []


@pytest.mark.parametrize(
    ("case_id", "version"), [("c" * 65, 1), (CASE_ID, 0), (" " + CASE_ID, 1)]
)
def test_header_outside_approval_target_contract_is_not_approved(
    case_id: str, version: int
) -> None:
    server = (
        b'{"case_id":"'
        + case_id.encode()
        + b'","content_version":'
        + str(version).encode()
        + b"}"
    )

    assert content_publication._approval_target(server) is None


def test_gate_turns_unavailable_source_into_fail() -> None:
    def broken(case_id: str, version: int):
        raise ApprovalSourceUnavailableError()

    assert _approval_check(broken, CASE_ID, 1, "sha256:" + "0" * 64) == GateCheck(
        "APPROVALS", "FAIL", ("approval source unavailable",)
    )


def test_npc_runtime_treats_unavailable_source_as_not_approved(monkeypatch) -> None:
    bundle, fingerprint = sealed()
    _, store = publish(monkeypatch, history(*approvals(fingerprint)), bundle)
    pinned = store.get_version(CASE_ID, 1)

    def unavailable(subject_id: str, version: int):
        raise ApprovalSourceUnavailableError()

    assert pinned.is_approved(unavailable) is False
    assert general_pack_approved(general_pack(), unavailable) is False


# ── 기록 생성 경로(검증된 관리자만) · 레거시 우회 차단 ──


def test_gate_review_requires_verified_admin() -> None:
    request = GateReviewCreate(
        **TARGET.model_dump(),
        gate="G1",
        target_hash="sha256:" + "0" * 64,
        decision="approved",
    )

    for admin in (None, "reviewer-test", {"reviewer": "reviewer-test"}):
        with pytest.raises(AdminAuthenticationRequired):
            asyncio.run(create_gate_review(None, request, admin=admin))


def _app_sources() -> dict[Path, str]:
    return {path: path.read_text(encoding="utf-8") for path in APP_DIR.rglob("*.py")}


def test_legacy_content_reviews_has_no_app_path() -> None:
    sources = _app_sources()

    # 레거시 서비스(append_review · load_approval_source)는 없다.
    assert not (APP_DIR / "services" / "approval_store.py").exists()
    for needle in ("append_review", "load_approval_source", "approval_store"):
        assert [path for path, text in sources.items() if needle in text] == []
    # content_reviews 모델은 migration 보존용으로만 남는다. 앱에서 import하는 곳이 없다.
    assert [
        path
        for path, text in sources.items()
        if "ContentReview" in text and path.name != "content_review.py"
    ] == []


def test_only_gate_review_appends_approval_records() -> None:
    sources = _app_sources()

    writers = [path for path, text in sources.items() if "repository.append(" in text]
    assert writers == [APP_DIR / "services" / "gate_review.py"]


def test_npc_runtime_reads_approvals_only_from_the_database() -> None:
    from app.services.npc_case_access import read_case_npc_access

    assert get_npc_case_access_reader() is read_case_npc_access


# ── 레거시 migration 보존 ──


def test_content_reviews_revision_is_kept_under_the_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    # 단일 head(통합 merge revision)의 조상이다. head 자체는 test_play_session_content_pin이 확인한다.
    (head,) = script.get_heads()
    assert LEGACY_REVISION in {
        rev.revision for rev in script.iterate_revisions(head, "base")
    }
    assert script.get_revision(LEGACY_REVISION).down_revision == PREVIOUS_HEAD


@pytest.fixture
def keep_existing_loggers():
    # alembic env.py의 fileConfig가 이미 있는 logger를 끈다. 뒤 테스트의 caplog에 새지 않게 되돌린다.
    loggers = [
        logger
        for logger in logging.root.manager.loggerDict.values()
        if isinstance(logger, logging.Logger)
    ]
    disabled = [logger.disabled for logger in loggers]
    yield
    for logger, was_disabled in zip(loggers, disabled, strict=True):
        logger.disabled = was_disabled


def test_offline_sql_creates_and_drops_only_content_reviews(
    keep_existing_loggers,
) -> None:
    upgrade_sql = io.StringIO()
    command.upgrade(
        alembic_config(upgrade_sql), f"{PREVIOUS_HEAD}:{LEGACY_REVISION}", sql=True
    )
    downgrade_sql = io.StringIO()
    command.downgrade(
        alembic_config(downgrade_sql), f"{LEGACY_REVISION}:{PREVIOUS_HEAD}", sql=True
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
