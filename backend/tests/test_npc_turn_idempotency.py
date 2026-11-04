"""NPC 턴 멱등 저장소 — DB 없이 검증하는 부분. 실제 MySQL 시나리오는 `test_npc_turn_idempotency_mysql.py`."""

import asyncio
import io
import re
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import OperationalError

from alembic import command
from app.models.npc_turn_idempotency import NpcTurnRequest, NpcTurnResponseBody
from app.repositories.npc_turn_idempotency import TurnContentRef
from app.schemas.npc_turn import NpcTurnResponse
from app.services.npc_turn_idempotency import (
    InconsistentTurnStateError,
    NpcTurnIdempotencyStore,
    PublicationStateUnavailableError,
    RequestHashKeys,
    RequestHashKeyUnavailableError,
    fail_closed_publication_guard,
    matches_request_body_hash,
    request_body_hash,
    turn_key,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
REVISION = "e4c1f7a2b9d6"
PARENT = "c9e1a4b7d2f0"

# 가상 테스트 키 · 데이터. 실제 운영 키가 아니다.
K1 = b"k1-test-only-" + b"a" * 32
K2 = b"k2-test-only-" + b"b" * 32
KEYS = RequestHashKeys("k1", {"k1": K1})
KEY = turn_key(str(uuid4()), str(uuid4()))
REQUEST = {"trigger": "player_message", "message": "가상 플레이어 문장", "focus": None}


def store(**kwargs) -> NpcTurnIdempotencyStore:
    return NpcTurnIdempotencyStore(
        None,  # type: ignore[arg-type]
        hash_keys=KEYS,
        publication_guard=fail_closed_publication_guard,
        **kwargs,
    )


# --- 요청 본문 해시 ---


def test_request_hash_is_self_describing_keyed_and_hides_the_request() -> None:
    value = request_body_hash(KEYS, KEY, REQUEST)

    assert re.fullmatch(r"hmac-sha256:k1:[0-9a-f]{64}", value)
    assert "가상" not in value and "player_message" not in value
    assert value == request_body_hash(KEYS, KEY, dict(reversed(REQUEST.items())))
    assert matches_request_body_hash(KEYS, value, KEY, REQUEST)


@pytest.mark.parametrize(
    "change",
    [
        {"key": turn_key(str(uuid4()), KEY.turn_request_id)},
        {"key": turn_key(KEY.play_session_id, str(uuid4()))},
        {"request": {**REQUEST, "message": "가상 플레이어 문장!"}},
        {"request": {**REQUEST, "focus": "OBJ_A"}},
        {"keys": RequestHashKeys("k1", {"k1": K2})},
    ],
)
def test_request_hash_changes_with_session_request_body_or_key(change) -> None:
    base = request_body_hash(KEYS, KEY, REQUEST)
    other = request_body_hash(
        change.get("keys", KEYS), change.get("key", KEY), change.get("request", REQUEST)
    )

    assert other.rsplit(":", 1)[1] != base.rsplit(":", 1)[1]


def test_key_rotation_still_verifies_hashes_made_with_the_old_key() -> None:
    old = request_body_hash(KEYS, KEY, REQUEST)
    rotated = RequestHashKeys("k2", {"k1": K1, "k2": K2})

    assert request_body_hash(rotated, KEY, REQUEST).startswith("hmac-sha256:k2:")
    assert matches_request_body_hash(rotated, old, KEY, REQUEST)
    assert not matches_request_body_hash(rotated, old, KEY, {**REQUEST, "x": 1})


def test_unknown_key_id_is_a_configuration_error_not_a_mismatch() -> None:
    old = request_body_hash(KEYS, KEY, REQUEST)

    with pytest.raises(RequestHashKeyUnavailableError):
        matches_request_body_hash(RequestHashKeys("k2", {"k2": K2}), old, KEY, REQUEST)
    with pytest.raises(InconsistentTurnStateError):
        matches_request_body_hash(KEYS, "sha256:" + "0" * 64, KEY, REQUEST)


@pytest.mark.parametrize(
    ("current", "keys"),
    [
        ("k1", {"k1": b"short"}),
        ("K1", {"K1": K1}),
        ("k1", {"k2": K2}),
        ("k1", {"k1": "a" * 40}),
    ],
)
def test_invalid_hash_keys_are_rejected(current, keys) -> None:
    with pytest.raises(ValueError):
        RequestHashKeys(current, keys)


def test_turn_key_requires_uuids_and_normalizes() -> None:
    upper = str(uuid4()).upper()

    assert turn_key(upper, upper).play_session_id == upper.lower()
    with pytest.raises(ValueError):
        turn_key("not-a-uuid", str(uuid4()))


# --- 서비스 경계 ---


def test_store_rejects_invalid_configuration_and_non_final_response() -> None:
    with pytest.raises(TypeError):
        NpcTurnIdempotencyStore(  # type: ignore[arg-type]
            None, hash_keys={"k1": K1}, publication_guard=fail_closed_publication_guard
        )
    with pytest.raises(ValueError):
        store(lease=timedelta(0))
    with pytest.raises(TypeError):
        asyncio.run(store().complete(None, {"reply": "x"}))  # type: ignore[arg-type]


def test_publication_guard_is_required_and_defaults_to_fail_closed() -> None:
    # guard를 빼고는 저장소를 만들 수 없다(누락이 승인으로 이어지지 않게).
    with pytest.raises(TypeError):
        NpcTurnIdempotencyStore(None, hash_keys=KEYS)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        NpcTurnIdempotencyStore(None, hash_keys=KEYS, publication_guard=None)  # type: ignore[arg-type]
    with pytest.raises(PublicationStateUnavailableError):
        asyncio.run(
            fail_closed_publication_guard(None, TurnContentRef("c", 1, "sha256:x"))  # type: ignore[arg-type]
        )


def test_content_mode_must_be_case_or_generic() -> None:
    response = NpcTurnResponse(
        npc_event_id=uuid4(), reply=None, suggest_hint=None, content_mode="case"
    )
    with pytest.raises(ValueError):
        asyncio.run(store().complete(None, response, content_mode="other"))  # type: ignore[arg-type]


def deadlock(errno: int = 1213) -> OperationalError:
    return OperationalError("stmt", {}, Exception(errno, "simulated"))


def test_deadlock_is_retried_a_bounded_number_of_times() -> None:
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise deadlock()
        return "ok"

    assert asyncio.run(store(deadlock_retries=3)._retry_deadlock(flaky)) == "ok"
    assert calls["n"] == 3

    async def always():
        raise deadlock()

    with pytest.raises(OperationalError):
        asyncio.run(store(deadlock_retries=2)._retry_deadlock(always))


def test_lock_wait_timeout_is_not_retried() -> None:
    calls = {"n": 0}

    async def timeout():
        calls["n"] += 1
        raise deadlock(1205)

    with pytest.raises(OperationalError):
        asyncio.run(store()._retry_deadlock(timeout))
    assert calls["n"] == 1


# --- 저장 범위 · migration ---


def test_tables_hold_no_player_text_or_model_context_columns() -> None:
    assert {c.name for c in NpcTurnRequest.__table__.columns} == {
        "play_session_id",
        "turn_request_id",
        "request_body_hash",
        "status",
        "case_id",
        "content_version",
        "content_fingerprint",
        "owner_token",
        "lease_expires_at",
        "created_at",
        "issued_at",
        "expires_at",
        "purged_at",
        "withdrawn_at",
    }
    assert {c.name for c in NpcTurnResponseBody.__table__.columns} == {
        "play_session_id",
        "turn_request_id",
        "response_json",
        "created_at",
    }
    # PM v0.4.7: fallback_reason(이유 코드), v0.4.12: content_mode만 추가됐다. 원문 · 내부 ID 필드는 없다.
    assert set(NpcTurnResponse.model_fields) == {
        "npc_event_id",
        "reply",
        "suggest_hint",
        "fallback_reason",
        "content_mode",
    }


def alembic_config(output=None) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


def test_migration_extends_content_pin_revision_only() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    # 게시 상태 migration(f3b8d2c6a1e7)이 이 revision 위에 추가되었다. 단일 head 여부 · 그 위 revision은
    # test_play_session_content_pin이 확인한다. 여기서는 head의 조상에 있는지만 본다.
    assert any(
        rev.revision == "f3b8d2c6a1e7"
        for head in script.get_heads()
        for rev in script.iterate_revisions(head, "base")
    )
    assert script.get_revision("f3b8d2c6a1e7").down_revision == REVISION
    assert script.get_revision(REVISION).down_revision == PARENT

    up = io.StringIO()
    command.upgrade(alembic_config(up), f"{PARENT}:{REVISION}", sql=True)
    down = io.StringIO()
    command.downgrade(alembic_config(down), f"{REVISION}:{PARENT}", sql=True)
    upgrade_sql, downgrade_sql = up.getvalue(), down.getvalue()

    assert "CREATE TABLE npc_turn_requests" in upgrade_sql
    assert "CREATE TABLE npc_turn_response_bodies" in upgrade_sql
    assert upgrade_sql.count("ON DELETE CASCADE") == 2
    assert "ALTER TABLE" not in upgrade_sql
    assert "DROP TABLE npc_turn_response_bodies" in downgrade_sql
    assert "DROP TABLE npc_turn_requests" in downgrade_sql
    assert "DROP TABLE play_sessions" not in downgrade_sql
    assert "ALTER TABLE" not in downgrade_sql
