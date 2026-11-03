import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.exc import OperationalError

from app.api.v1.play_sessions import get_new_session_publication_guard
from app.main import app, lifespan
from app.models.play_session import PlaySession
from app.repositories.npc_publication import PublicationSnapshot
from app.services import content_release
from app.services.content_release import (
    ContentNotPublishedError,
    publish_and_register,
    register_snapshot,
    require_published_for_new_session,
    restore_on_startup,
    sync_published_content,
)
from app.services.npc_publication import (
    PublicationGateFailedError,
    PublicationOutcome,
    PublicationTransitionError,
)
from app.services.pinned_content import (
    ContentPin,
    ContentVersionNotFoundError,
    PinnedContentStore,
    resolve_session_content,
)
from app.services.play_session import create_play_session
from app.services.publication_gate import (
    PublicationResult,
    PublishedContentRebuildError,
    rebuild_published_content,
)
from app.services.published_content_loader import (
    BundleFileMissingError,
    read_bundle_snapshot,
)
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    get_pinned_content_store,
)
from tests.conftest import FakeAsyncSession
from tests.test_content_publication import documents
from tests.test_pinned_session_http import anonymous, create_body
from tests.test_publication_gate import CASE_ID, seal

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 승인 기록 · 실제 게시본이 아니다.
# DB 잠금 · 트랜잭션 자체는 tests/test_content_release_mysql.py가 실제 MySQL로 본다.
NOW = datetime(2026, 11, 3, 1, 2, 3)
SESSIONS_URL = "/api/v1/play-sessions"


def write_bundle(root: Path, version: int, answer: str | None = None) -> str:
    """게시 루트에 한 버전의 원본을 쓴다(테스트 전용). fingerprint를 돌려준다."""

    docs = documents(version) if answer is None else documents(version, answer)
    files, fingerprint = seal(docs)
    directory = root / CASE_ID / f"v{version}"
    directory.mkdir(parents=True, exist_ok=True)
    for role, content in files.items():
        (directory / f"{role}.json").write_bytes(content)
    return fingerprint


def state(
    version: int, fingerprint: str, status: str = "published"
) -> PublicationSnapshot:
    return PublicationSnapshot(CASE_ID, version, fingerprint, status, 1, NOW)


class FakePublicationService:
    """`NpcPublicationService` 대역. DB 상태 목록과 게시 결과를 흉내 낸다."""

    def __init__(self, states: list[PublicationSnapshot] | None = None) -> None:
        self.states = list(states or [])
        self.publish_error: Exception | None = None
        self.read_error: Exception | None = None
        self.published: list[Any] = []

    async def restorable_versions(self):
        if self.read_error is not None:
            raise self.read_error
        return tuple(self.states)

    async def current(self, case_id: str, version: int):
        return next(
            (
                s
                for s in self.states
                if (s.case_id, s.content_version) == (case_id, version)
            ),
            None,
        )

    async def publish_new(self, snapshot, **kwargs):
        self.published.append((snapshot, kwargs))
        if self.publish_error is not None:
            raise self.publish_error
        files = snapshot.files
        fingerprint = seal_fingerprint(files)
        published = state(snapshot.content_version, fingerprint)
        self.states.append(published)
        pinned = rebuild_published_content(
            client=files["client"],
            server=files["server"],
            npc=files["npc"],
            idmap=files["idmap"],
            expected=ContentPin(CASE_ID, snapshot.content_version, fingerprint),
        )
        gate = PublicationResult(True, True, CASE_ID, snapshot.content_version, ())
        return PublicationOutcome(published, gate, pinned)


def seal_fingerprint(files) -> str:
    from app.services.content_fingerprint import compute_content_fingerprint

    return compute_content_fingerprint(
        client=files["client"],
        server=files["server"],
        npc=files["npc"],
        idmap=files["idmap"],
    )


def release(service, store, root, version: int = 1):
    return asyncio.run(
        publish_and_register(
            service,
            store,
            root,
            CASE_ID,
            version,
            reason="(가상) 게시",
            actor="operator-test",
            ng_checker=lambda text: False,
            local_ids=None,
        )
    )


def pinned_row(version: int, fingerprint: str) -> PlaySession:
    return PlaySession(
        id="p" * 36,
        anonymous_session_id="anon",
        case_id=CASE_ID,
        state_json={},
        created_at=NOW,
        updated_at=NOW,
        completed_at=None,
        content_version=version,
        content_fingerprint=fingerprint,
    )


# ── 재구성(원본 바이트 → 고정 묶음) ──


def test_rebuild_requires_the_registered_fingerprint(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    snapshot = read_bundle_snapshot(tmp_path, CASE_ID, 1)
    files = dict(snapshot.files)

    content = rebuild_published_content(
        **files, expected=ContentPin(CASE_ID, 1, fingerprint)
    )
    assert content.pin == ContentPin(CASE_ID, 1, fingerprint)

    with pytest.raises(PublishedContentRebuildError, match="fingerprint"):
        rebuild_published_content(
            **files, expected=ContentPin(CASE_ID, 1, "sha256:" + "0" * 64)
        )


def test_rebuild_rejects_files_whose_header_names_another_version(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 2)
    files = dict(read_bundle_snapshot(tmp_path, CASE_ID, 2).files)

    with pytest.raises(PublishedContentRebuildError, match="header"):
        rebuild_published_content(**files, expected=ContentPin(CASE_ID, 1, fingerprint))


def test_rebuild_rejects_unparseable_files(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    files = dict(read_bundle_snapshot(tmp_path, CASE_ID, 1).files)
    files["server"] = b"{"

    with pytest.raises(PublishedContentRebuildError, match="parse"):
        rebuild_published_content(**files, expected=ContentPin(CASE_ID, 1, fingerprint))


# ── 재시작 복구 · 재조정 ──


def test_sync_restores_every_publication_state(tmp_path) -> None:
    fingerprints = {v: write_bundle(tmp_path, v, f"가상정답{v}") for v in (1, 2, 3)}
    service = FakePublicationService(
        [
            state(1, fingerprints[1], "published"),
            state(2, fingerprints[2], "suspended"),
            state(3, fingerprints[3], "blocked"),
        ]
    )
    store = PinnedContentStore()

    entries = asyncio.run(sync_published_content(service, store, tmp_path))

    # 중단된 버전도 진행 중 세션의 게임 콘텐츠용으로 채운다(PM v0.4.6).
    assert [(e.content_version, e.status, e.publication_status) for e in entries] == [
        (1, "registered", "published"),
        (2, "registered", "suspended"),
        (3, "registered", "blocked"),
    ]
    assert store.versions(CASE_ID) == (1, 2, 3)


def test_sync_is_idempotent_and_never_replaces(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    service = FakePublicationService([state(1, fingerprint)])
    store = PinnedContentStore()
    asyncio.run(sync_published_content(service, store, tmp_path))
    before = store.get_version(CASE_ID, 1)

    entries = asyncio.run(sync_published_content(service, store, tmp_path))

    assert [e.status for e in entries] == ["already_registered"]
    assert store.get_version(CASE_ID, 1) is before


def test_missing_files_disable_only_that_version(tmp_path, caplog) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    service = FakePublicationService(
        [state(1, fingerprint), state(2, "sha256:" + "2" * 64)]
    )
    store = PinnedContentStore()

    with caplog.at_level(logging.ERROR):
        entries = asyncio.run(sync_published_content(service, store, tmp_path))

    assert [(e.status, e.reason) for e in entries] == [
        ("registered", None),
        ("files_missing", "client"),
    ]
    assert store.versions(CASE_ID) == (1,)
    assert "files_missing" in caplog.text and str(tmp_path) not in caplog.text


def test_replaced_files_are_not_registered(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    write_bundle(tmp_path, 1, "가상교체정답")  # 게시 뒤 같은 위치의 파일이 바뀌었다
    store = PinnedContentStore()

    entries = asyncio.run(
        sync_published_content(
            FakePublicationService([state(1, fingerprint)]), store, tmp_path
        )
    )

    assert [(e.status, e.reason) for e in entries] == [
        ("rebuild_failed", "fingerprint")
    ]
    assert store.versions(CASE_ID) == ()
    with pytest.raises(ContentVersionNotFoundError):
        resolve_session_content(pinned_row(1, fingerprint), store)


def test_store_holding_another_fingerprint_is_reported_not_replaced(tmp_path) -> None:
    other = write_bundle(tmp_path, 1, "가상다른정답")
    store = PinnedContentStore()
    asyncio.run(
        sync_published_content(
            FakePublicationService([state(1, other)]), store, tmp_path
        )
    )
    fingerprint = write_bundle(tmp_path, 1)

    entries = asyncio.run(
        sync_published_content(
            FakePublicationService([state(1, fingerprint)]), store, tmp_path
        )
    )

    assert [e.status for e in entries] == ["store_conflict"]
    assert store.get_version(CASE_ID, 1).pin.content_fingerprint == other


def test_restart_restores_pinned_sessions(tmp_path) -> None:
    root = tmp_path
    write_bundle(root, 1)
    service = FakePublicationService()
    before_restart = PinnedContentStore()
    result = release(service, before_restart, root)
    fingerprint = result.publication.content_fingerprint
    row = pinned_row(1, fingerprint)

    after_restart = PinnedContentStore()  # 새 프로세스
    with pytest.raises(ContentVersionNotFoundError):
        resolve_session_content(row, after_restart)
    asyncio.run(sync_published_content(service, after_restart, root))

    bundle = resolve_session_content(row, after_restart)
    assert bundle.pin == ContentPin(CASE_ID, 1, fingerprint)


def test_startup_restore_without_root_reads_nothing(monkeypatch) -> None:
    called = []
    monkeypatch.setattr(
        content_release,
        "sync_published_content",
        lambda *args: called.append(args),
    )

    assert asyncio.run(restore_on_startup("  ", None, PinnedContentStore())) is None
    assert called == []


def test_startup_restore_survives_database_failure(monkeypatch, caplog) -> None:
    async def failing(service, store, root):
        raise OperationalError("SELECT", {}, Exception("connection lost"))

    monkeypatch.setattr(content_release, "sync_published_content", failing)
    store = PinnedContentStore()

    with caplog.at_level(logging.ERROR):
        result = asyncio.run(restore_on_startup("/published", None, store))

    assert result is None
    assert store.versions(CASE_ID) == ()
    assert "restore failed" in caplog.text


def test_app_lifespan_restores_into_the_session_store(monkeypatch) -> None:
    calls = []

    async def fake_restore(root, sessions, store):
        calls.append((root, store))

    monkeypatch.setattr("app.main.restore_on_startup", fake_restore)
    monkeypatch.setattr("app.main.settings.published_content_root", "/published")

    async def run():
        async with lifespan(app):
            pass

    asyncio.run(run())
    assert calls == [("/published", get_pinned_content_store())]


# ── 게시 + 등록 ──


def test_publish_registers_after_database_commit(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    service = FakePublicationService()
    store = PinnedContentStore()

    result = release(service, store, tmp_path)

    assert result.outcome == "published"
    assert result.registration.status == "registered"
    assert result.publication.content_fingerprint == fingerprint
    assert store.get_version(CASE_ID, 1).pin.content_fingerprint == fingerprint


def test_missing_files_publish_nothing(tmp_path) -> None:
    service = FakePublicationService()
    store = PinnedContentStore()

    with pytest.raises(BundleFileMissingError):
        release(service, store, tmp_path)

    assert service.published == []
    assert store.versions(CASE_ID) == ()


@pytest.mark.parametrize(
    "error",
    [
        OperationalError("COMMIT", {}, Exception("connection lost")),
        PublicationGateFailedError(PublicationResult(False, False, CASE_ID, 1, ())),
    ],
)
def test_failed_database_publication_registers_nothing(tmp_path, error) -> None:
    write_bundle(tmp_path, 1)
    service = FakePublicationService()
    service.publish_error = error
    store = PinnedContentStore()

    with pytest.raises(type(error)):
        release(service, store, tmp_path)

    assert store.versions(CASE_ID) == ()


def test_registration_failure_is_reported_and_recovered_by_sync(
    tmp_path, monkeypatch
) -> None:
    write_bundle(tmp_path, 1)
    service = FakePublicationService()
    store = PinnedContentStore()

    def broken_add(bundle):
        raise MemoryError()

    monkeypatch.setattr(store, "add", broken_add)
    result = release(service, store, tmp_path)
    monkeypatch.undo()

    # DB는 게시 상태지만 메모리에는 없다(신규 세션은 409). 재조정이 채운다.
    assert result.outcome == "published"
    assert (result.registration.status, result.registration.reason) == (
        "registration_failed",
        "MemoryError",
    )
    assert store.versions(CASE_ID) == ()
    entries = asyncio.run(sync_published_content(service, store, tmp_path))
    assert [e.status for e in entries] == ["registered"]


def test_duplicate_publication_only_reconciles_registration(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    service = FakePublicationService([state(1, fingerprint)])
    service.publish_error = PublicationTransitionError()
    store = PinnedContentStore()

    result = release(service, store, tmp_path)

    assert result.outcome == "already_published"
    assert result.registration.status == "registered"
    assert release(service, store, tmp_path).registration.status == (
        "already_registered"
    )


def test_duplicate_publication_with_other_files_is_rejected(tmp_path) -> None:
    write_bundle(tmp_path, 1, "가상다른정답")
    service = FakePublicationService([state(1, "sha256:" + "1" * 64)])
    service.publish_error = PublicationTransitionError()
    store = PinnedContentStore()

    with pytest.raises(PublicationTransitionError):
        release(service, store, tmp_path)

    assert store.versions(CASE_ID) == ()


# ── 신규 세션 guard ──


class FakeRepository:
    snapshot: PublicationSnapshot | None = None

    def __init__(self, db) -> None:
        self.db = db

    async def lock_state(self, case_id, content_version, *, mode):
        assert mode == "share"
        return FakeRepository.snapshot


FP = "sha256:" + "a" * 64
PIN = ContentPin(CASE_ID, 1, FP)


@pytest.mark.parametrize(
    ("snapshot", "allowed"),
    [
        (None, False),
        (state(1, FP, "published"), True),
        (state(1, FP, "suspended"), False),
        (state(1, FP, "blocked"), False),
        (state(1, FP, "unknown"), False),
        (state(1, "sha256:" + "b" * 64, "published"), False),
    ],
)
def test_new_session_guard_follows_publication_policy(
    monkeypatch, snapshot, allowed
) -> None:
    monkeypatch.setattr(content_release, "NpcPublicationRepository", FakeRepository)
    monkeypatch.setattr(FakeRepository, "snapshot", snapshot)

    if allowed:
        asyncio.run(require_published_for_new_session(object(), PIN))
    else:
        with pytest.raises(ContentNotPublishedError):
            asyncio.run(require_published_for_new_session(object(), PIN))


def test_pinned_session_creation_requires_a_guard(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    snapshot = read_bundle_snapshot(tmp_path, CASE_ID, 1)
    db = FakeAsyncSession()
    db.get_result = anonymous()
    content = register_and_get(snapshot, fingerprint)

    with pytest.raises(ValueError, match="publication_guard"):
        asyncio.run(create_play_session(db, "anon", CASE_ID, pinned_content=content))
    assert db.added == [] and db.commit_count == 0


def test_rejected_guard_saves_nothing(tmp_path) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    snapshot = read_bundle_snapshot(tmp_path, CASE_ID, 1)
    db = FakeAsyncSession()
    db.get_result = anonymous()

    async def suspended(db, pin):
        raise ContentNotPublishedError(pin.label())

    with pytest.raises(ContentNotPublishedError):
        asyncio.run(
            create_play_session(
                db,
                "anon",
                CASE_ID,
                pinned_content=register_and_get(snapshot, fingerprint),
                publication_guard=suspended,
            )
        )
    assert db.added == [] and db.commit_count == 0 and db.rollback_count == 1


def register_and_get(snapshot, fingerprint):
    store = PinnedContentStore()
    register_snapshot(store, snapshot, state(1, fingerprint))
    return store.get_version(CASE_ID, 1)


def test_endpoint_uses_the_database_guard_by_default() -> None:
    assert get_new_session_publication_guard() is require_published_for_new_session


def test_endpoint_returns_409_when_content_is_not_published(
    client, db_session, tmp_path
) -> None:
    fingerprint = write_bundle(tmp_path, 1)
    store = PinnedContentStore()
    register_snapshot(
        store, read_bundle_snapshot(tmp_path, CASE_ID, 1), state(1, fingerprint)
    )
    db_session.get_result = anonymous()

    async def suspended(db, pin):
        raise ContentNotPublishedError(pin.label())

    app.dependency_overrides[get_pinned_content_store] = lambda: store
    app.dependency_overrides[get_new_session_publication_guard] = lambda: suspended
    try:
        response = client.post(SESSIONS_URL, json=create_body(content_version=1))
    finally:
        app.dependency_overrides.pop(get_pinned_content_store, None)

    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}
    assert db_session.added == [] and db_session.commit_count == 0
