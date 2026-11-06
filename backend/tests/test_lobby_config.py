"""로비 입장권 발급 설정 로더 — 실행 프로필 · 읽는 경로 · 운영 시작 검사(로비 설계 v0.19 3.3절)."""

from pathlib import Path

import pytest

from app.core.config import Settings
from app.services import lobby_config
from app.services.lobby_config import load_state

PROD_SECRET = "p" * 40
GOOD_PRODUCTION = {
    "WAEGOK_RUN_PROFILE": "production",
    "LOBBY_TICKET_SECRET": PROD_SECRET,
    "LOBBY_TICKET_TTL_SEC": "60",
    "LOBBY_BETA_LIST_PATH": "/srv/lobby/lobby_beta_users.txt",
}


def _reasons(
    environ: dict[str, str], local_file: Path | None = None
) -> tuple[str, ...]:
    state = load_state(environ, local_file or Path("/nonexistent/.env.lobby"))
    return state.reasons


def test_production_with_good_settings_is_enabled():
    state = load_state(GOOD_PRODUCTION, Path("/nonexistent/.env.lobby"))
    assert state.enabled
    assert state.config is not None
    assert state.config.profile == "production"
    assert state.config.ttl_sec == 60
    assert PROD_SECRET not in repr(state)


def test_missing_profile_means_production():
    environ = {
        key: value
        for key, value in GOOD_PRODUCTION.items()
        if key != "WAEGOK_RUN_PROFILE"
    }
    state = load_state(environ, Path("/nonexistent/.env.lobby"))
    assert state.config is not None and state.config.profile == "production"
    # 기본값이 production 이라 시험용 TTL 은 막힌다
    assert any(
        r.startswith("LOBBY_TICKET_TTL_SEC")
        for r in _reasons({**environ, "LOBBY_TICKET_TTL_SEC": "3"})
    )


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"WAEGOK_RUN_PROFILE": "staging"}, "WAEGOK_RUN_PROFILE"),
        ({"LOBBY_TICKET_TTL_SEC": "3"}, "LOBBY_TICKET_TTL_SEC"),
        ({"LOBBY_TICKET_TTL_SEC": "abc"}, "LOBBY_TICKET_TTL_SEC"),
        ({"LOBBY_TICKET_TTL_SEC": None}, "LOBBY_TICKET_TTL_SEC"),
        ({"LOBBY_LOADTEST_IP_EXEMPT": "1"}, "LOBBY_LOADTEST_IP_EXEMPT"),
        ({"LOBBY_LOADTEST_IP_EXEMPT": "yes"}, "LOBBY_LOADTEST_IP_EXEMPT"),
        ({"LOBBY_BETA_LIST_PATH": None}, "LOBBY_BETA_LIST_PATH"),
        ({"LOBBY_TICKET_SECRET": None}, "LOBBY_TICKET_SECRET"),
        ({"LOBBY_TICKET_SECRET": "short"}, "LOBBY_TICKET_SECRET"),
        ({"LOBBY_TICKET_SECRET": "dev-" + "x" * 40}, "LOBBY_TICKET_SECRET"),
        ({"LOBBY_ENV": "test"}, "LOBBY_ENV"),
    ],
)
def test_production_start_check_disables_issuance_only(override, field):
    environ = {**GOOD_PRODUCTION, **override}
    environ = {key: value for key, value in environ.items() if value is not None}
    reasons = _reasons(environ)
    assert any(reason.startswith(field) for reason in reasons), reasons
    # 실패 사유에 비밀값이 들어가지 않는다
    assert all(
        "x" * 40 not in reason and PROD_SECRET not in reason for reason in reasons
    )


def test_production_never_opens_the_local_file(tmp_path):
    local = tmp_path / ".env.lobby"
    local.write_text(
        "LOBBY_TICKET_SECRET="
        + PROD_SECRET
        + "\nLOBBY_TICKET_TTL_SEC=60\nLOBBY_BETA_LIST_PATH=x.txt\n",
        encoding="utf-8",
    )
    # 파일에 값이 다 있어도 production 은 환경만 본다
    reasons = _reasons({"WAEGOK_RUN_PROFILE": "production"}, local)
    assert any(reason.startswith("LOBBY_TICKET_SECRET") for reason in reasons)


def test_test_profile_reads_env_first_then_local_file_and_ignores_profile_key(tmp_path):
    local = tmp_path / ".env.lobby"
    local.write_text(
        "WAEGOK_RUN_PROFILE=production\nLOBBY_TICKET_SECRET=from-file\nLOBBY_TICKET_TTL_SEC=3\n"
        "LOBBY_BETA_LIST_PATH=data/list.txt\n",
        encoding="utf-8",
    )
    state = load_state(
        {"WAEGOK_RUN_PROFILE": "test", "LOBBY_TICKET_SECRET": "dev-from-env"}, local
    )
    assert state.config is not None
    assert state.config.profile == "test"
    assert state.config.secret == b"dev-from-env"
    assert state.config.ttl_sec == 3
    assert state.config.beta_list_path == lobby_config.BACKEND_ROOT / "data/list.txt"


def test_profile_key_in_local_file_cannot_switch_profile(tmp_path):
    local = tmp_path / ".env.lobby"
    local.write_text(
        "WAEGOK_RUN_PROFILE=test\nLOBBY_TICKET_TTL_SEC=3\n", encoding="utf-8"
    )
    state = load_state(GOOD_PRODUCTION, local)
    assert state.config is not None and state.config.profile == "production"
    assert state.config.ttl_sec == 60


def test_loader_failure_never_raises(monkeypatch, tmp_path):
    local = tmp_path / ".env.lobby"
    local.write_text("LOBBY_TICKET_SECRET=x\n", encoding="utf-8")

    def broken(_path):
        raise PermissionError("no")

    monkeypatch.setattr(lobby_config, "dotenv_values", broken)
    state = load_state({"WAEGOK_RUN_PROFILE": "test"}, local)
    assert not state.enabled
    assert state.reasons and "PermissionError" in state.reasons[0]


def test_main_settings_does_not_know_lobby_keys():
    # 로비 값은 본편 Settings 필드가 아니다 — 공유 .env 에 넣으면 본편이 뜨지 않으므로 넣지 않는다(3.3.3절)
    assert not any(name.lower().startswith("lobby_") for name in Settings.model_fields)
