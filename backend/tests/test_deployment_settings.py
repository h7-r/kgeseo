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
    {"db_user": "root"}, {"session_cookie_secure": False}, {"cors_origins": ["*"]}, {"cors_origins": []},
    {"cors_origins": ["http://web.example.invalid"]},
    {"naver_redirect_uri": "https://evil.invalid/로그인/콜백"},
    {"naver_redirect_uri": "https://web.example.invalid/other"},
])
def test_production_fails_closed_without_echoing_secrets(changes):
    with pytest.raises(ValidationError) as error:
        production(**changes)
    assert "synthetic-only" not in str(error.value)


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
