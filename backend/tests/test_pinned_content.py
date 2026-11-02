from datetime import datetime, timedelta
from typing import Any

import pytest

from app.models.anonymous_session import AnonymousSession
from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.schemas.hint import HintUnlockRequest
from app.schemas.interaction import SubmitAnswerInteraction, SubmitAnswerPayload
from app.schemas.npc import NpcHintReshowRequest, NpcNudgeRequest
from app.schemas.npc_content import NpcContentPack
from app.schemas.puzzle_runtime import (
    PuzzleDefinition,
    PuzzleRuntimeDefinition,
    RuntimeEffect,
)
from app.services.hint import get_puzzle_hint_state, unlock_hint
from app.services.interaction import process_interaction
from app.services.npc import NpcLineNotFoundError, process_npc_request
from app.services.pinned_content import (
    ContentBundleMismatchError,
    ContentCaseMismatchError,
    ContentFingerprintMismatchError,
    ContentPin,
    ContentVersionExistsError,
    ContentVersionNotFoundError,
    InvalidContentPinError,
    PinnedContent,
    PinnedContentStore,
)
from app.services.play_session import create_play_session
from tests.conftest import FakeAsyncSession

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
CASE_ID = "case_pinned_test"
FP_V1 = "opaque-fingerprint-v1"
FP_V2 = "opaque-fingerprint-v2"


def make_client(entry_zone: str = "ZONE_A") -> CaseClientContent:
    return CaseClientContent.model_validate(
        {
            "case_id": CASE_ID,
            "entry_zone_id": entry_zone,
            "zones": [
                {
                    "zone_id": zone_id,
                    "zone_name": zone_id,
                    "zone_type": "room",
                    "description": "(가상)",
                    "objects": [
                        {
                            "object_id": f"OBJ_LOCK_{zone_id}",
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


def make_server(answer: str = "가상정답일") -> PuzzleRuntimeDefinition:
    return PuzzleRuntimeDefinition(
        schema_version="0.1",
        case_id=CASE_ID,
        puzzles=[
            PuzzleDefinition(
                puzzle_id="PUZZLE_A",
                accepted_answers=[answer],
                on_correct=RuntimeEffect(grant_clue_ids=[], set_flags={"opened": True}),
            )
        ],
        clue_combinations=[],
    )


def make_npc(version: int = 1, fingerprint: str = FP_V1) -> NpcContentPack:
    return NpcContentPack.model_validate(
        {
            "schema_version": "npc-pack 0.1",
            "case_id": CASE_ID,
            "npc_id": "NPC_COMPANION",
            "status": "published",
            "content_version": version,
            "content_fingerprint": fingerprint,
            "general_nudges": [
                {
                    "line_id": "NUDGE_GENERAL",
                    "text": "(가상) 둘러보자.",
                    "reveal_when": {"always": True},
                }
            ],
            "puzzles": [
                {
                    "puzzle_id": "PUZZLE_A",
                    "nudges": [
                        {
                            "line_id": "NUDGE_PUZZLE_A",
                            "text": "(가상) 상자 쪽.",
                            "reveal_when": {"always": True},
                        }
                    ],
                }
            ],
        }
    )


def make_idmap(version: int = 1) -> dict[str, Any]:
    return {
        "case_id": CASE_ID,
        "content_version": version,
        "zones": [{"local": "Z1", "runtime": "ZONE_A"}],
    }


def make_bundle(
    version: int = 1, fingerprint: str = FP_V1, **overrides: Any
) -> PinnedContent:
    parts: dict[str, Any] = {
        "client": make_client(),
        "server": make_server(),
        "npc": make_npc(version, fingerprint),
        "idmap": make_idmap(version),
    }
    parts.update(overrides)
    return PinnedContent(ContentPin(CASE_ID, version, fingerprint), **parts)


HINTS = {("PUZZLE_A", 1): "(가상) 1단계", ("PUZZLE_A", 2): "(가상) 2단계"}


def resolver(server: PuzzleRuntimeDefinition, puzzle_id: str, level: int) -> str | None:
    assert server.case_id == CASE_ID
    return HINTS.get((puzzle_id, level))


# --- 고정 값 ---


@pytest.mark.parametrize(
    ("case_id", "version", "fingerprint"),
    [
        ("", 1, FP_V1),
        ("  ", 1, FP_V1),
        (CASE_ID, 0, FP_V1),
        (CASE_ID, -1, FP_V1),
        (CASE_ID, True, FP_V1),
        (CASE_ID, "1", FP_V1),
        (CASE_ID, 1, ""),
        (CASE_ID, 1, "   "),
        (CASE_ID, 1, None),
    ],
)
def test_pin_requires_case_version_and_fingerprint(
    case_id, version, fingerprint
) -> None:
    with pytest.raises(InvalidContentPinError):
        ContentPin(case_id, version, fingerprint)


# --- 저장소 조회 ---


def test_same_version_is_returned_again() -> None:
    store = PinnedContentStore()
    bundle = make_bundle()
    store.add(bundle)

    assert store.get(ContentPin(CASE_ID, 1, FP_V1)) is bundle
    assert store.get(ContentPin(CASE_ID, 1, FP_V1)) is bundle


def test_versions_are_kept_apart_and_never_auto_upgraded() -> None:
    store = PinnedContentStore()
    store.add(make_bundle(1, FP_V1))
    store.add(make_bundle(2, FP_V2, server=make_server(answer="가상정답이")))

    v1 = store.get(ContentPin(CASE_ID, 1, FP_V1))
    v2 = store.get(ContentPin(CASE_ID, 2, FP_V2))

    assert v1.server().puzzles[0].accepted_answers == ["가상정답일"]
    assert v2.server().puzzles[0].accepted_answers == ["가상정답이"]
    assert store.versions(CASE_ID) == (1, 2)
    assert not hasattr(store, "latest")


@pytest.mark.parametrize("fingerprint", [FP_V2, FP_V1 + " ", "OPAQUE-FINGERPRINT-V1"])
def test_fingerprint_mismatch_fails(fingerprint: str) -> None:
    store = PinnedContentStore()
    store.add(make_bundle(1, FP_V1))

    with pytest.raises(ContentFingerprintMismatchError) as raised:
        store.get(ContentPin(CASE_ID, 1, fingerprint))

    assert FP_V1 not in str(raised.value)
    assert fingerprint not in str(raised.value)


def test_missing_version_and_other_case_fail() -> None:
    store = PinnedContentStore()
    store.add(make_bundle(1, FP_V1))

    with pytest.raises(ContentVersionNotFoundError):
        store.get(ContentPin(CASE_ID, 2, FP_V1))
    with pytest.raises(ContentVersionNotFoundError):
        store.get(ContentPin("other_case", 1, FP_V1))


@pytest.mark.parametrize("fingerprint", [FP_V1, FP_V2])
def test_existing_version_cannot_be_overwritten(fingerprint: str) -> None:
    store = PinnedContentStore()
    original = make_bundle(1, FP_V1)
    store.add(original)

    with pytest.raises(ContentVersionExistsError):
        store.add(make_bundle(1, fingerprint, server=make_server(answer="바꿈")))

    assert store.get(ContentPin(CASE_ID, 1, FP_V1)) is original


# --- 묶음 일치 ---


@pytest.mark.parametrize(
    "overrides",
    [
        {"client": make_client().model_copy(update={"case_id": "other"})},
        {"server": make_server().model_copy(update={"case_id": "other"})},
        {"npc": make_npc(2, FP_V1)},
        {"npc": make_npc(1, FP_V2)},
        {"npc": make_npc(1, FP_V1).model_copy(update={"content_version": None})},
        {"npc": make_npc(1, FP_V1).model_copy(update={"case_id": "other"})},
        {"idmap": make_idmap(2)},
        {"idmap": {**make_idmap(1), "case_id": "other"}},
        {"idmap": {"zones": []}},
    ],
)
def test_all_parts_must_share_case_id_and_version(overrides: dict) -> None:
    with pytest.raises(ContentBundleMismatchError):
        make_bundle(1, FP_V1, **overrides)


def test_npc_and_idmap_may_be_absent() -> None:
    bundle = make_bundle(npc=None, idmap=None)

    assert bundle.npc() is None
    assert bundle.idmap() is None
    assert bundle.line_source()(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL") is None


def test_unserializable_idmap_is_rejected() -> None:
    with pytest.raises(TypeError):
        make_bundle(idmap={**make_idmap(1), "bad": object()})


# --- 불변성 ---


def test_bundle_is_unaffected_by_input_or_output_mutation() -> None:
    client, server, npc, idmap = make_client(), make_server(), make_npc(), make_idmap()
    bundle = PinnedContent(
        ContentPin(CASE_ID, 1, FP_V1),
        client=client,
        server=server,
        npc=npc,
        idmap=idmap,
    )

    server.puzzles[0].accepted_answers.append("밖에서 추가")
    client.zones[0].objects[0].visible = False
    npc.general_nudges[0].text = "(가상) 바꿈"
    idmap["zones"].append({"local": "Z9", "runtime": "ZONE_B"})

    out = bundle.server()
    out.puzzles[0].accepted_answers.clear()
    bundle.client().zones.clear()
    bundle.npc().general_nudges.clear()
    bundle.idmap()["zones"].clear()

    assert bundle.server().puzzles[0].accepted_answers == ["가상정답일"]
    assert bundle.client().zones[0].objects[0].visible is True
    assert bundle.npc().general_nudges[0].text == "(가상) 둘러보자."
    assert bundle.idmap()["zones"] == [{"local": "Z1", "runtime": "ZONE_A"}]
    assert bundle.runtime_loader()(CASE_ID).puzzles[0].accepted_answers == [
        "가상정답일"
    ]


# --- 주입 인터페이스 ---


def test_bound_loaders_reject_other_case_id() -> None:
    bundle = make_bundle()

    for call in (
        lambda: bundle.runtime_loader()("other"),
        lambda: bundle.client_content_loader()("other"),
        lambda: bundle.hint_source(resolver)("other", "PUZZLE_A", 1),
        lambda: bundle.line_source()("other", "NPC_COMPANION", "NUDGE_GENERAL"),
    ):
        with pytest.raises(ContentCaseMismatchError):
            call()


def test_line_source_never_marks_lines_approved() -> None:
    source = make_bundle().line_source()

    general = source(CASE_ID, "NPC_COMPANION", "NUDGE_GENERAL")
    puzzle = source(CASE_ID, "NPC_COMPANION", "NUDGE_PUZZLE_A")

    assert general.approved is False and general.puzzle_id is None
    assert puzzle.approved is False and puzzle.puzzle_id == "PUZZLE_A"
    assert source(CASE_ID, "NPC_OTHER", "NUDGE_GENERAL") is None
    assert source(CASE_ID, "NPC_COMPANION", "NUDGE_MISSING") is None


def make_play_session(hint_levels: dict | None = None) -> PlaySession:
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
            "hint_levels": hint_levels or {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
    )


@pytest.mark.anyio
async def test_play_session_creation_uses_bound_client_loader() -> None:
    db = FakeAsyncSession()
    db.get_result = AnonymousSession(
        id="anon",
        created_at=datetime(2026, 10, 27),
        expires_at=datetime.now() + timedelta(days=1),
    )
    bundle = make_bundle(client=make_client(entry_zone="ZONE_B"))

    session = await create_play_session(
        db, "anon", CASE_ID, client_content_loader=bundle.client_content_loader()
    )

    assert session.state_json["current_zone_id"] == "ZONE_B"


@pytest.mark.anyio
async def test_interaction_uses_bound_runtime_and_client_loaders() -> None:
    db = FakeAsyncSession()
    # 고정 묶음 로더는 같은 버전으로 고정된 세션에서만 쓸 수 있다.
    db.get_result = make_play_session()
    db.get_result.content_version = 1
    db.get_result.content_fingerprint = FP_V1
    bundle = make_bundle()

    result = await process_interaction(
        db,
        "play-session-id",
        SubmitAnswerInteraction(
            client_event_id="e1",
            interaction_type="submit_answer",
            target_id="PUZZLE_A",
            zone_id="ZONE_A",
            payload=SubmitAnswerPayload(answer="가상정답일"),
        ),
        runtime_loader=bundle.runtime_loader(),
        client_content_loader=bundle.client_content_loader(),
    )

    assert result.result.result_type == "correct"


@pytest.mark.anyio
async def test_hint_service_uses_bound_runtime_and_hint_source() -> None:
    bundle = make_bundle()
    db = FakeAsyncSession()
    db.get_result = make_play_session()

    unlocked = await unlock_hint(
        db,
        "play-session-id",
        "PUZZLE_A",
        HintUnlockRequest(client_event_id="h1", target_level=1),
        hint_source=bundle.hint_source(resolver),
        access_policy=lambda state, puzzle, level: None,
        runtime_loader=bundle.runtime_loader(),
    )
    assert unlocked.hint.text == "(가상) 1단계"

    read_db = FakeAsyncSession()
    read_db.get_result = make_play_session({"PUZZLE_A": 2})
    state = await get_puzzle_hint_state(
        read_db,
        "play-session-id",
        "PUZZLE_A",
        hint_source=bundle.hint_source(resolver),
        runtime_loader=bundle.runtime_loader(),
    )
    assert [hint.level for hint in state.unlocked] == [1, 2]


@pytest.mark.anyio
async def test_npc_service_uses_bound_sources_and_stays_closed_for_nudges() -> None:
    bundle = make_bundle()
    kwargs = {
        "line_source": bundle.line_source(),
        "hint_source": bundle.hint_source(resolver),
        "runtime_loader": bundle.runtime_loader(),
    }

    db = FakeAsyncSession()
    db.get_result = make_play_session()
    with pytest.raises(NpcLineNotFoundError):
        await process_npc_request(
            db,
            "play-session-id",
            NpcNudgeRequest(
                client_event_id="n1",
                kind="nudge",
                npc_id="NPC_COMPANION",
                line_id="NUDGE_GENERAL",
            ),
            **kwargs,
        )
    assert db.added == []

    reshow_db = FakeAsyncSession()
    reshow_db.get_result = make_play_session({"PUZZLE_A": 2})
    result = await process_npc_request(
        reshow_db,
        "play-session-id",
        NpcHintReshowRequest(
            client_event_id="r1",
            kind="hint_reshow",
            npc_id="NPC_COMPANION",
            puzzle_id="PUZZLE_A",
            hint_level=2,
        ),
        **kwargs,
    )
    assert result.reshown_hint.text == "(가상) 2단계"
