"""관리자 감사 기록(`admin_audit_logs`)의 요청 정보 · 대상 표기(11/16 세진, 계약 `docs/contracts/admin_audit_log_ext.md`).

- 요청 정보(IP · User-Agent)는 관리자 라우터 공통 의존성 `capture_audit_request` 가 요청마다 한 번 잡아 두고,
  `_audit()` 가 쓸 때 읽는다. 그래서 기존 `_audit()` 호출부는 고치지 않아도 새 열이 채워진다.
- IP 는 Uvicorn 이 판별한 `request.client.host` 만 쓴다(`request_rate_limit.client_ip` 와 같은 규칙). Uvicorn 은
  `--forwarded-allow-ips` 에 든 믿는 프록시(운영 Caddy)에서 온 연결일 때만 `X-Forwarded-For` 를 반영한다.
  여기서 `X-Forwarded-For` · `X-Real-IP` 원문을 직접 읽지 않는다. IP 주소 모양이 아니면(시험 클라이언트 등) 저장하지 않는다.
- User-Agent 는 앞 512자만, 제어 문자는 공백으로 바꿔 저장한다. 없으면 NULL.
- 대상 표기(`target_type` · `target_id`)는 열람 · 변경한 「대상 물건」이다. `target_user_id` 는 그와 별개로 「개인정보가 보인 회원」
  그대로 둔다(기존 의미 · 기존 필터 유지).
"""

import ipaddress
from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID

from fastapi import Request

USER_AGENT_MAX_LENGTH = 512
TARGET_ID_MAX_LENGTH = 64

# 대상 종류 — 늘릴 때는 계약 문서와 함께 늘린다
#   user(회원 id) · inquiry(문의 id) · setting(설정 키) · notice(공지 UUID, 11/16 — 공지 생성 · 수정 · 삭제)
AUDIT_TARGET_TYPES = frozenset({"user", "inquiry", "setting", "notice"})
# id 가 UUID 표준 표기(소문자 36자)여야 하는 종류 — 공지는 처음부터 UUID 로 정했다(계약 §3)
UUID_TARGET_TYPES = frozenset({"notice"})


@dataclass(frozen=True)
class AuditRequestInfo:
    client_ip: str | None
    user_agent: str | None


_EMPTY = AuditRequestInfo(client_ip=None, user_agent=None)
_current: ContextVar[AuditRequestInfo] = ContextVar(
    "admin_audit_request", default=_EMPTY
)


def normalize_client_ip(host: str | None) -> str | None:
    """IPv4 · IPv6 주소만 표준 표기로. 그 밖(`testclient` · 빈 값 · 이상한 글자)은 None."""

    if not host:
        return None
    try:
        return str(ipaddress.ip_address(host.strip()))
    except ValueError:
        return None


def normalize_user_agent(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = "".join(
        " " if ord(ch) < 32 or ord(ch) == 127 else ch for ch in value
    ).strip()
    return cleaned[:USER_AGENT_MAX_LENGTH] or None


def request_info(request: Request) -> AuditRequestInfo:
    host = request.client.host if request.client else None
    return AuditRequestInfo(
        client_ip=normalize_client_ip(host),
        user_agent=normalize_user_agent(request.headers.get("user-agent")),
    )


async def capture_audit_request(request: Request) -> None:
    """관리자 라우터 공통 의존성. async 여야 한다 — 같은 작업(task) 안에서 이어지는 엔드포인트가 이 값을 본다
    (sync 의존성은 스레드풀의 복사된 문맥에서 돌아 값이 엔드포인트로 넘어오지 않는다)."""

    _current.set(request_info(request))


def current_request_info() -> AuditRequestInfo:
    return _current.get()


def check_target(target_type: str | None, target_id: str | None) -> None:
    """대상 표기는 둘 다 주거나 둘 다 비운다. 종류는 정해 둔 값만. 어기면 부른 코드의 실수다(ValueError)."""

    if (target_type is None) != (target_id is None):
        raise ValueError("target_type and target_id must be given together.")
    if target_type is None:
        return
    if target_type not in AUDIT_TARGET_TYPES:
        raise ValueError(f"unknown audit target_type: {target_type}")
    if (
        not isinstance(target_id, str)
        or not target_id
        or len(target_id) > TARGET_ID_MAX_LENGTH
    ):
        raise ValueError(
            "target_id must be a non-empty string of at most 64 characters."
        )
    if target_type in UUID_TARGET_TYPES and not _is_canonical_uuid(target_id):
        raise ValueError(f"{target_type} target_id must be a canonical UUID.")


def _is_canonical_uuid(value: str) -> bool:
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False
