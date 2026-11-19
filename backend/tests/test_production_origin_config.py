"""production 설정으로 앱을 새로 띄워 CORS 미들웨어와 플레이 쓰기 Origin 검사가 같은 목록을 쓰는지 확인한다.

앱 · 설정은 import 때 고정되므로 별도 프로세스에서 확인한다. DB 는 도달할 수 없는 합성 값이다
(거부 경로는 DB 에 닿기 전에 403 이 나야 한다). 운영 DB · API 에는 접근하지 않는다.
"""

import json
import os
import subprocess
import sys

import pytest

WWW = "https://www.k-escape.com"
PLAY = "https://play.k-escape.com"
PREVIEW = "https://preview.k-escape.com"

SCRIPT = r"""
import json, sys
from fastapi.testclient import TestClient
from app.core.config import settings
from app.main import app

origins = json.loads(sys.argv[1])
client = TestClient(app, raise_server_exceptions=False)
result = {"app_env": settings.app_env, "cors_origins": settings.cors_origins, "origins": {}}
for origin in origins:
    preflight = client.options(
        "/api/v1/anonymous-sessions",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )
    result["origins"][origin] = {
        "preflight_status": preflight.status_code,
        "allow_origin": preflight.headers.get("access-control-allow-origin"),
        "allow_credentials": preflight.headers.get("access-control-allow-credentials"),
        # 허용 Origin 은 Origin 검사를 지나 DB 단계로 간다(합성 DB 라 403 이 아닌 다른 실패)
        "guest_write_status": client.post(
            "/api/v1/anonymous-sessions", headers={"Origin": origin}
        ).status_code,
    }
# 거부되는 Origin 의 게스트 · 로그인 쓰기 요청은 DB 에 닿기 전 403 이어야 한다
writes = {}
for origin in json.loads(sys.argv[2]):
    headers = {"Origin": origin} if origin else {}
    writes[str(origin)] = [
        client.post("/api/v1/anonymous-sessions", headers=headers).status_code,
        client.post("/api/v1/play-sessions", json={}, headers=headers).status_code,
        client.post("/api/v1/auth/login", json={}, headers=headers).status_code,
    ]
result["rejected_writes"] = writes
print(json.dumps(result))
"""


def _run(cors_origins: list[str], probe: list[str], rejected: list[str | None]) -> dict:
    environment = {
        **os.environ,
        "APP_ENV": "production",
        "SESSION_COOKIE_SECURE": "true",
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "1",
        "DB_USER": "synthetic",
        "DB_PASSWORD": "synthetic",
        "DB_NAME": "synthetic",
        "GOOGLE_CLIENT_ID": "synthetic",
        "NAVER_CLIENT_ID": "synthetic",
        "NAVER_CLIENT_SECRET": "synthetic",
        "NAVER_REDIRECT_URI": f"{WWW}/로그인/콜백",
        "CORS_ORIGINS": json.dumps(cors_origins),
        "PUBLISHED_CONTENT_ROOT": "",
    }
    completed = subprocess.run(
        [sys.executable, "-c", SCRIPT, json.dumps(probe), json.dumps(rejected)],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    return json.loads(completed.stdout.strip().splitlines()[-1])


LOOKALIKES = [
    "https://kgeseo-git-main-h7-r.vercel.app",
    "https://preview.k-escape.com.evil.example",
    "http://preview.k-escape.com",
    "https://preview.k-escape.com:8443",
]


def test_production_cors_and_play_origin_use_configured_preview():
    result = _run(
        [WWW, PLAY, PREVIEW],
        [WWW, PLAY, PREVIEW, *LOOKALIKES],
        [None, *LOOKALIKES],
    )
    assert result["app_env"] == "production"
    assert result["cors_origins"] == [WWW, PLAY, PREVIEW]
    for origin in (WWW, PLAY, PREVIEW):
        seen = result["origins"][origin]
        assert seen["preflight_status"] == 200
        assert seen["allow_origin"] == origin  # * 이 아니라 요청 Origin 그대로
        assert seen["allow_credentials"] == "true"
        assert seen["guest_write_status"] != 403
    for origin in LOOKALIKES:
        seen = result["origins"][origin]
        assert seen["preflight_status"] == 400
        assert seen["allow_origin"] is None
    for origin, statuses in result["rejected_writes"].items():
        assert statuses == [403, 403, 403], origin


def test_production_preview_is_refused_when_not_configured():
    result = _run([WWW, PLAY], [WWW, PLAY, PREVIEW], [PREVIEW])
    assert result["origins"][WWW]["allow_origin"] == WWW
    assert result["origins"][PLAY]["allow_origin"] == PLAY
    assert result["origins"][PREVIEW]["allow_origin"] is None
    assert result["origins"][PREVIEW]["guest_write_status"] == 403
    assert result["rejected_writes"][PREVIEW] == [403, 403, 403]


@pytest.mark.parametrize(
    "cors_origins",
    [
        [],
        ["*"],
        [WWW, "*"],
        [WWW, f"{PREVIEW}/"],
        [WWW, "http://preview.k-escape.com"],
        [WWW, f"{PREVIEW}/path"],
    ],
)
def test_production_refuses_to_start_with_unsafe_cors_origins(cors_origins):
    """빈 목록 · 와일드카드 · 끝 슬래시 · http · 경로가 든 Origin 이면 production 은 시작하지 않는다."""
    with pytest.raises(subprocess.CalledProcessError) as error:
        _run(cors_origins, [], [])
    assert "CORS_ORIGINS" in error.value.stderr
