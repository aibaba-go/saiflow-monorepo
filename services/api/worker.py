"""OCR 后台 Worker（PRD §9：自有持久队列，不依赖厂商回调）。

单线程轮询：QUEUED → PREPROCESSING → PROCESSING → POSTPROCESSING →
SUCCEEDED / PARTIAL_SUCCESS / FAILED；CANCEL_REQUESTED → CANCELLED。
进程重启后把中断的非终态任务重新排队（不丢任务、不重复计费——
恢复时仅在任务仍处于 QUEUED/PREPROCESSING 时继续；PROCESSING 中
厂商是否已接收无法对账，按 PRD §12.4 标记 FAILED(uncertain) 保守处理）。

DocFlow 适配：`_process_inner` 调 `textin.adapter.run_extraction`；识别结果
按 `result["status"]` 映射到 OcrJob，并把 vendor 标识
（vendor_task_id / vendor_batch_number / vendor_category / recognition_status）
持久化以便排障 + 重试；审计 JSON 写入完整 structured 摘要。
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from flask import Flask

logger = logging.getLogger(__name__)

TERMINAL = {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}
MAX_VENDOR_RETRIES = 3  # 限流类错误的有界指数退避（PRD §12.4）

# Map adapter run_extraction status → OcrJob.status string.
_STATUS_MAP: dict[str, str] = {
    "SUCCEEDED": "SUCCEEDED",
    "PARTIAL_SUCCESS": "PARTIAL_SUCCESS",
    "FAILED": "FAILED",
}


def _truncate(s: str | None, limit: int = 512) -> str:
    s = s or ""
    return s[:limit]


def apply_extraction_to_job(job, result: dict[str, Any], duration_ms: int) -> None:
    """Pure mapping: take an OcrJob ORM instance + the run_extraction result and
    update all fields that depend on a successful vendor response.

    Side effects:
      - Sets `status`, `progress`, `duration_ms`, `page_count`, `table_count`,
        `field_count`, `vendor_task_id`, `vendor_batch_number`, `vendor_category`,
        `recognition_status`, `capability` (vendor="textin-docflow"), `error_code`,
        `error_message`.

    Note: this helper does NOT commit, transition to a worker state, or open a
    DB session. The caller owns those so the helper stays a pure function and
    is testable without Flask context.
    """
    status_raw = result.get("status") or "FAILED"
    job.status = _STATUS_MAP.get(status_raw, "FAILED")

    if job.status == "FAILED":
        # 任务失败时把 vendor 错误码与可读信息写入 OcrJob。
        job.error_code = (result.get("error_code") or "OCR_FAILED")
        job.error_message = _truncate(result.get("error_message"))

    structured = result.get("structured") or {}
    if not isinstance(structured, dict):
        structured = {}

    job.duration_ms = result.get("duration_ms") or duration_ms
    job.page_count = (
        result.get("page_count")
        or getattr(job, "file", None) and getattr(job.file, "page_count", 0)
        or 1
    )
    job.table_count = result.get("table_count", 0) or 0
    job.field_count = result.get("field_count", 0) or 0

    job.vendor_task_id = result.get("task_id")
    job.vendor_batch_number = result.get("batch_number")
    job.vendor_category = result.get("category")
    rs = structured.get("recognition_status")
    job.recognition_status = rs if isinstance(rs, int) else None

    # Capability 摘要：保留用户已有的能力快照，只覆盖 vendor 字段。
    capability = dict(job.capability or {})
    capability["vendor"] = result.get("vendor") or "textin-docflow"
    capability.pop("field_source", None)  # 老 vendor 的字段源不再适用
    job.capability = capability


def build_audit_payload(
    job_id: str,
    result: dict[str, Any],
    *,
    saved_at: str,
    duration_ms: int,
) -> dict[str, Any]:
    """Build the audit JSON snapshot.

    Includes the full `structured` payload so post-mortem on a failed job
    has enough vendor context without re-fetching. Heavy keys (pages /
    handwritings / stamps) are kept verbatim — audit storage is sized for it.
    """
    summary: dict[str, Any] = {
        "vendor": result.get("vendor"),
        "status": result.get("status"),
        "page_count": result.get("page_count"),
        "table_count": result.get("table_count"),
        "field_count": result.get("field_count"),
        "duration_ms": result.get("duration_ms") or duration_ms,
        "task_id": result.get("task_id"),
        "batch_number": result.get("batch_number"),
        "category": result.get("category"),
        "error_code": result.get("error_code"),
        "error_message": result.get("error_message"),
        "structured": result.get("structured"),
    }
    return {"job_id": job_id, "saved_at": saved_at, "summary": summary}


class OcrWorker:
    def __init__(self, app: Flask, poll_seconds: float = 2.0) -> None:
        self.app = app
        self.poll_seconds = poll_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="ocr-worker", daemon=True)
        self._thread.start()
        logger.info("OCR worker started")

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        from datetime import datetime, timedelta, timezone

        import quota
        from extensions import db
        from models import OcrJob

        with self.app.app_context():
            # 重启恢复：中断的任务重新入队；已请求取消的直接落终态（不再计费）
            # 库为多实例共享：只回收长时间无进展的任务，避免抢走其他实例正在处理的任务
            stale_before = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
            stuck = OcrJob.query.filter(
                OcrJob.status.in_(["PREPROCESSING", "PROCESSING", "POSTPROCESSING"]),
                OcrJob.updated_at < stale_before,
            ).all()
            for job in stuck:
                job.status = "QUEUED"
                job.progress = 0
            cancelling = OcrJob.query.filter_by(status="CANCEL_REQUESTED").all()
            for job in cancelling:
                job.status = "CANCELLED"
                job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                quota.refund_for_job(job.id)
            db.session.commit()

        while not self._stop.is_set():
            try:
                # 取到任务 ID 即结束轮询事务，避免处理期间长时间 idle in transaction 占锁
                with self.app.app_context():
                    job = (
                        OcrJob.query.filter_by(status="QUEUED")
                        .order_by(OcrJob.created_at.asc())
                        .first()
                    )
                    job_id = job.id if job is not None else None
                if job_id is not None:
                    self._process(job_id)
            except Exception:
                logger.exception("OCR worker 轮询异常")
            self._stop.wait(self.poll_seconds)

    # ---- 状态推进（独立上下文，提交即持久） ----

    def _transition(self, job_id: str, status: str, *, progress: int | None = None,
                    error_code: str = "", error_message: str = "") -> None:
        import quota
        from extensions import db
        from models import OcrJob

        job = db.session.get(OcrJob, job_id)
        if job is None:
            return
        job.status = status
        if progress is not None:
            job.progress = progress
        if error_code:
            job.error_code = error_code
        if error_message:
            job.error_message = error_message[:512]
        if status in ("FAILED", "CANCELLED"):
            # 未产出可用结果：返还本次免费任务消耗（幂等）
            try:
                quota.refund_for_job(job_id)
            except Exception:
                logger.exception("配额返还失败 job=%s", job_id)
        db.session.commit()

    def _cancel_requested(self, job_id: str) -> bool:
        from extensions import db
        from models import OcrJob

        job = db.session.get(OcrJob, job_id)
        cancelled = job is not None and job.status == "CANCEL_REQUESTED"
        # 只读检查后立即结束事务：调用方随后可能等待 TextIn/重试退避，不能 idle in transaction 占锁
        db.session.rollback()
        return cancelled

    # ---- 任务处理 ----

    def _process(self, job_id: str) -> None:
        with self.app.app_context():
            self._process_inner(job_id)

    def _process_inner(self, job_id: str) -> None:
        from datetime import datetime, timezone

        from extensions import db
        from models import File, OcrJob, ResultVersion

        # 条件更新原子认领：本地与 Cloud Run 共用一个库，多个 worker 可能同时看到同一 QUEUED 任务
        claimed = (
            OcrJob.query.filter_by(id=job_id, status="QUEUED")
            .update({"status": "PREPROCESSING", "progress": 10}, synchronize_session=False)
        )
        db.session.commit()
        if not claimed:
            return
        job = db.session.get(OcrJob, job_id)

        if self._cancel_requested(job_id):
            self._transition(job_id, "CANCELLED")
            return

        file = db.session.get(File, job.file_id)
        if file is None or file.status != "READY":
            self._transition(job_id, "FAILED", error_code="FILE_NOT_READY",
                             error_message="source file missing or not READY")
            return
        import storage

        if not storage.exists(file.storage_path):
            self._transition(job_id, "FAILED", error_code="FILE_MISSING",
                             error_message="source file bytes missing")
            return

        client = self.app.extensions.get("textin_client")
        if client is None:
            self._transition(job_id, "FAILED", error_code="OCR_VENDOR_UNAVAILABLE",
                             error_message="TextIn client not configured")
            return

# 外部调用所需的值先读出：_transition 提交后 ORM 对象过期，再访问属性会隐式开读事务，
        # 并在整个 TextIn/DeepSeek 调用期间 idle in transaction 持有 ocr_jobs/files 的表锁
        file_pages = file.page_count
        file_name = file.original_name or f"{file.id}"
        storage_path = file.storage_path
        params = dict(job.params or {})
        params.pop("field_names", None)  # Prompt 模式不使用自定义字段

        self._transition(job_id, "PROCESSING", progress=30)

        content = storage.get_bytes(storage_path)
        started = time.monotonic()
        content_type = "application/octet-stream"

        result: dict[str, Any] | None = None
        last_err: Exception | None = None
        for attempt in range(MAX_VENDOR_RETRIES):
            try:
                from textin.adapter import run_extraction

                result = run_extraction(
                    client,
                    filename=file_name,
                    content=content,
                    content_type=content_type,
                    params=params,
                )
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                if self._cancel_requested(job_id):
                    self._transition(job_id, "CANCELLED")
                    return
                if _is_retryable(e) and attempt < MAX_VENDOR_RETRIES - 1:
                    delay = 2 ** (attempt + 1)
                    logger.warning("TextIn 可重试错误（%s），%ds 后第 %d 次重试", e, delay, attempt + 2)
                    time.sleep(delay)
                else:
                    break

        if result is None:
            err = last_err or RuntimeError("unknown")
            self._transition(job_id, "FAILED", error_code=_error_code(err),
                             error_message=str(err)[:512])
            return

        if self._cancel_requested(job_id):
            self._transition(job_id, "CANCELLED")
            return

        self._transition(job_id, "POSTPROCESSING", progress=80)

        import deepseek

        if deepseek.is_configured(self.app.config):
            try:
                from textin.adapter import _count_structure

                refined = deepseek.refine_json(result["structured"], self.app.config)
                result["structured"] = refined
                result["table_count"], result["field_count"] = _count_structure(refined)
            except Exception as e:  # noqa: BLE001 二次整理失败不影响主流程，保留 DocFlow 结果
                logger.warning("DeepSeek 整理失败，沿用 DocFlow JSON job=%s: %s", job_id, e)

        with self.app.app_context():
            job = db.session.get(OcrJob, job_id)
            duration_ms = int((time.monotonic() - started) * 1000)
            version = ResultVersion(
                job_id=job_id, version=1, is_current=True, created_by_user_id=None,
                structured=result["structured"],
            )
            db.session.add(version)
            apply_extraction_to_job(job, result, duration_ms)
            job.progress = 100
            job.started_at = job.started_at or datetime.now(timezone.utc).replace(tzinfo=None)
            job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

        # 审计副本 + 完成通知
        try:
            import json
            from datetime import datetime as _dt
            from datetime import timezone as _tz

            storage.put_bytes(
                "audit",
                f"{job_id}.json",
                json.dumps(
                    build_audit_payload(
                        job_id,
                        result,
                        saved_at=_dt.now(_tz.utc).isoformat(),
                        duration_ms=int((time.monotonic() - started) * 1000),
                    ),
                    ensure_ascii=False,
                ).encode("utf-8"),
                "application/json",
            )
        except Exception:  # noqa: BLE001
            logger.warning("审计副本写入失败 job=%s", job_id)

        from auth import notify
        from models import User

        with self.app.app_context():
            job = db.session.get(OcrJob, job_id)
            user = db.session.get(User, job.created_by_user_id)
            if user is not None:
                notify(
                    user.id, "OCR_DONE",
                    "OCR task finished",
                    f"job {job_id} -> {job.status}",
                )


def call_extraction_with_retry(
    client,
    *,
    filename: str,
    content: bytes,
    content_type: str,
    params: dict[str, Any] | None,
    max_retries: int = MAX_VENDOR_RETRIES,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Run `run_extraction` with bounded retry. Sleeps between retries via the
    injected `sleep` callable (tests pass a no-op). Returns the run_extraction
    dict on success; raises the last exception if no retry budget remains or
    the error is non-retryable.
    """
    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            from textin.adapter import run_extraction

            return run_extraction(
                client,
                filename=filename,
                content=content,
                content_type=content_type,
                params=params,
            )
        except Exception as e:
            last_err = e
            if _is_retryable(e) and attempt < max_retries - 1:
                sleep(2 ** (attempt + 1))
                continue
            raise
    # Unreachable when attempt >= 1; defensive only.
    assert last_err is not None
    raise last_err


def _is_retryable(err: Exception) -> bool:
    from textin.errors import TextInAPIError

    if isinstance(err, TextInAPIError):
        return str(err.code) in {"429", "458", "459"} or "rate" in err.msg.lower()
    import httpx

    return isinstance(err, (httpx.TransportError, httpx.TimeoutException))


def _error_code(err: Exception) -> str:
    from textin.errors import TextInAPIError

    if isinstance(err, TextInAPIError):
        return f"TEXTIN_ERROR_{err.code}"
    import httpx

    if isinstance(err, httpx.TimeoutException):
        return "VENDOR_TIMEOUT"
    if isinstance(err, httpx.TransportError):
        return "VENDOR_TRANSPORT"
    return "OCR_FAILED"


_worker: OcrWorker | None = None


def start_worker(app: Flask) -> None:
    """应用启动时拉起 worker（debug reloader 下仅主进程启动一次）。"""
    global _worker
    if _worker is not None:
        return
    import os

    if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return  # reloader 子进程未起时跳过，实际请求进程才启动
    _worker = OcrWorker(app)
    _worker.start()
