"""OCR 后台 Worker（PRD §9：自有持久队列，不依赖厂商回调）。

单线程轮询：QUEUED → PREPROCESSING → PROCESSING → POSTPROCESSING →
SUCCEEDED / PARTIAL_SUCCESS / FAILED；CANCEL_REQUESTED → CANCELLED。
进程重启后把中断的非终态任务重新排队（不丢任务、不重复计费——
恢复时仅在任务仍处于 QUEUED/PREPROCESSING 时继续；PROCESSING 中
厂商是否已接收无法对账，按 PRD §12.4 标记 FAILED(uncertain) 保守处理）。
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Mapping

from flask import Flask

logger = logging.getLogger(__name__)

TERMINAL = {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}
MAX_VENDOR_RETRIES = 3  # 限流类错误的有界指数退避（PRD §12.4）


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

        from extensions import db
        from models import OcrJob
        import quota

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
            except Exception:  # noqa: BLE001 worker 永不退出
                logger.exception("OCR worker 轮询异常")
            self._stop.wait(self.poll_seconds)

    # ---- 状态推进（独立上下文，提交即持久） ----

    def _transition(self, job_id: str, status: str, *, progress: int | None = None,
                    error_code: str = "", error_message: str = "") -> None:
        from extensions import db
        from models import OcrJob
        import quota

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
            except Exception:  # noqa: BLE001 返还不阻塞状态落库
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

        try:
            result, actual_extractor, fallback_reason = _run_extraction_pipeline(
                client,
                app_config=self.app.config,
                params=params,
                filename=file_name,
                content=content,
                cancelled=lambda: self._cancel_requested(job_id),
            )
        except _ExtractionCancelled:
            self._transition(job_id, "CANCELLED")
            return
        except Exception as e:  # noqa: BLE001
            self._transition(job_id, "FAILED", error_code=_error_code(e),
                             error_message=str(e)[:512])
            return

        if self._cancel_requested(job_id):
            self._transition(job_id, "CANCELLED")
            return

        self._transition(job_id, "POSTPROCESSING", progress=80)

        refiner = ""
        import deepseek

        if deepseek.is_configured(self.app.config):
            try:
                from textin.adapter import _count_structure

                refined = deepseek.refine_json(result["structured"], self.app.config)
                result["structured"] = refined
                result["table_count"], result["field_count"] = _count_structure(refined)
                refiner = str(self.app.config.get("DEEPSEEK_MODEL") or "deepseek")
            except Exception as e:  # noqa: BLE001 二次整理失败不影响主流程，保留 TextIn 结果
                logger.warning("DeepSeek 整理失败，沿用 TextIn JSON job=%s: %s", job_id, e)

        with self.app.app_context():
            job = db.session.get(OcrJob, job_id)
            duration_ms = int((time.monotonic() - started) * 1000)
            version = ResultVersion(
                job_id=job_id, version=1, is_current=True, created_by_user_id=None,
                structured=result["structured"],
            )
            db.session.add(version)
            job.duration_ms = result["duration_ms"] or duration_ms
            job.page_count = result["page_count"] or file_pages or 1
            job.table_count = result["table_count"]
            job.field_count = result["field_count"]
            job.missing_pages = list(result.get("missing_pages") or [])
            job.capability = {"vendor": "textin", **(job.capability or {}),
                              "field_source": result.get("field_source", "heuristic"),
                              "extractor": actual_extractor,
                              **({"parser": "parse/sync"} if actual_extractor != "prompt" else {}),
                              **({"fallback_reason": fallback_reason} if fallback_reason else {}),
                              **({"refiner": refiner} if refiner else {})}
            job.status = "PARTIAL_SUCCESS" if result["missing_pages"] else "SUCCEEDED"
            job.progress = 100
            job.started_at = job.started_at or datetime.now(timezone.utc).replace(tzinfo=None)
            job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

        # 审计副本 + 完成通知
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


def _is_retryable(err: Exception) -> bool:
    from textin.errors import TextInAPIError

    if isinstance(err, TextInAPIError):
        return str(err.code) in {"429", "458", "459"} or "rate" in err.message.lower()
    import httpx

    return isinstance(err, (httpx.TransportError, httpx.TimeoutException))


def _select_extractor(app_config: Mapping[str, Any], params: Mapping[str, Any]) -> str:
    """决定走 extract-v3 还是 Prompt 模式。

    优先级: job.params["extract_v3"] 显式 > 全局 EXTRACT_V3_ENABLED。
    返回 'extract_v3' / 'prompt'。
    """
    per_job = params.get("extract_v3") if isinstance(params, Mapping) else None
    if per_job is True:
        return "extract_v3"
    if per_job is False:
        return "prompt"
    return "extract_v3" if app_config.get("EXTRACT_V3_ENABLED", False) else "prompt"


def _classify_fallback(err: Exception) -> str:
    """解析 extract-v3 失败原因，归入 design §6 枚举。"""
    from textin.errors import TextInAPIError

    if isinstance(err, TextInAPIError):
        # -1 是内部约定的归一器失败码（llm_json / extract-v3 响应不可解析）
        return "normalize_failed" if err.code == -1 else "vendor_error"
    return "empty_or_invalid"


class _ExtractionCancelled(Exception):
    """退避重试期间收到取消请求;调用方据此落 CANCELLED 而非 FAILED。"""


def _run_extraction_pipeline(
    client: Any,
    *,
    app_config: Mapping[str, Any],
    params: Mapping[str, Any],
    filename: str,
    content: bytes,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[dict[str, Any], str, str | None]:
    """按 cfg 选择 extract-v3 或 Prompt 路径;v3 失败自动回退 Prompt。

    返回 (result, actual_extractor, fallback_reason);终态失败时抛最后一次异常,
    交由调用方按 _error_code 落 FAILED;cancelled 回调为真时抛 _ExtractionCancelled。
    """
    from textin.adapter import run_extraction, run_extraction_v3

    extractor_target = _select_extractor(app_config, params)
    actual_extractor = extractor_target
    fallback_reason: str | None = None

    def _do(call):
        last_err: Exception | None = None
        for attempt in range(MAX_VENDOR_RETRIES):
            try:
                return call()
            except Exception as e:  # noqa: BLE001
                last_err = e
                if _is_retryable(e) and attempt < MAX_VENDOR_RETRIES - 1:
                    if cancelled is not None and cancelled():
                        raise _ExtractionCancelled from e
                    delay = 2 ** (attempt + 1)
                    logger.warning("TextIn 可重试错误（%s），%ds 后第 %d 次重试", e, delay, attempt + 2)
                    time.sleep(delay)
                else:
                    break
        raise last_err if last_err else RuntimeError("unknown")

    if extractor_target == "extract_v3":
        try:
            result = _do(lambda: run_extraction_v3(client, filename=filename, content=content, params=dict(params)))
        except _ExtractionCancelled:
            raise
        except Exception as e:  # noqa: BLE001
            fallback_reason = _classify_fallback(e)
            logger.warning("extract-v3 失败，回退 Prompt 模式: %s", e)
            actual_extractor = "prompt_fallback"
            result = _do(lambda: run_extraction(client, filename=filename, content=content, params=dict(params)))
    else:
        actual_extractor = "prompt"
        result = _do(lambda: run_extraction(client, filename=filename, content=content, params=dict(params)))

    return result, actual_extractor, fallback_reason


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
