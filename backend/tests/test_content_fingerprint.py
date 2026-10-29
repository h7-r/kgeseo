import hashlib
import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from app.services.content_fingerprint import (
    EXCLUDED_HEADER_FIELDS,
    FINGERPRINT_PREFIX,
    MissingContentPartError,
    NonCanonicalJsonError,
    UnexpectedContentPartError,
    compute_content_fingerprint,
    content_body,
    header_mismatches,
    jcs_canonicalize,
    parse_i_json,
    verify_content_fingerprint,
)
from app.services.content_integrity import canonical_json_sha256, content_fingerprint

# 가상 테스트 데이터. 실제 PM 콘텐츠가 아니다.
CLIENT = {
    "case_id": "case_fp",
    "entry_zone_id": "ZONE_A",
    "zones": [{"zone_id": "ZONE_A"}],
}
SERVER = {
    "schema_version": "0.1",
    "case_id": "case_fp",
    "puzzles": [{"puzzle_id": "P", "n": 1}],
}
NPC = {
    "schema_version": "npc-pack 0.1",
    "case_id": "case_fp",
    "content_version": 3,
    "content_fingerprint": "sha256:old",
    "status": "published",
    "approvals": [{"gate": "G3", "target_hash": "sha256:x"}],
    "general_nudges": [{"line_id": "NUDGE_A", "text": "(가상) 둘러보자"}],
}
IDMAP = {
    "schema": "naju-idmap/0.1-draft",
    "case_id": "case_fp",
    "status": "draft",
    "zones": [],
}


def encode(data: Any, **kwargs: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, **kwargs).encode("utf-8")


def fp(**overrides: Any) -> str:
    parts: dict[str, Any] = {
        "client": encode(CLIENT),
        "server": encode(SERVER),
        "npc": encode(NPC),
        "idmap": encode(IDMAP),
    }
    parts.update(overrides)
    return compute_content_fingerprint(**parts)


# --- RFC 8785 정규화 ---


BS = chr(92)


def esc(code: int) -> str:
    """JSON 문자열 이스케이프 텍스트(백슬래시 u + 16진 4자리)를 chr로 만든다."""
    return BS + "u" + format(code, "04X")


def test_rfc8785_example_vector() -> None:
    # RFC 8785 §3.2.2 예시 입력과 기대 출력
    source = (
        '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],'
        ' "string": "'
        + esc(0x20AC)
        + "$"
        + esc(0x0F)
        + esc(0x0A)
        + "A'"
        + esc(0x42)
        + esc(0x22)
        + esc(0x5C)
        + BS
        + BS
        + BS
        + '"'
        + BS
        + "/"
        + '", "literals": [null, true, false]}'
    )
    expected = (
        '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],'
        '"string":"'
        + chr(0x20AC)
        + "$"
        + BS
        + "u000f"
        + BS
        + "n"
        + "A'B"
        + BS
        + '"'
        + BS
        + BS
        + BS
        + BS
        + BS
        + '"'
        + '/"}'
    )

    assert (
        jcs_canonicalize(parse_i_json(source.encode("utf-8"))).decode("utf-8")
        == expected
    )


def test_rfc8785_key_order_uses_utf16_code_units() -> None:
    # RFC 8785 §3.2.3 정렬 예시. 이모지(서로게이트 D83D)가 U+FB33보다 앞선다(코드 포인트 순이면 뒤).
    entries = [
        (esc(0x20AC), "Euro Sign"),
        (BS + "r", "Carriage Return"),
        (esc(0xFB33), "Hebrew Letter Dalet With Dagesh"),
        ("1", "One"),
        (esc(0xD83D) + esc(0xDE00), "Emoji: Grinning Face"),
        (esc(0x80), "Control"),
        (esc(0xF6), "Latin Small Letter O With Diaeresis"),
    ]
    source = "{" + ",".join(f'"{key}":"{value}"' for key, value in entries) + "}"

    out = jcs_canonicalize(parse_i_json(source.encode("utf-8"))).decode("utf-8")
    keys = list(json.loads(out, object_pairs_hook=lambda pairs: [k for k, _ in pairs]))

    assert keys == [
        chr(0x0D),
        "1",
        chr(0x80),
        chr(0xF6),
        chr(0x20AC),
        chr(0x1F600),
        chr(0xFB33),
    ]
    assert out.startswith('{"' + BS + 'r":"Carriage Return","1":"One"')


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, "0"),
        (-0.0, "0"),
        (1, "1"),
        (-1, "-1"),
        (100, "100"),
        (4.5, "4.5"),
        (0.1, "0.1"),
        (0.000001, "0.000001"),
        (1e-7, "1e-7"),
        (1.5e-9, "1.5e-9"),
        (1e20, "100000000000000000000"),
        (1e21, "1e+21"),
        (123456789012345680000.0, "123456789012345680000"),
        (5e-324, "5e-324"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
        (2**53, "9007199254740992"),
        (-(2**53), "-9007199254740992"),
        (1.0, "1"),
    ],
)
def test_ecmascript_number_format(value: float, expected: str) -> None:
    assert jcs_canonicalize([value]) == f"[{expected}]".encode("utf-8")


@pytest.mark.parametrize("value", [2**53 + 1, -(2**53) - 1, math.nan, math.inf])
def test_numbers_outside_i_json_are_rejected(value: float) -> None:
    with pytest.raises(NonCanonicalJsonError):
        jcs_canonicalize([value])


def test_strings_are_escaped_like_json_stringify_without_unicode_normalization() -> (
    None
):
    line_separator = chr(0x2028)
    value = "가" + line_separator + chr(0x7F) + chr(0x1F) + chr(0x09)
    expected = '["가' + line_separator + chr(0x7F) + BS + "u001f" + BS + 't"]'
    assert jcs_canonicalize([value]) == expected.encode("utf-8")
    # NFC(é 한 글자)와 NFD(e + 결합 기호)는 다른 값이다 — 정규화하지 않는다.
    assert jcs_canonicalize([chr(0xE9)]) != jcs_canonicalize(["e" + chr(0x301)])


@pytest.mark.parametrize(
    "content",
    [
        b'{"a": 1, "a": 2}',
        b'{"a": {"b": 1, "b": 1}}',
        b'{"a": NaN}',
        b'{"a": Infinity}',
        b'{"a": -Infinity}',
        b"\xef\xbb\xbf{}",
        b"\xff",
        b'{"a": "\\ud800"}',
        b"{",
        b"",
    ],
)
def test_parse_rejects_non_i_json(content: bytes) -> None:
    with pytest.raises(NonCanonicalJsonError):
        jcs_canonicalize(parse_i_json(content))


def test_non_string_keys_and_unknown_types_are_rejected() -> None:
    with pytest.raises(NonCanonicalJsonError):
        jcs_canonicalize({1: "x"})
    with pytest.raises(NonCanonicalJsonError):
        jcs_canonicalize({"a": object()})


# --- fingerprint ---


def test_same_content_same_fingerprint_and_format() -> None:
    first = fp()

    assert first == fp()
    assert first.startswith(FINGERPRINT_PREFIX)
    assert len(first) == len(FINGERPRINT_PREFIX) + 64
    assert first[len(FINGERPRINT_PREFIX) :] == first[len(FINGERPRINT_PREFIX) :].lower()


def test_key_order_whitespace_and_escapes_do_not_change_fingerprint() -> None:
    reordered = dict(reversed(list(NPC.items())))

    assert fp() == fp(
        npc=encode(reordered, indent=4).replace(b"\n", b"\r\n"),
        client=json.dumps(CLIENT, ensure_ascii=True).encode("utf-8"),
    )


def test_matches_manual_definition() -> None:
    body = {
        "client": CLIENT,
        "server": SERVER,
        "npc": {
            k: v
            for k, v in NPC.items()
            if k not in {"content_fingerprint", "approvals", "status"}
        },
        "idmap": {k: v for k, v in IDMAP.items() if k != "status"},
    }
    expected = "sha256:" + hashlib.sha256(jcs_canonicalize(body)).hexdigest()

    assert fp() == expected


@pytest.mark.parametrize("role", ["client", "server", "npc", "idmap"])
def test_changing_any_file_changes_fingerprint(role: str) -> None:
    source = {"client": CLIENT, "server": SERVER, "npc": NPC, "idmap": IDMAP}[role]
    changed = deepcopy(source)
    changed["case_id"] = "case_fp_changed"

    assert fp(**{role: encode(changed)}) != fp()


def test_role_assignment_matters() -> None:
    assert fp(client=encode(SERVER), server=encode(CLIENT)) != fp()


def test_idmap_absent_omits_key_and_differs() -> None:
    without = fp(idmap=None)
    body = {
        "client": CLIENT,
        "server": SERVER,
        "npc": {
            k: v
            for k, v in NPC.items()
            if k not in {"content_fingerprint", "approvals", "status"}
        },
    }

    assert without != fp()
    assert without == "sha256:" + hashlib.sha256(jcs_canonicalize(body)).hexdigest()


def test_unicode_and_number_representations_in_content() -> None:
    decomposed = deepcopy(NPC)
    decomposed["general_nudges"][0]["text"] = chr(0x1100) + chr(
        0x1161
    )  # 자모 조합(NFD)
    precomposed = deepcopy(NPC)
    precomposed["general_nudges"][0]["text"] = chr(0xAC00)  # 가(NFC)
    assert fp(npc=encode(decomposed)) != fp(npc=encode(precomposed))
    # ensure_ascii 이스케이프 표기와 UTF-8 글자는 같은 값이다.
    assert fp(npc=json.dumps(NPC, ensure_ascii=True).encode("ascii")) == fp()

    # 1과 1.0은 RFC 8785에서 같은 숫자다.
    assert (
        fp(
            server=b'{"schema_version":"0.1","case_id":"case_fp",'
            b'"puzzles":[{"puzzle_id":"P","n":1.0}]}'
        )
        == fp()
    )
    assert (
        fp(server=encode({**SERVER, "puzzles": [{"puzzle_id": "P", "n": 2}]})) != fp()
    )


def test_header_fields_are_excluded_from_body() -> None:
    changed = {
        **NPC,
        "content_fingerprint": "sha256:new",
        "status": "draft",
        "approvals": [],
        "generated_at": "2026-10-27T01:00:00Z",
        "published_at": "2026-10-27T02:00:00Z",
    }
    no_header = {k: v for k, v in NPC.items() if k not in EXCLUDED_HEADER_FIELDS}

    assert EXCLUDED_HEADER_FIELDS == {
        "content_fingerprint",
        "approvals",
        "status",
        "generated_at",
        "published_at",
    }
    assert fp(npc=encode(changed)) == fp()
    assert fp(npc=encode(no_header)) == fp()


@pytest.mark.parametrize("role", ["client", "server", "npc", "idmap"])
def test_generated_and_published_timestamps_do_not_change_fingerprint(
    role: str,
) -> None:
    source = {"client": CLIENT, "server": SERVER, "npc": NPC, "idmap": IDMAP}[role]
    first = {
        **source,
        "generated_at": "2026-10-27T00:00:00Z",
        "published_at": "2026-10-27T00:00:01Z",
    }
    second = {**source, "generated_at": "2026-12-31T23:59:59Z", "published_at": None}

    assert fp(**{role: encode(first)}) == fp(**{role: encode(second)}) == fp()


@pytest.mark.parametrize(
    "field",
    ["content_fingerprint", "approvals", "status", "generated_at", "published_at"],
)
def test_nested_fields_with_header_names_are_kept(field: str) -> None:
    nested = deepcopy(NPC)
    nested["general_nudges"][0][field] = "kept"

    assert content_body(nested, role="npc")["general_nudges"][0][field] == "kept"
    assert fp(npc=encode(nested)) != fp()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("case_id", "case_other"),
        ("content_version", 4),
        ("schema_version", "npc-pack 0.2"),
    ],
)
def test_identity_fields_stay_in_body(field: str, value: Any) -> None:
    assert fp(npc=encode({**NPC, field: value})) != fp()
    assert fp(server=encode({**SERVER, field: value})) != fp()


def test_idmap_content_change_changes_fingerprint() -> None:
    changed = {**IDMAP, "zones": [{"local": "Z1", "zone_id": "ZONE_A"}]}

    assert fp(idmap=encode(changed)) != fp()


def test_missing_npc_is_rejected_for_published_cases() -> None:
    with pytest.raises(MissingContentPartError) as raised:
        fp(npc=None)

    assert str(raised.value) == "npc"
    with pytest.raises(MissingContentPartError):
        compute_content_fingerprint(client=encode(CLIENT), server=encode(SERVER))


def test_legacy_fingerprint_uses_client_and_server_only() -> None:
    legacy = compute_content_fingerprint(
        client=encode(CLIENT), server=encode(SERVER), legacy=True
    )
    body = {"client": CLIENT, "server": SERVER}

    assert legacy == "sha256:" + hashlib.sha256(jcs_canonicalize(body)).hexdigest()
    assert legacy != fp()
    assert verify_content_fingerprint(
        legacy, client=encode(CLIENT), server=encode(SERVER), legacy=True
    )


@pytest.mark.parametrize("part", ["npc", "idmap"])
def test_legacy_rejects_extra_parts(part: str) -> None:
    with pytest.raises(UnexpectedContentPartError) as raised:
        compute_content_fingerprint(
            client=encode(CLIENT),
            server=encode(SERVER),
            legacy=True,
            **{part: encode({})},
        )

    assert str(raised.value) == part


@pytest.mark.parametrize("role", ["client", "server", "npc", "idmap"])
def test_top_level_must_be_object_and_errors_carry_no_content(role: str) -> None:
    with pytest.raises(NonCanonicalJsonError) as raised:
        fp(**{role: '["(가상) 비공개 문장"]'.encode("utf-8")})

    assert "비공개" not in str(raised.value)


def test_verify_and_input_immutability() -> None:
    raw = {
        "client": encode(CLIENT),
        "server": encode(SERVER),
        "npc": encode(NPC),
        "idmap": encode(IDMAP),
    }
    before = deepcopy(raw)
    expected = fp()

    assert verify_content_fingerprint(expected, **raw) is True
    assert verify_content_fingerprint(expected.upper(), **raw) is False
    assert verify_content_fingerprint("sha256:" + "0" * 64, **raw) is False
    assert raw == before

    document = deepcopy(NPC)
    content_body(document, role="npc")
    assert document == NPC


def test_header_mismatches_reports_role_and_field_only() -> None:
    documents = {
        "client": CLIENT,
        "npc": NPC,
        "idmap": {**IDMAP, "content_version": True},
    }

    problems = header_mismatches(
        documents, case_id="case_fp", content_version=3, fingerprint="sha256:old"
    )

    assert problems == [
        ("client", "content_version"),
        ("client", "content_fingerprint"),
        ("idmap", "content_version"),
        ("idmap", "content_fingerprint"),
    ]


# --- 기존 콘텐츠 · 기존 도구와의 관계 ---


CASES_DIR = Path(__file__).resolve().parents[1] / "app" / "content" / "cases"


def test_case_001_legacy_fingerprint_is_computed_and_stable() -> None:
    client = (CASES_DIR / "case_001.client.json").read_bytes()
    server = (CASES_DIR / "case_001.server.json").read_bytes()

    first = compute_content_fingerprint(client=client, server=server, legacy=True)

    assert first.startswith(FINGERPRINT_PREFIX)
    assert first == compute_content_fingerprint(
        client=client, server=server, legacy=True
    )
    with pytest.raises(MissingContentPartError):
        compute_content_fingerprint(client=client, server=server)


def test_differs_from_diagnostic_integrity_hashes() -> None:
    parts = {"client": encode(CLIENT), "server": encode(SERVER), "npc": encode(NPC)}

    official = compute_content_fingerprint(**parts)

    assert official != "sha256:" + content_fingerprint(parts)
    assert official[len(FINGERPRINT_PREFIX) :] != canonical_json_sha256(parts["npc"])
