"""Deployment URL checks. Error messages contain names, never input values."""
from urllib.parse import urlsplit


def https_origin(value: str) -> bool:
    try:
        url = urlsplit(value)
        return bool(
            url.scheme == "https" and url.hostname and not url.username
            and not url.password and url.path in ("", "/")
            and not url.query and not url.fragment and url.port != 0
            and not any(c.isspace() for c in value)
        )
    except ValueError:
        return False


def api_docs_settings(app_env: str) -> dict[str, str | None]:
    """FastAPI 문서 경로(`/docs` · `/redoc` · `/openapi.json`). 운영(`APP_ENV=production`)에서만 끈다.

    운영 판별은 `APP_ENV` 하나뿐이다 — 운영 서버의 환경에 `APP_ENV=production`이 없으면 문서가 그대로 열린다.
    배포 뒤 세 경로가 404인지 확인한다(`backend/docs/deployment_login_readiness.md`).
    """

    if app_env == "production":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


def validate_deployment(settings):
    if "*" in settings.cors_origins:
        raise ValueError("CORS_ORIGINS cannot use a wildcard with credentials")
    if settings.app_env != "production":
        return settings
    required = ("db_password", "google_client_id", "naver_client_id", "naver_client_secret", "naver_redirect_uri")
    if any(not getattr(settings, key).strip() or getattr(settings, key).startswith("YOUR_") for key in required):
        raise ValueError("production requires DB and Google/Naver settings (values redacted)")
    if settings.db_user.lower() == "root":
        raise ValueError("production requires a non-root DB account")
    if not settings.cors_origins or any(not https_origin(origin) or origin.endswith("/") for origin in settings.cors_origins):
        raise ValueError("CORS_ORIGINS requires exact HTTPS origins without trailing slash")
    try:
        callback = urlsplit(settings.naver_redirect_uri)
        origin = f"{callback.scheme}://{callback.netloc}"
        valid = https_origin(origin) and origin in settings.cors_origins and callback.path in ("/로그인/콜백", "/%EB%A1%9C%EA%B7%B8%EC%9D%B8/%EC%BD%9C%EB%B0%B1") and not callback.query and not callback.fragment
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("NAVER_REDIRECT_URI must match the website HTTPS callback and CORS_ORIGINS")
    return settings
