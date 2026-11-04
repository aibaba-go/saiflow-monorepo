import aiosmtplib
import pytest

from app.integrations.email import EmailRejected, EmailUnavailable, SmtpSender


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


async def test_unavailable_carries_server_reply():
    sender, _, _ = make(
        aiosmtplib.SMTPAuthenticationError(535, "5.7.3 Authentication unsuccessful")
    )
    with pytest.raises(EmailUnavailable) as info:
        await sender.send("a@example.com", "s", "b")
    assert str(info.value) == "SMTPAuthenticationError: 535 5.7.3 Authentication unsuccessful"


async def test_unavailable_carries_connection_reason():
    sender, _, _ = make(aiosmtplib.SMTPServerDisconnected("Unexpected EOF received"))
    with pytest.raises(EmailUnavailable) as info:
        await sender.send("a@example.com", "s", "b")
    assert str(info.value) == "SMTPServerDisconnected: Unexpected EOF received"


async def test_recipient_refused_5xx_is_rejected_once():  # AC-FR-SYS-020-09 (adapter)
    refused = aiosmtplib.SMTPRecipientRefused(550, "no such user", "a@example.com")
    sender, calls, _ = make(aiosmtplib.SMTPRecipientsRefused([refused]))
    with pytest.raises(EmailRejected):
        await sender.send("a@example.com", "s", "b")
    assert len(calls) == 1


async def test_auth_failure_is_not_rejected():
    sender, _, _ = make(aiosmtplib.SMTPAuthenticationError(535, "bad"))
    with pytest.raises(EmailUnavailable) as info:
        await sender.send("a@example.com", "s", "b")
    assert not isinstance(info.value, EmailRejected)


async def test_recipient_refused_4xx_is_not_rejected():
    refused = aiosmtplib.SMTPRecipientRefused(450, "mailbox busy", "a@example.com")
    sender, _, _ = make(aiosmtplib.SMTPRecipientsRefused([refused]))
    with pytest.raises(EmailUnavailable) as info:
        await sender.send("a@example.com", "s", "b")
    assert not isinstance(info.value, EmailRejected)


def _refused(code: int, message: str) -> aiosmtplib.SMTPRecipientsRefused:
    return aiosmtplib.SMTPRecipientsRefused(
        [aiosmtplib.SMTPRecipientRefused(code, message, "a@example.com")]
    )


@pytest.mark.parametrize(
    "code,message",
    [(554, "5.7.1 Relay access denied"), (550, "5.7.1 Message rejected by policy")],
)
async def test_relay_or_policy_refusal_is_not_rejected(code, message):  # M2
    sender, _, _ = make(_refused(code, message))
    with pytest.raises(EmailUnavailable) as info:
        await sender.send("a@example.com", "s", "b")
    assert not isinstance(info.value, EmailRejected)


async def test_550_511_is_rejected():  # M2
    sender, calls, _ = make(_refused(550, "5.1.1 The email account does not exist"))
    with pytest.raises(EmailRejected):
        await sender.send("a@example.com", "s", "b")
    assert len(calls) == 1


async def test_rcpt_4xx_retried():  # M3
    sender, calls, sleep = make(_refused(450, "4.2.0 Mailbox busy, try later"))
    with pytest.raises(EmailUnavailable):
        await sender.send("a@example.com", "s", "b")
    assert len(calls) == 4 and sleep.delays == [0.5, 1.0, 2.0]
