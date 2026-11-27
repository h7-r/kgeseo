"""비밀번호 찾기 · 변경(계약 password_reset_v0.1, 11/25) — DB 없이 볼 수 있는 것.

- 메일 발송 설정: 운영에서 console 금지 · smtp 는 보낼 곳 · 보내는 사람 · 암호화가 있어야 시작된다
- 메일 꺼짐이면 가입 여부를 보기 전에 503
- 형식 오류는 입력값(이메일 · 코드 · 증표 · 비밀번호)을 되돌려 보내지 않는다
- 메일 모듈: 꺼짐 · 로그 · SMTP 발송(가짜 서버)

실제 흐름(코드 발급 · 확인 · 저장 · 세션 정리 · 탈퇴)은 격리 MySQL 시험(`test_password_reset_mysql.py`)이 본다.
"""

import asyncio
import hashlib
import logging
from email import message_from_bytes, policy

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import settings
from app.services import mailer
from tests.test_deployment_settings import production

ORIGIN = {"Origin": "http://localhost:5173"}


@pytest.mark.parametrize(
    "changes",
    [
        {"mail_backend": "console"},
        {"mail_backend": "smtp", "mail_from": "no-reply@example.invalid"},
        {"mail_backend": "smtp", "smtp_host": "smtp.example.invalid"},
        {
            "mail_backend": "smtp",
            "smtp_host": "smtp.example.invalid",
            "mail_from": "no-reply@example.invalid",
            "smtp_starttls": False,
            "smtp_ssl": False,
        },
        # 코드 해시 비밀값이 없거나 짧다(세진 11/27)
        {
            "mail_backend": "smtp",
            "smtp_host": "smtp.example.invalid",
            "mail_from": "no-reply@example.invalid",
        },
        {
            "mail_backend": "smtp",
            "smtp_host": "smtp.example.invalid",
            "mail_from": "no-reply@example.invalid",
            "password_reset_code_secret": "short",
        },
    ],
)
def test_production_refuses_unsafe_mail_settings(changes):
    with pytest.raises(ValidationError) as error:
        production(**changes, smtp_password="synthetic-only")
    assert "synthetic-only" not in str(error.value)


def test_production_accepts_disabled_or_complete_smtp():
    assert production().mail_backend == "disabled"
    smtp = production(
        mail_backend="smtp",
        smtp_host="email-smtp.ap-northeast-2.amazonaws.com",
        mail_from="ESCAPE THE LEGEND <no-reply@example.invalid>",
        smtp_username="user",
        smtp_password="synthetic-only",
        password_reset_code_secret="x" * 64,
    )
    assert smtp.smtp_port == 587 and smtp.smtp_starttls


def test_code_hash_needs_the_server_secret(monkeypatch):
    """같은 행 · 같은 코드라도 비밀값이 다르면 해시가 다르다 — DB 만으로는 백만 번 대입해도 맞출 수 없다(세진 11/27)."""
    from app.services import password_reset

    monkeypatch.setattr(settings, "password_reset_code_secret", SecretStr("a" * 64))
    first = password_reset._code_hash("row-1", "123456")
    monkeypatch.setattr(settings, "password_reset_code_secret", SecretStr("b" * 64))
    assert password_reset._code_hash("row-1", "123456") != first
    assert first != hashlib.sha256(b"row-1:123456").hexdigest()


def test_request_answers_503_before_looking_up_the_account(client, monkeypatch):
    monkeypatch.setattr(settings, "mail_backend", "disabled")
    monkeypatch.setattr(mailer, "outbox", None)

    async def must_not_run(*args, **kwargs):
        raise AssertionError("account lookup ran while mail is disabled")

    monkeypatch.setattr(
        "app.services.password_reset.request_password_reset", must_not_run
    )
    response = client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": "someone@example.com"},
        headers=ORIGIN,
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "mail_unavailable"
    assert response.headers["cache-control"] == "no-store"


def test_test_recipients_gate_before_the_policy_date(client, monkeypatch):
    """처리방침 시행일(12/4) 전에는 팀 계정에만 보낸다 — 목록 밖은 계정을 찾기 전에 503(미르 11/27)."""
    sent: list[mailer.Mail] = []
    monkeypatch.setattr(mailer, "outbox", sent.append)
    monkeypatch.setattr(
        settings, "mail_test_recipients", " Team@Example.com , qa@example.com,"
    )
    looked_up: list[str] = []

    async def record_lookup(db, email):
        looked_up.append(email)
        return None

    monkeypatch.setattr(
        "app.services.password_reset.request_password_reset", record_lookup
    )

    outside = client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": "member@example.com"},
        headers=ORIGIN,
    )
    assert outside.status_code == 503
    assert outside.json()["detail"]["code"] == "mail_unavailable"
    assert looked_up == []

    inside = client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": "team@example.com"},
        headers=ORIGIN,
    )
    assert inside.status_code == 200
    assert looked_up == ["team@example.com"]

    # 메일 모듈도 목록 밖으로는 보내지 않는다(다른 길로 불려도)
    with pytest.raises(mailer.MailUnavailableError):
        asyncio.run(
            mailer.send_mail(
                mailer.Mail(to="member@example.com", subject="s", text="t")
            )
        )
    asyncio.run(
        mailer.send_mail(mailer.Mail(to="QA@example.com", subject="s", text="t"))
    )
    assert [mail.to for mail in sent] == ["QA@example.com"]

    # 시행일에 값을 비우면 누구에게나 간다
    monkeypatch.setattr(settings, "mail_test_recipients", "")
    assert mailer.mail_available("member@example.com")


@pytest.mark.parametrize(
    "path,body,code",
    [
        ("/api/v1/auth/password-reset/request", {"email": 42}, "invalid_email"),
        (
            "/api/v1/auth/password-reset/verify",
            {"email": "a@example.com", "code": "12ab-secret"},
            "invalid_reset_code",
        ),
        (
            "/api/v1/auth/password-reset/complete",
            {"reset_token": "synthetic-token-secret", "new_password": ""},
            "invalid_password",
        ),
        (
            "/api/v1/auth/password-reset/complete",
            {"reset_token": "synthetic-token-secret"},
            "invalid_password",
        ),
    ],
)
def test_validation_errors_never_echo_inputs(client, monkeypatch, path, body, code):
    monkeypatch.setattr(mailer, "outbox", lambda mail: None)
    response = client.post(path, json=body, headers=ORIGIN)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert "secret" not in response.text


def test_password_routes_refuse_foreign_origins(client):
    for path in (
        "/api/v1/auth/password-reset/request",
        "/api/v1/auth/password-reset/verify",
        "/api/v1/auth/password-reset/complete",
        "/api/v1/me/password",
    ):
        response = client.post(
            path, json={}, headers={"Origin": "https://evil.invalid"}
        )
        assert response.status_code == 403, path


def test_mailer_disabled_console_and_outbox(monkeypatch, caplog):
    mail = mailer.Mail(to="a@example.com", subject="제목", text="본문 123456")
    monkeypatch.setattr(mailer, "outbox", None)
    monkeypatch.setattr(settings, "mail_backend", "disabled")
    assert not mailer.mail_available()
    with pytest.raises(mailer.MailUnavailableError):
        asyncio.run(mailer.send_mail(mail))

    monkeypatch.setattr(settings, "mail_backend", "console")
    # alembic 의 fileConfig 가 같은 프로세스에서 먼저 돌면 이미 만든 로거를 끈다(시험 순서 탓) — 이 시험 동안만 켠다
    monkeypatch.setattr(mailer.logger, "disabled", False)
    with caplog.at_level(logging.WARNING, logger="app.mail"):
        asyncio.run(mailer.send_mail(mail))
    assert "123456" in caplog.text

    sent = []
    monkeypatch.setattr(mailer, "outbox", sent.append)
    monkeypatch.setattr(settings, "mail_backend", "disabled")
    assert mailer.mail_available()
    asyncio.run(mailer.send_mail(mail))
    assert sent == [mail]


class FakeSMTP:
    instances: list["FakeSMTP"] = []
    fail = False

    def __init__(self, host, port, timeout):
        self.host, self.port, self.timeout = host, port, timeout
        self.calls: list[str] = []
        self.message = None
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")

    def starttls(self, context):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(f"login:{user}:{password}")

    def send_message(self, message):
        if FakeSMTP.fail:
            raise mailer.smtplib.SMTPRecipientsRefused({})
        self.message = message
        self.calls.append("send")


def test_smtp_sends_with_starttls_and_hides_failures(monkeypatch, caplog):
    FakeSMTP.instances.clear()
    FakeSMTP.fail = False
    monkeypatch.setattr(mailer, "outbox", None)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    for key, value in {
        "mail_backend": "smtp",
        "smtp_host": "smtp.example.invalid",
        "smtp_port": 587,
        "smtp_username": "user",
        "mail_from": "왜곡 <no-reply@example.invalid>",
        "smtp_starttls": True,
        "smtp_ssl": False,
    }.items():
        monkeypatch.setattr(settings, key, value)
    monkeypatch.setattr(
        settings, "smtp_password", mailer.settings.smtp_password.__class__("pw")
    )

    asyncio.run(
        mailer.send_mail(mailer.Mail(to="a@example.com", subject="제목", text="본문"))
    )
    server = FakeSMTP.instances[-1]
    assert (server.host, server.port) == ("smtp.example.invalid", 587)
    assert server.calls == ["starttls", "login:user:pw", "send", "quit"]
    assert server.message["To"] == "a@example.com"
    assert "no-reply@example.invalid" in server.message["From"]
    # 한글 이름은 RFC 2047 로 실려 받은 쪽에서 「왜곡」으로 읽힌다
    raw_headers = server.message.as_bytes().split(b"\n\n", 1)[0]
    assert b"From: =?utf-8?" in raw_headers  # 머리는 ASCII 로만(본문은 8bit UTF-8)
    parsed = message_from_bytes(server.message.as_bytes(), policy=policy.default)
    assert parsed["From"].addresses[0].display_name == "왜곡"

    FakeSMTP.fail = True
    monkeypatch.setattr(mailer.logger, "disabled", False)
    with caplog.at_level(logging.ERROR, logger="app.mail"):
        with pytest.raises(mailer.MailSendError):
            asyncio.run(
                mailer.send_mail(mailer.Mail(to="b@example.com", subject="s", text="t"))
            )
    # 받는 주소는 로그에 남기지 않는다
    assert "b@example.com" not in caplog.text


def test_locked_retry_after_rounds_up_like_login():
    """하루 잠금의 Retry-After 는 올림 — 로그인 잠금(user_session)과 같다. 버리면 1초 일찍 다시 보낸다(세진 11/27)."""
    from datetime import datetime, timedelta

    from app.models.password_reset import PasswordResetVerifyThrottle
    from app.services import password_reset

    now = datetime(2026, 12, 1, 12, 0, 0)
    throttle = PasswordResetVerifyThrottle(
        key_hash="k" * 64,
        failed_count=20,
        window_started_at=now,
        locked_until=now + timedelta(seconds=90, milliseconds=200),
    )
    assert password_reset._locked_error(throttle, now).retry_after_sec == 91
    throttle.locked_until = now + timedelta(milliseconds=10)
    assert password_reset._locked_error(throttle, now).retry_after_sec == 1
