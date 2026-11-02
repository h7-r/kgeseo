"""단서 표시 유형(clues[].carrier_kind) — 테스트용 가상 콘텐츠만 쓴다."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.puzzle_runtime import ClueDefinition
from app.services import case_content, puzzle_runtime
from app.services.puzzle_runtime import load_case_runtime
from tests.conftest import FakeAsyncSession
from tests.test_clues_api import (
    CLIENT_DATA,
    CLUES_URL,
    INTERACTIONS_URL,
    RUNTIME_DATA,
    get_clues,
    inspect_body,
    make_play_session,
)

CARRIER_KINDS = ["letter", "note", "key", "piece", "mark", "deduction"]


def client_content() -> dict:
    client = deepcopy(CLIENT_DATA)
    client["zones"][0]["objects"].append(
        {
            "object_id": "OBJ_SAFE",
            "object_name": "OBJ_SAFE",
            "object_type": "prop",
            "visible": True,
            "enabled": True,
            "interaction": {"type": "input", "target_id": "PUZZLE_SECRET"},
        }
    )
    return client


def runtime_content() -> dict:
    """서신(letter) · 일기(생략) · 비밀(deduction, 퍼즐 보상) · 조합 결과(key)."""

    runtime = deepcopy(RUNTIME_DATA)
    kinds = {"CLUE_LETTER": "letter", "CLUE_SECRET": "deduction"}
    for clue in runtime["clues"]:
        if clue["clue_id"] in kinds:
            clue["carrier_kind"] = kinds[clue["clue_id"]]
    runtime["clues"].append(
        {"clue_id": "CLUE_COMBINED", "title": "맞춘 조각", "carrier_kind": "key"}
    )
    runtime["clue_combinations"] = [
        {
            "combination_id": "COMBO_LETTER_DIARY",
            "clue_ids": ["CLUE_LETTER", "CLUE_DIARY"],
            "on_success": {"grant_clue_ids": ["CLUE_COMBINED"], "set_flags": {}},
        }
    ]
    return runtime


def write_case(directory: Path, runtime: dict) -> None:
    (directory / "case_001.client.json").write_text(
        json.dumps(client_content()), encoding="utf-8"
    )
    (directory / "case_001.server.json").write_text(
        json.dumps(runtime, ensure_ascii=False), encoding="utf-8"
    )


@pytest.fixture
def kind_case(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    write_case(tmp_path, runtime_content())
    return tmp_path


def clue(**values) -> dict:
    return {"clue_id": "CLUE_X", "title": "제목", **values}


def body(action: str, target_type: str, target_id, payload: dict) -> dict:
    return {
        **inspect_body("OBJ_LETTER"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "payload": payload,
    }


# ── 스키마 ──


@pytest.mark.parametrize("kind", CARRIER_KINDS)
def test_each_allowed_carrier_kind_loads(kind_case: Path, kind: str) -> None:
    assert ClueDefinition.model_validate(clue(carrier_kind=kind)).carrier_kind == kind

    runtime = runtime_content()
    runtime["clues"][1]["carrier_kind"] = kind
    write_case(kind_case, runtime)
    loaded = {c.clue_id: c for c in load_case_runtime("case_001").clues}
    assert loaded["CLUE_DIARY"].carrier_kind == kind


@pytest.mark.parametrize(
    "kind",
    ["Letter", "LETTER", "scroll", "", " letter", "letter ", 1, True, ["letter"], {}],
)
def test_invalid_carrier_kind_is_rejected(kind: object) -> None:
    with pytest.raises(ValidationError) as error:
        ClueDefinition.model_validate(clue(carrier_kind=kind))

    assert [e["loc"] for e in error.value.errors()] == [("carrier_kind",)]


def test_missing_and_null_carrier_kind_mean_no_kind() -> None:
    assert ClueDefinition.model_validate(clue()).carrier_kind is None
    assert ClueDefinition.model_validate(clue(carrier_kind=None)).carrier_kind is None


def test_clue_still_forbids_unknown_fields() -> None:
    with pytest.raises(ValidationError) as error:
        ClueDefinition.model_validate(clue(carrier_kind="note", asset_key="icon"))

    assert [(e["loc"], e["type"]) for e in error.value.errors()] == [
        (("asset_key",), "extra_forbidden")
    ]


# ── 단서 조회 API ──


def test_acquired_clues_return_carrier_kind(
    client: TestClient,
    db_session: FakeAsyncSession,
    kind_case: Path,
) -> None:
    db_session.get_result = make_play_session(acquired=["CLUE_LETTER", "CLUE_DIARY"])

    clues = get_clues(client)

    assert [(c["clue_id"], c["carrier_kind"]) for c in clues] == [
        ("CLUE_LETTER", "letter"),
        ("CLUE_DIARY", None),  # 생략한 콘텐츠는 null
    ]
    assert set(clues[0]) == {"clue_id", "title", "summary", "body", "carrier_kind"}


def test_explicit_null_carrier_kind_returns_null(
    client: TestClient,
    db_session: FakeAsyncSession,
    kind_case: Path,
) -> None:
    runtime = runtime_content()
    runtime["clues"][0]["carrier_kind"] = None
    write_case(kind_case, runtime)
    db_session.get_result = make_play_session(acquired=["CLUE_LETTER"])

    assert get_clues(client)[0]["carrier_kind"] is None


def test_unacquired_carrier_kind_is_not_exposed(
    client: TestClient,
    db_session: FakeAsyncSession,
    kind_case: Path,
) -> None:
    db_session.get_result = make_play_session(acquired=["CLUE_LETTER"])

    response = client.get(CLUES_URL)

    assert [c["clue_id"] for c in response.json()["data"]["clues"]] == ["CLUE_LETTER"]
    for secret in ("deduction", "CLUE_SECRET", "key", "CLUE_COMBINED", "맞춘 조각"):
        assert secret not in response.text


def test_session_without_clues_returns_empty_list(
    client: TestClient,
    db_session: FakeAsyncSession,
    kind_case: Path,
) -> None:
    db_session.get_result = make_play_session()

    response = client.get(CLUES_URL)

    assert response.status_code == 200
    assert response.json()["data"]["clues"] == []
    assert "letter" not in response.text


def test_bundle_does_not_contain_carrier_kind(
    client: TestClient,
    kind_case: Path,
) -> None:
    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 200
    assert "carrier_kind" not in response.text
    assert "deduction" not in response.text


# ── 기존 기능 회귀: 조사 · 조합 · 퍼즐 ──


def test_inspect_combine_and_puzzle_work_with_carrier_kind(
    client: TestClient,
    db_session: FakeAsyncSession,
    kind_case: Path,
) -> None:
    play_session = make_play_session()
    db_session.get_result = play_session

    letter = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_LETTER"))
    diary = client.post(INTERACTIONS_URL, json=inspect_body("OBJ_DIARY"))
    combined = client.post(
        INTERACTIONS_URL,
        json=body(
            "combine_clues", "clue", None, {"clue_ids": ["CLUE_LETTER", "CLUE_DIARY"]}
        ),
    )
    # 표시 유형 값을 정답으로 내도 정답 판정에 쓰이지 않는다.
    wrong = client.post(
        INTERACTIONS_URL,
        json=body("input", "object", "OBJ_SAFE", {"answer": "deduction"}),
    )
    right = client.post(
        INTERACTIONS_URL,
        json=body("input", "object", "OBJ_SAFE", {"answer": "ANSWER_VALVE"}),
    )

    assert letter.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_LETTER"}
    ]
    assert diary.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_DIARY"}
    ]
    assert combined.json()["result_type"] == "correct"
    assert combined.json()["state_changes"] == [
        {"type": "clue_acquired", "clue_id": "CLUE_COMBINED"}
    ]
    assert wrong.json()["result_type"] == "incorrect"
    assert right.json()["result_type"] == "correct"
    for response in (letter, diary, combined, wrong, right):
        assert "carrier_kind" not in response.text  # Interaction 응답은 그대로

    assert [(c["clue_id"], c["carrier_kind"]) for c in get_clues(client)] == [
        ("CLUE_LETTER", "letter"),
        ("CLUE_DIARY", None),
        ("CLUE_COMBINED", "key"),
        ("CLUE_SECRET", "deduction"),
    ]
    assert play_session.state_json["acquired_clue_ids"] == [
        "CLUE_LETTER",
        "CLUE_DIARY",
        "CLUE_COMBINED",
        "CLUE_SECRET",
    ]
