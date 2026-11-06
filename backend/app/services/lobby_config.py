"""로비 입장권 발급 설정 — 본편 `Settings`와 분리한다(로비 설계 v0.19 3.3절).

본편 `Settings`(pydantic-settings)는 공유 `.env`에 모르는 키가 값과 함께 있으면 거부한다. 그래서 로비 값은
공유 `.env`에 두지 않고, 이 로더가 따로 읽고 · 숫자로 바꾸고 · 실행 프로필을 검사한다. 실패하면 **입장권 발급만**
끄고(503) 본편은 그대로 뜬다. 이 모듈은 어떤 경우에도 예외를 밖으로 던지지 않는다.

- 실행 프로필: 실행 시점의 프로세스 환경 `WAEGOK_RUN_PROFILE`(production | test). 없으면 production.
  운영 systemd 유닛의 `ExecStart` 줄에 `env WAEGOK_RUN_PROFILE=production uvicorn …`으로 적는다.
- 읽는 경로: production은 프로세스 환경만 읽고 `backend/.env.lobby`를 직접 열지 않는다(systemd
  `EnvironmentFile=-…/backend/.env.lobby`가 root 권한으로 읽어 넣는다). test는 프로세스 환경을 먼저 보고,
  없는 항목만 `backend/.env.lobby`에서 채운다. 어느 경우든 그 파일의 `WAEGOK_RUN_PROFILE`은 무시한다.
- 로그에는 항목과 이유, 발급 활성 여부만 남긴다. 비밀값 · 원본 설정은 남기지 않는다.
"""

from __future__ import annotations

import io
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv.parser import parse_stream

logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
LOCAL_LOBBY_ENV_FILE = BACKEND_ROOT / ".env.lobby"

PROFILE_ENV_KEY = "WAEGOK_RUN_PROFILE"
PROFILES = ("production", "test")
PRODUCTION_TTL_SEC = 60
MIN_SECRET_BYTES = 32
DEV_SECRET_PREFIX = "dev-"


@dataclass(frozen=True)
class LobbyIssuerConfig:
    profile: str
    secret: bytes = field(repr=False)
    ttl_sec: int
    beta_list_path: Path
    loadtest_ip_exempt: bool


@dataclass(frozen=True)
class LobbyIssuerState:
    """발급 가능 여부. 꺼졌으면 `reasons`에 항목과 이유만 있다."""

    config: LobbyIssuerConfig | None
    reasons: tuple[str, ...] = ()

    @property
    def enabled(self) -> bool:
        return self.config is not None


def read_profile(environ: Mapping[str, str]) -> str | None:
    """실행 프로필. 알 수 없는 값이면 None."""

    value = (environ.get(PROFILE_ENV_KEY) or "").strip()
    if not value:
        return "production"
    return value if value in PROFILES else None


class LobbyConfigError(Exception):
    """로비 전용 파일을 해석하지 못했다(항목 · 줄 번호만, 값은 담지 않는다)."""


def _parse_local_file(text: str) -> dict[str, str]:
    """python-dotenv 의 해석기로 읽되, 형식이 틀린 줄을 경고만 하고 넘기지 않는다."""

    values: dict[str, str] = {}
    for binding in parse_stream(io.StringIO(text)):
        if binding.error:
            raise LobbyConfigError(
                f"backend/.env.lobby: {binding.original.line}번째 줄 형식이 틀렸다"
            )
        if binding.key is not None and binding.value is not None:
            values[binding.key] = binding.value
    return values


def collect_settings(
    profile: str, environ: Mapping[str, str], local_file: Path = LOCAL_LOBBY_ENV_FILE
) -> dict[str, str]:
    settings = {
        key: value for key, value in environ.items() if key.startswith("LOBBY_")
    }
    # 파일이 없는 것만 「없음」. 있는데 못 읽거나(권한 · 디렉터리) 형식이 틀리면 예외 → 발급만 끈다
    if profile != "test" or not local_file.exists():
        return settings
    text = local_file.read_text(encoding="utf-8")
    for key, value in _parse_local_file(text).items():
        if key == PROFILE_ENV_KEY or not key.startswith("LOBBY_"):
            continue
        settings.setdefault(key, value)
    return settings


def _parse_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text.lstrip("-").isdigit():
        return None
    return int(text)


def build_state(profile: str | None, settings: Mapping[str, str]) -> LobbyIssuerState:
    if profile is None:
        return LobbyIssuerState(
            None, (f"{PROFILE_ENV_KEY}: production 또는 test 만 쓸 수 있다",)
        )
    reasons: list[str] = []
    production = profile == "production"

    declared = (settings.get("LOBBY_ENV") or "").strip()
    if declared and declared != profile:
        reasons.append("LOBBY_ENV: 실행 프로필과 다르다")

    secret_text = settings.get("LOBBY_TICKET_SECRET") or ""
    secret = secret_text.encode("utf-8")
    if not secret:
        reasons.append("LOBBY_TICKET_SECRET: 없다")
    elif production and secret_text.startswith(DEV_SECRET_PREFIX):
        reasons.append("LOBBY_TICKET_SECRET: 운영에서 개발 키(dev-)를 쓸 수 없다")
    elif production and len(secret) < MIN_SECRET_BYTES:
        reasons.append(
            f"LOBBY_TICKET_SECRET: 운영 키는 {MIN_SECRET_BYTES}바이트 이상이어야 한다"
        )

    ttl_raw = settings.get("LOBBY_TICKET_TTL_SEC")
    ttl = (
        PRODUCTION_TTL_SEC
        if ttl_raw is None and not production
        else _parse_int(ttl_raw)
    )
    if ttl is None or ttl < 1:
        reasons.append("LOBBY_TICKET_TTL_SEC: 1 이상 정수가 아니다")
    elif production and ttl != PRODUCTION_TTL_SEC:
        reasons.append(f"LOBBY_TICKET_TTL_SEC: 운영은 {PRODUCTION_TTL_SEC}이어야 한다")

    exempt_raw = (settings.get("LOBBY_LOADTEST_IP_EXEMPT") or "").strip()
    if exempt_raw not in ("", "0", "1"):
        reasons.append("LOBBY_LOADTEST_IP_EXEMPT: 0 또는 1 이어야 한다")
    exempt = exempt_raw == "1"
    if production and exempt:
        reasons.append("LOBBY_LOADTEST_IP_EXEMPT: 운영 프로필에서 켤 수 없다")

    list_raw = (settings.get("LOBBY_BETA_LIST_PATH") or "").strip()
    if not list_raw:
        reasons.append("LOBBY_BETA_LIST_PATH: 없다")
    list_path = Path(list_raw)
    if not list_path.is_absolute():
        list_path = BACKEND_ROOT / list_path

    if reasons:
        return LobbyIssuerState(None, tuple(reasons))
    return LobbyIssuerState(
        LobbyIssuerConfig(
            profile=profile,
            secret=secret,
            ttl_sec=ttl,  # type: ignore[arg-type]
            beta_list_path=list_path,
            loadtest_ip_exempt=exempt,
        )
    )


def load_state(
    environ: Mapping[str, str] | None = None, local_file: Path = LOCAL_LOBBY_ENV_FILE
) -> LobbyIssuerState:
    """환경에서 설정을 읽어 검사한다. 무슨 일이 있어도 예외를 던지지 않는다."""

    try:
        env = os.environ if environ is None else environ
        profile = read_profile(env)
        settings = collect_settings(profile, env, local_file) if profile else {}
        return build_state(profile, settings)
    except LobbyConfigError as error:
        return LobbyIssuerState(None, (str(error),))
    except Exception as error:  # noqa: BLE001 — 로더 실패는 발급만 끈다
        return LobbyIssuerState(
            None, (f"로비 설정을 읽지 못했다({type(error).__name__})",)
        )


@lru_cache(maxsize=1)
def get_lobby_issuer_state() -> LobbyIssuerState:
    """프로세스당 한 번 읽는다. 서버 시작 때 불러 결과를 로그에 남긴다(FastAPI 의존성으로도 쓴다)."""

    state = load_state()
    if state.enabled and state.config is not None:
        logger.info("lobby ticket issuance enabled (profile=%s)", state.config.profile)
    else:
        logger.warning("lobby ticket issuance disabled: %s", " | ".join(state.reasons))
    return state
