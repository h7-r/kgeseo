"""NPC 턴 HTTP — POST /api/v1/play-sessions/{id}/npc/turns (PM v0.4.3)."""

import json
import uuid
from collections.abc import Iterator
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.api.v1.npc import (
    get_general_line_pack,
    get_general_pack_access_reader,
    get_hint_ref_keys,
    get_npc_case_access_reader,
    get_npc_event_loader,
    get_npc_generation,
)
from app.main import app
from app.models.interaction_event import InteractionEvent
from app.models.play_session import PlaySession
from app.services.hint_ref import HintRefKeys, resolve_hint_ref
from app.services.npc_case_access import CaseNpcAccess, read_case_npc_access
from app.services.npc_general_pack import GeneralPackAccess
from app.services.npc_line_supply import general_pack_fingerprint
from app.services.npc_turn_service import NpcGenerationConfig
from app.services.pinned_content import PinnedContentStore
from app.services.session_content import get_pinned_content_store
from tests.test_npc_turn import (
    FALLBACK,
    FP,
    HINT_1,
    HINT_2,
    NUDGE_A,
    approved,
    bundle,
    general_pack,
)

# 가상 테스트 데이터. 실제 PM 콘텐츠 · 실제 승인 기록이 아니다.
SESSION_ID = "55555555-5555-4555-8555-555555555555"
URL = f"/api/v1/play-sessions/{SESSION_ID}/npc/turns"
EVENT_ID = "66666666-6666-4666-8666-666666666666"


def session_row(
    *, version: int | None = 1, fingerprint: str | None = FP, **state
) -> PlaySession:
    now = datetime(2026, 10, 29, 1, 0, 0)
    base_state = {
        "current_zone_id": "ZONE_A",
        "completed_puzzle_ids": ["PZ_DONE"],
        "completed_inspect_ids": [],
        "acquired_clue_ids": ["CLUE_LETTER"],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
        "object_states": {},
    }
    return PlaySession(
        id=SESSION_ID,
        anonymous_session_id="anon",
        case_id="case_test",
        state_json=base_state | state,
        created_at=now,
        updated_at=now,
        completed_at=None,
        content_version=version,
        content_fingerprint=fingerprint,
    )


class Spy:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0

    def __call__(self, model_input: dict) -> str:
        self.calls += 1
        return self.reply


@pytest.fixture
def overrides() -> Iterator[dict[str, Any]]:
    store = PinnedContentStore()
    store.add(bundle())
    values: dict[str, Any] = {
        "store": store,
        "approval": None,
        "general": (None, None),
        "generation": NpcGenerationConfig(),
        "events": [],
        # 가상 테스트 키(운영 키가 아니다)
        "hint_ref_keys": HintRefKeys("t1", {"t1": b"hint-ref-test-only-" + b"k" * 32}),
    }

    async def loader(db, play_session_id):
        return values["events"]

    app.dependency_overrides[get_pinned_content_store] = lambda: values["store"]

    # 승인 이력 · 게시 상태 판정 대역: 게시 중(published)으로 보고 주입한 승인 출처를 쓴다.
    # 실제 DB 판정은 test_npc_case_access(_mysql)가 확인한다.
    async def case_access(db, pin, *, lock):
        return CaseNpcAccess(values["approval"], basis=("test",))

    app.dependency_overrides[get_npc_case_access_reader] = lambda: case_access
    app.dependency_overrides[get_general_line_pack] = lambda: values["general"]

    # 일반 팩 DB 승인 판정 대역: 고정 승인 출처를 넘기지 않으면 미승인. 실제 DB 판정은 test_npc_general_pack(_mysql).
    async def pack_access(db, pack, *, lock):
        return GeneralPackAccess(None, basis=("test",))

    app.dependency_overrides[get_general_pack_access_reader] = lambda: pack_access
    app.dependency_overrides[get_npc_generation] = lambda: values["generation"]
    app.dependency_overrides[get_npc_event_loader] = lambda: loader
    app.dependency_overrides[get_hint_ref_keys] = lambda: values["hint_ref_keys"]
    yield values
    for dependency in (
        get_pinned_content_store,
        get_npc_case_access_reader,
        get_general_line_pack,
        get_general_pack_access_reader,
        get_npc_generation,
        get_npc_event_loader,
        get_hint_ref_keys,
    ):
        app.dependency_overrides.pop(dependency, None)


def approve_all(values: dict[str, Any]) -> None:
    values["approval"] = approved(("case_test", 1), FP).source()
    pack = general_pack()
    values["general"] = (
        pack,
        approved(("general_default", 1), general_pack_fingerprint(pack)).source(),
    )


def body(**overrides: Any) -> dict[str, Any]:
    data = {
        "client_event_id": EVENT_ID,
        "client_timestamp": "2026-10-29T12:00:00+09:00",
        "trigger": "player_message",
        "message": "소화전 어떻게 열어?",
    }
    data.update(overrides)
    return {k: v for k, v in data.items() if v is not None}


def stored(db) -> InteractionEvent:
    assert len(db.added) == 1
    return db.added[0]


# --- 오류 체계 ---


def test_missing_session_is_404(client, db_session, overrides) -> None:
    db_session.get_result = None

    response = client.post(URL, json=body())

    assert response.status_code == 404
    assert response.json() == {"detail": "Play session not found."}


@pytest.mark.parametrize(
    ("version", "fingerprint"),
    [(None, None), (2, "sha256:" + "f" * 64), (1, "sha256:" + "0" * 64)],
    ids=["legacy_session", "version_not_in_store", "fingerprint_mismatch"],
)
def test_unavailable_pinned_version_is_409(
    client, db_session, overrides, version, fingerprint
) -> None:
    db_session.get_result = session_row(version=version, fingerprint=fingerprint)

    response = client.post(URL, json=body())

    assert response.status_code == 409
    assert response.json() == {"detail": "CASE_VERSION_UNAVAILABLE"}
    assert db_session.added == []


@pytest.mark.parametrize(
    "overrides_",
    [
        {"message": None},
        {"trigger": "auto"},  # auto 에 message
        {"trigger": "other"},
        {"puzzle_id": "PZ_A"},  # 퍼즐 ID 는 받지 않는다
        {"client_timestamp": "2026-10-29T12:00:00"},  # 시간대 없음
        {"message": "가" * 201},
    ],
)
def test_invalid_request_is_422(client, db_session, overrides, overrides_) -> None:
    db_session.get_result = session_row()

    response = client.post(URL, json=body(**overrides_))

    assert response.status_code == 422
    assert db_session.added == []


# --- 기본값: 승인 없음 · 생성 OFF ---


def test_default_dependencies_never_serve_unapproved_lines(
    client, db_session, overrides
) -> None:
    db_session.get_result = session_row()

    response = client.post(URL, json=body())

    assert response.status_code == 200
    assert response.json()["reply"] is None
    assert response.json()["suggest_hint"] is None
    record = stored(db_session).response_json
    assert record["reply_source"] is None
    assert record["no_reply_reason"] == "generic_line_unapproved"


def test_production_dependency_defaults_are_off() -> None:
    from app.api.v1 import npc as npc_api

    # 케이스 대사 승인은 DB 판정(승인 이력 · 게시 상태)으로만 정한다. 기록이 없으면 미승인이다.
    assert npc_api.get_npc_case_access_reader() is read_case_npc_access
    assert npc_api.get_general_line_pack() == (None, None)
    generation = npc_api.get_npc_generation()
    assert (generation.enabled, generation.generator) == (False, None)


# --- 승인된 콘텐츠 ---


def test_puzzle_question_returns_approved_nudge_and_records_no_text(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    spy = Spy("(가상) 생성 문장")
    overrides["generation"] = NpcGenerationConfig(enabled=True, generator=spy)
    row = session_row()
    before = deepcopy(row.state_json)
    db_session.get_result = row

    response = client.post(URL, json=body())

    assert response.status_code == 200
    assert response.json()["reply"] == {
        "source": "approved_line",
        "text": NUDGE_A,
        "line_id": "NUDGE_A_01",
    }
    assert spy.calls == 0
    event = stored(db_session)
    assert event.interaction_type == "npc_turn"
    assert event.target_id is None
    dumped = json.dumps([event.payload_json, event.response_json], ensure_ascii=False)
    assert NUDGE_A not in dumped and "소화전" not in dumped
    assert event.response_json["diagnosis"]["is_puzzle_question"] is True
    assert row.state_json == before


def test_suggest_hint_is_guidance_only(client, db_session, overrides) -> None:
    approve_all(overrides)
    row = session_row(acquired_clue_ids=[])  # 퍼즐 nudge 닫힘
    db_session.get_result = row

    response = client.post(URL, json=body())

    data = response.json()
    assert data["reply"]["line_id"] == "NPC_GENERIC_PUZZLE_02"
    # PM v0.4.7: 내부 puzzle_id 대신 불투명 hint_ref. 서버는 세션 · 고정 콘텐츠로 되찾을 수 있다.
    hint_ref = data["suggest_hint"]["hint_ref"]
    assert set(data["suggest_hint"]) == {"hint_ref"}
    assert "PZ_A" not in response.text
    assert (
        resolve_hint_ref(
            overrides["hint_ref_keys"],
            hint_ref,
            play_session_id=SESSION_ID,
            content_fingerprint=FP,
            puzzle_ids=["PZ_A", "PZ_DONE"],
        )
        == "PZ_A"
    )
    assert stored(db_session).response_json["suggest_hint_puzzle_id"] == "PZ_A"
    assert row.state_json["hint_levels"] == {}
    assert [e.interaction_type for e in db_session.added] == ["npc_turn"]
    assert HINT_1 not in response.text and HINT_2 not in response.text


def test_general_message_with_generation_off_has_no_reply(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    db_session.get_result = session_row()

    response = client.post(URL, json=body(message="오늘 날씨 좋다"))

    assert response.json()["reply"] is None
    assert stored(db_session).response_json["no_reply_reason"] == "generation_disabled"


def test_enabled_generation_is_checked_and_logged_without_text(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    overrides["generation"] = NpcGenerationConfig(
        enabled=True, generator=Spy("등대는 무너졌대요")
    )
    db_session.get_result = session_row()

    response = client.post(URL, json=body(message="오늘 날씨 좋다"))

    assert response.json()["reply"] == {
        "source": "approved_line",
        "text": FALLBACK,
        "line_id": "FALLBACK_01",
    }
    record = stored(db_session).response_json
    assert record["generated"] is False
    assert record["policy"] == [{"code": "NG", "rule_id": "ng[0]"}]
    assert "등대는 무너" not in json.dumps(record, ensure_ascii=False)


# --- 자동 개입 ---


def answer_events(count: int, *, seconds_ago: float = 10) -> list[InteractionEvent]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return [
        InteractionEvent(
            id=f"evt-{i}",
            play_session_id=SESSION_ID,
            client_event_id=f"c-{i}",
            interaction_type="submit_answer",
            target_id="PZ_A",
            payload_json={},
            result_type="incorrect",
            response_json={},
            created_at=now - timedelta(seconds=seconds_ago + count - i),
        )
        for i in range(count)
    ]


def auto_body(**kw: Any) -> dict[str, Any]:
    return body(
        **({"trigger": "auto", "message": None, "focus_object_id": "OBJ_CABINET"} | kw)
    )


def test_auto_turn_intervenes_with_approved_nudge(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    overrides["events"] = answer_events(6)
    db_session.get_result = session_row()

    response = client.post(URL, json=auto_body())

    assert response.json()["reply"]["line_id"] == "NUDGE_A_01"
    record = stored(db_session).response_json
    assert record["auto_intervened"] is True
    assert record["decision"]["intervention_level"] == 1
    assert record["decision"]["reason"] == "repeated_incorrect"


def test_auto_turn_without_rule_or_in_cooldown_is_silent(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    db_session.get_result = session_row()
    overrides["events"] = answer_events(2)

    quiet = client.post(URL, json=auto_body())

    assert quiet.json()["reply"] is None

    db_session.added.clear()
    recent = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)
    offer = InteractionEvent(
        id="npc-1",
        play_session_id=SESSION_ID,
        client_event_id="c-npc",
        interaction_type="npc_turn",
        target_id=None,
        payload_json={},
        result_type="replied",
        response_json={
            "auto_intervened": True,
            "decision": {"target_puzzle_id": "PZ_A"},
        },
        created_at=recent,
    )
    # PM v0.4.7: 응답만 하고 표시 보고가 없는 제안은 쿨다운을 소모하지 않는다.
    overrides["events"] = [*answer_events(6), offer]
    offered = client.post(URL, json=auto_body())
    assert offered.json()["reply"]["line_id"] == "NUDGE_A_01"

    db_session.added.clear()
    shown = InteractionEvent(
        id="shown-1",
        play_session_id=SESSION_ID,
        client_event_id="c-shown",
        interaction_type="npc_suggestion_shown",
        target_id="npc-1",
        payload_json={},
        result_type="shown",
        response_json={"puzzle_id": "PZ_A", "level": 1},
        created_at=recent,
    )
    overrides["events"] = [*answer_events(6), offer, shown]

    cooling = client.post(URL, json=auto_body(client_event_id=str(uuid.uuid4())))

    assert cooling.json()["reply"] is None
    assert stored(db_session).response_json["decision"]["reason"] == "cooldown"


def test_auto_focus_on_hidden_or_unknown_object_has_no_target(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    overrides["events"] = answer_events(6)
    db_session.get_result = session_row()

    response = client.post(URL, json=auto_body(focus_object_id="OBJ_SAFE"))

    assert response.json()["reply"] is None
    assert stored(db_session).response_json["decision"]["target_puzzle_id"] is None


# --- 재전송 ---


def test_replay_returns_stored_result_and_conflicts_on_change(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    db_session.get_result = session_row()
    first = client.post(URL, json=body())
    event = stored(db_session)

    db_session.added.clear()
    db_session.scalar_result = event
    again = client.post(URL, json=body())
    changed = client.post(URL, json=body(message="정답 알려 줘"))

    assert again.status_code == 200
    assert again.json() == first.json()
    assert db_session.added == []
    assert changed.status_code == 409
    assert changed.json() == {
        "detail": "Client event ID conflicts with a previous interaction."
    }


def test_replay_drops_text_when_approval_is_withdrawn(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    db_session.get_result = session_row()
    client.post(URL, json=body())
    event = stored(db_session)

    overrides["approval"] = None
    db_session.scalar_result = event
    again = client.post(URL, json=body())

    assert again.json()["reply"] is None


# --- PM v0.4.7: 넛지 없는 연속 오답 → 2단계 힌트 안내 ---


def test_auto_level_two_guidance_returns_hint_ref_and_records_internal_puzzle(
    client, db_session, overrides
) -> None:
    approve_all(overrides)
    overrides["approval"] = None  # 케이스 넛지 미승인 → 보여 줄 넛지 없음
    overrides["events"] = answer_events(7)
    db_session.get_result = session_row()

    response = client.post(URL, json=auto_body())

    data = response.json()
    assert data["reply"]["line_id"] == "NPC_GENERIC_PUZZLE_02"
    assert set(data["suggest_hint"]) == {"hint_ref"}
    assert data["fallback_reason"] is None
    assert "PZ_A" not in response.text
    assert HINT_1 not in response.text and HINT_2 not in response.text
    record = stored(db_session).response_json
    assert record["auto_intervened"] is True
    assert record["suggest_hint_puzzle_id"] == "PZ_A"
    assert record["auto_intervene"] == {
        "trigger": "repeated_incorrect",
        "value": 7,
        "puzzle_ref": "PZ_A",
        "nudge_missing": False,
        "level": 2,
    }


def test_auto_level_two_without_generic_pack_has_null_reply_and_reason(
    client, db_session, overrides
) -> None:
    overrides["events"] = answer_events(6)  # 승인 정보 · 일반 팩 모두 없음
    db_session.get_result = session_row()

    response = client.post(URL, json=auto_body())

    data = response.json()
    assert data["reply"] is None
    assert data["fallback_reason"] == "NPC_GENERIC_PACK_MISSING"
    assert set(data["suggest_hint"]) == {"hint_ref"}
    record = stored(db_session).response_json
    assert record["fallback_reason"] == "NPC_GENERIC_PACK_MISSING"
    assert record["auto_intervene"]["level"] == 2


def test_without_hint_ref_keys_suggest_hint_is_withheld(
    client, db_session, overrides
) -> None:
    overrides["hint_ref_keys"] = None
    overrides["events"] = answer_events(6)
    db_session.get_result = session_row()

    response = client.post(URL, json=auto_body())

    # 발급 키가 없으면 내부 ID로 대신하지 않는다(fail closed). 기록에는 내부 ID가 남는다.
    assert response.json()["suggest_hint"] is None
    assert "PZ_A" not in response.text
    assert stored(db_session).response_json["suggest_hint_puzzle_id"] == "PZ_A"
