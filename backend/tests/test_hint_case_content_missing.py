"""Hint API: 레거시 세션의 케이스 콘텐츠 파일이 없거나 깨졌을 때의 HTTP 응답(DB 없이).

세션 조회는 대역으로 바꾸고(레거시 세션 = 파일 기반 기본 로더), 케이스 디렉터리는 `tmp_path`로 돌린다.
앱 예외를 그대로 올리지 않도록(`raise_app_exceptions=False`) 해서 클라이언트가 받는 실제 응답을 본다.
잔액 · 멱등성(격리 MySQL)은 `test_fe_integration_contract_mysql.py`가 본다.
"""

import asyncio
from uuid import uuid4

import httpx
import pytest

from app.api.v1 import hints
from app.db.session import get_db
from app.main import app
from app.services import case_content, puzzle_runtime
from app.services.case_content import load_case_client_content
from app.services.hint import server_hint_source
from app.services.puzzle_runtime import load_case_runtime
from app.services.session_content import SessionHintLoaders
from tests.test_api_error_contract import assert_documented

CASE = "case_gone"
HINTS = "/api/v1/play-sessions/{play_session_id}/hints"
ALIAS = "/api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints"


@pytest.fixture
def legacy_case_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(puzzle_runtime, "CASES_DIRECTORY", tmp_path)
    monkeypatch.setattr(case_content, "CASES_DIRECTORY", tmp_path)

    async def legacy_loaders(db, play_session_id, store):
        return SessionHintLoaders(
            load_case_runtime,
            server_hint_source(),
            load_case_client_content,
            CASE,
            None,
        )

    async def no_db():
        yield None

    monkeypatch.setattr(hints, "resolve_session_hint_loaders", legacy_loaders)
    app.dependency_overrides[get_db] = no_db
    yield tmp_path
    app.dependency_overrides.pop(get_db, None)


def post(url: str, **body) -> httpx.Response:
    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as http:
            return await http.post(
                url,
                json={
                    "client_event_id": str(uuid4()),
                    "client_timestamp": "2026-11-03T12:00:00+09:00",
                    "target_level": 1,
                    **body,
                },
            )

    return asyncio.run(send())


def assert_no_internals(response: httpx.Response, case_dir) -> None:
    text = response.text
    for leak in (str(case_dir), "server.json", "client.json", "Error", CASE):
        assert leak not in text, leak


def test_missing_runtime_file_is_case_not_found_not_a_bare_500(legacy_case_dir):
    session_id = uuid4()
    canonical = post(f"/api/v1/play-sessions/{session_id}/hints", puzzle_id="PZ_A")
    alias = post(f"/api/v1/play-sessions/{session_id}/puzzles/PZ_A/hints")

    for response, template in ((canonical, HINTS), (alias, ALIAS)):
        assert (response.status_code, response.json()) == (
            404,
            {"detail": "Case not found."},
        )
        assert_documented(response, "POST", template)
        assert_no_internals(response, legacy_case_dir)


@pytest.mark.parametrize(
    "server_json",
    ["{", '{"case_id": "case_gone"}'],
    ids=["json-decode", "validation"],
)
def test_broken_runtime_file_is_case_content_unavailable(legacy_case_dir, server_json):
    (legacy_case_dir / f"{CASE}.server.json").write_text(server_json, encoding="utf-8")

    response = post(f"/api/v1/play-sessions/{uuid4()}/hints", puzzle_id="PZ_A")

    assert (response.status_code, response.json()) == (
        500,
        {"detail": "Case content is unavailable."},
    )
    assert_documented(response, "POST", HINTS)
    assert_no_internals(response, legacy_case_dir)
