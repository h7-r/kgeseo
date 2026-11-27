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
    # https 운영의 로그인 · 게스트 쿠키는 __Host- + Secure 다. 값이 빠지면 Secure 없는 waegok_session 이 나가므로 시작부터 막는다(11/18)
    if not settings.session_cookie_secure:
        raise ValueError("production requires SESSION_COOKIE_SECURE=true")
    if not settings.cors_origins or any(not https_origin(origin) or origin.endswith("/") for origin in settings.cors_origins):
        raise ValueError("CORS_ORIGINS requires exact HTTPS origins without trailing slash")
    # 메일(11/25): console 은 비밀번호 찾기 코드를 로그에 남기므로 운영 금지. smtp 면 보낼 곳 · 보내는 사람 · 암호화가 있어야 한다
    if settings.mail_backend == "console":
        raise ValueError("production cannot use MAIL_BACKEND=console")
    if settings.mail_backend == "smtp" and (
        not settings.smtp_host.strip()
        or not settings.mail_from.strip()
        or not (settings.smtp_starttls or settings.smtp_ssl)
    ):
        raise ValueError("MAIL_BACKEND=smtp requires SMTP_HOST, MAIL_FROM and STARTTLS or SSL")
    if settings.mail_backend == "smtp" and len(settings.password_reset_code_secret.get_secret_value()) < 32:
        raise ValueError("MAIL_BACKEND=smtp requires PASSWORD_RESET_CODE_SECRET of at least 32 characters")
    try:
        callback = urlsplit(settings.naver_redirect_uri)
        origin = f"{callback.scheme}://{callback.netloc}"
        valid = https_origin(origin) and origin in settings.cors_origins and callback.path in ("/로그인/콜백", "/%EB%A1%9C%EA%B7%B8%EC%9D%B8/%EC%BD%9C%EB%B0%B1") and not callback.query and not callback.fragment
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("NAVER_REDIRECT_URI must match the website HTTPS callback and CORS_ORIGINS")
    return settings
