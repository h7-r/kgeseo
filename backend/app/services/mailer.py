"""메일 발송(11/25, 비밀번호 찾기 코드). 설정 `MAIL_BACKEND` 하나로 고른다.

- `disabled`: 보내지 않는다. 메일이 필요한 기능은 `MailUnavailableError` 를 받아 503 으로 답한다.
- `console`: 서버 로그에 적는다(개발 전용 — production 설정 검사가 막는다).
- `smtp`: 표준 라이브러리 smtplib 로 보낸다. AWS SES SMTP · Gmail 등 어느 SMTP 든 환경 값만 바꾸면 된다.

`MAIL_TEST_RECIPIENTS` 가 있으면 그 주소에만 보낸다(시험 발송 기간). 목록 밖 주소는 꺼짐과 같게 다룬다.

smtplib 는 동기라 스레드에서 돌린다(이벤트 루프가 다른 요청을 계속 받는다). 테스트는 `outbox` 를 바꿔 끼워 보낸 메일을 본다.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from starlette.concurrency import run_in_threadpool

from app.core.config import settings

logger = logging.getLogger("app.mail")
SMTP_TIMEOUT_SEC = 15


class MailUnavailableError(Exception):
    """메일 발송이 꺼져 있다(MAIL_BACKEND=disabled) · 시험 발송 기간이라 이 주소로는 보내지 않는다."""


class MailSendError(Exception):
    """SMTP 서버가 받지 않았거나 연결이 끊겼다. 원문은 로그에만 남기고 사용자에게는 내보내지 않는다."""


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    text: str


# 테스트가 바꿔 끼운다. None 이면 설정대로 보낸다.
outbox: Callable[[Mail], None] | None = None


def _address_key(address: str) -> str:
    # local_auth.normalize_email 과 같은 셈(가입 이메일이 저장된 모양) — 그 모듈을 부르면 순환 import 가 된다
    return unicodedata.normalize("NFC", address).strip().lower()


def _recipient_allowed(address: str) -> bool:
    allowed = {
        _address_key(item)
        for item in settings.mail_test_recipients.split(",")
        if item.strip()
    }
    return not allowed or _address_key(address) in allowed


def mail_available(to: str | None = None) -> bool:
    """보낼 수 있는가. `to` 를 주면 시험 발송 목록도 본다."""
    if outbox is None and settings.mail_backend == "disabled":
        return False
    return to is None or _recipient_allowed(to)


def _build(mail: Mail) -> EmailMessage:
    message = EmailMessage()
    name, address = parseaddr(settings.mail_from)
    message["From"] = formataddr((name, address)) if address else settings.mail_from
    message["To"] = mail.to
    message["Subject"] = mail.subject
    message.set_content(mail.text)
    return message


def _send_smtp(mail: Mail) -> None:
    message = _build(mail)
    context = ssl.create_default_context()
    try:
        if settings.smtp_ssl:
            server: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=SMTP_TIMEOUT_SEC,
                context=context,
            )
        else:
            server = smtplib.SMTP(
                settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SEC
            )
        with server:
            if settings.smtp_starttls and not settings.smtp_ssl:
                server.starttls(context=context)
            if settings.smtp_username:
                server.login(
                    settings.smtp_username, settings.smtp_password.get_secret_value()
                )
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        # 받는 주소는 로그에 남기지 않는다(개인정보). 오류 종류만 남긴다
        logger.error("mail send failed: %s", type(error).__name__)
        raise MailSendError from error


async def send_mail(mail: Mail) -> None:
    # 앞에서 거르지만 한 번 더 — 목록 밖 주소로는 어떤 메일도 나가지 않게
    if not _recipient_allowed(mail.to):
        raise MailUnavailableError
    if outbox is not None:
        outbox(mail)
        return
    if settings.mail_backend == "disabled":
        raise MailUnavailableError
    if settings.mail_backend == "console":
        logger.warning(
            "[dev mail] to=%s subject=%s\n%s", mail.to, mail.subject, mail.text
        )
        return
    await run_in_threadpool(_send_smtp, mail)
