"""`GET /site/status` 의 소셜 준비 여부(11/18 해랑, 점검 H2 선택 항목). 값은 내지 않고 설정됐는지만 — 로그인 API 가 503 을 내는 판정과 같다."""

import pytest

from app.core.config import settings

PATH = "/api/v1/site/status"
NAVER_FIELDS = ("naver_client_id", "naver_client_secret", "naver_redirect_uri")


def set_social(monkeypatch, *, google: str, naver: tuple[str, str, str]) -> None:
    monkeypatch.setattr(settings, "google_client_id", google)
    for field, value in zip(NAVER_FIELDS, naver, strict=True):
        monkeypatch.setattr(settings, field, value)


def test_social_flags_follow_server_settings(client, monkeypatch):
    set_social(
        monkeypatch,
        google="g-id",
        naver=("n-id", "n-secret", "https://www.example/콜백"),
    )
    body = client.get(PATH).json()
    assert body["social"] == {"google": True, "naver": True}
    assert body["maintenance"] == {"on": False, "message": ""}


def test_missing_or_placeholder_values_count_as_not_configured(client, monkeypatch):
    set_social(
        monkeypatch,
        google="YOUR_GOOGLE_CLIENT_ID",
        naver=("n-id", "YOUR_NAVER_CLIENT_SECRET", "https://www.example/콜백"),
    )
    assert client.get(PATH).json()["social"] == {"google": False, "naver": False}


@pytest.mark.parametrize("blank_index", [0, 1, 2])
def test_naver_needs_all_three_values(client, monkeypatch, blank_index):
    values = ["n-id", "n-secret", "https://www.example/콜백"]
    values[blank_index] = ""
    set_social(monkeypatch, google="", naver=tuple(values))
    assert client.get(PATH).json()["social"] == {"google": False, "naver": False}


def test_status_never_leaks_social_values(client, monkeypatch):
    set_social(
        monkeypatch,
        google="g-secret-like",
        naver=("n-id", "n-secret", "https://www.example/콜백"),
    )
    response = client.get(PATH)
    assert response.headers["cache-control"] == "no-store"
    for value in ("g-secret-like", "n-id", "n-secret", "example"):
        assert value not in response.text
