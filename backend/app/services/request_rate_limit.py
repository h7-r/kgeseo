"""IP 기준 요청 빈도 제한(베타 전 보안 PR B, 11/11 미르 확정).

| 규칙 | API | 기본 한도 |
|---|---|---|
| `email_exists` | POST /api/v1/auth/email-exists | IP 당 60초에 30회 |
| `nickname_exists` | POST /api/v1/auth/nickname-exists | IP 당 60초에 30회 |
| `register` | POST /api/v1/auth/register | IP 당 60초에 30회(베타. 종료 뒤 10회 예정) |
| `anonymous_session_create` | POST /api/v1/anonymous-sessions (새 게스트를 만들 때만) | IP 당 60초에 60회 |
| `beta_events` | POST /api/v1/beta-events (베타 분석 기록, 11/11) | IP 당 60초에 1500회 |

- 규칙마다 · IP 마다 따로 센다. 한 API 를 다 써도 다른 API 는 그대로다.
- 한도와 창은 환경 변수(`RATE_LIMIT_*`)로 바꿀 수 있다. 값이 없으면 위 기본값이고, 0 · 음수 · 숫자가 아닌 값은
  설정 로딩에서 거부된다 — 설정이 빠졌다고 제한이 꺼지지 않는다. `APP_ENV`와 상관없이 항상 켜져 있다.
- IP 는 Uvicorn 이 판별한 `request.client.host`만 쓴다. Uvicorn 은 `--forwarded-allow-ips`(기본 127.0.0.1)로
  믿는 프록시(운영 Caddy → 127.0.0.1:8000)에서 온 연결일 때만 `X-Forwarded-For`를 오른쪽부터 읽어 실제 주소를
  정한다. 그 밖의 연결이 보낸 `X-Forwarded-For`는 무시된다. 여기서 헤더 원문을 직접 읽지 않는다.
- 저장: 이 프로세스 메모리의 최근 60초 시각 목록(슬라이딩 창). 확인과 기록 사이에 `await`이 없어 한 이벤트 루프
  안의 동시 요청도 한도를 넘지 못한다. **워커가 여러 개면 워커마다 따로 센다**(한도 × 워커 수). 베타의 API 는
  Uvicorn 워커 1개다(로비 입장권 제한과 같은 전제). 워커를 늘릴 때는 DB 공유 카운터로 바꾼다.
- 허용된 요청만 센다. 막힌 요청(429)은 세지 않으므로 `Retry-After`가 지나면 반드시 다시 허용된다.
"""

from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from app.core.config import settings

EMAIL_EXISTS = "email_exists"
NICKNAME_EXISTS = "nickname_exists"
REGISTER = "register"
ANONYMOUS_SESSION_CREATE = "anonymous_session_create"
BETA_EVENTS = "beta_events"
INQUIRY_CREATE = "inquiry_create"

RATE_LIMITED_CODE = "rate_limited"
RATE_LIMITED_MESSAGE = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_sec: int


def configured_rule(name: str) -> RateLimitRule:
    """지금 설정의 규칙. 요청마다 읽는다(테스트 · 설정 교체가 바로 반영된다)."""

    limits = {
        EMAIL_EXISTS: settings.rate_limit_email_exists,
        NICKNAME_EXISTS: settings.rate_limit_nickname_exists,
        REGISTER: settings.rate_limit_register,
        ANONYMOUS_SESSION_CREATE: settings.rate_limit_anonymous_session_create,
        BETA_EVENTS: settings.rate_limit_beta_events,
        INQUIRY_CREATE: settings.rate_limit_inquiry_create,
    }
    # 문의 접수만 창이 길다(10분) — 나머지는 공용 창
    window = (
        settings.rate_limit_inquiry_window_sec
        if name == INQUIRY_CREATE
        else settings.rate_limit_window_sec
    )
    return RateLimitRule(name, limits[name], window)


class SlidingWindowLimiter:
    """(규칙, IP)마다 최근 창 안의 허용 시각을 둔다. 한 키의 목록은 한도보다 길어지지 않는다."""

    SWEEP_EVERY = 1000

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._windows: dict[str, int] = {}
        self._calls = 0

    def try_acquire(self, rule: RateLimitRule, ip: str) -> int:
        """허용하면 0 을 돌려주고 센다. 한도가 찼으면 다음 허용까지 남은 초(올림, 1 이상)를 돌려주고 세지 않는다."""

        now = self._clock()
        self._windows[rule.name] = rule.window_sec
        self._calls += 1
        if self._calls % self.SWEEP_EVERY == 0:
            self._sweep(now)
        times = self._hits.setdefault((rule.name, ip), deque())
        while times and times[0] <= now - rule.window_sec:
            times.popleft()
        if len(times) >= rule.limit:
            # 한도를 줄인 직후에는 목록이 한도보다 길 수 있다 — 한도 안으로 들어오는 시각을 기다린다
            return max(1, math.ceil(times[-rule.limit] + rule.window_sec - now))
        times.append(now)
        return 0

    def _sweep(self, now: float) -> None:
        stale = [
            key
            for key, times in self._hits.items()
            if not times or times[-1] <= now - self._windows.get(key[0], 0)
        ]
        for key in stale:
            del self._hits[key]


_limiter = SlidingWindowLimiter()


def get_request_rate_limiter() -> SlidingWindowLimiter:
    return _limiter


def client_ip(request: Request) -> str:
    """Uvicorn 이 판별한 주소(신뢰 프록시 처리 뒤). `X-Forwarded-For` 원문은 읽지 않는다."""

    return request.client.host if request.client else "unknown"


def enforce_rate_limit(
    limiter: SlidingWindowLimiter, rule_name: str, request: Request
) -> None:
    """한도를 넘었으면 429 `rate_limited` + `Retry-After`. `await` 없이 확인 · 기록한다(동시 요청 원자성)."""

    retry_after = limiter.try_acquire(configured_rule(rule_name), client_ip(request))
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "message": RATE_LIMITED_MESSAGE},
            headers={"Cache-Control": "no-store", "Retry-After": str(retry_after)},
        )


def limit_by_ip(rule_name: str):
    """라우트 의존성. `async def`여야 한다 — 일반 함수 의존성은 스레드 풀에서 돌아 확인 · 기록이 겹칠 수 있다."""

    configured_rule(rule_name)  # 없는 규칙 이름이면 앱을 만들 때 바로 실패한다

    async def dependency(
        request: Request,
        limiter: SlidingWindowLimiter = Depends(get_request_rate_limiter),
    ) -> None:
        enforce_rate_limit(limiter, rule_name, request)

    return dependency
