# pytest fixture(overrides · reader_override)를 다른 테스트 모듈에서 가져와 인자로 쓴다.
# ruff: noqa: F811
import json
import uuid

import pytest

from app.api.v1.npc import get_general_line_pack
from app.main import app
from app.schemas.npc_content import GeneralLinePack
from app.services.approval_history import ApprovalLog, ReviewRecord
from app.services.npc_dialogue import PM_GENERIC_PUZZLE_LINES
from app.services.npc_line_supply import (
    PAUSE_LINE_PREFIX,
    general_pack_fingerprint,
    select_pause_line,
)
from app.services.npc_turn_service import NpcGenerationConfig
from tests.test_npc_case_access import (  # noqa: F401  (pytest fixture)
    APPROVED_REPLY,
    BLOCKED,
    Reader,
    approved_access,
    reader_override,
)
from tests.test_npc_turn import NUDGE_A, approved
from tests.test_npc_turn_http import (  # noqa: F401  (pytest fixture)
    URL,
    Spy,
    body,
    overrides,
    session_row,
    stored,
)

# 테스트 전용 가상 일반 팩. 실제 PM 문장 · 실제 승인 기록이 아니다(PM이 작성 · 승인 예정).
PAUSE_LINES = {
    "GENERIC_PAUSE_01": "(가상) 잠시 쉬어 갈게요.",
    "GENERIC_PAUSE_02": "(가상) 조금 있다가 다시 이야기해요.",
    "GENERIC_PAUSE_03": "(가상) 기록을 정리하는 중이에요.",
}
WITHDRAWN = "NPC_CONTENT_WITHDRAWN"


def pause_pack(lines=PAUSE_LINES, version: int = 1) -> GeneralLinePack:
    return GeneralLinePack.model_validate(
        {
            "schema_version": "npc-general-pack 0.1",
            "pack_id": "general_test",
            "pack_version": version,
            "lines": [
                {"line_id": k, "text": v, "use": "puzzle_question"}
                for k, v in PM_GENERIC_PUZZLE_LINES.items()
            ]
            + [{"line_id": k, "text": v, "use": "pause"} for k, v in lines.items()],
        }
    )


def pack_approval(pack: GeneralLinePack, fingerprint: str | None = None):
    return approved(
        (pack.pack_id, pack.pack_version), fingerprint or general_pack_fingerprint(pack)
    ).source()


@pytest.fixture
def general(overrides):
    def supply(pack, approval) -> None:
        app.dependency_overrides[get_general_line_pack] = lambda: (pack, approval)

    return supply


def post(client, **fields):
    return client.post(URL, json=body(**fields)).json()


# ── 선택 규칙 ──


def test_selection_is_deterministic_and_uses_only_pause_lines() -> None:
    pack = pause_pack()
    approval = pack_approval(pack)

    picks = {select_pause_line(pack, approval, f"event-{n}").line_id for n in range(60)}

    assert picks <= set(PAUSE_LINES) and len(picks) > 1  # 여러 후보가 고르게 쓰인다
    for n in range(5):
        first = select_pause_line(pack, approval, f"event-{n}")
        assert select_pause_line(pack, approval, f"event-{n}") == first
        assert first.text == PAUSE_LINES[first.line_id]  # 승인 원문 그대로
        assert first.approved is True


def test_selection_is_stable_across_processes() -> None:
    # SHA-256 고정 규칙(Python hash() 미사용). 값이 바뀌면 같은 요청의 대사가 바뀌므로 고정해 둔다.
    pack = pause_pack()
    picks = [
        select_pause_line(pack, pack_approval(pack), key).line_id
        for key in (
            "66666666-6666-4666-8666-666666666666",
            "00000000-0000-4000-8000-000000000000",
            "event-a",
        )
    ]
    # 기대값은 규칙(SHA-256(도메인 \0 팩 fingerprint \0 키) 앞 8바이트 mod 후보 수)을 따로 계산한 값이다.
    assert picks == ["GENERIC_PAUSE_01", "GENERIC_PAUSE_03", "GENERIC_PAUSE_01"]


@pytest.mark.parametrize(
    "case",
    [
        "no_pack",
        "no_approval",
        "other_fingerprint",
        "other_pack_version",
        "withdrawn_pack_approval",
        "no_pause_lines",
    ],
)
def test_no_pause_line_without_an_approved_pack_with_pause_lines(case: str) -> None:
    pack = pause_pack()
    approval = pack_approval(pack)
    if case == "no_pack":
        pack = None
    elif case == "no_approval":
        approval = None
    elif case == "other_fingerprint":
        approval = pack_approval(pack, "sha256:" + "f" * 64)
    elif case == "other_pack_version":
        approval = pack_approval(pause_pack(version=2))
    elif case == "withdrawn_pack_approval":
        log = approved((pack.pack_id, 1), general_pack_fingerprint(pack))
        g3 = next(r for r in log.records(pack.pack_id, 1) if r.gate == "G3")
        log.append(
            pack.pack_id,
            1,
            ReviewRecord(
                review_id=str(uuid.uuid4()),
                gate="G3",
                target_hash=general_pack_fingerprint(pack),
                decision="hold",
                reviewer="reviewer-test",
                reviewed_at="2026-11-03T09:00:00.000Z",
                reason="(가상) 팩 철회",
                supersedes=g3.review_id,
            ),
        )
        approval = log.source()
    elif case == "no_pause_lines":
        pack = pause_pack(lines={})
        approval = pack_approval(pack)

    assert select_pause_line(pack, approval, "event-1") is None


def test_case_approvals_never_approve_the_general_pack() -> None:
    # 케이스 콘텐츠 승인 출처(다른 key)를 팩 승인 출처로 넘겨도 팩 승인이 아니다.
    pack = pause_pack()
    case_source = approved(("case_test", 1), general_pack_fingerprint(pack)).source()

    assert select_pause_line(pack, case_source, "event-1") is None


def test_empty_approval_log_is_not_an_approval() -> None:
    assert select_pause_line(pause_pack(), ApprovalLog().source(), "e") is None


# ── HTTP: 긴급 중단 응답 ──


def test_blocked_case_answers_with_an_approved_pause_line(
    client,
    db_session,
    reader_override,
    general,
) -> None:
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.status_code == 200
    expected = select_pause_line(pack, pack_approval(pack), body()["client_event_id"])
    assert response.json() == {
        "npc_event_id": response.json()["npc_event_id"],
        "reply": {
            "source": "approved_line",
            "text": expected.text,
            "line_id": expected.line_id,
        },
        "suggest_hint": None,
        "fallback_reason": WITHDRAWN,
    }
    record = stored(db_session).response_json
    assert (record["reply_source"], record["line_id"], record["fallback_reason"]) == (
        "approved_line",
        expected.line_id,
        WITHDRAWN,
    )
    assert record["suggest_hint_puzzle_id"] is None
    # 이벤트에는 대사 원문을 남기지 않는다(기존 규칙).
    assert expected.text not in json.dumps(record, ensure_ascii=False)


@pytest.mark.parametrize("supply", ["none", "unapproved", "other_fingerprint"])
def test_blocked_case_without_usable_pack_keeps_null_reply(
    client,
    db_session,
    reader_override,
    general,
    supply,
) -> None:
    pack = pause_pack()
    general(
        *{
            "none": (None, None),
            "unapproved": (pack, None),
            "other_fingerprint": (pack, pack_approval(pack, "sha256:" + "f" * 64)),
        }[supply]
    )
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = post(client)

    assert (response["reply"], response["suggest_hint"]) == (None, None)
    assert response["fallback_reason"] == WITHDRAWN


def test_same_client_event_id_returns_the_same_pause_line(
    client,
    db_session,
    reader_override,
    general,
) -> None:
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()
    first = post(client)
    event = stored(db_session)

    db_session.added.clear()
    db_session.scalar_result = event
    again = post(client)

    assert again == first
    assert db_session.added == []


def test_resend_of_a_case_reply_after_block_returns_the_pause_line(
    client,
    db_session,
    reader_override,
    general,
) -> None:
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(approved_access()))
    db_session.get_result = session_row()
    before = post(client)
    event = stored(db_session)
    assert before["reply"] == APPROVED_REPLY

    reader_override(Reader(BLOCKED))
    db_session.added.clear()
    db_session.scalar_result = event
    again = post(client)

    expected = select_pause_line(pack, pack_approval(pack), body()["client_event_id"])
    assert again["reply"]["line_id"] == expected.line_id
    assert NUDGE_A not in json.dumps(again, ensure_ascii=False)
    assert again["fallback_reason"] == WITHDRAWN


def test_resend_after_pack_approval_withdrawn_does_not_reuse_old_line(
    client,
    db_session,
    reader_override,
    general,
) -> None:
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()
    first = post(client)
    event = stored(db_session)
    assert first["reply"] is not None

    general(pack, None)  # 팩 승인이 빠졌다(또는 공급 중단)
    db_session.scalar_result = event
    again = post(client)

    assert again["reply"] is None
    assert again["fallback_reason"] == WITHDRAWN


def test_no_generation_while_blocked(
    client,
    db_session,
    overrides,
    reader_override,
    general,
) -> None:
    spy = Spy("(가상) 생성 문장")
    overrides["generation"] = NpcGenerationConfig(enabled=True, generator=spy)
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(BLOCKED))
    db_session.get_result = session_row()

    response = post(client, message="오늘 날씨 어때?")

    assert spy.calls == 0
    assert response["reply"]["source"] == "approved_line"
    assert response["reply"]["line_id"].startswith(PAUSE_LINE_PREFIX)


def test_published_case_does_not_use_pause_lines(
    client,
    db_session,
    reader_override,
    general,
) -> None:
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(approved_access()))
    db_session.get_result = session_row()

    response = post(client)

    assert response["reply"] == APPROVED_REPLY
    assert response["fallback_reason"] is None


def test_block_committed_during_turn_switches_to_pause_line(
    client,
    db_session,
    reader_override,
    general,
) -> None:
    pack = pause_pack()
    general(pack, pack_approval(pack))
    reader_override(Reader(approved_access(), BLOCKED))
    db_session.get_result = session_row()

    response = post(client)

    assert response["reply"]["line_id"].startswith(PAUSE_LINE_PREFIX)
    assert response["fallback_reason"] == WITHDRAWN
    assert stored(db_session).response_json["line_id"].startswith(PAUSE_LINE_PREFIX)


def test_response_schema_is_unchanged() -> None:
    schema = app.openapi()["components"]["schemas"]["NpcTurnResponse"]["properties"]
    assert set(schema) == {"npc_event_id", "reply", "suggest_hint", "fallback_reason"}
