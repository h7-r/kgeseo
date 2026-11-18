import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.middleware.cors import CORSMiddleware

from app.core.config import Settings


def production(**overrides):
    values = dict(_env_file=None, app_env="production", db_host="db.invalid", db_user="app", db_password="synthetic-only", db_name="app", google_client_id="google-test", naver_client_id="naver-test", naver_client_secret="synthetic-only", naver_redirect_uri="https://web.example.invalid/로그인/콜백", cors_origins=["https://web.example.invalid"], session_cookie_secure=True)
    return Settings(**{**values, **overrides})


def test_production_configuration_accepts_only_explicit_settings():
    assert production().app_env == "production"


@pytest.mark.parametrize("changes", [
    {"naver_client_secret": ""}, {"google_client_id": ""}, {"db_password": ""},
    {"db_user": "root"}, {"cors_origins": ["*"]}, {"cors_origins": []},
    {"cors_origins": ["http://web.example.invalid"]},
    {"naver_redirect_uri": "https://evil.invalid/로그인/콜백"},
    {"naver_redirect_uri": "https://web.example.invalid/other"},
    # 11/18 — https 운영의 로그인 · 게스트 쿠키는 Secure(__Host-) 여야 한다. 값이 빠져도(기본 false) 시작되지 않는다
    {"session_cookie_secure": False},
])
def test_production_fails_closed_without_echoing_secrets(changes):
    with pytest.raises(ValidationError) as error:
        production(**changes)
    assert "synthetic-only" not in str(error.value)


def test_production_requires_the_secure_cookie_flag_to_be_set_explicitly():
    values = dict(_env_file=None, app_env="production", db_host="db.invalid", db_user="app", db_password="synthetic-only", db_name="app", google_client_id="google-test", naver_client_id="naver-test", naver_client_secret="synthetic-only", naver_redirect_uri="https://web.example.invalid/로그인/콜백", cors_origins=["https://web.example.invalid"])
    with pytest.raises(ValidationError) as error:
        Settings(**values)  # SESSION_COOKIE_SECURE 줄이 없는 운영 .env 와 같다
    assert "SESSION_COOKIE_SECURE" in str(error.value)
    assert "synthetic-only" not in str(error.value)


def test_development_keeps_the_plain_cookie_without_the_flag():
    plain = Settings(_env_file=None, db_host="db.invalid", db_user="app", db_password="synthetic-only", db_name="app")
    assert plain.session_cookie_secure is False


def test_env_example_lists_every_setting_with_app_env_first():
    """`.env.example` 은 Settings 의 모든 칸을 적는다(운영 판별 스위치 APP_ENV 가 맨 앞). 칸을 더하면 예제도 같이 늘린다(11/18)."""

    example = (Path(__file__).resolve().parents[1] / ".env.example").read_text(encoding="utf-8")
    listed = re.findall(r"^([A-Z_]+)=", example, flags=re.M)
    assert listed[0] == "APP_ENV"
    assert set(listed) == {name.upper() for name in Settings.model_fields}


def test_exact_cors_preflight_rejects_unlisted_websites():
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=production().cors_origins, allow_methods=["POST"], allow_headers=["Content-Type"], allow_credentials=False)
    with TestClient(app) as client:
        headers = {"Origin": "https://web.example.invalid", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
        good = client.options("/api/v1/auth/login", headers=headers)
        assert good.status_code == 200
        assert good.headers["access-control-allow-origin"] == headers["Origin"]
        assert "access-control-allow-credentials" not in good.headers
        bad = client.options("/api/v1/auth/login", headers={**headers, "Origin": "https://evil.invalid"})
        assert bad.status_code == 400
        assert "access-control-allow-origin" not in bad.headers


@pytest.mark.parametrize("path,body", [("google", {"credential": 42}), ("naver", {"code": [], "state": "synthetic-sensitive"})])
def test_oauth_validation_never_echoes_credentials(client, path, body):
    response = client.post("/api/v1/auth/" + path, json=body)
    assert response.status_code == 422
    assert "synthetic-sensitive" not in response.text
    assert "input" not in response.text.replace("invalid_input", "")
    assert response.headers["cache-control"] == "no-store"
