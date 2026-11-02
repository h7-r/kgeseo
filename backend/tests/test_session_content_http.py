from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.interaction_event import InteractionEvent
from app.schemas.puzzle_runtime import (
    ClueDefinition,
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.pinned_content import ContentPin, PinnedContent, PinnedContentStore
from app.services.session_content import (
    CASE_VERSION_UNAVAILABLE,
    get_pinned_content_store,
)
from tests.conftest import FakeAsyncSession
from tests.test_session_content_pin_flow import (
    ANSWER,
    CASE_ID,
    FP,
    make_bundle,
    make_client,
    session_row,
)

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
PLAY_SESSION_ID = "33333333-3333-4333-8333-333333333333"
INTERACTIONS_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/interactions"
CLUES_URL = f"/api/v1/play-sessions/{PLAY_SESSION_ID}/clues"


def input_body(
    version: int, answer: str, event_id: str = "44444444-4444-4444-8444-444444444444"
):
    return {
        "client_event_id": event_id,
        "client_timestamp": "2026-10-27T12:00:00+09:00",
        "zone_id": "ZONE_A",
        "action": "input",
        "target_type": "object",
        "target_id": f"OBJ_LOCK_V{version}",
        "payload": {"answer": answer},
    }


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


def pinned_row(version: int | None, fingerprint: str | None):
    row = session_row(version, fingerprint)
    row.id = PLAY_SESSION_ID
    return row


def assert_unavailable(response, db: FakeAsyncSession) -> None:
    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}
    assert db.added == []
    assert db.commit_count == 0


# --- 정상 버전 선택 ---


@pytest.mark.parametrize("version", [1, 2])
def test_pinned_session_uses_its_own_version(
    client: TestClient, db_session: FakeAsyncSession, store, use_store, version: int
) -> None:
    use_store(store)
    db_session.get_result = pinned_row(version, FP[version])

    correct = client.post(INTERACTIONS_URL, json=input_body(version, ANSWER[version]))

    assert correct.status_code == 200
    assert correct.json()["result_type"] == "correct"
    assert db_session.commit_count == 1


def test_pinned_session_does_not_accept_other_version_answer(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = pinned_row(1, FP[1])

    response = client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[2]))

    assert response.status_code == 200
    assert response.json()["result_type"] == "incorrect"


def test_pinned_session_object_ids_come_from_its_version(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = pinned_row(1, FP[1])

    # v2에만 있는 Object → 기존 404 규칙(최신 버전으로 바꾸지 않는다)
    response = client.post(INTERACTIONS_URL, json=input_body(2, ANSWER[2]))

    assert response.status_code == 404
    assert response.json() == {"detail": "Object not found."}


# --- 버전을 쓸 수 없음 → 409 CASE_VERSION_UNAVAILABLE ---


def test_missing_version_is_409(
    client: TestClient, db_session: FakeAsyncSession, use_store
) -> None:
    only_v2 = PinnedContentStore()
    only_v2.add(make_bundle(2))
    use_store(only_v2)
    db_session.get_result = pinned_row(1, FP[1])

    assert_unavailable(
        client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1])), db_session
    )


def test_fingerprint_mismatch_is_409(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = pinned_row(1, "opaque-tampered")

    response = client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1]))

    assert_unavailable(response, db_session)
    assert "opaque" not in response.text


def test_partial_pin_columns_are_409(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = pinned_row(1, None)

    assert_unavailable(
        client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1])), db_session
    )


def test_default_store_is_empty_so_pinned_sessions_never_fall_back(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = pinned_row(1, FP[1])

    assert_unavailable(
        client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1])), db_session
    )


class WrongVersionStore(PinnedContentStore):
    """요청한 버전과 다른 묶음을 돌려주는 잘못된 저장소(서비스 쪽 검사 확인용)."""

    def get(self, pin: ContentPin) -> PinnedContent:
        return make_bundle(2)


def test_wrong_version_loaders_are_refused_by_services(
    client: TestClient, db_session: FakeAsyncSession, use_store
) -> None:
    use_store(WrongVersionStore())
    db_session.get_result = pinned_row(1, FP[1])

    assert_unavailable(
        client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1])), db_session
    )


# --- 멱등 재전송 ---


def stored_event(response_json: dict) -> InteractionEvent:
    return InteractionEvent(
        id=response_json["interaction_id"],
        play_session_id=PLAY_SESSION_ID,
        client_event_id="44444444-4444-4444-8444-444444444444",
        client_timestamp=None,
        interaction_type="submit_answer",
        target_id="PUZZLE_A",
        payload_json={"answer": ANSWER[1]},
        result_type="correct",
        response_json={
            "result_type": "correct",
            "state": pinned_row(1, FP[1]).state_json,
            "state_changes": [],
            "message": None,
            "attempt_count": 1,
            "ui_actions": [],
        },
        created_at=pinned_row(1, FP[1]).created_at,
    )


def test_replay_uses_stored_response_and_still_requires_the_pinned_version(
    client: TestClient, db_session: FakeAsyncSession, store, use_store
) -> None:
    use_store(store)
    db_session.get_result = pinned_row(1, FP[1])
    first = client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1]))
    db_session.scalar_result = stored_event(first.json())
    commits = db_session.commit_count

    replay = client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1]))

    assert replay.status_code == 200
    assert replay.json()["interaction_id"] == first.json()["interaction_id"]
    assert db_session.commit_count == commits

    use_store(PinnedContentStore())
    refused = client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1]))
    assert refused.status_code == 409
    assert refused.json() == {"detail": CASE_VERSION_UNAVAILABLE}
    assert db_session.commit_count == commits


# --- 단서 조회 ---


def bundle_with_clue() -> PinnedContent:
    server = PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=CASE_ID,
        puzzles=[
            PuzzleDefinition(
                puzzle_id="PUZZLE_A",
                accepted_answers=[ANSWER[1]],
                on_correct=RuntimeEffect(grant_clue_ids=["CLUE_PINNED"], set_flags={}),
            )
        ],
        clue_combinations=[],
        clues=[ClueDefinition(clue_id="CLUE_PINNED", title="(가상) 고정 버전 단서")],
    )
    return PinnedContent(
        ContentPin(CASE_ID, 1, FP[1]),
        client=make_client(1),
        server=server,
        npc=None,
        idmap=None,
    )


def test_clues_read_from_pinned_version(
    client: TestClient, db_session: FakeAsyncSession, use_store
) -> None:
    store = PinnedContentStore()
    store.add(bundle_with_clue())
    use_store(store)
    row = pinned_row(1, FP[1])
    row.state_json = {**row.state_json, "acquired_clue_ids": ["CLUE_PINNED"]}
    db_session.get_result = row

    response = client.get(CLUES_URL)

    assert response.status_code == 200
    assert [c["clue_id"] for c in response.json()["data"]["clues"]] == ["CLUE_PINNED"]


def test_clues_for_unavailable_version_are_409(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = pinned_row(1, FP[1])

    response = client.get(CLUES_URL)

    assert response.status_code == 409
    assert response.json() == {"detail": CASE_VERSION_UNAVAILABLE}


# --- 레거시 · 기존 오류 · 등록 경로 ---


def test_missing_session_is_still_404(
    client: TestClient, db_session: FakeAsyncSession
) -> None:
    db_session.get_result = None

    response = client.post(INTERACTIONS_URL, json=input_body(1, ANSWER[1]))

    assert response.status_code == 404
    assert response.json() == {"detail": "Play session not found."}


def test_no_http_route_registers_or_lists_pinned_content() -> None:
    paths = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", ())
    }

    assert not [p for _, p in paths if "content" in p.lower() or "pinned" in p.lower()]
    assert get_pinned_content_store().versions(CASE_ID) == ()
