import re
from dataclasses import dataclass


@dataclass
class SentMail:
    to: str
    subject: str
    body: str

    @property
    def code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.body)
        assert match, self.body
        return match.group(1)


class FakeEmailSender:
    """Stands in for SmtpSender: records mail, or raises `fail_with`."""

    def __init__(self) -> None:
        self.sent: list[SentMail] = []
        self.fail_with: Exception | None = None

    async def send(self, to: str, subject: str, body: str) -> None:
        if self.fail_with:
            raise self.fail_with
        self.sent.append(SentMail(to, subject, body))
