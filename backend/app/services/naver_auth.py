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


def verify_naver_authorization_code(
    code: str,
    state: str,
    naver_client_id: str,
    naver_client_secret: str,
    naver_redirect_uri: str,
) -> GoogleUserResponse:
    if (
        not naver_client_id
        or naver_client_id == "YOUR_NAVER_CLIENT_ID"
        or not naver_client_secret
        or naver_client_secret == "YOUR_NAVER_CLIENT_SECRET"
        or not naver_redirect_uri
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
    if not email:
        raise InvalidNaverProfileError

    return GoogleUserResponse(
        provider="naver",
        subject=subject,
        email=email,
        email_verified=None,
        name=response.get("nickname") or response.get("name"),
        picture=response.get("profile_image"),
    )
