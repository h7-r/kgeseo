from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.anonymous_session import AnonymousSession
from app.services.pinned_content import ContentPin, PinnedContent, PinnedContentStore
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    get_pinned_content_store,
)
from tests.conftest import FakeAsyncSession
from tests.test_session_content_pin_flow import (
    ANSWER,
    CASE_ID,
    ENTRY,
    FP,
    make_bundle,
    session_row,
)

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 게시본이 아니다.
SESSIONS_URL = "/api/v1/play-sessions"
SESSION_ID = "55555555-5555-4555-8555-555555555555"


@pytest.fixture
def store() -> PinnedContentStore:
    store = PinnedContentStore()
    store.add(make_bundle(1))
    store.add(make_bundle(2))
    return store


@pytest.fixture
def use_store() -> Iterator:
    def install(store: PinnedContentStore) -> None:
        app.dependency_overrides[get_pinned_content_store] = lambda: store

    yield install
    app.dependency_overrides.pop(get_pinned_content_store, None)


def anonymous() -> AnonymousSession:
    return AnonymousSession(
        id="anon",
        created_at=datetime(2026, 10, 29),
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1),
    )


def create_body(case_id: str = CASE_ID, **extra) -> dict:
    return {"anonymous_session_id": "anon", "case_id": case_id, **extra}


def pinned_session(version: int | None, fingerprint: str | None):
    row = session_row(version, fingerprint)
    row.id = SESSION_ID
    return row


def assert_unavailable(response, db: FakeAsyncSession) -> None:
    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}
    assert db.added == []
    assert db.commit_count == 0


# --- 세션 생성 ---


def test_legacy_creation_without_version_is_unchanged(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = anonymous()

    response = client.post(SESSIONS_URL, json=create_body("case_001"))

    assert response.status_code == 201
    [row] = db_session.added
    assert (row.content_version, row.content_fingerprint) == (None, None)
    assert set(response.json()["data"]) == {
        "play_session_id",
        "case_id",
        "created_at",
        "state",
    }


@pytest.mark.parametrize("version", [1, 2])
def test_creation_with_version_pins_exactly_that_bundle(
    client: TestClient, db_session: FakeAsyncSession, store, use_store, version: int
) -> None:
    use_store(store)
    db_session.get_result = anonymous()

    response = client.post(SESSIONS_URL, json=create_body(content_version=version))

    assert response.status_code == 201
    [row] = db_session.added
    assert (row.content_version, row.content_fingerprint) == (version, FP[version])
    assert row.state_json["current_zone_id"] == ENTRY[version]
    assert response.json()["data"]["state"]["current_zone_id"] == ENTRY[version]
    # 응답 계약은 그대로다(버전 · fingerprint를 응답에 싣지 않는다).
    assert set(response.json()["data"]) == {
        "play_session_id",
        "case_id",
        "created_at",
        "state",
    }
    assert FP[version] not in response.text
    assert db_session.commit_count == 1


def test_creation_with_empty_store_is_409(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = anonymous()

    response = client.post(SESSIONS_URL, json=create_body(content_version=1))

    assert_unavailable(response, db_session)
    assert db_session.get_calls == []


def test_creation_with_unregistered_version_is_409_without_fallback(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = anonymous()

    assert_unavailable(
        client.post(SESSIONS_URL, json=create_body(content_version=3)), db_session
    )


@pytest.mark.parametrize("version", [0, -1, "1", True, 1.5])
def test_invalid_version_value_is_422(
    client: TestClient, db_session: FakeAsyncSession, store, use_store, version
) -> None:
    use_store(store)
    db_session.get_result = anonymous()

    response = client.post(SESSIONS_URL, json=create_body(content_version=version))

    assert response.status_code == 422
    assert db_session.added == []


def test_invalid_case_id_with_version_is_422(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = anonymous()

    response = client.post(SESSIONS_URL, json=create_body("../x", content_version=1))

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid case ID."}
    assert db_session.added == []


# --- 세션 고정 Client Bundle ---


def bundle_url(session_id: str = SESSION_ID) -> str:
    return f"{SESSIONS_URL}/{session_id}/bundle"


@pytest.mark.parametrize("version", [1, 2])
def test_session_bundle_matches_pinned_version_and_hides_server_data(
    client: TestClient, db_session: FakeAsyncSession, store, use_store, version: int
) -> None:
    use_store(store)
    db_session.get_result = pinned_session(version, FP[version])

    response = client.get(bundle_url())

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["case_id"] == CASE_ID
    assert data["entry_zone_id"] == ENTRY[version]
    assert {o["object_id"] for z in data["zones"] for o in z["objects"]} == {
        f"OBJ_LOCK_V{version}"
    }
    for secret in (
        *ANSWER.values(),
        "accepted_answers",
        "PUZZLE_A",
        "target_id",
        FP[version],
    ):
        assert secret not in response.text


def test_legacy_session_bundle_equals_case_bundle(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    row = pinned_session(None, None)
    row.case_id = "case_001"
    db_session.get_result = row

    response = client.get(bundle_url())

    assert response.status_code == 200
    assert response.json() == client.get("/api/v1/cases/case_001/bundle").json()


@pytest.mark.parametrize(
    ("version", "fingerprint"),
    [(3, "opaque-v3"), (1, FP[2]), (1, None), (None, FP[1])],
)
def test_session_bundle_for_unavailable_version_is_409(
    client: TestClient,
    db_session: FakeAsyncSession,
    store,
    use_store,
    version,
    fingerprint,
) -> None:
    use_store(store)
    db_session.get_result = pinned_session(version, fingerprint)

    response = client.get(bundle_url())

    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}


def test_session_bundle_with_empty_store_is_409(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = pinned_session(1, FP[1])

    assert client.get(bundle_url()).status_code == 409


def test_session_bundle_for_missing_session_is_404(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = None

    response = client.get(bundle_url())

    assert response.status_code == 404
    assert response.json() == {"detail": "Play session not found."}


class OtherCaseStore(PinnedContentStore):
    """요청과 다른 케이스의 묶음을 돌려주는 잘못된 저장소(경계 검사 확인용)."""

    def get(self, pin: ContentPin) -> PinnedContent:
        bundle = make_bundle(1)
        object.__setattr__(bundle, "_pin", ContentPin("case_other", 1, FP[1]))
        return bundle


def test_session_bundle_from_other_case_is_refused(
    client: TestClient, db_session: FakeAsyncSession, use_store
) -> None:
    use_store(OtherCaseStore())
    db_session.get_result = pinned_session(1, FP[1])

    response = client.get(bundle_url())

    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}


def test_registering_newer_version_does_not_change_pinned_bundle(
    client: TestClient, db_session: FakeAsyncSession, use_store
) -> None:
    store = PinnedContentStore()
    store.add(make_bundle(1))
    use_store(store)
    db_session.get_result = pinned_session(1, FP[1])
    before = client.get(bundle_url()).json()

    store.add(make_bundle(2))
    after = client.get(bundle_url()).json()

    assert after == before
    assert after["data"]["entry_zone_id"] == ENTRY[1]


# --- 생성 → 번들 → Interaction · 단서 버전 일치 ---


def test_created_session_uses_same_version_for_bundle_interaction_and_clues(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = anonymous()
    created = client.post(SESSIONS_URL, json=create_body(content_version=2))
    [row] = db_session.added
    session_id = created.json()["data"]["play_session_id"]
    db_session.get_result = row

    bundle = client.get(bundle_url(session_id)).json()["data"]
    [lock] = [
        o["object_id"]
        for z in bundle["zones"]
        if z["zone_id"] == bundle["entry_zone_id"]
        for o in z["objects"]
    ]
    interaction = client.post(
        f"{SESSIONS_URL}/{session_id}/interactions",
        json={
            "client_event_id": "66666666-6666-4666-8666-666666666666",
            "client_timestamp": "2026-10-29T12:00:00+09:00",
            "zone_id": ENTRY[2],
            "action": "input",
            "target_type": "object",
            "target_id": lock,
            "payload": {"answer": ANSWER[2]},
        },
    )
    clues = client.get(f"{SESSIONS_URL}/{session_id}/clues")

    assert lock == "OBJ_LOCK_V2"
    assert interaction.status_code == 200
    assert interaction.json()["result_type"] == "correct"
    assert clues.status_code == 200


def test_no_route_accepts_content_uploads_or_publishing() -> None:
    writes = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", ())
        if method in {"POST", "PUT", "PATCH", "DELETE"}
    }

    assert not [
        path
        for _, path in writes
        if any(w in path for w in ("publish", "content", "bundle", "upload"))
    ]
