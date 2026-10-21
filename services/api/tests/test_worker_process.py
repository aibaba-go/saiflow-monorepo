"""TDD: 第四轮 — _process_inner 端到端写入 capability.extractor / fallback_reason。

SQLite 内存库跑完整状态机（models 已为 SQLite 准备了 with_variant 主键）。
"""

from __future__ import annotations

from typing import Any

import pytest
from flask import Flask

from extensions import db
import worker


@pytest.fixture
def app(tmp_path) -> Flask:
    from config import Config

    app = Flask(__name__)
    app.config.from_object(Config)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{tmp_path / 'ocr.db'}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)
    import models  # noqa: F401 建表前必须先注册 db.metadata 里的全部表

    with app.app_context():
        db.create_all()
    app.extensions["textin_client"] = object()
    return app


@pytest.fixture
def job_factory(app: Flask, monkeypatch):
    """建 File + OcrJob，桩掉 storage / deepseek，返回建 job 的函数。"""
    from models import File, OcrJob, User

    monkeypatch.setattr("storage.exists", lambda path: True, raising=False)
    monkeypatch.setattr("storage.get_bytes", lambda path: b"png-bytes", raising=False)
    monkeypatch.setattr("storage.put_bytes", lambda *a, **k: None, raising=False)
    monkeypatch.setattr("deepseek.is_configured", lambda cfg: False, raising=False)

    def _make(params: dict[str, Any], *, v3_enabled: bool):
        app.config["EXTRACT_V3_ENABLED"] = v3_enabled
        with app.app_context():
            user = User(line_sub="u1")
            db.session.add(user)
            db.session.flush()
            file = File(
                created_by_user_id=user.id, uploader_user_id=user.id,
                original_name="doc.png", storage_path="s/doc.png", page_count=1, status="READY",
            )
            db.session.add(file)
            db.session.flush()
            job = OcrJob(
                created_by_user_id=user.id, file_id=file.id, params=params,
                capability={"vendor": "textin"},
            )
            db.session.add(job)
            db.session.commit()
            return job.id

    return _make


def _v3_ok(client, **kwargs):
    return {"vendor": "textin", "structured": {"invoice_number": "INV-9"}, "field_source": "extract_v3",
            "page_count": 1, "duration_ms": 5, "missing_pages": [],
            "table_count": 0, "field_count": 1}


def _prompt_ok(client, **kwargs):
    return {"vendor": "textin", "structured": {"llm_key": "llm_val"}, "field_source": "prompt",
            "page_count": 1, "duration_ms": 5, "missing_pages": [],
            "table_count": 0, "field_count": 1}


def _capability(app: Flask, job_id: str) -> dict:
    from models import OcrJob

    with app.app_context():
        return dict(db.session.get(OcrJob, job_id).capability)


def test_process_writes_extractor_extract_v3(app, job_factory, monkeypatch):
    """cfg=extract_v3 成功 → capability.extractor='extract_v3'，不写 fallback_reason。"""
    calls: list[str] = []
    monkeypatch.setattr("textin.adapter.run_extraction_v3",
                        lambda c, **k: calls.append("v3") or _v3_ok(c), raising=False)
    monkeypatch.setattr("textin.adapter.run_extraction",
                        lambda c, **k: calls.append("prompt") or _prompt_ok(c), raising=False)

    job_id = job_factory({}, v3_enabled=True)
    worker.OcrWorker(app)._process(job_id)

    capability = _capability(app, job_id)
    assert calls == ["v3"]
    assert capability["extractor"] == "extract_v3"
    assert capability["parser"] == "parse/sync"
    assert "fallback_reason" not in capability


def test_process_writes_prompt_fallback_reason(app, job_factory, monkeypatch):
    """v3 抛厂商错 → 回退 prompt，extractor='prompt_fallback'，fallback_reason='vendor_error'。"""
    from textin.errors import TextInAPIError

    calls: list[str] = []

    def v3_fail(c, **k):
        calls.append("v3")
        raise TextInAPIError(40003, "schema not configured")

    monkeypatch.setattr("textin.adapter.run_extraction_v3", v3_fail, raising=False)
    monkeypatch.setattr("textin.adapter.run_extraction",
                        lambda c, **k: calls.append("prompt") or _prompt_ok(c), raising=False)
    monkeypatch.setattr(worker, "_is_retryable", lambda e: False)

    job_id = job_factory({}, v3_enabled=True)
    worker.OcrWorker(app)._process(job_id)

    capability = _capability(app, job_id)
    assert calls == ["v3", "prompt"]
    assert capability["extractor"] == "prompt_fallback"
    assert capability["fallback_reason"] == "vendor_error"
    assert capability["parser"] == "parse/sync"


def test_process_writes_extractor_prompt_without_fallback(app, job_factory, monkeypatch):
    """cfg=prompt → extractor='prompt'，无 fallback_reason。"""
    calls: list[str] = []
    monkeypatch.setattr("textin.adapter.run_extraction_v3",
                        lambda c, **k: calls.append("v3") or _v3_ok(c), raising=False)
    monkeypatch.setattr("textin.adapter.run_extraction",
                        lambda c, **k: calls.append("prompt") or _prompt_ok(c), raising=False)

    job_id = job_factory({"extract_v3": False}, v3_enabled=True)
    worker.OcrWorker(app)._process(job_id)

    capability = _capability(app, job_id)
    assert calls == ["prompt"]
    assert capability["extractor"] == "prompt"
    assert "parser" not in capability
    assert "fallback_reason" not in capability