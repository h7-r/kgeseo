"""hint_ref 발급 · 검증 (PM: suggest_hint {hint_ref}, 공개 puzzle_id 없음)."""

import base64
import re
from uuid import uuid4

import pytest

from app.services.hint_ref import (
    HintRefFormatError,
    HintRefKeys,
    HintRefKeyUnavailableError,
    HintRefMismatchError,
    issue_hint_ref,
    resolve_hint_ref,
)

# 가상 테스트 키 · ID(운영 값이 아니다)
K1 = b"hint-ref-k1-test-" + b"a" * 32
K2 = b"hint-ref-k2-test-" + b"b" * 32
KEYS = HintRefKeys("k1", {"k1": K1})
SESSION = str(uuid4())
FP = "sha256:" + "1" * 64
PUZZLES = ["PZ_LOCK_A", "PZ_LOCK_B", "PZ_DONE"]


def issue(puzzle_id="PZ_LOCK_A", session=SESSION, fp=FP, keys=KEYS):
    return issue_hint_ref(
        keys, play_session_id=session, puzzle_id=puzzle_id, content_fingerprint=fp
    )


def resolve(ref, session=SESSION, fp=FP, keys=KEYS):
    return resolve_hint_ref(
        keys, ref, play_session_id=session, content_fingerprint=fp, puzzle_ids=PUZZLES
    )


def test_hint_ref_is_opaque_and_contains_no_puzzle_or_session_id() -> None:
    ref = issue()

    assert re.fullmatch(r"hr1\.k1\.[A-Za-z0-9_-]{43}", ref)
    tag = ref.rsplit(".", 1)[1]
    decoded = base64.urlsafe_b64decode(tag + "=")
    for secret in ("PZ_LOCK_A", SESSION, FP):
        assert secret not in ref
        assert secret.encode() not in decoded


def test_hint_ref_is_deterministic_and_resolves_to_the_internal_puzzle() -> None:
    assert issue() == issue()
    assert resolve(issue()) == "PZ_LOCK_A"
    assert resolve(issue("PZ_LOCK_B")) == "PZ_LOCK_B"
    assert issue("PZ_LOCK_A") != issue("PZ_LOCK_B")


@pytest.mark.parametrize(
    "change",
    [
        {"session": str(uuid4())},
        {"fp": "sha256:" + "2" * 64},
        {"keys": HintRefKeys("k1", {"k1": K2})},
    ],
)
def test_other_session_fingerprint_or_forged_key_is_a_mismatch(change) -> None:
    ref = issue()

    with pytest.raises(HintRefMismatchError):
        resolve(ref, **change)


def test_puzzle_outside_the_pinned_content_is_a_mismatch() -> None:
    with pytest.raises(HintRefMismatchError):
        resolve(issue("PZ_OTHER_CASE"))


@pytest.mark.parametrize(
    "bad",
    ["", "PZ_LOCK_A", "hr1.k1.short", "hr2.k1." + "A" * 43, "hr1.K1." + "A" * 43, None],
)
def test_malformed_hint_ref_is_a_format_error(bad) -> None:
    with pytest.raises(HintRefFormatError):
        resolve(bad)


def test_key_rotation_keeps_old_refs_valid_and_unknown_key_is_config_error() -> None:
    old = issue()
    rotated = HintRefKeys("k2", {"k1": K1, "k2": K2})

    assert issue(keys=rotated).startswith("hr1.k2.")
    assert resolve(old, keys=rotated) == "PZ_LOCK_A"
    with pytest.raises(HintRefKeyUnavailableError):
        resolve(old, keys=HintRefKeys("k2", {"k2": K2}))


@pytest.mark.parametrize(
    ("current", "keys"),
    [("k1", {"k1": b"short"}), ("K1", {"K1": K1}), ("k1", {"k2": K2})],
)
def test_invalid_keys_are_rejected(current, keys) -> None:
    with pytest.raises(ValueError):
        HintRefKeys(current, keys)
