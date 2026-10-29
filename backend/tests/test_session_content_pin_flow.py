from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import pytest

from app.models.anonymous_session import AnonymousSession
from app.models.play_session import ContentPinColumnsError, PlaySession
from app.schemas.case_content import CaseClientContent
from app.schemas.interaction import SubmitAnswerInteraction, SubmitAnswerPayload
from app.schemas.interaction_api import InputInteractionRequest
from app.schemas.puzzle_runtime import (
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.external_interaction import process_external_interaction
from app.services.interaction import process_interaction
from app.services.pinned_content import (
    ContentCaseMismatchError,
    ContentFingerprintMismatchError,
    ContentPin,
    ContentVersionNotFoundError,
    LegacySessionLoaderError,
    PinnedContent,
    PinnedContentRequiredError,
    PinnedContentStore,
    resolve_session_content,
)
from app.services.play_session import create_play_session
from tests.conftest import FakeAsyncSession

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다. 이 case_id의 파일은 콘텐츠 폴더에 없다.
CASE_ID = "case_pin_flow_test"
FP = {1: "opaque-v1", 2: "opaque-v2"}
ANSWER = {1: "가상정답일", 2: "가상정답이"}
ENTRY = {1: "ZONE_A", 2: "ZONE_B"}


def make_client(version: int) -> CaseClientContent:
    return CaseClientContent.model_validate(
        {
            "case_id": CASE_ID,
            "entry_zone_id": ENTRY[version],
            "zones": [
                {
                    "zone_id": zone_id,
                    "zone_name": zone_id,
                    "zone_type": "room",
                    "description": "(가상)",
                    "objects": [
                        {
                            "object_id": f"OBJ_LOCK_V{version}",
                            "object_name": "Lock",
                            "object_type": "lock",
                            "visible": True,
                            "enabled": True,
                            "interaction": {"type": "input", "target_id": "PUZZLE_A"},
                        }
                    ],
                    "navigation": [],
                }
                for zone_id in ("ZONE_A", "ZONE_B")
            ],
        }
    )


def make_bundle(version: int) -> PinnedContent:
    server = PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=CASE_ID,
        puzzles=[
            PuzzleDefinition(
                puzzle_id="PUZZLE_A",
                accepted_answers=[ANSWER[version]],
                on_correct=RuntimeEffect(grant_clue_ids=[], set_flags={"opened": True}),
            )
        ],
        clue_combinations=[],
    )
    return PinnedContent(
        ContentPin(CASE_ID, version, FP[version]),
        client=make_client(version),
        server=server,
        npc=None,
        idmap=None,
    )


@pytest.fixture
def store() -> PinnedContentStore:
    store = PinnedContentStore()
    store.add(make_bundle(1))
    store.add(make_bundle(2))
    return store


def anonymous_db() -> FakeAsyncSession:
    db = FakeAsyncSession()
    db.get_result = AnonymousSession(
        id="anon",
        created_at=datetime(2026, 10, 27),
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1),
    )
    return db


def session_row(
    version: int | None = None, fingerprint: str | None = None
) -> PlaySession:
    now = datetime(2026, 10, 27, 1, 2, 3)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anon",
        case_id=CASE_ID,
        state_json={
            "current_zone_id": "ZONE_A",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
        content_version=version,
        content_fingerprint=fingerprint,
    )


def answer(text: str) -> SubmitAnswerInteraction:
    return SubmitAnswerInteraction(
        client_event_id="e1",
        interaction_type="submit_answer",
        target_id="PUZZLE_A",
        zone_id="ZONE_A",
        payload=SubmitAnswerPayload(answer=text),
    )


# --- 세션 생성 ---


@pytest.mark.anyio
async def test_legacy_creation_path_is_unchanged() -> None:
    db = anonymous_db()

    session = await create_play_session(db, "anon", "case_001")

    assert (session.content_version, session.content_fingerprint) == (None, None)
    assert db.commit_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize("version", [1, 2])
async def test_pinned_creation_stores_pin_and_uses_pinned_client(version: int) -> None:
    db = anonymous_db()

    session = await create_play_session(
        db, "anon", CASE_ID, pinned_content=make_bundle(version)
    )

    assert (session.content_version, session.content_fingerprint) == (
        version,
        FP[version],
    )
    assert session.state_json["current_zone_id"] == ENTRY[version]
    # 버전 정보와 세션은 같은 행 · 같은 commit 한 번으로 저장된다.
    assert db.added == [session]
    assert db.commit_count == 1


@pytest.mark.anyio
async def test_pinned_creation_rejects_other_case_before_any_db_work() -> None:
    db = anonymous_db()

    with pytest.raises(ContentCaseMismatchError):
        await create_play_session(db, "anon", "case_001", pinned_content=make_bundle(1))

    assert db.get_calls == []
    assert db.added == []
    assert db.commit_count == 0


@pytest.mark.anyio
async def test_pinned_creation_rejects_extra_loader() -> None:
    db = anonymous_db()

    with pytest.raises(ValueError):
        await create_play_session(
            db,
            "anon",
            CASE_ID,
            pinned_content=make_bundle(1),
            client_content_loader=lambda case_id: make_client(1),
        )

    assert db.added == []


@pytest.mark.anyio
async def test_pinned_creation_commit_failure_rolls_back() -> None:
    db = anonymous_db()
    db.commit_error = RuntimeError("commit failed")

    with pytest.raises(RuntimeError):
        await create_play_session(db, "anon", CASE_ID, pinned_content=make_bundle(1))

    assert db.commit_count == 1
    assert db.rollback_count == 1
    # 세션과 버전 정보가 따로 저장되는 단계가 없다(한 행 · 한 INSERT).
    [row] = db.added
    assert (row.content_version, row.content_fingerprint) == (1, FP[1])


# --- 세션 복원 ---


def test_restore_returns_exact_pinned_bundle_without_upgrading(
    store: PinnedContentStore,
) -> None:
    v1 = resolve_session_content(session_row(1, FP[1]), store)
    v2 = resolve_session_content(session_row(2, FP[2]), store)

    assert v1.pin == ContentPin(CASE_ID, 1, FP[1])
    assert v2.pin == ContentPin(CASE_ID, 2, FP[2])
    assert v1.server().puzzles[0].accepted_answers == [ANSWER[1]]


def test_restore_legacy_session_returns_none(store: PinnedContentStore) -> None:
    assert resolve_session_content(session_row(), store) is None


def test_restore_errors(store: PinnedContentStore) -> None:
    with pytest.raises(ContentVersionNotFoundError):
        resolve_session_content(session_row(3, "opaque-v3"), store)
    with pytest.raises(ContentFingerprintMismatchError):
        resolve_session_content(session_row(1, FP[2]), store)
    with pytest.raises(ContentPinColumnsError):
        resolve_session_content(session_row(1, None), store)
    with pytest.raises(ContentPinColumnsError):
        resolve_session_content(session_row(None, FP[1]), store)


# --- Interaction 연결 ---


def bound_loaders(bundle: PinnedContent) -> dict[str, Any]:
    return {
        "runtime_loader": bundle.runtime_loader(),
        "client_content_loader": bundle.client_content_loader(),
    }


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("submitted", "expected"), [(ANSWER[1], "correct"), (ANSWER[2], "incorrect")]
)
async def test_pinned_interaction_judges_with_pinned_version(
    store: PinnedContentStore, submitted: str, expected: str
) -> None:
    row = session_row(1, FP[1])
    db = FakeAsyncSession()
    db.get_result = row

    result = await process_interaction(
        db,
        "play-session-id",
        answer(submitted),
        **bound_loaders(resolve_session_content(row, store)),
    )

    assert result.result.result_type == expected


@pytest.mark.anyio
async def test_pinned_session_refuses_default_loaders() -> None:
    db = FakeAsyncSession()
    db.get_result = session_row(1, FP[1])

    with pytest.raises(PinnedContentRequiredError) as raised:
        await process_interaction(db, "play-session-id", answer(ANSWER[1]))

    assert FP[1] not in str(raised.value)
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_pinned_session_refuses_other_version_loaders(
    store: PinnedContentStore,
) -> None:
    db = FakeAsyncSession()
    db.get_result = session_row(1, FP[1])

    with pytest.raises(PinnedContentRequiredError):
        await process_interaction(
            db, "play-session-id", answer(ANSWER[2]), **bound_loaders(make_bundle(2))
        )

    assert db.added == []


@pytest.mark.anyio
async def test_legacy_session_refuses_pinned_loaders() -> None:
    db = FakeAsyncSession()
    db.get_result = session_row()

    with pytest.raises(LegacySessionLoaderError):
        await process_interaction(
            db, "play-session-id", answer(ANSWER[1]), **bound_loaders(make_bundle(1))
        )

    assert db.added == []


@pytest.mark.anyio
async def test_partially_pinned_session_is_rejected() -> None:
    db = FakeAsyncSession()
    db.get_result = session_row(1, None)

    with pytest.raises(ContentPinColumnsError):
        await process_interaction(
            db, "play-session-id", answer(ANSWER[1]), **bound_loaders(make_bundle(1))
        )

    assert db.added == []


def external_input(object_id: str, text: str) -> InputInteractionRequest:
    return InputInteractionRequest(
        client_event_id=uuid4(),
        client_timestamp=datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc),
        zone_id="ZONE_A",
        action="input",
        target_type="object",
        target_id=object_id,
        payload={"answer": text},
    )


@pytest.mark.anyio
async def test_external_adapter_resolves_objects_with_pinned_client(
    store: PinnedContentStore,
) -> None:
    row = session_row(2, FP[2])
    db = FakeAsyncSession()
    db.get_result = row

    result = await process_external_interaction(
        db,
        "play-session-id",
        external_input("OBJ_LOCK_V2", ANSWER[2]),
        **bound_loaders(resolve_session_content(row, store)),
    )

    assert result.result.result_type == "correct"


@pytest.mark.anyio
async def test_external_adapter_does_not_fall_back_to_default_loaders() -> None:
    db = FakeAsyncSession()
    db.get_result = session_row(1, FP[1])

    # 이 case_id의 파일은 없다. 기본 로더로 조용히 바꿨다면 CaseClientContentNotFoundError가 났을 것이다.
    with pytest.raises(PinnedContentRequiredError):
        await process_external_interaction(
            db, "play-session-id", external_input("OBJ_LOCK_V1", ANSWER[1])
        )

    assert db.added == []
    assert db.commit_count == 0


# --- 멱등 재전송 ---


def counting_loaders(bundle: PinnedContent, calls: list[str]) -> dict[str, Any]:
    """고정 표시는 그대로 두고, 콘텐츠를 읽으면 기록하는 로더."""

    runtime, client = bundle.runtime_loader(), bundle.client_content_loader()

    def load_runtime(case_id: str):
        calls.append("runtime")
        return runtime(case_id)

    def load_client(case_id: str):
        calls.append("client")
        return client(case_id)

    load_runtime.content_pin = bundle.pin
    load_client.content_pin = bundle.pin
    return {"runtime_loader": load_runtime, "client_content_loader": load_client}


async def stored_event_for(version: int):
    db = FakeAsyncSession()
    db.get_result = session_row(version, FP[version])
    first = await process_interaction(
        db,
        "play-session-id",
        answer(ANSWER[version]),
        **bound_loaders(make_bundle(version)),
    )
    [event] = db.added
    return first, event


def replay_db(version: int | None, event) -> FakeAsyncSession:
    db = FakeAsyncSession()
    db.get_result = session_row(version, FP[version] if version else None)
    db.scalar_result = event
    return db


@pytest.mark.anyio
async def test_replay_with_matching_loaders_returns_stored_response_without_reading() -> (
    None
):
    first, event = await stored_event_for(1)
    db = replay_db(1, event)
    calls: list[str] = []

    replay = await process_interaction(
        db,
        "play-session-id",
        answer(ANSWER[1]),
        **counting_loaders(make_bundle(1), calls),
    )

    assert replay.interaction_id == first.interaction_id
    assert replay.result == first.result
    assert calls == []  # 재전송은 콘텐츠를 다시 읽지 않는다
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize("loaders", ["default", "other_version"])
async def test_replay_with_wrong_loaders_is_refused_before_event_lookup(
    loaders: str,
) -> None:
    _, event = await stored_event_for(1)
    db = replay_db(1, event)
    kwargs = {} if loaders == "default" else bound_loaders(make_bundle(2))

    with pytest.raises(PinnedContentRequiredError):
        await process_interaction(db, "play-session-id", answer(ANSWER[1]), **kwargs)

    assert db.scalar_calls == []
    assert db.added == []
    assert db.commit_count == 0
    assert db.rollback_count == 1


@pytest.mark.anyio
async def test_legacy_replay_with_pinned_loaders_is_refused() -> None:
    _, event = await stored_event_for(1)
    db = replay_db(None, event)

    with pytest.raises(LegacySessionLoaderError):
        await process_interaction(
            db, "play-session-id", answer(ANSWER[1]), **bound_loaders(make_bundle(1))
        )

    assert db.scalar_calls == []
    assert db.added == []
    assert db.commit_count == 0


@pytest.mark.anyio
async def test_legacy_replay_with_default_loaders_still_returns_stored_response() -> (
    None
):
    _, event = await stored_event_for(1)
    db = replay_db(None, event)

    replay = await process_interaction(db, "play-session-id", answer(ANSWER[1]))

    assert replay.interaction_id == event.id
    assert db.added == []
    assert db.commit_count == 0


@pytest.mark.anyio
async def test_external_replay_with_default_loaders_is_refused() -> None:
    db = FakeAsyncSession()
    db.get_result = session_row(1, FP[1])

    with pytest.raises(PinnedContentRequiredError):
        await process_external_interaction(
            db,
            "play-session-id",
            InputInteractionRequest(
                client_event_id=uuid4(),
                client_timestamp=datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc),
                zone_id="ZONE_A",
                action="input",
                target_type="object",
                target_id="OBJ_LOCK_V1",
                payload={"answer": ANSWER[1]},
            ),
        )

    assert db.scalar_calls == []
    assert db.commit_count == 0
