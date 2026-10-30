"""힌트 잔액 설정 · 잔액 부족 오류 · hint_ref 발급 키 설정 v0.1 (PM v0.4.8 §4 · v0.4.9 §7 · §9).

- 잔액을 바꾸는 곳은 Hint 서비스(`app.services.hint.unlock_hint`)뿐이다. 이 모듈은 값과 설정만 다룬다.
- 숫자(최초 지급 N · 회차당 미니게임 수)는 하드코딩하지 않고 앱 설정(`app.core.config.Settings`)에서 읽는다.
- 미니게임 충전 API는 아직 없다(미니게임 계약 v0.1 대기). 그래서 「남은 미니게임 수」는 지금 회차당 설정값
  그대로이고, 특별 미니게임은 재미 미니게임을 다 써야 열리므로 지금은 늘 False다. 충전 API가 생기면
  `minigame_allowance`가 회차의 사용 기록을 빼도록 바꾼다.
"""

import base64
import binascii
from dataclasses import dataclass

from app.services.hint_ref import HintRefKeys

HINT_BALANCE_EMPTY = "HINT_BALANCE_EMPTY"


@dataclass(frozen=True)
class HintEconomyConfig:
    initial_balance: int = 3
    fun_minigames_per_session: int = 2
    special_minigames_per_session: int = 1

    def __post_init__(self) -> None:
        for value in (
            self.initial_balance,
            self.fun_minigames_per_session,
            self.special_minigames_per_session,
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError("hint economy values must be non-negative integers")


def hint_economy_config() -> HintEconomyConfig:
    """앱 설정(환경 변수)에서 읽는다. FastAPI 의존성으로도 쓴다."""

    from app.core.config import settings

    return HintEconomyConfig(
        initial_balance=settings.hint_initial_balance,
        fun_minigames_per_session=settings.hint_fun_minigames_per_session,
        special_minigames_per_session=settings.hint_special_minigames_per_session,
    )


@dataclass(frozen=True)
class MinigameAllowance:
    minigames_left: int
    special_minigame_available: bool


def minigame_allowance(config: HintEconomyConfig) -> MinigameAllowance:
    """이번 회차에 남은 충전 수단. 충전 기록이 아직 없어 설정값 그대로다(모듈 설명 참고)."""

    left = config.fun_minigames_per_session
    return MinigameAllowance(
        minigames_left=left,
        special_minigame_available=left == 0
        and config.special_minigames_per_session > 0,
    )


class HintBalanceEmptyError(Exception):
    """잔액 0에서 새 힌트 단계를 요청했다. 상태 · 이벤트를 바꾸지 않는다(409 `HINT_BALANCE_EMPTY`)."""

    code = HINT_BALANCE_EMPTY

    def __init__(self, allowance: MinigameAllowance) -> None:
        super().__init__(HINT_BALANCE_EMPTY)
        self.allowance = allowance


class HintRefKeyConfigError(ValueError):
    """hint_ref 키 설정 형식이 잘못됐다. 메시지에 비밀 값을 싣지 않는다."""


def parse_hint_ref_keys(current_key_id: str, raw_keys: str) -> HintRefKeys | None:
    """`"<key id>:<base64url 비밀>[,...]"`를 읽는다. 둘 다 비어 있으면 None(발급하지 않음, fail closed).

    한쪽만 있거나 형식 · 길이(32바이트 이상)가 틀리면 설정 오류다. 조용히 None으로 바꾸지 않는다.
    """

    current_key_id = current_key_id.strip()
    raw_keys = raw_keys.strip()
    if not current_key_id and not raw_keys:
        return None
    if not current_key_id or not raw_keys:
        raise HintRefKeyConfigError(
            "both hint_ref current key id and keys are required"
        )
    keys: dict[str, bytes] = {}
    for entry in raw_keys.split(","):
        key_id, separator, encoded = entry.strip().partition(":")
        if not separator or not key_id or not encoded or key_id in keys:
            raise HintRefKeyConfigError("invalid hint_ref key entry")
        try:
            keys[key_id] = base64.b64decode(
                encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True
            )
        except (binascii.Error, ValueError) as error:
            raise HintRefKeyConfigError("invalid hint_ref key encoding") from error
    try:
        return HintRefKeys(current_key_id, keys)
    except ValueError as error:
        raise HintRefKeyConfigError("invalid hint_ref key set") from error


def hint_ref_keys_from_settings() -> HintRefKeys | None:
    from app.core.config import settings

    return parse_hint_ref_keys(
        settings.hint_ref_current_key_id, settings.hint_ref_keys.get_secret_value()
    )
