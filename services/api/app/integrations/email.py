"""Outgoing mail over an encrypted SMTP connection (STARTTLS or implicit TLS).

Transient failures (connection problems, timeouts, 4xx replies) are retried (D5);
5xx replies are permanent. The caller sees EmailRejected when the recipient was refused
permanently, otherwise EmailUnavailable."""

import asyncio
import re
from collections.abc import Awaitable, Callable
from email.message import EmailMessage
from typing import Literal

import aiosmtplib

from app.retry import with_retries


class EmailUnavailable(Exception):
    pass


class EmailRejected(EmailUnavailable):
    """The server refused the recipient permanently (5xx): the address is the problem,
    not the service (AC-FR-SYS-020-09). Our own account being refused (535) is not this."""


_ENHANCED = re.compile(r"^\s*([245])\.(\d{1,3})\.(\d{1,3})(?:\s|$)")
_ADDRESS_CODES = {550, 551, 553}


def _address_refused(code: int, message: str) -> bool:
    """Whether a refusal means the address itself is bad (M2). An enhanced status code
    decides when present (5.1.x = addressing); otherwise only 550/551/553 count. Relay
    and policy refusals (e.g. 554 5.7.1) are our setup, not the user's address."""
    enhanced = _ENHANCED.match(message or "")
    if enhanced:
        return enhanced.group(1) == "5" and enhanced.group(2) == "1"
    return code in _ADDRESS_CODES


def _is_recipient_rejection(exc: BaseException) -> bool:
    if isinstance(exc, aiosmtplib.SMTPRecipientsRefused):
        return bool(exc.recipients) and all(
            _address_refused(r.code, r.message) for r in exc.recipients
        )
    return isinstance(exc, aiosmtplib.SMTPRecipientRefused) and _address_refused(
        exc.code, exc.message
    )


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, aiosmtplib.SMTPRecipientsRefused):  # M3: 4xx at RCPT (greylisting)
        return bool(exc.recipients) and all(400 <= r.code < 500 for r in exc.recipients)
    if isinstance(exc, aiosmtplib.SMTPResponseException):
        return 400 <= exc.code < 500
    return isinstance(
        exc,
        aiosmtplib.SMTPConnectError
        | aiosmtplib.SMTPServerDisconnected
        | aiosmtplib.SMTPTimeoutError
        | TimeoutError
        | OSError,
    )


def _reason(exc: BaseException) -> str:
    """Error class plus the server reply or connection message; never the password."""
    if isinstance(exc, aiosmtplib.SMTPResponseException):
        return f"{type(exc).__name__}: {exc.code} {exc.message}"
    return f"{type(exc).__name__}: {exc}"


class SmtpSender:
    def __init__(
        self,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        sender: str,
        security: Literal["starttls", "ssl"],
        send: Callable[..., Awaitable[object]] = aiosmtplib.send,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.host, self.port, self.username, self.password = host, port, username, password
        self.sender, self.security, self._send, self.sleep = sender, security, send, sleep

    async def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = self.sender, to, subject
        message.set_content(body)

        async def call() -> object:
            return await self._send(
                message,
                hostname=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                use_tls=self.security == "ssl",
                start_tls=self.security == "starttls",
                timeout=10,
            )

        try:
            await with_retries(call, is_transient=_is_transient, sleep=self.sleep)
        except Exception as exc:
            if _is_recipient_rejection(exc):
                raise EmailRejected(_reason(exc)) from None
            raise EmailUnavailable(_reason(exc)) from None


def smtp_sender_from(settings) -> SmtpSender | None:
    """The sender configured by SMTP_* variables, or None when SMTP is not configured."""
    if not (settings.smtp_host and settings.smtp_from):
        return None
    return SmtpSender(
        settings.smtp_host,
        settings.smtp_port,
        settings.smtp_username,
        settings.smtp_password.get_secret_value() if settings.smtp_password else None,
        settings.smtp_from,
        settings.smtp_security,
    )
