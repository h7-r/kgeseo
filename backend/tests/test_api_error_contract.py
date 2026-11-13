"""오류 응답 OpenAPI 명세(`app.api.v1.error_responses`)가 라우터의 실제 상태 코드 · 본문과 맞는지 본다.

- 연산마다 문서화된 상태 코드 목록을 고정한다(빠지거나 늘면 실패).
- 라우터 소스의 `detail` 문장 · 오류 `code`가 모두 명세 설명에 있는지 대조한다.
- `assert_documented`: 실제 응답이 문서화된 상태이고, 본문이 그 상태의 모델에 맞고, 문장 · code가 설명에 있는지.
  격리 MySQL 계약 테스트(`test_fe_integration_contract_mysql.py`)도 이 함수로 모든 오류 응답을 확인한다.
"""

import asyncio
import re
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pydantic import BaseModel, ValidationError

from app.main import app
from app.schemas import api_error
from app.schemas.api_error import ValidationErrorResponse

API_DIR = Path(__file__).resolve().parents[1] / "app" / "api" / "v1"

# 명세 component 이름 → 오류 모델. FastAPI 기본 검증 오류(`HTTPValidationError`)도 같은 형식이다.
ERROR_MODELS: dict[str, type[BaseModel]] = {
    name: model
    for name, model in vars(api_error).items()
    if isinstance(model, type) and issubclass(model, api_error.ErrorModel)
} | {"HTTPValidationError": ValidationErrorResponse}

# 연산별 문서화된 오류 상태(자동 422 포함). 성공 상태는 기존 그대로라 여기서 보지 않는다.
EXPECTED_ERRORS = {
    ("GET", "/api/v1/health"): set(),
    ("GET", "/api/v1/health/ready"): {503},
    ("POST", "/api/v1/auth/google"): {401, 403, 409, 422, 503},
    ("POST", "/api/v1/auth/naver"): {401, 403, 409, 422, 502, 503},
    ("POST", "/api/v1/auth/register"): {403, 409, 422, 429},
    ("POST", "/api/v1/auth/login"): {401, 403, 422, 429},
    ("GET", "/api/v1/me"): {401},
    ("POST", "/api/v1/me/logout"): {403},
    ("GET", "/api/v1/me/game-save"): {401},
    ("PUT", "/api/v1/me/game-save"): {401, 403, 409, 413, 422},
    ("DELETE", "/api/v1/me/game-save"): {401, 403},
    ("GET", "/api/v1/me/character"): {401},
    ("PUT", "/api/v1/me/character"): {401, 403, 413, 422},
    ("GET", "/api/v1/me/items"): {401},
    ("POST", "/api/v1/lobby/ticket"): {401, 403, 429, 503},
    ("GET", "/api/v1/admin/users"): {401, 403, 422},
    ("GET", "/api/v1/admin/users/{user_id}"): {401, 403, 404, 422},
    ("GET", "/api/v1/admin/beta-events"): {401, 403, 422},
    ("GET", "/api/v1/admin/stats/summary"): {401, 403, 422},
    ("GET", "/api/v1/admin/audit-logs"): {401, 403, 422},
    # 2단계(11/12 해랑) — 조회 전용 통계 · 보안 집계
    ("GET", "/api/v1/admin/stats/traffic"): {401, 403, 422},
    ("GET", "/api/v1/admin/stats/active-sessions"): {401, 403},
    ("GET", "/api/v1/admin/stats/members"): {401, 403, 422},
    ("GET", "/api/v1/admin/stats/game"): {401, 403, 422},
    ("GET", "/api/v1/admin/security/summary"): {401, 403},
    # 3단계(11/13 해랑) — 1:1 문의 · 설정 · 관리자 목록 · 콘텐츠
    ("POST", "/api/v1/inquiries"): {403, 422, 429},
    ("GET", "/api/v1/me/inquiries"): {401},
    ("GET", "/api/v1/site/status"): set(),
    ("GET", "/api/v1/admin/inquiries"): {401, 403, 422},
    ("GET", "/api/v1/admin/inquiries/{inquiry_id}"): {401, 403, 404, 422},
    ("POST", "/api/v1/admin/inquiries/{inquiry_id}/replies"): {401, 403, 404, 409, 422},
    ("PATCH", "/api/v1/admin/inquiries/{inquiry_id}"): {401, 403, 404, 422},
    ("GET", "/api/v1/admin/settings"): {401, 403},
    ("PUT", "/api/v1/admin/settings/maintenance_mode"): {401, 403, 422},
    ("GET", "/api/v1/admin/admins"): {401, 403},
    ("GET", "/api/v1/admin/contents"): {401, 403},
    ("GET", "/api/v1/admin/contents/{case_id}"): {401, 403, 404, 422},
    # 11/11 베타 분석 기록: 쿠키 없이도 받는다(401 없음). 형식 오류 422, 64KB 초과 413.
    ("POST", "/api/v1/beta-events"): {403, 413, 422, 429},
    ("POST", "/api/v1/auth/email-exists"): {403, 422, 429},
    ("POST", "/api/v1/auth/nickname-exists"): {403, 422, 429},
    ("POST", "/api/v1/auth/social-onboarding/complete"): {401, 403, 409, 422},
    # 11/6 PM: 플레이 API 는 쿠키 주체가 없으면 401, 쓰기 요청은 Origin 이 다르면 403.
    ("POST", "/api/v1/anonymous-sessions"): {403, 429},
    ("POST", "/api/v1/play-sessions"): {401, 403, 404, 409, 410, 422, 500},
    ("GET", "/api/v1/play-sessions/{play_session_id}"): {401, 404, 422},
    ("GET", "/api/v1/play-sessions/{play_session_id}/clues"): {401, 404, 409, 422, 500},
    ("GET", "/api/v1/play-sessions/{play_session_id}/bundle"): {
        401,
        404,
        409,
        422,
        500,
    },
    ("POST", "/api/v1/play-sessions/{play_session_id}/interactions"): {
        401,
        403,
        404,
        409,
        422,
        500,
        501,
    },
    ("POST", "/api/v1/play-sessions/{play_session_id}/npc/turns"): {
        401,
        403,
        404,
        409,
        422,
        500,
    },
    ("POST", "/api/v1/play-sessions/{play_session_id}/hints"): {
        401,
        403,
        404,
        409,
        422,
        500,
        503,
    },
    ("POST", "/api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints"): {
        401,
        403,
        404,
        409,
        422,
        500,
    },
    ("GET", "/api/v1/cases/{case_id}/bundle"): {404, 422, 500},
}


NO_CONTENT = {
    ("POST", "/api/v1/me/logout"),
    ("DELETE", "/api/v1/me/game-save"),
}
CREATED = {
    ("POST", "/api/v1/inquiries"),
    ("POST", "/api/v1/admin/inquiries/{inquiry_id}/replies"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/social-onboarding/complete"),
    ("POST", "/api/v1/anonymous-sessions"),
    ("POST", "/api/v1/play-sessions"),
}


def _operations():
    for path, item in app.openapi()["paths"].items():
        for method, operation in item.items():
            yield method.upper(), path, operation


def _documented_response(method: str, path: str, status: int) -> dict:
    responses = app.openapi()["paths"][path][method.lower()]["responses"]
    assert str(status) in responses, f"{method} {path} {status} is undocumented"
    return responses[str(status)]


def _schema_models(response: dict) -> list[type[BaseModel]]:
    """명세의 본문 스키마(단일 `$ref` 또는 `anyOf`)가 가리키는 오류 모델들."""

    schema = response["content"]["application/json"]["schema"]
    refs = [item["$ref"] for item in schema.get("anyOf", [schema])]
    names = [ref.rsplit("/", 1)[-1] for ref in refs]
    return [ERROR_MODELS[name] for name in names]


def _matches_any(models: list[type[BaseModel]], body) -> bool:
    for model in models:
        try:
            model.model_validate(body)
        except ValidationError:
            continue
        return True
    return False


def assert_documented(response: httpx.Response, method: str, path: str) -> None:
    """오류 응답이면 명세와 맞는지 확인한다. `path`는 OpenAPI 경로 템플릿이다."""

    status = response.status_code
    if status < 400:
        return
    body = response.json()
    documented = _documented_response(method, path, status)
    assert _matches_any(_schema_models(documented), body), (method, path, status, body)
    detail = body["detail"]
    description = documented["description"]
    if isinstance(detail, str):
        assert f"`{detail}`" in description, (method, path, status, detail)
    elif isinstance(detail, dict):
        assert f"`{detail['code']}`" in description or detail["code"] in description, (
            method,
            path,
            status,
            detail,
        )


def test_every_operation_documents_exactly_its_error_statuses():
    documented = {
        (method, path): {
            int(code) for code in operation["responses"] if int(code) >= 400
        }
        for method, path, operation in _operations()
        if path.startswith("/api/v1/")
    }
    assert documented == EXPECTED_ERRORS


def test_no_route_documents_or_returns_400():
    assert all(400 not in statuses for statuses in EXPECTED_ERRORS.values())
    for file in API_DIR.glob("*.py"):
        assert "HTTP_400" not in file.read_text(encoding="utf-8"), file.name


def test_success_responses_keep_their_schemas():
    # 오류 명세만 더했다. 성공 응답은 응답 모델 그대로다.
    for method, path, operation in _operations():
        if not path.startswith("/api/v1/"):
            continue
        success = [code for code in operation["responses"] if int(code) < 400]
        assert len(success) == 1, (method, path)
        expected = (
            201
            if (method, path) in CREATED
            else 204
            if (method, path) in NO_CONTENT
            else 200
        )
        assert int(success[0]) == expected, (method, path)


def _source_literals(text: str) -> set[str]:
    patterns = (
        r'detail="([^"<]+)"',  # {"detail": "<문장>"}
        r'"code": "([A-Za-z_]+)"',  # {"detail": {"code": ...}}
        r'_error\(\s*status\.\w+,\s*"([A-Z_]+)"',  # Hint `_error(status, code, message)`
        r'OnboardingError\("([a-z_]+)"',  # 소셜 가입 실패 code
        r'"detail": "([^"<]+)"',  # JSONResponse로 직접 만드는 본문
    )
    return {value for pattern in patterns for value in re.findall(pattern, text)}


@pytest.mark.parametrize(
    "source",
    [
        "auth.py",
        "beta_events.py",
        "cases.py",
        "health.py",
        "hints.py",
        "interactions.py",
        "lobby.py",
        "npc.py",
        "play_sessions.py",
        "../../services/social_onboarding.py",
        "../../services/request_rate_limit.py",
        "../../main.py",
    ],
)
def test_every_error_text_and_code_in_source_is_documented(source):
    descriptions = "\n".join(
        response["description"]
        for _, _, operation in _operations()
        for code, response in operation["responses"].items()
        if int(code) >= 400
    )
    literals = _source_literals((API_DIR / source).read_text(encoding="utf-8"))
    if source.endswith("main.py"):
        literals |= {"invalid_input"}
    else:
        assert literals, source
    missing = sorted(value for value in literals if f"`{value}`" not in descriptions)
    assert not missing, (source, missing)


def test_hint_balance_empty_error_shape_is_documented_with_its_extra_fields():
    schema = app.openapi()["components"]["schemas"]["HintBalanceEmptyDetail"]
    assert set(schema["required"]) == {
        "code",
        "message",
        "minigames_left",
        "special_minigame_available",
    }


# --- DB 없이 재현되는 오류 응답 표본 ---


def call(method: str, url: str, **kwargs) -> httpx.Response:
    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            return await http.request(method, url, **kwargs)

    return asyncio.run(send())


def test_case_bundle_errors_match_the_spec():
    path = "/api/v1/cases/{case_id}/bundle"
    invalid = call("GET", "/api/v1/cases/Bad Case!/bundle")
    missing = call("GET", "/api/v1/cases/case_does_not_exist/bundle")

    assert invalid.json() == {"detail": "Invalid case ID."}
    assert invalid.status_code == 422
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Case not found."}
    for response in (invalid, missing):
        assert_documented(response, "GET", path)


def test_hint_request_with_both_targets_is_a_validation_error():
    path = "/api/v1/play-sessions/{play_session_id}/hints"
    response = call(
        "POST",
        f"/api/v1/play-sessions/{uuid4()}/hints",
        json={
            "client_event_id": str(uuid4()),
            "target_level": 1,
            "puzzle_id": "PZ_A",
            "hint_ref": "hr1.k.x",
        },
    )

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert_documented(response, "POST", path)


def test_social_onboarding_validation_error_never_echoes_inputs():
    path = "/api/v1/auth/social-onboarding/complete"
    response = call(
        "POST",
        path,
        json={"onboarding_token": "secret-proof", "nickname": 1, "unknown": True},
        headers={"Origin": "http://localhost:5175"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "invalid_nickname",
            "message": "사용할 수 없는 닉네임입니다.",
        }
    }
    assert "secret-proof" not in response.text
    assert_documented(response, "POST", path)


def test_assert_documented_rejects_an_undocumented_status_or_text():
    request = httpx.Request("GET", "http://test")
    teapot = httpx.Response(418, json={"detail": "x"}, request=request)
    unknown_text = httpx.Response(404, json={"detail": "Nope."}, request=request)
    wrong_shape = httpx.Response(404, json={"detail": {"code": "x"}}, request=request)
    path = "/api/v1/play-sessions/{play_session_id}"

    for response in (teapot, unknown_text, wrong_shape):
        with pytest.raises(AssertionError):
            assert_documented(response, "GET", path)
