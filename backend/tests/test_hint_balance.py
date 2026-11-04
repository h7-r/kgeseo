"""힌트 잔액 설정 · hint_ref 키 설정 · Hint 라우터 오류 형식(PM v0.4.8 · v0.4.9). DB 없이 검증한다.

실제 차감 · 동시성은 `test_hint_balance_mysql.py`(격리 MySQL)가 검증한다. 키 · 원문은 모두 가상 값이다.
"""

import base64
import logging
from datetime import datetime, timedelta

import pytest

from app.api.v1.hints import get_hint_economy_config
from app.api.v1.npc import get_hint_ref_keys
from app.core.config import settings
from app.models.anonymous_session import AnonymousSession
from app.models.play_session import PlaySession
from app.schemas.hint import HintUnlockRequest
from app.services.hint import unlock_hint
from app.services.hint_balance import (
    HintBalanceEmptyError,
    HintEconomyConfig,
    HintRefKeyConfigError,
    hint_economy_config,
    minigame_allowance,
    parse_hint_ref_keys,
)
from app.services.play_session import create_play_session
from app.services.session_content import get_pinned_content_store
from tests.conftest import FakeAsyncSession
from tests.test_npc_turn import FP, bundle
from tests.test_pinned_content import make_bundle

SECRET = b"hint-ref-test-only-" + b"s" * 32
ENCODED = base64.urlsafe_b64encode(SECRET).decode().rstrip("=")
OTHER = base64.urlsafe_b64encode(b"o" * 40).decode()


# --- 설정값 ---


def test_economy_defaults_follow_pm_v049_and_come_from_settings(monkeypatch):
    assert HintEconomyConfig() == HintEconomyConfig(3, 2, 1)
    monkeypatch.setattr(settings, "hint_initial_balance", 7)
    monkeypatch.setattr(settings, "hint_fun_minigames_per_session", 0)
    assert hint_economy_config() == HintEconomyConfig(7, 0, 1)


@pytest.mark.parametrize("value", [-1, True, "3", 1.5])
def test_economy_rejects_non_integer_or_negative_values(value):
    with pytest.raises(ValueError):
        HintEconomyConfig(initial_balance=value)


def test_minigame_allowance_opens_special_only_after_fun_minigames():
    normal = minigame_allowance(HintEconomyConfig())
    assert (normal.minigames_left, normal.special_minigame_available) == (2, False)
    spent = minigame_allowance(HintEconomyConfig(fun_minigames_per_session=0))
    assert (spent.minigames_left, spent.special_minigame_available) == (0, True)
    none = minigame_allowance(
        HintEconomyConfig(fun_minigames_per_session=0, special_minigames_per_session=0)
    )
    assert none.special_minigame_available is False


# --- hint_ref 발급 키 ---


def test_hint_ref_keys_are_parsed_from_settings_format():
    assert parse_hint_ref_keys("", "") is None
    keys = parse_hint_ref_keys("k2", f"k1:{OTHER},k2:{ENCODED}")
    assert keys.current_id == "k2"
    assert keys.keys == {"k1": b"o" * 40, "k2": SECRET}


@pytest.mark.parametrize(
    ("current", "raw"),
    [
        ("k1", ""),  # 한쪽만
        ("", f"k1:{ENCODED}"),
        ("k9", f"k1:{ENCODED}"),  # 현재 키가 목록에 없음
        ("k1", f"k1{ENCODED}"),  # 구분자 없음
        ("k1", f"k1:{ENCODED},k1:{OTHER}"),  # 중복 id
        ("k1", "k1:not*base64"),
        ("k1", "k1:" + base64.urlsafe_b64encode(b"short").decode()),  # 32바이트 미만
        ("K1", f"K1:{ENCODED}"),  # 대문자 id
    ],
)
def test_invalid_hint_ref_key_settings_fail_without_leaking_secret(current, raw):
    with pytest.raises(HintRefKeyConfigError) as error:
        parse_hint_ref_keys(current, raw)
    assert ENCODED not in str(error.value) and "base64" not in str(error.value)


def test_npc_dependency_reads_keys_and_fails_closed_on_bad_config(monkeypatch, caplog):
    monkeypatch.setattr(settings, "hint_ref_current_key_id", "")
    monkeypatch.setattr(settings, "hint_ref_keys", type(settings.hint_ref_keys)(""))
    assert get_hint_ref_keys() is None  # 운영 기본값: 발급하지 않음

    monkeypatch.setattr(settings, "hint_ref_current_key_id", "k1")
    monkeypatch.setattr(
        settings, "hint_ref_keys", type(settings.hint_ref_keys)(f"k1:{ENCODED}")
    )
    assert get_hint_ref_keys().keys == {"k1": SECRET}
    # 비밀 값은 설정 객체 표시에 나오지 않는다.
    assert ENCODED not in repr(settings) and ENCODED not in str(settings.hint_ref_keys)

    monkeypatch.setattr(
        settings, "hint_ref_keys", type(settings.hint_ref_keys)("k1:short")
    )
    with caplog.at_level(logging.ERROR):
        assert get_hint_ref_keys() is None
    assert "suggest_hint disabled" in caplog.text
    assert "short" not in caplog.text


# --- 회차 시작 지급 ---


@pytest.mark.anyio
async def test_new_session_gets_configured_initial_balance(monkeypatch):
    def anonymous_db():
        db = FakeAsyncSession()
        db.get_result = AnonymousSession(
            id="anon",
            created_at=datetime(2026, 10, 30),
            expires_at=datetime.now() + timedelta(days=1),
        )
        return db

    loader = make_bundle().client_content_loader()
    monkeypatch.setattr(settings, "hint_initial_balance", 4)
    from_settings = await create_play_session(
        anonymous_db(), "anon", "case_pinned_test", client_content_loader=loader
    )
    explicit = await create_play_session(
        anonymous_db(),
        "anon",
        "case_pinned_test",
        client_content_loader=loader,
        initial_hint_balance=0,
    )
    assert (from_settings.hint_balance, from_settings.help_used) == (4, 0)
    assert (explicit.hint_balance, explicit.help_used) == (0, 0)

    with pytest.raises(ValueError):
        await create_play_session(
            anonymous_db(),
            "anon",
            "case_pinned_test",
            client_content_loader=loader,
            initial_hint_balance=-1,
        )


# --- 서비스: 잔액 0은 아무것도 쓰지 않는다 ---


def pinned_session(balance: int, levels: dict | None = None) -> PlaySession:
    now = datetime(2026, 10, 30, 1, 0, 0)
    return PlaySession(
        id="play-session-id",
        anonymous_session_id="anon",
        case_id="case_test",
        state_json={
            "current_zone_id": "ZONE_A",
            "completed_puzzle_ids": [],
            "completed_inspect_ids": [],
            "acquired_clue_ids": [],
            "hint_levels": levels or {},
            "attempt_counts": {},
            "flags": {},
            "object_states": {},
        },
        created_at=now,
        updated_at=now,
        completed_at=None,
        content_version=1,
        content_fingerprint=FP,
        hint_balance=balance,
        help_used=0,
    )


@pytest.mark.anyio
async def test_empty_balance_raises_before_any_write():
    from app.services.hint import server_hint_text

    db = FakeAsyncSession()
    db.get_result = pinned_session(0)
    content = bundle()
    with pytest.raises(HintBalanceEmptyError) as error:
        await unlock_hint(
            db,
            "play-session-id",
            "PZ_A",
            HintUnlockRequest(client_event_id="h1", target_level=1),
            hint_source=content.hint_source(server_hint_text),
            access_policy=lambda state, puzzle, level: None,
            runtime_loader=content.runtime_loader(),
            economy=HintEconomyConfig(fun_minigames_per_session=1),
        )
    assert error.value.allowance.minigames_left == 1
    assert db.added == [] and db.commit_count == 0 and db.rollback_count >= 1
    assert (
        db.get_result.hint_balance == 0
        and db.get_result.state_json["hint_levels"] == {}
    )


# --- HTTP 오류 형식 ---


@pytest.fixture
def pinned_store():
    from app.main import app
    from app.services.pinned_content import PinnedContentStore

    store = PinnedContentStore()
    store.add(bundle())
    app.dependency_overrides[get_pinned_content_store] = lambda: store
    app.dependency_overrides[get_hint_economy_config] = lambda: HintEconomyConfig()
    yield store
    app.dependency_overrides.pop(get_pinned_content_store, None)
    app.dependency_overrides.pop(get_hint_economy_config, None)


PATH = "/api/v1/play-sessions/00000000-0000-4000-8000-000000000001/puzzles/PZ_A/hints"


def test_http_empty_balance_is_409_with_recharge_options(
    client, db_session, pinned_store
):
    db_session.get_result = pinned_session(0)
    response = client.post(PATH, json={"client_event_id": "h1", "target_level": 1})
    assert response.status_code == 409
    assert response.json() == {
        "detail": {
            "code": "HINT_BALANCE_EMPTY",
            "message": "Hint balance is empty.",
            "minigames_left": 2,
            "special_minigame_available": False,
        }
    }
    assert db_session.added == [] and db_session.commit_count == 0


def test_http_unlock_returns_text_and_balance(client, db_session, pinned_store):
    db_session.get_result = pinned_session(2)
    response = client.post(PATH, json={"client_event_id": "h1", "target_level": 1})
    assert response.status_code == 200
    body = response.json()
    assert body["result"]["hint_balance"] == 1 and body["result"]["help_used"] == 1
    assert body["hint"]["level"] == 1
    # 이벤트에는 원문을 저장하지 않는다.
    (stored,) = db_session.added
    assert body["hint"]["text"] not in str(stored.response_json)


def test_http_missing_pinned_version_is_409_without_writes(client, db_session):
    from app.main import app
    from app.services.pinned_content import PinnedContentStore

    app.dependency_overrides[get_pinned_content_store] = PinnedContentStore
    try:
        db_session.get_result = pinned_session(2)
        response = client.post(PATH, json={"client_event_id": "h1", "target_level": 1})
    finally:
        app.dependency_overrides.pop(get_pinned_content_store, None)
    assert response.status_code == 409
    assert response.json() == {"detail": "CASE_VERSION_UNAVAILABLE"}
    assert db_session.added == [] and db_session.commit_count == 0


@pytest.mark.parametrize("event_id", ["", "x" * 37])
def test_http_rejects_client_event_ids_that_do_not_fit_storage(
    client, db_session, pinned_store, event_id
):
    db_session.get_result = pinned_session(2)
    response = client.post(PATH, json={"client_event_id": event_id, "target_level": 1})
    assert response.status_code == 422
