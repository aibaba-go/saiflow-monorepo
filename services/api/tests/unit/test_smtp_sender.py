import aiosmtplib
import pytest

from app.integrations.email import EmailUnavailable, SmtpSender


class Sleep:
    def __init__(self):
        self.delays: list[float] = []

    async def __call__(self, d: float) -> None:
        self.delays.append(d)


def make(error: Exception | None, security="starttls"):
    calls: list[dict] = []

    async def send(message, **kwargs):
        calls.append({"message": message, **kwargs})
        if error is not None:
            raise error

    sleep = Sleep()
    sender = SmtpSender(
        "smtp.example.com",
        587,
        "user",
        "pw",
        "SaiFlow <no-reply@example.com>",
        security,
        send,
        sleep,
    )
    return sender, calls, sleep


async def test_smtp_retries_4xx_then_unavailable():  # AC-FR-SYS-020-06 (adapter)
    sender, calls, sleep = make(aiosmtplib.SMTPResponseException(451, "try later"))
    with pytest.raises(EmailUnavailable):
        await sender.send("a@example.com", "s", "b")
    assert len(calls) == 4 and sleep.delays == [0.5, 1.0, 2.0]


async def test_smtp_connect_error_is_transient():
    sender, calls, _ = make(aiosmtplib.SMTPConnectError("refused"))
    with pytest.raises(EmailUnavailable):
        await sender.send("a@example.com", "s", "b")
    assert len(calls) == 4


async def test_smtp_5xx_no_retry():
    sender, calls, _ = make(aiosmtplib.SMTPResponseException(550, "no such user"))
    with pytest.raises(EmailUnavailable):
        await sender.send("a@example.com", "s", "b")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "security,use_tls,start_tls", [("ssl", True, False), ("starttls", False, True)]
)
async def test_smtp_ssl_vs_starttls_flags(security, use_tls, start_tls):
    sender, calls, _ = make(None, security)
    await sender.send("a@example.com", "Subject", "Body")
    call = calls[0]
    assert call["use_tls"] is use_tls and call["start_tls"] is start_tls
    assert call["hostname"] == "smtp.example.com" and call["port"] == 587
    assert call["username"] == "user" and call["password"] == "pw"
    assert call["message"]["To"] == "a@example.com" and call["message"]["Subject"] == "Subject"
