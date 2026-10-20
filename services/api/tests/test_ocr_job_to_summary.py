"""OcrJob.to_summary 在 DocFlow 迁移后必须暴露 vendor 标识符字段。

对应 task 4.4 的验证：
- `task_id` / `batch_number` / `category` / `recognition_status` 出现在 to_summary 返回里。
- `task_id` 映射自 `vendor_task_id`；其余三个同理。
- 字段在 vendor 还没填时返 None 或缺省（旧任务迁移不崩）。
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

import models


@pytest.fixture
def app() -> Flask:
    """Minimal Flask app bound to Flask-SQLAlchemy so OcrJob attribute
    descriptors operate without `Working outside of application context.`.
    """
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db = SQLAlchemy(app)
    # Force the OcrJob class to bind to THIS app's metadata so descriptor
    # lookups hit the right default values.
    with app.app_context():
        db.create_all()
    return app


def _make_job(app: Flask, **overrides):
    """Construct a transient OcrJob with sensible defaults and explicit
    vendor-* overrides where supplied. No DB session needed — not added,
    not committed.
    """
    with app.app_context():
        job = models.OcrJob(
            id=overrides.get("id", "job-1"),
            workspace_type=overrides.get("workspace_type", "PERSONAL"),
            enterprise_id=overrides.get("enterprise_id", None),
            file_id=overrides.get("file_id", "file-1"),
            status=overrides.get("status", "SUCCEEDED"),
            progress=overrides.get("progress", 100),
            page_count=overrides.get("page_count", 1),
            table_count=overrides.get("table_count", 0),
            field_count=overrides.get("field_count", 0),
            duration_ms=overrides.get("duration_ms", 250),
            review_status=overrides.get("review_status", "UNREVIEWED"),
            error_code=overrides.get("error_code", ""),
            error_message=overrides.get("error_message", ""),
            parent_job_id=overrides.get("parent_job_id", None),
            created_at=overrides.get(
                "created_at", datetime(2026, 10, 19, 12, 0, 0, tzinfo=timezone.utc)
            ),
            finished_at=overrides.get(
                "finished_at", datetime(2026, 10, 19, 12, 1, 0, tzinfo=timezone.utc)
            ),
            vendor_task_id=overrides.get("vendor_task_id", None),
            vendor_batch_number=overrides.get("vendor_batch_number", None),
            vendor_category=overrides.get("vendor_category", None),
            recognition_status=overrides.get("recognition_status", None),
        )
        return job.to_summary()


def test_to_summary_exposes_task_id_alias_to_vendor_task_id(app: Flask) -> None:
    """summary 字段名 = `task_id`（前端按此读取），值来自 `vendor_task_id`。"""
    summary = _make_job(app, vendor_task_id="task-docflow-99")
    assert summary["task_id"] == "task-docflow-99"


def test_to_summary_exposes_batch_number_alias_to_vendor_batch_number(app: Flask) -> None:
    """summary 字段名 = `batch_number`，值来自 `vendor_batch_number`。"""
    summary = _make_job(app, vendor_batch_number="BN-2026-10-19")
    assert summary["batch_number"] == "BN-2026-10-19"


def test_to_summary_exposes_category_alias_to_vendor_category(app: Flask) -> None:
    """summary 字段名 = `category`，值来自 `vendor_category`。"""
    summary = _make_job(app, vendor_category="invoice")
    assert summary["category"] == "invoice"


def test_to_summary_exposes_recognition_status_int_value(app: Flask) -> None:
    """`recognition_status`（vendor 返回值 0..20）原样进 summary。"""
    summary = _make_job(app, recognition_status=1)
    assert summary["recognition_status"] == 1
    assert isinstance(summary["recognition_status"], int)


def test_to_summary_all_four_vendor_fields_default_none_for_legacy_job(app: Flask) -> None:
    """迁移前的老任务（未填 vendor_* 字段）→ 4 个 vendor 字段均为 None，不崩。"""
    summary = _make_job(app)
    for field in ("task_id", "batch_number", "category", "recognition_status"):
        assert field in summary, f"{field} missing in summary"
        assert summary[field] is None, f"{field} should default to None for legacy rows"


def test_to_summary_preserves_existing_fields_alongside_vendor_ids(app: Flask) -> None:
    """迁移不能偷偷丢字段；老的 summary 字段全部还在。"""
    summary = _make_job(
        app,
        vendor_task_id="t-1",
        vendor_batch_number="b-1",
        vendor_category="invoice",
        recognition_status=1,
    )
    assert summary["id"] == "job-1"
    assert summary["status"] == "SUCCEEDED"
    assert summary["page_count"] == 1
    assert summary["duration_ms"] == 250
    # 老的字段没动
    assert summary["error_code"] == ""
    assert summary["error_message"] == ""
    assert summary["parent_job_id"] is None


def test_to_summary_uses_isoformat_timestamps(app: Flask) -> None:
    """created_at / finished_at 是 ISO 字符串（与前端期望格式一致）。"""
    summary = _make_job(
        app,
        created_at=datetime(2026, 10, 19, 12, 0, 0, tzinfo=timezone.utc),
        finished_at=datetime(2026, 10, 19, 12, 1, 0, tzinfo=timezone.utc),
    )
    assert summary["created_at"] == "2026-10-19T12:00:00+00:00"
    assert summary["finished_at"] == "2026-10-19T12:01:00+00:00"


def test_to_summary_vendor_fields_present_even_when_failed(app: Flask) -> None:
    """FAILED 任务也保留 vendor 标识（识别失败的 task_id 等也要进 audit）。"""
    summary = _make_job(
        app,
        status="FAILED",
        error_code="DOCFLOW_RECOGNITION_FAILED",
        error_message="[low_conf] OCR borked",
        vendor_task_id="t-failed-1",
        vendor_batch_number="b-failed-1",
        vendor_category="invoice",
        recognition_status=2,
    )
    assert summary["status"] == "FAILED"
    assert summary["task_id"] == "t-failed-1"
    assert summary["batch_number"] == "b-failed-1"
    assert summary["category"] == "invoice"
    assert summary["recognition_status"] == 2

