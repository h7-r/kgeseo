"""hint_ref 발급 · 검증 v0.1 (PM: `suggest_hint: {hint_ref}`, 공개 puzzle_id를 따로 만들지 않음).

- `hint_ref = "hr1.<key id>.<base64url(HMAC-SHA-256)>"`. HMAC 입력은 도메인 ‖ play_session_id ‖ puzzle_id ‖
  content_fingerprint이고, **토큰 안에 puzzle_id를 넣지 않는다**(태그만 있다). 키 없이는 어느 퍼즐인지 알 수 없다.
- 검증은 세션이 고정한 콘텐츠의 퍼즐마다 같은 값을 계산해 상수 시간 비교로 찾는다(케이스당 퍼즐 수십 개 이하).
  다른 세션 · 다른 fingerprint · 위조는 모두 `HintRefMismatchError`(409)다. 형식 오류는 `HintRefFormatError`(422).
- 같은 세션 · 같은 퍼즐 · 같은 fingerprint면 값이 같다(재전송 응답도 같다).
- key id를 함께 실어 키를 바꿔도 이전 ref를 검증한다. 모르는 key id는 설정 오류(`HintRefKeyUnavailableError`).
- Hint API(HTTP)는 아직 연결하지 않았다. 이벤트 로그에는 내부 puzzle_id를 기록한다(PM).
"""

import base64
import hashlib
import hmac
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

HINT_REF_VERSION = "hr1"
HINT_REF_DOMAIN = b"kgeseo/hint-ref/v1"
MIN_KEY_BYTES = 32
KEY_ID_PATTERN = re.compile(r"^[a-z0-9]{1,16}$")
_REF_PATTERN = re.compile(r"^hr1\.([a-z0-9]{1,16})\.([A-Za-z0-9_-]{43})$")


class HintRefError(Exception):
    """오류에는 ref 값 · 퍼즐 ID를 싣지 않는다."""


class HintRefFormatError(HintRefError):
    pass


class HintRefMismatchError(HintRefError):
    pass


class HintRefKeyUnavailableError(HintRefError):
    pass


@dataclass(frozen=True)
class HintRefKeys:
    current_id: str
    keys: Mapping[str, bytes]

    def __post_init__(self) -> None:
        if self.current_id not in self.keys:
            raise ValueError("current key id must be in keys")
        for key_id, secret in self.keys.items():
            if not KEY_ID_PATTERN.fullmatch(key_id):
                raise ValueError("key id must be 1-16 lowercase letters or digits")
            if not isinstance(secret, bytes) or len(secret) < MIN_KEY_BYTES:
                raise ValueError("hint_ref key must be at least 32 bytes")


def _tag(secret: bytes, play_session_id: str, puzzle_id: str, fingerprint: str) -> str:
    message = b"\x00".join(
        (
            HINT_REF_DOMAIN,
            play_session_id.encode("utf-8"),
            puzzle_id.encode("utf-8"),
            fingerprint.encode("utf-8"),
        )
    )
    digest = hmac.new(secret, message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def issue_hint_ref(
    keys: HintRefKeys,
    *,
    play_session_id: str,
    puzzle_id: str,
    content_fingerprint: str,
) -> str:
    tag = _tag(
        keys.keys[keys.current_id], play_session_id, puzzle_id, content_fingerprint
    )
    return f"{HINT_REF_VERSION}.{keys.current_id}.{tag}"


def resolve_hint_ref(
    keys: HintRefKeys,
    hint_ref: str,
    *,
    play_session_id: str,
    content_fingerprint: str,
    puzzle_ids: Iterable[str],
) -> str:
    """세션 · 고정 콘텐츠에 맞는 내부 puzzle_id. 맞는 퍼즐이 없으면 `HintRefMismatchError`."""

    match = _REF_PATTERN.fullmatch(hint_ref) if isinstance(hint_ref, str) else None
    if match is None:
        raise HintRefFormatError()
    key_id, tag = match.groups()
    secret = keys.keys.get(key_id)
    if secret is None:
        raise HintRefKeyUnavailableError()
    found: str | None = None
    for puzzle_id in puzzle_ids:
        expected = _tag(secret, play_session_id, puzzle_id, content_fingerprint)
        if hmac.compare_digest(expected, tag):
            found = puzzle_id
    if found is None:
        raise HintRefMismatchError()
    return found
