import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import publication_gate
from app.services.content_publication import (
    ContentPublisher,
    PublicationBundle,
    PublicationInputError,
    read_publication_bundle,
)
from app.services.pinned_content import ContentPin, PinnedContentStore
from app.services.puzzle_runtime import CASES_DIRECTORY
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    get_pinned_content_store,
)
from tests.conftest import FakeAsyncSession
from tests.naju_mini_case import input_body
from tests.test_pinned_session_http import anonymous, create_body
from tests.test_publication_gate import (
    ANSWER,
    CASE_ID,
    HINTS,
    base_documents,
    review,
    seal,
)

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 승인 기록 · 실제 게시본이 아니다.
SESSIONS_URL = "/api/v1/play-sessions"
SECOND_ANSWER = "가상두번째정답"
NPC_TEXT = "(가상) 그 자물쇠를 다시 보자."


def documents(version: int = 1, answer: str = ANSWER) -> dict[str, dict[str, Any]]:
    docs = base_documents(version)
    del docs["idmap"]
    puzzle = docs["server"]["puzzles"][0]
    puzzle["accepted_answers"] = [answer]
    # 정식 힌트 원문은 server.json에 둔다(게시 경로는 따로 넘기지 않으면 여기서 읽는다).
    puzzle["hints"] = [
        {"level": level, "text": HINTS[(CASE_ID, "PUZZLE_A", level)]}
        for level in (1, 2)
    ]
    return docs


def sealed(version: int = 1, answer: str = ANSWER) -> tuple[PublicationBundle, str]:
    files, fingerprint = seal(documents(version, answer))
    return PublicationBundle(**files), fingerprint


def approving(*fingerprints: str):
    """세 관문 모두 승인한 기록(테스트 전용 승인 이력)."""

    records = [
        review(gate, "approved", fingerprint)
        for fingerprint in fingerprints
        for gate in ("G1", "G2", "G3")
    ]
    return lambda case_id, version: records


def publisher(store: PinnedContentStore, *fingerprints: str, **overrides: Any):
    kwargs: dict[str, Any] = {
        "approval_source": approving(*fingerprints) if fingerprints else None,
        "ng_checker": lambda text: False,
    }
    kwargs.update(overrides)
    return ContentPublisher(store, **kwargs)


def statuses(report) -> dict[str, str]:
    return {check.code: check.status for check in report.checks}


# ── 게시 성공 · 실패 ──


def test_approved_bundle_is_published_with_its_own_hints() -> None:
    bundle, fingerprint = sealed()
    store = PinnedContentStore()

    report = publisher(store, fingerprint).publish(bundle)

    assert report.outcome == "published"
    assert report.registered is True
    assert (report.case_id, report.content_version) == (CASE_ID, 1)
    assert set(statuses(report).values()) == {"PASS", "NOT_APPLICABLE"}
    pinned = store.get(ContentPin(CASE_ID, 1, fingerprint))
    assert pinned.server().puzzles[0].accepted_answers == [ANSWER]


def test_bundle_without_approval_source_is_rejected() -> None:
    bundle, _ = sealed()
    store = PinnedContentStore()

    report = publisher(store).publish(bundle)

    assert report.outcome == "rejected"
    assert report.registered is False
    assert report.checks[-1].code == "APPROVALS"
    assert report.checks[-1].status == "FAIL"
    assert store.versions(CASE_ID) == ()


def test_approvals_for_other_content_are_not_used() -> None:
    bundle, _ = sealed()
    _, other_fingerprint = sealed(answer=SECOND_ANSWER)
    store = PinnedContentStore()

    report = publisher(store, other_fingerprint).publish(bundle)

    assert report.outcome == "rejected"
    assert statuses(report)["APPROVALS"] == "FAIL"
    assert store.versions(CASE_ID) == ()


def test_unverified_check_blocks_publication() -> None:
    bundle, fingerprint = sealed()
    store = PinnedContentStore()

    report = publisher(store, fingerprint, ng_checker=None).publish(bundle)

    assert report.outcome == "rejected"
    assert statuses(report)["NG"] == "UNVERIFIED"
    assert store.versions(CASE_ID) == ()


def test_content_edited_after_sealing_is_rejected() -> None:
    docs = documents()
    files, fingerprint = seal(docs)
    docs["server"]["puzzles"][0]["accepted_answers"] = ["바뀐정답"]
    tampered = PublicationBundle(
        **{**files, "server": json.dumps(docs["server"]).encode()}
    )
    store = PinnedContentStore()

    report = publisher(store, fingerprint).publish(tampered)

    assert report.outcome == "rejected"
    assert statuses(report)["HEADER"] == "FAIL"
    assert store.versions(CASE_ID) == ()


def test_files_with_different_versions_are_rejected() -> None:
    docs = documents()
    docs["npc"]["content_version"] = 2
    files, fingerprint = seal(docs)
    store = PinnedContentStore()

    report = publisher(store, fingerprint).publish(PublicationBundle(**files))

    assert report.outcome == "rejected"
    assert statuses(report)["HEADER"] == "FAIL"
    assert store.versions(CASE_ID) == ()


def test_report_carries_no_content_or_fingerprint() -> None:
    bundle, fingerprint = sealed()
    store = PinnedContentStore()

    for report in (
        publisher(store).publish(bundle),
        publisher(store, fingerprint).publish(bundle),
        publisher(store, fingerprint).publish(bundle),
    ):
        text = repr(report)
        for secret in (ANSWER, NPC_TEXT, fingerprint, *HINTS.values()):
            assert secret not in text


# ── 버전 정책 ──


def test_same_version_same_content_is_already_published() -> None:
    bundle, fingerprint = sealed()
    store = PinnedContentStore()
    publisher(store, fingerprint).publish(bundle)
    first = store.get_version(CASE_ID, 1)

    report = publisher(store, fingerprint).publish(bundle)

    assert report.outcome == "already_published"
    assert report.registered is False
    assert store.versions(CASE_ID) == (1,)
    assert store.get_version(CASE_ID, 1) is first


def test_same_version_different_content_is_a_conflict() -> None:
    bundle, fingerprint = sealed()
    other, other_fingerprint = sealed(answer=SECOND_ANSWER)
    store = PinnedContentStore()
    publisher(store, fingerprint).publish(bundle)

    report = publisher(store, other_fingerprint).publish(other)

    assert report.outcome == "version_conflict"
    assert statuses(report)["VERSION_ORDER"] == "FAIL"
    assert store.get_version(CASE_ID, 1).pin.content_fingerprint == fingerprint


def test_lower_version_after_newer_one_is_rejected() -> None:
    v1, fp1 = sealed(1)
    v2, fp2 = sealed(2, SECOND_ANSWER)
    store = PinnedContentStore()
    publisher(store, fp2).publish(v2)

    report = publisher(store, fp1).publish(v1)

    assert report.outcome == "rejected"
    assert statuses(report)["VERSION_ORDER"] == "FAIL"
    assert store.versions(CASE_ID) == (2,)


def test_newer_version_is_added_without_replacing_the_old_one() -> None:
    v1, fp1 = sealed(1)
    v2, fp2 = sealed(2, SECOND_ANSWER)
    store = PinnedContentStore()

    reports = [
        publisher(store, fp1).publish(v1),
        publisher(store, fp2).publish(v2),
    ]

    assert [r.outcome for r in reports] == ["published", "published"]
    assert store.versions(CASE_ID) == (1, 2)
    assert store.get_version(CASE_ID, 1).pin.content_fingerprint == fp1


def test_concurrent_publications_of_one_version_register_once() -> None:
    bundles = [sealed(answer=f"가상정답{n}") for n in range(8)]
    store = PinnedContentStore()
    start = threading.Barrier(len(bundles))
    reports = []

    def run(bundle: PublicationBundle, fingerprint: str) -> None:
        start.wait()
        reports.append(publisher(store, fingerprint).publish(bundle))

    threads = [threading.Thread(target=run, args=pair) for pair in bundles]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    outcomes = sorted(report.outcome for report in reports)
    assert outcomes == ["published"] + ["version_conflict"] * 7
    assert store.versions(CASE_ID) == (1,)


def test_failure_while_registering_leaves_nothing_behind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle, fingerprint = sealed()
    store = PinnedContentStore()

    def broken_bundle(*args: Any, **kwargs: Any):
        raise RuntimeError("bundle construction failed")

    monkeypatch.setattr(publication_gate, "PinnedContent", broken_bundle)

    with pytest.raises(RuntimeError):
        publisher(store, fingerprint).publish(bundle)

    assert store.versions(CASE_ID) == ()
    # 잠금은 풀려 있어 다음 게시를 막지 않는다.
    assert store.publication_lock.acquire(blocking=False)
    store.publication_lock.release()


# ── 게시 입력 ──


def write_bundle(directory: Path, docs: dict[str, dict[str, Any]]) -> dict:
    files, _ = seal(docs)
    directory.mkdir(parents=True, exist_ok=True)
    for role, content in files.items():
        (directory / f"{role}.json").write_bytes(content)
    return files


def test_publication_input_is_read_as_exact_bytes(tmp_path: Path) -> None:
    files = write_bundle(tmp_path / "v1", documents())

    bundle = read_publication_bundle(tmp_path / "v1")

    assert bundle == PublicationBundle(**files, idmap=None)


def test_missing_publication_file_names_only_its_role(tmp_path: Path) -> None:
    write_bundle(tmp_path / "v1", documents())
    (tmp_path / "v1" / "npc.json").unlink()

    with pytest.raises(PublicationInputError, match="^npc$"):
        read_publication_bundle(tmp_path / "v1")


@pytest.mark.parametrize("directory", [CASES_DIRECTORY, CASES_DIRECTORY / "nested"])
def test_legacy_content_directory_is_not_publication_input(directory: Path) -> None:
    with pytest.raises(PublicationInputError, match="legacy content directory"):
        read_publication_bundle(directory)


# ── 세션 고정 · 기존 세션 불변 (HTTP) ──


@pytest.fixture
def app_store() -> Iterator[PinnedContentStore]:
    store = PinnedContentStore()
    app.dependency_overrides[get_pinned_content_store] = lambda: store
    yield store
    app.dependency_overrides.pop(get_pinned_content_store, None)


def start_session(client: TestClient, db_session: FakeAsyncSession, **extra: Any):
    db_session.get_result = anonymous()
    db_session.added.clear()
    body = {**create_body(CASE_ID), **extra}
    response = client.post(SESSIONS_URL, json=body)
    assert response.status_code == 201
    [row] = db_session.added
    return row


def answer(client: TestClient, db_session: FakeAsyncSession, row, value: str):
    db_session.get_result = row
    db_session.scalar_result = None
    response = client.post(
        f"{SESSIONS_URL}/{row.id}/interactions",
        json=input_body("OBJ_S1_LOCK_1", value),
    )
    assert response.status_code == 200
    return response.json()["result_type"]


def test_unpublished_version_cannot_start_a_session(
    client: TestClient, db_session: FakeAsyncSession, app_store: PinnedContentStore
) -> None:
    bundle, _ = sealed()
    publisher(app_store).publish(bundle)  # 승인 없음 → 등록되지 않음
    db_session.get_result = anonymous()

    response = client.post(SESSIONS_URL, json=create_body(CASE_ID, content_version=1))

    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}
    assert db_session.added == []


def test_published_session_keeps_its_pinned_content_after_newer_publication(
    client: TestClient, db_session: FakeAsyncSession, app_store: PinnedContentStore
) -> None:
    v1, fp1 = sealed(1)
    assert publisher(app_store, fp1).publish(v1).registered
    row = start_session(client, db_session, content_version=1)
    assert (row.content_version, row.content_fingerprint) == (1, fp1)

    v2, fp2 = sealed(2, SECOND_ANSWER)
    assert publisher(app_store, fp2).publish(v2).registered
    later = start_session(client, db_session, content_version=2)

    # v1 세션은 v2 게시 뒤에도 v1 정답만 받는다(최신으로 바뀌지 않는다).
    assert answer(client, db_session, row, SECOND_ANSWER) == "incorrect"
    assert answer(client, db_session, row, ANSWER) == "correct"
    assert answer(client, db_session, later, ANSWER) == "incorrect"
    assert answer(client, db_session, later, SECOND_ANSWER) == "correct"
    assert (row.content_version, row.content_fingerprint) == (1, fp1)


def test_conflicting_republication_does_not_change_existing_sessions(
    client: TestClient, db_session: FakeAsyncSession, app_store: PinnedContentStore
) -> None:
    v1, fp1 = sealed(1)
    publisher(app_store, fp1).publish(v1)
    row = start_session(client, db_session, content_version=1)
    other, other_fp = sealed(1, SECOND_ANSWER)

    assert publisher(app_store, other_fp).publish(other).outcome == "version_conflict"

    assert answer(client, db_session, row, ANSWER) == "correct"


def test_legacy_case_001_session_ignores_published_store(
    client: TestClient, db_session: FakeAsyncSession, app_store: PinnedContentStore
) -> None:
    v1, fp1 = sealed(1)
    publisher(app_store, fp1).publish(v1)

    row = start_session(client, db_session, case_id="case_001")

    assert (row.content_version, row.content_fingerprint) == (None, None)
    assert row.state_json["current_zone_id"] is not None


def test_default_hint_source_still_catches_hint_leak_in_client() -> None:
    docs = documents()
    docs["client"]["zones"][0]["description"] = HINTS[(CASE_ID, "PUZZLE_A", 1)]
    files, fingerprint = seal(docs)
    store = PinnedContentStore()

    report = publisher(store, fingerprint).publish(PublicationBundle(**files))

    assert report.outcome == "rejected"
    assert statuses(report)["LEAK_CLIENT"] == "FAIL"
    assert store.versions(CASE_ID) == ()
