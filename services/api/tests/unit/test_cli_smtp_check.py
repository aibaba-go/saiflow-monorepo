import pytest

from app import cli
from app.integrations.email import EmailUnavailable, SmtpSender

SECRET = "smtp-secret-value"


@pytest.fixture
def base_env(monkeypatch):
    for key, value in {"DB_HOST": "h", "DB_NAME": "n", "DB_USER": "u", "DB_PASSWORD": "p"}.items():
        monkeypatch.setenv(key, value)
    for key in ["SMTP_HOST", "SMTP_FROM", "SMTP_USERNAME", "SMTP_PASSWORD"]:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def smtp_env(base_env, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_FROM", "no-reply@example.com")
    monkeypatch.setenv("SMTP_USERNAME", "user")
    monkeypatch.setenv("SMTP_PASSWORD", SECRET)


def test_not_configured(base_env, capsys):
    assert cli.main(["smtp-check", "a@example.com"]) == 1
    assert "smtp not configured" in capsys.readouterr().out


def test_ok(smtp_env, monkeypatch, capsys):
    sent = []

    async def fake_send(self, to, subject, body):
        sent.append((to, subject))

    monkeypatch.setattr(SmtpSender, "send", fake_send)
    assert cli.main(["smtp-check", "a@example.com"]) == 0
    assert "smtp OK" in capsys.readouterr().out
    assert sent == [("a@example.com", "SaiFlow SMTP check")]


def test_failure_hides_password(smtp_env, monkeypatch, capsys):
    async def failing(self, to, subject, body):
        raise EmailUnavailable("SMTPAuthenticationError: 535 bad login")

    monkeypatch.setattr(SmtpSender, "send", failing)
    assert cli.main(["smtp-check", "a@example.com"]) == 1
    out = capsys.readouterr()
    assert "smtp FAILED: SMTPAuthenticationError: 535 bad login" in out.out
    assert SECRET not in out.out + out.err
