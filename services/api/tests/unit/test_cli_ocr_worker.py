"""The OCR worker commands (ocr-scan-flow Task 7): one pass, and the compose loop."""

import pytest

from app import cli
from app.ocr import worker


@pytest.fixture
def patched(monkeypatch):
    for key, value in {"DB_HOST": "h", "DB_NAME": "n", "DB_USER": "u", "DB_PASSWORD": "p"}.items():
        monkeypatch.setenv(key, value)
    calls: list[str] = []

    class FakeEngine:
        async def dispose(self):
            calls.append("dispose")

    class FakeStore:
        def __init__(self, bucket, credentials_file=None):
            calls.append(f"store:{bucket}")

    async def fake_recover(sm, now):
        calls.append("recover")

    async def fake_run_once(sm, store, settings, **kw):
        calls.append("run_once")
        return False

    monkeypatch.setattr(cli, "create_engine", lambda settings: FakeEngine())
    monkeypatch.setattr(cli, "create_sessionmaker", lambda engine: object())
    monkeypatch.setattr(cli, "GcsStore", FakeStore)
    monkeypatch.setattr(worker, "recover", fake_recover)
    monkeypatch.setattr(worker, "run_once", fake_run_once)
    return calls


def test_run_once_recovers_then_processes(patched, monkeypatch, capsys):
    monkeypatch.setenv("GCS_BUCKET", "saiflow-docs-dev")
    assert cli.main(["ocr-worker-run-once"]) == 0
    assert patched == ["store:saiflow-docs-dev", "recover", "run_once", "dispose"]
    assert "ocr worker: idle" in capsys.readouterr().out


def test_without_bucket_nothing_is_processed(patched, monkeypatch, capsys):
    monkeypatch.delenv("GCS_BUCKET", raising=False)
    assert cli.main(["ocr-worker-run-once"]) == 0
    assert "run_once" not in patched  # jobs would all fail FILE_MISSING
    assert "GCS_BUCKET" in capsys.readouterr().out


def test_loop_command_is_registered():
    parser_help = cli.build_parser().format_help()
    assert "ocr-worker-loop" in parser_help and "ocr-worker-run-once" in parser_help
