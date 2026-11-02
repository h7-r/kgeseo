"""고정 세션 생성 → Client Bundle → NPC turn 교차 회귀 (BE · NPC 통합).

세션 생성 · 번들 · NPC turn 이 같은 저장소(`get_pinned_content_store`)에서 같은 고정 버전을 쓰는지 본다.
409(미등록 버전) · 번들 server-only 필드 차단은 `test_pinned_session_http.py` 와
`test_npc_turn_http.py` 가 다루므로 여기서 반복하지 않는다.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.anonymous_session import AnonymousSession
from app.services.approval_history import ApprovalLog
from app.services.pinned_content import ContentPin, PinnedContent
from tests.test_npc_turn import (
    FP,
    HINT_1,
    HINT_2,
    approved,
    make_client,
    npc_pack,
    review,
    runtime_with_hints,
)
from tests.test_npc_turn_http import approve_all, body, overrides  # noqa: F401

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 게시본 · 실제 승인 기록이 아니다.
SESSIONS_URL = "/api/v1/play-sessions"
CASE_ID = "case_test"
FINGERPRINT = {1: FP, 2: "sha256:" + "d" * 64}
NUDGE = {1: "(가상) v1 동행 문장.", 2: "(가상) v2 동행 문장."}


def versioned_bundle(version: int) -> PinnedContent:
    npc = npc_pack(
        content_version=version,
        content_fingerprint=FINGERPRINT[version],
        puzzles=[
            {
                "puzzle_id": "PZ_A",
                "nudges": [
                    {
                        "line_id": f"NUDGE_A_V{version}",
                        "text": NUDGE[version],
                        "reveal_when": {"always": True},
                    }
                ],
                "hints": [{"level": 1}, {"level": 2}],
            }
        ],
    )
    return PinnedContent(
        ContentPin(CASE_ID, version, FINGERPRINT[version]),
        client=make_client(),
        server=runtime_with_hints(),
        npc=npc,
        idmap=None,
    )


def approve_versions(values: dict, *versions: int) -> None:
    approve_all(values)
    log = ApprovalLog()
    for version in versions:
        for gate in ("G1", "G2", "G3"):
            log.append(CASE_ID, version, review(FINGERPRINT[version], gate))
    values["approval"] = log.source()


def anonymous() -> AnonymousSession:
    return AnonymousSession(
        id="anon",
        created_at=datetime(2026, 10, 29),
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1),
    )


def create_pinned(client, db_session, version: int):
    db_session.get_result = anonymous()
    response = client.post(
        SESSIONS_URL,
        json={
            "anonymous_session_id": "anon",
            "case_id": CASE_ID,
            "content_version": version,
        },
    )
    assert response.status_code == 201, response.text
    [row] = db_session.added
    db_session.added.clear()
    db_session.get_result = row
    return response.json()["data"]["play_session_id"], row


@pytest.mark.parametrize("version", [1, 2])
def test_created_session_uses_its_version_for_bundle_and_npc_turn(
    client,
    db_session,
    overrides,  # noqa: F811
    version: int,
) -> None:
    store = type(overrides["store"])()
    store.add(versioned_bundle(1))
    store.add(versioned_bundle(2))
    overrides["store"] = store
    approve_versions(overrides, 1, 2)

    session_id, row = create_pinned(client, db_session, version)
    assert (row.content_version, row.content_fingerprint) == (
        version,
        FINGERPRINT[version],
    )

    bundle = client.get(f"{SESSIONS_URL}/{session_id}/bundle")
    assert bundle.status_code == 200
    assert bundle.json()["data"]["case_id"] == CASE_ID

    turn = client.post(f"{SESSIONS_URL}/{session_id}/npc/turns", json=body())
    assert turn.status_code == 200, turn.text
    reply = turn.json()["reply"]
    assert reply["source"] == "approved_line"
    assert reply["text"] == NUDGE[version]
    other = 2 if version == 1 else 1
    for leaked in (NUDGE[other], *FINGERPRINT.values(), HINT_1, HINT_2):
        assert leaked not in bundle.text
        assert leaked not in turn.text


def test_registering_newer_version_keeps_npc_turn_on_pinned_version(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    store = type(overrides["store"])()
    store.add(versioned_bundle(1))
    overrides["store"] = store
    approve_versions(overrides, 1, 2)
    session_id, _ = create_pinned(client, db_session, 1)
    url = f"{SESSIONS_URL}/{session_id}/npc/turns"
    before = client.post(url, json=body())
    db_session.added.clear()

    store.add(versioned_bundle(2))
    after = client.post(
        url, json=body(client_event_id="77777777-7777-4777-8777-777777777777")
    )

    assert before.status_code == after.status_code == 200
    assert before.json()["reply"]["text"] == after.json()["reply"]["text"] == NUDGE[1]


def test_unapproved_pinned_version_serves_no_case_line(
    client,
    db_session,
    overrides,  # noqa: F811
) -> None:
    store = type(overrides["store"])()
    store.add(versioned_bundle(1))
    store.add(versioned_bundle(2))
    overrides["store"] = store
    approve_all(overrides)
    overrides["approval"] = approved((CASE_ID, 1), FINGERPRINT[1]).source()

    session_id, _ = create_pinned(client, db_session, 2)
    turn = client.post(f"{SESSIONS_URL}/{session_id}/npc/turns", json=body())

    assert turn.status_code == 200
    assert NUDGE[2] not in turn.text and NUDGE[1] not in turn.text
