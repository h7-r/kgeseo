import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services import case_content, puzzle_runtime


@pytest.fixture
def case_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    return tmp_path


def make_client_content() -> dict:
    return {
        "case_id": "case_001",
        "entry_zone_id": "ZONE_001",
        "zones": [
            {
                "zone_id": "ZONE_001",
                "zone_name": "Arrival",
                "zone_type": "room",
                "description": "First zone",
                "objects": [
                    {
                        "object_id": "OBJ_SHARED",
                        "object_name": "Lock",
                        "object_type": "lock",
                        "asset_key": "lock_asset",
                        "visible": True,
                        "enabled": True,
                        "interaction": {
                            "type": "input",
                            "target_id": "PUZZLE_001",
                        },
                    },
                    {
                        "object_id": "OBJ_DOOR",
                        "object_name": "Door",
                        "object_type": "door",
                        "asset_key": None,
                        "visible": False,
                        "enabled": False,
                        "interaction": None,
                    },
                ],
                "navigation": [
                    {
                        "door_object_id": "OBJ_DOOR",
                        "target_zone_id": "ZONE_002",
                    }
                ],
                "metadata": {},
            },
            {
                "zone_id": "ZONE_002",
                "zone_name": "Archive",
                "zone_type": "room",
                "description": "Second zone",
                "objects": [
                    {
                        "object_id": "OBJ_SHARED",
                        "object_name": "Archive lock",
                        "object_type": "lock",
                        "asset_key": None,
                        "visible": True,
                        "enabled": True,
                        "interaction": {
                            "type": "input",
                            "target_id": "PUZZLE_002",
                        },
                    }
                ],
                "navigation": [],
                "metadata": {},
            },
        ],
    }


def make_server_runtime(*, case_id: str = "case_001") -> dict:
    effect = {
        "grant_clue_ids": ["CLUE_SECRET"],
        "complete_puzzle_ids": [],
        "set_flags": {"secret_flag": True},
    }
    return {
        "schema_version": "0.1",
        "case_id": case_id,
        "puzzles": [
            {
                "puzzle_id": "PUZZLE_001",
                "accepted_answers": ["secret answer one"],
                "on_correct": effect,
            },
            {
                "puzzle_id": "PUZZLE_002",
                "accepted_answers": ["secret answer two"],
                "on_correct": effect,
            },
        ],
        "clue_combinations": [
            {
                "combination_id": "COMBINATION_SECRET",
                "clue_ids": ["CLUE_SECRET", "CLUE_OTHER"],
                "on_success": effect,
            }
        ],
    }


def write_case_pair(
    directory: Path,
    *,
    client_content: dict | None = None,
    server_runtime: dict | None = None,
) -> None:
    client_data = client_content or make_client_content()
    server_data = server_runtime or make_server_runtime()
    (directory / "case_001.client.json").write_text(
        json.dumps(client_data),
        encoding="utf-8",
    )
    (directory / "case_001.server.json").write_text(
        json.dumps(server_data),
        encoding="utf-8",
    )


def test_get_case_bundle_returns_public_content(
    client: TestClient,
    case_directory: Path,
) -> None:
    write_case_pair(case_directory)

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["case_id"] == "case_001"
    assert body["data"]["entry_zone_id"] == "ZONE_001"
    assert [zone["zone_id"] for zone in body["data"]["zones"]] == [
        "ZONE_001",
        "ZONE_002",
    ]

    first_zone = body["data"]["zones"][0]
    assert first_zone["navigation"] == [
        {"door_object_id": "OBJ_DOOR", "target_zone_id": "ZONE_002"}
    ]
    assert first_zone["metadata"] == {}
    assert first_zone["objects"][0] == {
        "object_id": "OBJ_SHARED",
        "object_name": "Lock",
        "object_type": "lock",
        "asset_key": "lock_asset",
        "visible": True,
        "enabled": True,
        "interaction": {"type": "input"},
    }
    assert first_zone["objects"][1]["interaction"] is None


def test_get_case_bundle_does_not_expose_server_only_content(
    client: TestClient,
    case_directory: Path,
) -> None:
    write_case_pair(case_directory)

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 200
    response_text = response.text
    for server_only_value in (
        "target_id",
        "PUZZLE_001",
        "accepted_answers",
        "secret answer one",
        "on_correct",
        "on_success",
        "grant_clue_ids",
        "complete_puzzle_ids",
        "set_flags",
        "clue_combinations",
        "COMBINATION_SECRET",
        "secret_flag",
    ):
        assert server_only_value not in response_text


def test_get_case_bundle_allows_same_object_id_in_different_zones(
    client: TestClient,
    case_directory: Path,
) -> None:
    write_case_pair(case_directory)

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 200
    zones = response.json()["data"]["zones"]
    assert zones[0]["objects"][0]["object_id"] == "OBJ_SHARED"
    assert zones[1]["objects"][0]["object_id"] == "OBJ_SHARED"


def test_get_case_bundle_returns_422_for_invalid_case_id(
    client: TestClient,
    case_directory: Path,
) -> None:
    response = client.get("/api/v1/cases/invalid.case/bundle")

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid case ID."}


@pytest.mark.parametrize("missing_file", ["client", "server"])
def test_get_case_bundle_returns_404_when_content_file_is_missing(
    client: TestClient,
    case_directory: Path,
    missing_file: str,
) -> None:
    if missing_file != "client":
        (case_directory / "case_001.client.json").write_text(
            json.dumps(make_client_content()),
            encoding="utf-8",
        )
    if missing_file != "server":
        (case_directory / "case_001.server.json").write_text(
            json.dumps(make_server_runtime()),
            encoding="utf-8",
        )

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 404
    assert response.json() == {"detail": "Case not found."}


@pytest.mark.parametrize("malformed_file", ["client", "server"])
def test_get_case_bundle_returns_500_for_malformed_json(
    client: TestClient,
    case_directory: Path,
    malformed_file: str,
) -> None:
    write_case_pair(case_directory)
    (case_directory / f"case_001.{malformed_file}.json").write_text(
        "{not-json",
        encoding="utf-8",
    )

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}


def test_get_case_bundle_returns_500_for_cross_file_mismatch(
    client: TestClient,
    case_directory: Path,
) -> None:
    write_case_pair(case_directory, server_runtime=make_server_runtime(case_id="other"))

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert "other" not in response.text


def test_get_case_bundle_returns_500_for_missing_runtime_puzzle(
    client: TestClient,
    case_directory: Path,
) -> None:
    client_content = make_client_content()
    client_content["zones"][0]["objects"][0]["interaction"]["target_id"] = (
        "PUZZLE_MISSING"
    )
    write_case_pair(case_directory, client_content=client_content)

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}
    assert "PUZZLE_MISSING" not in response.text


def test_get_case_bundle_returns_500_for_invalid_entry_zone(
    client: TestClient,
    case_directory: Path,
) -> None:
    client_content = make_client_content()
    client_content["entry_zone_id"] = "ZONE_MISSING"
    write_case_pair(case_directory, client_content=client_content)

    response = client.get("/api/v1/cases/case_001/bundle")

    assert response.status_code == 500
    assert response.json() == {"detail": "Case content is unavailable."}


def test_case_bundle_openapi_uses_public_response_schema(client: TestClient) -> None:
    operation = client.get("/openapi.json").json()["paths"][
        "/api/v1/cases/{case_id}/bundle"
    ]["get"]

    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CaseBundleResponse"
    }

    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert set(schemas["CaseBundleInteraction"]["properties"]) == {"type"}
    assert "target_id" not in schemas["CaseBundleInteraction"]["properties"]
