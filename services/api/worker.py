"""OCR 后台 Worker（PRD §9：自有持久队列，不依赖厂商回调）。

单线程轮询：QUEUED → PREPROCESSING → PROCESSING → POSTPROCESSING →
SUCCEEDED / PARTIAL_SUCCESS / FAILED；CANCEL_REQUESTED → CANCELLED。
进程重启后把中断的非终态任务重新排队（不丢任务、不重复计费——
恢复时仅在任务仍处于 QUEUED/PREPROCESSING 时继续；PROCESSING 中
厂商是否已接收无法对账，按 PRD §12.4 标记 FAILED(uncertain) 保守处理）。

同一个轮询循环还挂了套餐到期提醒的低频触发（见 `_maybe_sweep_reminders`）：
每 30 分钟检查一次「今天（泰国自然日）是否已跑过」，避免每 2 秒扫订阅表。
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from flask import Flask

logger = logging.getLogger(__name__)

TERMINAL = {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}
MAX_VENDOR_RETRIES = 3  # FR-OCR-017：首次调用之外最多 3 次重试，共最多 4 次调用。
# 到期提醒的调度间隔：仅决定「多久检查一次」，当天是否已跑过由 _reminder_day 判断，
# 真正的发送唯一性由 plan_reminders 唯一约束保证（多实例并行时内存标记不可信）
REMINDER_CHECK_SECONDS = 30 * 60


class OcrWorker:
    def __init__(self, app: Flask, poll_seconds: float = 2.0) -> None:
        self.app = app
        self.poll_seconds = poll_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._next_reminder_check = 0.0  # 单调时钟；0 表示启动后第一圈就检查
        self._reminder_day = None  # 最近一次成功 sweep 的泰国自然日

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="ocr-worker", daemon=True)
        self._thread.start()
        logger.info("OCR worker started")

    def stop(self) -> None:
        self._stop.set()

    def _recover_stale_jobs(self) -> None:
        """FR-OCR-017：未知供应商结果不自动重排，避免重新开启三次重试预算。"""
        from datetime import datetime, timedelta, timezone

        from extensions import db
        from models import OcrJob

        with self.app.app_context():
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            stale_before = now - timedelta(minutes=10)
            # 只有尚未调用 TextIn 的阶段可以恢复入队；条件更新避免覆盖推进中的任务。
            OcrJob.query.filter(
                OcrJob.status == "PREPROCESSING", OcrJob.updated_at < stale_before,
            ).update({"status": "QUEUED", "progress": 0}, synchronize_session=False)
            OcrJob.query.filter(
                OcrJob.status.in_(["PROCESSING", "POSTPROCESSING"]),
                OcrJob.updated_at < stale_before,
            ).update({
                "status": "FAILED", "error_code": "VENDOR_UNCERTAIN",
                "error_message": "TextIn result uncertain after worker recovery; use manual Retry.",
                "finished_at": now,
            }, synchronize_session=False)
            OcrJob.query.filter_by(status="CANCEL_REQUESTED").update(
                {"status": "CANCELLED", "finished_at": now}, synchronize_session=False,
            )
            db.session.commit()

    def _loop(self) -> None:
        from extensions import db
        from models import OcrJob

        self._recover_stale_jobs()

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
            except Exception:  # noqa: BLE001 worker 永不退出
                logger.exception("OCR worker 轮询异常")
            try:
                self._maybe_sweep_reminders()
            except Exception:  # noqa: BLE001 提醒失败同样不能让 worker 退出
                logger.exception("套餐到期提醒调度异常")
            self._stop.wait(self.poll_seconds)

    # ---- 套餐到期提醒（每日一次，独立 app_context） ----

    def _maybe_sweep_reminders(self) -> None:
        """低频触发：30 分钟检查一次，当天已跑过就不再扫订阅表。

        内存标记只用于省掉重复扫库，不作为幂等保证——本地与 Cloud Run 共用同一个
        库、可能多实例并行，同一节点只发一次靠 plan_reminders 的唯一约束。
        """
        if not self.app.config.get("PLAN_REMINDERS_ENABLED", True):
            return
        now = time.monotonic()
        if now < self._next_reminder_check:
            return
        self._next_reminder_check = now + REMINDER_CHECK_SECONDS

        import reminders
        import subscriptions
        from models import _now

        with self.app.app_context():
            today = subscriptions.local_date(_now())
            if self._reminder_day == today:
                return
            stats = reminders.sweep()
            self._reminder_day = today
            logger.info("套餐到期提醒 sweep 完成 %s %s", today, stats)

    # ---- 状态推进（独立上下文，提交即持久） ----

    def _transition(self, job_id: str, status: str, *, progress: int | None = None,
                    error_code: str = "", error_message: str = "") -> None:
        from extensions import db
        from models import OcrJob

        job = db.session.get(OcrJob, job_id, with_for_update=True, populate_existing=True)
        if job is None or job.status in TERMINAL:
            db.session.rollback()
            return
        if job.status == "CANCEL_REQUESTED":
            job.status = "CANCELLED"
        else:
            job.status = status
            if progress is not None:
                job.progress = progress
            if error_code:
                job.error_code = error_code
            if error_message:
                job.error_message = error_message[:512]
        # FAILED/CANCELLED 不计入月页额度（pages_used 只统计非终态失败的任务），无需返还
        db.session.commit()

    def _cancel_requested(self, job_id: str) -> bool:
        from extensions import db
        from models import OcrJob

        job = db.session.get(OcrJob, job_id, populate_existing=True)
        # 另一实例可能已取消/结束任务或将不确定的供应商结果落为 FAILED。
        cancelled = job is None or job.status == "CANCEL_REQUESTED" or job.status in TERMINAL
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

        result: dict[str, Any] | None = None
        last_err: Exception | None = None
        for attempt in range(MAX_VENDOR_RETRIES + 1):
            # 退避/准备期间用户也可能取消；每次调用供应商前重新检查。
            if self._cancel_requested(job_id):
                self._transition(job_id, "CANCELLED")
                return
            try:
                from textin.adapter import run_extraction

                result = run_extraction(
                    client,
                    filename=file_name,
                    content=content,
                    params=params,
                )
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                if self._cancel_requested(job_id):
                    self._transition(job_id, "CANCELLED")
                    return
                if _is_retryable(e) and attempt < MAX_VENDOR_RETRIES:
                    delay = 2 ** (attempt + 1)
                    logger.warning(
                        "TextIn 可重试错误 job=%s code=%s，%ds 后第 %d/%d 次重试",
                        job_id, _error_code(e), delay, attempt + 1, MAX_VENDOR_RETRIES,
                    )
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

        # FR-OCR-021：DeepSeek 整理之前保存 TextIn llm_json 原样副本（OCR 解析结果，模板映射唯一输入）
        import copy
        import uuid

        raw_payload = copy.deepcopy(result["structured"])
        # design D6：开启模板映射后 v1 通用结果直接使用 TextIn 结果，不再调用 DeepSeek
        mapping_enabled = bool(self.app.config.get("TEMPLATE_MAPPING_ENABLED"))

        refiner = ""
        import deepseek

        if not mapping_enabled and deepseek.is_configured(self.app.config):
            try:
                from textin.adapter import _count_structure

                refined = deepseek.refine_json(result["structured"], self.app.config)
                result["structured"] = refined
                result["table_count"], result["field_count"] = _count_structure(refined)
                refiner = str(self.app.config.get("DEEPSEEK_MODEL") or "deepseek")
            except Exception as e:  # noqa: BLE001 二次整理失败不影响主流程，保留 TextIn 结果
                logger.warning("DeepSeek 整理失败，沿用 TextIn JSON job=%s: %s", job_id, e)

        with self.app.app_context():
            # 持久化事务锁住并刷新任务行，避免恢复/取消已落终态后被成功结果覆盖。
            job = db.session.get(OcrJob, job_id, with_for_update=True, populate_existing=True)
            if job is None or job.status in TERMINAL:
                db.session.rollback()
                return
            if job.status == "CANCEL_REQUESTED":
                self._transition(job_id, "CANCELLED")
                return
            duration_ms = int((time.monotonic() - started) * 1000)
            from models import OcrRawResult

            raw = OcrRawResult(id=uuid.uuid4().hex, job_id=job_id, payload=raw_payload)
            db.session.add(raw)
            version = ResultVersion(
                job_id=job_id, version=1, is_current=True, created_by_user_id=None,
                structured=result["structured"],
            )
            db.session.add(version)
            if mapping_enabled:
                from doc_templates.service import create_auto_mapping

                db.session.flush()  # 生成 v1 主键，作为自动映射的 base_version_id
                create_auto_mapping(job, raw.id, version)
            job.duration_ms = result["duration_ms"] or duration_ms
            job.page_count = result["page_count"] or file_pages or 1
            job.table_count = result["table_count"]
            job.field_count = result["field_count"]
            job.missing_pages = list(result.get("missing_pages") or [])
            job.capability = {"vendor": "textin", **(job.capability or {}),
                              "field_source": result.get("field_source", "heuristic"),
                              **({"refiner": refiner} if refiner else {})}
            job.status = "PARTIAL_SUCCESS" if result["missing_pages"] else "SUCCEEDED"
            job.progress = 100
            job.started_at = job.started_at or datetime.now(timezone.utc).replace(tzinfo=None)
            job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

        # 审计副本
        try:
            import json
            from datetime import datetime, timezone

            storage.put_bytes(
                "audit",
                f"{job_id}.json",
                json.dumps(
                    {
                        "job_id": job_id,
                        "saved_at": datetime.now(timezone.utc).isoformat(),
                        "summary": {k: result[k] for k in
                                    ("page_count", "table_count", "field_count", "missing_pages",
                                     "duration_ms", "field_source", "vendor")},
                    },
                    ensure_ascii=False,
                ).encode("utf-8"),
                "application/json",
            )
        except Exception:  # noqa: BLE001
            logger.warning("审计副本写入失败 job=%s", job_id)
        # 不再发 OCR 完成站内通知：通知中心只承载账户变动（FR-SYS-018），任务进度看历史页阶段


def _is_retryable(err: Exception) -> bool:
    from textin.errors import TextInAPIError

    if isinstance(err, TextInAPIError):
        code = str(err.code)
        # 明确的余额/鉴权/参数错误优先，不被 HTTP 5xx 或错误文案误判成限流。
        transient_codes = {"408", "429", "458", "459", "30203", "40306", "-1"}
        numeric_code = int(code) if code.isdigit() else None
        if code not in transient_codes and numeric_code is not None:
            if 400 <= numeric_code < 500 or 40000 <= numeric_code < 50000:
                return False
        status = err.http_status
        if status is not None and 400 <= status < 500 and status not in {408, 429}:
            return False
        return (
            code in transient_codes
            or (numeric_code is not None and 500 <= numeric_code < 600)
            or (status is not None and (status in {408, 429} or 500 <= status < 600))
        )
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
