"""`POST /api/v1/lobby/ticket` — 200 · 401 · 403 · 429 · 503, 명단 교체 반영, 발급 제한(로비 설계 v0.19 2 · 3절)."""

import os
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest

from app.core.config import settings
from app.main import app
from app.models.account_data import UserCharacter
from app.services.lobby_config import (
    LobbyIssuerState,
    build_state,
    get_lobby_issuer_state,
)
from app.services.lobby_ticket import IssueRateLimiter, get_issue_rate_limiter
from app.services.user_session import current_user
from tests.test_api_error_contract import assert_documented

PATH = "/api/v1/lobby/ticket"
ORIGIN = settings.cors_origins[0]
SECRET = "dev-" + "k" * 40


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def beta_list(tmp_path) -> Path:
    path = tmp_path / "lobby_beta_users.txt"
    path.write_text("# 모집 명단\nuser-1\n\nloadtest:bot-1\n", encoding="utf-8")
    return path


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def lobby(client, db_session, beta_list, clock):
    """로그인 사용자 · 로비 설정 · 발급 제한을 시험용으로 바꿔 끼운다."""

    state = {"value": _state(beta_list)}
    user = {"value": SimpleNamespace(id="user-1", nickname="조사관")}
    limiter = IssueRateLimiter(clock=clock)
    app.dependency_overrides[get_lobby_issuer_state] = lambda: state["value"]
    app.dependency_overrides[current_user] = lambda: user["value"]
    app.dependency_overrides[get_issue_rate_limiter] = lambda: limiter
    try:
        yield SimpleNamespace(
            client=client,
            state=state,
            user=user,
            path=beta_list,
            db=db_session,  # 저장된 캐릭터(조사관명) — get_result 가 없으면 캐릭터를 안 만든 계정
        )
    finally:
        for dependency in (
            get_lobby_issuer_state,
            current_user,
            get_issue_rate_limiter,
        ):
            app.dependency_overrides.pop(dependency, None)


def _state(beta_list: Path, **extra: str) -> LobbyIssuerState:
    settings_map = {
        "LOBBY_TICKET_SECRET": SECRET,
        "LOBBY_TICKET_TTL_SEC": "60",
        "LOBBY_BETA_LIST_PATH": str(beta_list),
        **extra,
    }
    return build_state("test", settings_map)


def _post(client, origin: str | None = ORIGIN):
    """origin=None 이면 Origin 헤더를 아예 뺀다(공용 client 는 기본 Origin 을 붙인다)."""

    request = client.build_request(
        "POST", PATH, headers={"Origin": origin or "placeholder"}
    )
    if origin is None:
        del request.headers["origin"]
    return client.send(request)


def _replace_list(path: Path, text: str) -> None:
    # 운영자 방식: 같은 폴더의 임시 파일에 쓰고 한 번에 바꿔 끼운다
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(text, encoding="utf-8")
    os.replace(temp, path)


def test_issues_a_ticket_for_a_listed_account(lobby):
    response = _post(lobby.client)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    claims = jwt.decode(
        response.json()["ticket"], SECRET, algorithms=["HS256"], audience="waegok-lobby"
    )
    assert claims["sub"] == "user-1"
    assert claims["nickname"] == "조사관"
    assert claims["exp"] - claims["iat"] == 60
    assert len(claims["jti"]) >= 16
    second = jwt.decode(
        _post(lobby.client).json()["ticket"],
        SECRET,
        algorithms=["HS256"],
        audience="waegok-lobby",
    )
    assert second["jti"] != claims["jti"]


def _nickname(response) -> str:
    return jwt.decode(
        response.json()["ticket"], SECRET, algorithms=["HS256"], audience="waegok-lobby"
    )["nickname"]


def test_ticket_carries_investigator_name_when_character_exists(lobby):
    lobby.db.get_result = SimpleNamespace(display_name=" 한서진 ")
    response = _post(lobby.client)
    assert response.status_code == 200
    assert _nickname(response) == "한서진"
    assert lobby.db.get_calls == [(UserCharacter, "user-1")]


@pytest.mark.parametrize(
    "display_name",
    [
        "   ",  # 공백뿐
        "😀" * 21,  # 21자지만 UTF-16 42단위 — 로비(40)가 거절할 길이
    ],
)
def test_ticket_falls_back_to_account_nickname(lobby, display_name):
    lobby.db.get_result = SimpleNamespace(display_name=display_name)
    assert _nickname(_post(lobby.client)) == "조사관"


def test_guest_without_session_gets_401(client, beta_list):
    app.dependency_overrides[get_lobby_issuer_state] = lambda: _state(beta_list)
    try:
        response = _post(client)
    finally:
        app.dependency_overrides.pop(get_lobby_issuer_state, None)
    assert response.status_code == 401
    assert_documented(response, "POST", PATH)


def test_foreign_origin_gets_403(lobby):
    for origin in ("https://evil.example.com", None):
        response = _post(lobby.client, origin=origin)
        assert response.status_code == 403
        assert response.json()["detail"] == "Origin not allowed."
        assert_documented(response, "POST", PATH)


def test_account_not_on_the_list_gets_403(lobby):
    lobby.user["value"] = SimpleNamespace(id="stranger", nickname="낯선 사람")
    response = _post(lobby.client)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not on the lobby beta list."
    assert response.headers["cache-control"] == "no-store"
    assert_documented(response, "POST", PATH)


def test_list_replacement_applies_without_restart(lobby):
    lobby.user["value"] = SimpleNamespace(id="newcomer", nickname="새 참가자")
    assert _post(lobby.client).status_code == 403
    _replace_list(lobby.path, "user-1\nnewcomer\n")
    assert _post(lobby.client).status_code == 200
    _replace_list(lobby.path, "user-1\n")
    assert _post(lobby.client).status_code == 403


@pytest.mark.parametrize(
    "content",
    [None, "", "# 주석만\n\n", "user 1\n", "loadtest:\n", b"\xff\xfe\x00bad"],
)
def test_missing_empty_or_broken_list_gets_503(lobby, content):
    if content is None:
        lobby.path.unlink()
    elif isinstance(content, bytes):
        lobby.path.write_bytes(content)
    else:
        lobby.path.write_text(content, encoding="utf-8")
    response = _post(lobby.client)
    assert response.status_code == 503
    assert response.json()["detail"] == "Lobby is unavailable."
    assert_documented(response, "POST", PATH)


def test_disabled_config_gets_503_and_main_api_is_fine(lobby):
    lobby.state["value"] = LobbyIssuerState(
        None, ("LOBBY_TICKET_TTL_SEC: 운영은 60이어야 한다",)
    )
    response = _post(lobby.client)
    assert response.status_code == 503
    assert_documented(response, "POST", PATH)
    assert lobby.client.get("/api/v1/health").status_code == 200


def test_account_limit_returns_429_with_retry_after_readable_by_the_game(lobby, clock):
    for _ in range(10):
        assert _post(lobby.client).status_code == 200
        clock.now += 1
    response = _post(lobby.client)
    assert response.status_code == 429
    # 첫 발급(1000초)이 60초 창을 벗어나는 1060초까지 남은 시간 — 지금은 1010초
    assert response.headers["retry-after"] == "50"
    assert "retry-after" in response.headers["access-control-expose-headers"].lower()
    assert_documented(response, "POST", PATH)
    # 거절된 요청은 세지 않는다. 한도가 풀리기 전에는 다시 거절, 풀리면 다시 발급된다
    clock.now += 49
    assert _post(lobby.client).status_code == 429
    clock.now += 1
    assert _post(lobby.client).status_code == 200


def test_shared_ip_limit_across_accounts(lobby, beta_list, clock):
    accounts = [f"acct-{n}" for n in range(7)]
    _replace_list(beta_list, "\n".join(accounts) + "\n")
    for account in accounts[:6]:
        lobby.user["value"] = SimpleNamespace(id=account, nickname=account)
        for _ in range(10):
            assert _post(lobby.client).status_code == 200
    lobby.user["value"] = SimpleNamespace(id=accounts[6], nickname="일곱째")
    response = _post(lobby.client)
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) == 60


def test_loadtest_ip_exemption_only_in_test_profile_and_keeps_account_limit(
    lobby, beta_list, clock
):
    accounts = [f"bot-{n}" for n in range(7)]
    _replace_list(beta_list, "\n".join(f"loadtest:{a}" for a in accounts) + "\n")
    lobby.state["value"] = _state(beta_list, LOBBY_LOADTEST_IP_EXEMPT="1")
    for account in accounts:
        lobby.user["value"] = SimpleNamespace(id=account, nickname=account)
        for _ in range(10):
            assert _post(lobby.client).status_code == 200
    # IP 한도(60)는 넘었지만 시험 계정이라 통과했다. 계정당 한도는 그대로다
    assert _post(lobby.client).status_code == 429
    # production 프로필에서는 이 예외를 켤 수 없다
    assert not build_state(
        "production",
        {
            "LOBBY_TICKET_SECRET": "p" * 40,
            "LOBBY_TICKET_TTL_SEC": "60",
            "LOBBY_BETA_LIST_PATH": str(beta_list),
            "LOBBY_LOADTEST_IP_EXEMPT": "1",
        },
    ).enabled
