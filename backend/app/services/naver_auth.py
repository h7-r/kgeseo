from typing import Any

import requests

from app.schemas.auth import GoogleUserResponse

NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token"
NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me"
REQUEST_TIMEOUT = 5


class NaverAuthConfigurationError(Exception):
    pass


class InvalidNaverAuthorizationCodeError(Exception):
    pass


class NaverTokenExchangeError(Exception):
    pass


class NaverProfileError(Exception):
    pass


class InvalidNaverProfileError(Exception):
    pass


def naver_auth_configured(
    naver_client_id: str,
    naver_client_secret: str,
    naver_redirect_uri: str,
) -> bool:
    """세 값이 모두 실제 값인지 — 하나라도 비거나 견본 자리표시자면 미설정(/site/status 와 같은 판정)."""
    return (
        bool(naver_client_id)
        and naver_client_id != "YOUR_NAVER_CLIENT_ID"
        and bool(naver_client_secret)
        and naver_client_secret != "YOUR_NAVER_CLIENT_SECRET"
        and bool(naver_redirect_uri)
    )


class NaverEmailRequiredError(InvalidNaverProfileError):
    """프로필은 정상인데 이메일이 없다(네이버 동의 항목에서 이메일을 안 줌). 화면이 가려 쓸 수 있게 따로 둔다(11/18)."""


def verify_naver_authorization_code(
    code: str,
    state: str,
    naver_client_id: str,
    naver_client_secret: str,
    naver_redirect_uri: str,
) -> GoogleUserResponse:
    if not naver_auth_configured(
        naver_client_id, naver_client_secret, naver_redirect_uri
    ):
        raise NaverAuthConfigurationError

    access_token = exchange_code_for_access_token(
        code.strip(),
        state.strip(),
        naver_client_id,
        naver_client_secret,
        naver_redirect_uri,
    )
    profile = fetch_naver_profile(access_token)
    return normalize_naver_profile(profile)


def exchange_code_for_access_token(
    code: str,
    state: str,
    naver_client_id: str,
    naver_client_secret: str,
    naver_redirect_uri: str,
) -> str:
    if not code or not state:
        raise InvalidNaverAuthorizationCodeError

    try:
        response = requests.post(
            NAVER_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": naver_client_id,
                "client_secret": naver_client_secret,
                "redirect_uri": naver_redirect_uri,
                "code": code,
                "state": state,
            },
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as error:
        raise NaverTokenExchangeError from error

    if not response.ok:
        raise InvalidNaverAuthorizationCodeError

    try:
        payload: dict[str, Any] = response.json()
    except ValueError as error:
        raise NaverTokenExchangeError from error

    # 네이버는 코드가 틀리거나 만료돼도 HTTP 200 에 {"error": "invalid_request" | "invalid_grant", ...} 로 답한다(11/18 실측).
    # 이건 사용자 쪽 문제라 401 이고, 네이버 서버 장애(네트워크 · 본문 깨짐 · 토큰 모양 이상)만 502 로 남긴다.
    if payload.get("error"):
        raise InvalidNaverAuthorizationCodeError

    access_token = payload.get("access_token")
    token_type = payload.get("token_type")
    if not access_token or token_type != "bearer":
        raise NaverTokenExchangeError
    return access_token


def fetch_naver_profile(access_token: str) -> dict[str, Any]:
    try:
        response = requests.get(
            NAVER_PROFILE_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as error:
        raise NaverProfileError from error

    if not response.ok:
        raise NaverProfileError

    try:
        payload: dict[str, Any] = response.json()
    except ValueError as error:
        raise NaverProfileError from error

    if payload.get("resultcode") != "00":
        raise NaverProfileError
    return payload


def normalize_naver_profile(payload: dict[str, Any]) -> GoogleUserResponse:
    response = payload.get("response")
    if not isinstance(response, dict):
        raise InvalidNaverProfileError

    subject = response.get("id")
    email = response.get("email")
    if not subject:
        raise InvalidNaverProfileError
    if not str(email or "").strip():
        raise NaverEmailRequiredError

    return GoogleUserResponse(
        provider="naver",
        subject=subject,
        email=email,
        email_verified=None,
        name=response.get("nickname") or response.get("name"),
        picture=response.get("profile_image"),
    )
