"""로비 입장권 발급 — 모집 명단 · 발급 빈도 제한 · 서명(로비 설계 v0.19 2.1 · 2.2 · 3절).

- 명단: 한 줄에 계정 ID 하나, 빈 줄 · `#` 줄은 건너뛴다, `loadtest:<계정 ID>`는 시험 계정. 요청마다 파일이 바뀌었는지
  확인하고 새 명단을 읽는다(운영자는 같은 폴더에 임시 파일을 쓰고 `mv`로 바꿔 끼운다). 파일이 없거나 · 비었거나 ·
  읽기 · 해석에 실패하면 발급하지 않고 원인을 운영 로그에 남긴다. 명단 내용(계정 ID)은 로그에 남기지 않는다.
- 발급 제한: 최근 60초 동안 계정당 10회 · IP당 60회(🟡 시작값). 두 한도를 함께 보고 허용된 요청만 센다. 이 프로세스
  메모리에만 둔다 — 베타의 FastAPI 는 uvicorn 워커 1개다. 확인과 기록 사이에 await 이 없어 동시 요청도 한도를 나눠 쓴다.
- 티켓: HS256 JWT `{sub, nickname, aud="waegok-lobby", jti, iat, exp=iat+TTL}`. 원문은 로그에 남기지 않는다.
"""

from __future__ import annotations

import logging
import math
import os
import secrets
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import jwt

from app.services.lobby_config import LobbyIssuerConfig

logger = logging.getLogger(__name__)

TICKET_AUDIENCE = "waegok-lobby"
LOADTEST_PREFIX = "loadtest:"
RATE_WINDOW_SEC = 60.0
ACCOUNT_LIMIT = 10
IP_LIMIT = 60


# --- 모집 명단 ---


ALL_ACCOUNTS = "*"
"""명단에 이 한 줄이 있으면 로그인한 계정 전부를 받는다."""


@dataclass(frozen=True)
class BetaMembership:
    eligible: bool
    loadtest: bool


class BetaListUnavailable(Exception):
    """명단을 쓸 수 없다(없음 · 빔 · 읽기 · 해석 실패). 발급하지 않는다(503)."""


@dataclass(frozen=True)
class _Snapshot:
    signature: tuple[int, int, int]
    accounts: frozenset[str]
    loadtest: frozenset[str]


def parse_beta_list(text: str) -> tuple[frozenset[str], frozenset[str]]:
    """(일반 계정, 시험 계정). 형식이 틀린 줄이 있거나 계정이 하나도 없으면 ValueError.

    `*` 한 줄 = 로그인한 계정 전부(11/8 미르: 베타는 로그인한 사람 모두 로비에). 일반 계정 집합에 `*` 로 담긴다.
    """

    accounts: set[str] = set()
    loadtest: set[str] = set()
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if any(ch.isspace() for ch in line):
            raise ValueError(f"{number}번째 줄에 공백이 있다")
        if line.startswith(LOADTEST_PREFIX):
            account = line[len(LOADTEST_PREFIX) :]
            if not account:
                raise ValueError(f"{number}번째 줄의 loadtest: 뒤가 비었다")
            loadtest.add(account)
        else:
            accounts.add(line)
    if not accounts and not loadtest:
        raise ValueError("계정이 하나도 없다")
    return frozenset(accounts), frozenset(loadtest)


class BetaList:
    """요청 때마다 파일이 바뀌었는지(크기 · 수정 시각 · inode) 보고 바뀌었으면 다시 읽는다."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._snapshot: _Snapshot | None = None
        self._failure: tuple[tuple[int, int, int] | None, str] | None = None

    def _fail(
        self, signature: tuple[int, int, int] | None, reason: str
    ) -> BetaListUnavailable:
        if self._failure != (signature, reason):
            # 같은 원인을 요청마다 되풀이해 적지 않는다
            logger.warning("lobby beta list unavailable: %s", reason)
            self._failure = (signature, reason)
        self._snapshot = None
        return BetaListUnavailable(reason)

    def lookup(self, account_id: str) -> BetaMembership:
        try:
            stat = os.stat(self.path)
        except OSError as error:
            raise self._fail(
                None, f"명단 파일을 찾지 못했다({type(error).__name__})"
            ) from None
        signature = (stat.st_size, stat.st_mtime_ns, stat.st_ino)
        snapshot = self._snapshot
        if snapshot is None or snapshot.signature != signature:
            try:
                text = self.path.read_text(encoding="utf-8")
                accounts, loadtest = parse_beta_list(text)
            except (OSError, UnicodeDecodeError) as error:
                raise self._fail(
                    signature, f"명단 파일을 읽지 못했다({type(error).__name__})"
                ) from None
            except ValueError as error:
                raise self._fail(signature, f"명단 형식 오류: {error}") from None
            snapshot = _Snapshot(signature, accounts, loadtest)
            self._snapshot = snapshot
            if self._failure is not None:
                logger.info("lobby beta list readable again")
            self._failure = None
        in_loadtest = account_id in snapshot.loadtest
        return BetaMembership(
            eligible=ALL_ACCOUNTS in snapshot.accounts
            or account_id in snapshot.accounts
            or in_loadtest,
            loadtest=in_loadtest,
        )


_beta_lists: dict[Path, BetaList] = {}


def get_beta_list(path: Path) -> BetaList:
    beta_list = _beta_lists.get(path)
    if beta_list is None:
        beta_list = BetaList(path)
        _beta_lists[path] = beta_list
    return beta_list


# --- 발급 빈도 제한 ---


class IssueRateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._accounts: dict[str, deque[float]] = {}
        self._ips: dict[str, deque[float]] = {}
        self._calls = 0

    @staticmethod
    def _recent(table: dict[str, deque[float]], key: str, now: float) -> deque[float]:
        times = table.setdefault(key, deque())
        while times and times[0] <= now - RATE_WINDOW_SEC:
            times.popleft()
        return times

    @staticmethod
    def _wait(times: deque[float], now: float) -> int:
        """한도가 찼을 때 다음 발급까지 남은 초(올림, 최소 1)."""

        return max(1, math.ceil(times[0] + RATE_WINDOW_SEC - now))

    def try_acquire(self, account_id: str, ip: str, ip_exempt: bool = False) -> int:
        """허용하면 0 을 돌려주고 센다. 넘으면 Retry-After 초를 돌려주고 세지 않는다."""

        now = self._clock()
        self._calls += 1
        if self._calls % 1000 == 0:
            self._sweep(now)
        account_times = self._recent(self._accounts, account_id, now)
        ip_times = self._recent(self._ips, ip, now)
        wait = 0
        if len(account_times) >= ACCOUNT_LIMIT:
            wait = self._wait(account_times, now)
        if not ip_exempt and len(ip_times) >= IP_LIMIT:
            wait = max(wait, self._wait(ip_times, now))
        if wait:
            return wait
        account_times.append(now)
        if not ip_exempt:
            ip_times.append(now)
        return 0

    def _sweep(self, now: float) -> None:
        for table in (self._accounts, self._ips):
            for key in [
                key
                for key, times in table.items()
                if not times or times[-1] <= now - RATE_WINDOW_SEC
            ]:
                del table[key]


_rate_limiter = IssueRateLimiter()


def get_issue_rate_limiter() -> IssueRateLimiter:
    return _rate_limiter


# --- 서명 ---


def issue_ticket(
    config: LobbyIssuerConfig, account_id: str, nickname: str, now: float | None = None
) -> str:
    issued_at = int(time.time() if now is None else now)
    payload = {
        "sub": account_id,
        "nickname": nickname,
        "aud": TICKET_AUDIENCE,
        "jti": secrets.token_urlsafe(16),
        "iat": issued_at,
        "exp": issued_at + config.ttl_sec,
    }
    return jwt.encode(payload, config.secret, algorithm="HS256")
