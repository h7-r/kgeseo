"""요청 빈도 제한 값은 프로세스가 시작할 때 읽는다 — 값을 바꾸고 새 프로세스(=`waegok-api` 재시작)로 띄우면 반영된다.

실제 Uvicorn 프로세스를 띄워 확인한다(lifespan 끔, DB 에 접속하지 않음). 가입 API 에 빈 본문을 보내 422 를 받는다 —
빈도 제한은 본문 검증보다 먼저 세므로 계정을 만들지 않고 한도를 셀 수 있다(운영 확인 절차와 같은 방법).
DB 설정은 접속하지 않는 가상 값이고, 작업 폴더는 테스트 임시 폴더다(저장소의 `.env`를 읽지 않는다).
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]
ORIGIN = "http://localhost:5175"  # 기본 CORS_ORIGINS(개발) 안의 값
SYNTHETIC_ENV = {
    "APP_ENV": "development",  # 지금 운영과 같은 모드
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "1",
    "DB_USER": "synthetic",
    "DB_PASSWORD": "synthetic-only",
    "DB_NAME": "synthetic_test",
}


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _env(**extra: str) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("RATE_LIMIT_", "DB_", "APP_ENV", "FORWARDED_ALLOW_IPS"))
    }
    return env | SYNTHETIC_ENV | {"PYTHONPATH": str(BACKEND)} | extra


class ApiProcess:
    def __init__(self, workdir: Path, env: dict[str, str]) -> None:
        self.port = _free_port()
        self.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--lifespan",
                "off",
                "--log-level",
                "warning",
            ],
            cwd=workdir,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

    def __enter__(self) -> "ApiProcess":
        deadline = time.monotonic() + 30
        while True:
            assert self.process.poll() is None, self.process.stderr.read().decode()
            try:
                httpx.get(f"http://127.0.0.1:{self.port}/api/v1/health", timeout=1)
                return self
            except httpx.TransportError:
                assert time.monotonic() < deadline, "uvicorn did not start"
                time.sleep(0.1)

    def __exit__(self, *exc) -> None:
        self.process.terminate()
        self.process.wait(timeout=15)
        self.process.stderr.close()

    def register_statuses(self, count: int) -> list[int]:
        url = f"http://127.0.0.1:{self.port}/api/v1/auth/register"
        with httpx.Client(headers={"Origin": ORIGIN}) as http:
            return [http.post(url, json={}).status_code for _ in range(count)]


def test_a_new_process_applies_changed_values_and_starts_counting_from_zero(
    tmp_path,
) -> None:
    # 1) 프로세스 환경 변수(systemd EnvironmentFile 과 같은 경로)로 2
    with ApiProcess(tmp_path, _env(RATE_LIMIT_REGISTER="2")) as api:
        assert api.register_statuses(3) == [422, 422, 429]

    # 2) 「.env 수정 → 재시작」: 작업 폴더의 .env 를 3 으로 바꾸고 새 프로세스로 띄운다
    (tmp_path / ".env").write_text("RATE_LIMIT_REGISTER=3\n", encoding="utf-8")
    with ApiProcess(tmp_path, _env()) as api:
        # 앞 프로세스의 카운트는 남지 않는다(메모리 카운터) — 첫 요청부터 다시 3회
        assert api.register_statuses(4) == [422, 422, 422, 429]


def test_a_new_process_without_the_setting_uses_the_beta_default(tmp_path) -> None:
    with ApiProcess(tmp_path, _env()) as api:
        statuses = api.register_statuses(31)
    assert statuses == [422] * 30 + [429]


@pytest.mark.parametrize("value", ["0", "bad-value-xyz"])
def test_an_invalid_value_stops_the_process_from_starting(tmp_path, value) -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=tmp_path,
        env=_env(RATE_LIMIT_REGISTER=value),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    assert "rate_limit_register" in result.stderr
    assert "bad-value-xyz" not in result.stderr  # 넣은 값은 출력하지 않는다
