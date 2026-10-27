"""공식 콘텐츠 fingerprint 계산기 v0.1 (팀 검토 대기, 로더 · 세션 · 서비스에 연결하지 않음).

근거: NPC 콘텐츠 데이터 계약 v0.3 §6 · v0.4 §6(10/27).

    content_fingerprint = "sha256:" + sha256( canonical({"client": …, "server": …, "npc": …, "idmap": …}) )

- 각 값은 그 파일의 **본문** = 최상위 객체에서 머리 필드 `content_fingerprint` · `approvals` · `status` ·
  생성 시각을 뺀 것. idmap이 없는 케이스는 `"idmap"` 키를 빼고 계산한다(v0.4).
- canonical = JSON Canonicalization Scheme(RFC 8785). 외부 라이브러리 없이 RFC 본문대로 구현했다.
  - 입력은 I-JSON(RFC 7493)이어야 한다: 중복 키 · NaN/Infinity · 짝 없는 서로게이트 · BOM 거부,
    정수는 ±2^53 범위만(밖이면 IEEE 754 배정밀도로 바뀌어 구현마다 값이 갈린다).
  - 객체 키는 UTF-16 코드 단위 순으로 정렬, 공백 없음, 숫자는 ECMAScript Number→String 규칙,
    문자열은 JSON.stringify 이스케이프 규칙, UTF-8 출력. Unicode 정규화(NFC 등)는 하지 않는다.

[계약 미정 — 호출하는 쪽이 정하거나 계산하지 않음]
- 생성 시각 필드 이름: 계약에 이름이 없다. `generated_at_fields`로 반드시 넘겨야 한다(기본값 없음).
- npc 파일이 없는 케이스(`case_001` 등): 계약은 세 파일 게시만 말한다. 계산하지 않고 오류로 둔다.
- sha256 출력 표기: 계약은 `"sha256:" + sha256(...)`만 적었다. 소문자 16진수로 구현했고 확인이 필요하다.
- G3 `target_hash`: 승인 대상 산출물의 해시로, 이 fingerprint와 다른 값이다. 계산 대상이 정의되지 않아
  구현하지 않는다.

기존 `content_integrity`(파일 · 정규화 해시, 진단용)와 다르다. 그 해시는 공식 fingerprint가 아니다.
결과 · 오류에는 콘텐츠 내용을 담지 않는다.
"""

import hashlib
import hmac
import json
import math
from collections.abc import Collection, Mapping
from decimal import Decimal
from typing import Any

FINGERPRINT_PREFIX = "sha256:"
# v0.3 §6에 이름이 나온 머리 필드
NAMED_HEADER_FIELDS = frozenset({"content_fingerprint", "approvals", "status"})
# 배정밀도 실수로 정확히 나타낼 수 있는 정수 범위(I-JSON 권고)
MAX_SAFE_INTEGER = 2**53


class FingerprintError(Exception):
    """오류에는 역할 이름과 이유만 싣는다."""


class NonCanonicalJsonError(FingerprintError):
    pass


class MissingContentPartError(FingerprintError):
    pass


def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise NonCanonicalJsonError("duplicate key")
        result[key] = value
    return result


def _reject_constant(_: str) -> Any:
    raise NonCanonicalJsonError("non-finite number")


def parse_i_json(content: bytes) -> Any:
    """I-JSON으로 읽는다. 원본 바이트는 바꾸지 않는다."""

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise NonCanonicalJsonError("invalid UTF-8") from error
    if text.startswith(chr(0xFEFF)):
        raise NonCanonicalJsonError("byte order mark")
    try:
        return json.loads(
            text, object_pairs_hook=_reject_duplicates, parse_constant=_reject_constant
        )
    except json.JSONDecodeError as error:
        raise NonCanonicalJsonError("invalid JSON") from error


def _format_number(value: int | float) -> str:
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise NonCanonicalJsonError("integer outside I-JSON range")
        value = float(value)
    if not math.isfinite(value):
        raise NonCanonicalJsonError("non-finite number")
    if value == 0:
        return "0"  # -0도 "0"
    if value < 0:
        return "-" + _format_number(-value)

    # repr은 왕복 가능한 가장 짧은 십진 표현이다. 그 숫자열을 ECMAScript 규칙으로 다시 배치한다.
    _, digit_tuple, exponent = Decimal(repr(value)).as_tuple()
    digits = "".join(map(str, digit_tuple)).rstrip("0")
    exponent += len("".join(map(str, digit_tuple))) - len(digits)
    k = len(digits)
    n = exponent + k  # value = 0.<digits> × 10^n

    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    e = n - 1
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"


_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _format_string(value: str) -> str:
    out = ['"']
    for char in value:
        code = ord(char)
        if 0xD800 <= code <= 0xDFFF:
            raise NonCanonicalJsonError("lone surrogate")
        if char in _ESCAPES:
            out.append(_ESCAPES[char])
        elif code < 0x20:
            out.append(f"\\u{code:04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def _utf16_key(key: str) -> bytes:
    return key.encode("utf-16-be", "surrogatepass")


def _serialize(value: Any, out: list[str]) -> None:
    if value is None:
        out.append("null")
    elif value is True:
        out.append("true")
    elif value is False:
        out.append("false")
    elif isinstance(value, int | float):
        out.append(_format_number(value))
    elif isinstance(value, str):
        out.append(_format_string(value))
    elif isinstance(value, list | tuple):
        out.append("[")
        for index, item in enumerate(value):
            if index:
                out.append(",")
            _serialize(item, out)
        out.append("]")
    elif isinstance(value, Mapping):
        keys = list(value)
        if any(not isinstance(key, str) for key in keys):
            raise NonCanonicalJsonError("non-string key")
        out.append("{")
        for index, key in enumerate(sorted(keys, key=_utf16_key)):
            if index:
                out.append(",")
            out.append(_format_string(key))
            out.append(":")
            _serialize(value[key], out)
        out.append("}")
    else:
        raise NonCanonicalJsonError("unsupported value type")


def jcs_canonicalize(value: Any) -> bytes:
    """RFC 8785 정규 형식의 UTF-8 바이트. 입력 값을 바꾸지 않는다."""

    out: list[str] = []
    _serialize(value, out)
    return "".join(out).encode("utf-8")


def content_body(
    document: Any, *, role: str, generated_at_fields: Collection[str]
) -> dict[str, Any]:
    """최상위 객체에서 머리 필드를 뺀 새 dict(얕은 복사)."""

    if not isinstance(document, Mapping):
        raise NonCanonicalJsonError(f"{role}: top level must be an object")
    excluded = NAMED_HEADER_FIELDS | frozenset(generated_at_fields)
    return {key: value for key, value in document.items() if key not in excluded}


def compute_content_fingerprint(
    *,
    client: bytes,
    server: bytes,
    npc: bytes | None,
    idmap: bytes | None = None,
    generated_at_fields: Collection[str],
) -> str:
    if npc is None:
        # 계약에 npc 없는 케이스의 계산 규칙이 없다(idmap만 "없으면 키를 뺀다"가 정의돼 있다).
        raise MissingContentPartError("npc")
    parts: dict[str, bytes] = {"client": client, "server": server, "npc": npc}
    if idmap is not None:
        parts["idmap"] = idmap
    combined = {
        role: content_body(
            parse_i_json(content), role=role, generated_at_fields=generated_at_fields
        )
        for role, content in parts.items()
    }
    return FINGERPRINT_PREFIX + hashlib.sha256(jcs_canonicalize(combined)).hexdigest()


def verify_content_fingerprint(
    expected: str,
    *,
    client: bytes,
    server: bytes,
    npc: bytes | None,
    idmap: bytes | None = None,
    generated_at_fields: Collection[str],
) -> bool:
    actual = compute_content_fingerprint(
        client=client,
        server=server,
        npc=npc,
        idmap=idmap,
        generated_at_fields=generated_at_fields,
    )
    return hmac.compare_digest(actual, expected)


def header_mismatches(
    documents: Mapping[str, Any],
    *,
    case_id: str,
    content_version: int,
    fingerprint: str,
) -> list[tuple[str, str]]:
    """v0.3 §6 파일 머리 일치 규칙: 각 파일의 `case_id` · `content_version` · `content_fingerprint`.

    `(역할, 필드)` 목록을 돌려준다(없거나 다르면 포함). 값은 담지 않는다.
    """

    expected = {
        "case_id": case_id,
        "content_version": content_version,
        "content_fingerprint": fingerprint,
    }
    problems: list[tuple[str, str]] = []
    for role, document in documents.items():
        header = document if isinstance(document, Mapping) else {}
        for name, value in expected.items():
            stored = header.get(name)
            if type(stored) is not type(value) or stored != value:
                problems.append((role, name))
    return problems
