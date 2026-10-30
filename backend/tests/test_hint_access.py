"""정식 Hint API 요청 검증 · 발견 판정 · 대상 결정(PM v0.4.10 §1). DB 없이 검증한다.

경로 전체(차감 · 동시성 · NPC 제안 수락)는 `test_hint_api_mysql.py`가 검증한다. 키 · 콘텐츠는 가상 값이다.
"""

import pytest
from pydantic import ValidationError

from app.schemas.hint import HintApiRequest
from app.services.hint_access import (
    HintAccessRules,
    HintCluesMissingError,
    PuzzleNotDiscoveredError,
    is_puzzle_discovered,
    resolve_hint_target,
    server_state_access_policy,
)
from app.services.hint_ref import (
    HintRefKeys,
    HintRefKeyUnavailableError,
    HintRefMismatchError,
    issue_hint_ref,
)
from tests.test_npc_turn import FP, runtime_with_hints
from tests.test_puzzle_question import make_client

KEYS = HintRefKeys("t1", {"t1": b"hint-ref-test-only-" + b"k" * 32})


def state(**overrides):
    base = {
        "current_zone_id": "ZONE_A",
        "completed_puzzle_ids": [],
        "acquired_clue_ids": [],
        "hint_levels": {},
        "object_states": {},
    }
    return base | overrides


# --- 요청 스키마 ---


@pytest.mark.parametrize(
    "target",
    [{}, {"puzzle_id": "PZ_A", "hint_ref": "hr1.t1." + "A" * 43}],
)
def test_exactly_one_target_is_required(target):
    with pytest.raises(ValidationError):
        HintApiRequest(client_event_id="e1", target_level=1, **target)


@pytest.mark.parametrize(
    "extra",
    [
        {"target_level": 3},
        {"client_event_id": ""},
        {"client_event_id": "x" * 37},
        {"puzzle_id": ""},
        {"zone_id": "ZONE_A"},  # 모르는 필드
    ],
)
def test_invalid_fields_are_rejected(extra):
    data = {"client_event_id": "e1", "target_level": 1, "puzzle_id": "PZ_A"} | extra
    with pytest.raises(ValidationError):
        HintApiRequest(**data)


def test_unlock_request_keeps_only_service_fields():
    request = HintApiRequest(client_event_id="e1", target_level=2, puzzle_id="PZ_A")
    assert request.unlock_request().model_dump() == {
        "client_event_id": "e1",
        "client_timestamp": None,
        "target_level": 2,
    }


# --- 발견 판정 ---


def test_discovery_follows_visible_hosts_completion_and_opened_levels():
    client = make_client()
    assert is_puzzle_discovered(client, state(), "PZ_A")  # 보이는 호스트
    assert not is_puzzle_discovered(client, state(), "PZ_B")  # 숨긴 호스트
    assert not is_puzzle_discovered(client, state(), "PZ_C")  # 다른 구역
    revealed = state(object_states={"ZONE_A": {"OBJ_SAFE": {"visible": True}}})
    assert is_puzzle_discovered(client, revealed, "PZ_B")
    hidden_again = state(object_states={"ZONE_A": {"OBJ_CABINET": {"visible": False}}})
    assert not is_puzzle_discovered(client, hidden_again, "PZ_A")
    assert is_puzzle_discovered(client, state(completed_puzzle_ids=["PZ_C"]), "PZ_C")
    assert is_puzzle_discovered(client, state(hint_levels={"PZ_C": 1}), "PZ_C")
    assert not is_puzzle_discovered(client, state(hint_levels={"PZ_C": True}), "PZ_C")
    assert not is_puzzle_discovered(client, state(current_zone_id=None), "PZ_A")


def test_policy_raises_not_discovered_and_optional_clue_rule():
    runtime = runtime_with_hints()
    pz_a = next(p for p in runtime.puzzles if p.puzzle_id == "PZ_A")
    pz_c = next(p for p in runtime.puzzles if p.puzzle_id == "PZ_C")
    loader = lambda case_id: make_client()  # noqa: E731

    default = server_state_access_policy("case_test", loader)
    default(state(), pz_a, 1)  # 선행 단서 조건은 기본 미적용
    with pytest.raises(PuzzleNotDiscoveredError):
        default(state(), pz_c, 1)

    strict = server_state_access_policy(
        "case_test", loader, HintAccessRules(require_clues=True)
    )
    with pytest.raises(HintCluesMissingError) as error:
        strict(state(acquired_clue_ids=["CLUE_LETTER"]), pz_a, 1)
    assert error.value.missing_clue_count == 1
    strict(state(acquired_clue_ids=["CLUE_LETTER", "CLUE_MAP"]), pz_a, 1)


# --- 대상 결정 ---


def test_target_resolution_by_id_or_verified_ref():
    runtime = runtime_with_hints()
    common = {"play_session_id": "s1", "content_fingerprint": FP, "runtime": runtime}
    assert (
        resolve_hint_target(puzzle_id="PZ_X", hint_ref=None, keys=None, **common)
        == "PZ_X"
    )
    ref = issue_hint_ref(
        KEYS, play_session_id="s1", puzzle_id="PZ_B", content_fingerprint=FP
    )
    assert (
        resolve_hint_target(puzzle_id=None, hint_ref=ref, keys=KEYS, **common) == "PZ_B"
    )

    with pytest.raises(HintRefKeyUnavailableError):
        resolve_hint_target(puzzle_id=None, hint_ref=ref, keys=None, **common)
    with pytest.raises(HintRefMismatchError):  # 레거시(버전 없는) 세션
        resolve_hint_target(
            puzzle_id=None,
            hint_ref=ref,
            keys=KEYS,
            play_session_id="s1",
            content_fingerprint=None,
            runtime=runtime,
        )
    with pytest.raises(HintRefMismatchError):  # 다른 세션
        resolve_hint_target(
            puzzle_id=None,
            hint_ref=ref,
            keys=KEYS,
            play_session_id="s2",
            content_fingerprint=FP,
            runtime=runtime,
        )
