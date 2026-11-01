"""模板映射 Worker（design D7、D11、D12，FR-OCR-018/019）。

独立线程（template-mapping-worker），与 OcrWorker 同处启动，避免大模型调用阻塞 OCR 队列；
仅在 TEMPLATE_MAPPING_ENABLED 开启时启动。本地与线上共用数据库：本地必须保持开关关闭，
否则本地 Worker 会处理线上映射。

- 每 2 秒取最早的 PENDING 映射，条件更新 `WHERE id = ? AND status = 'PENDING'` 认领（多实例安全）；
- PENDING → MATCHING（AUTO，未指定模板）→ CONVERTING → READY / FAILED；
- 每个阶段前后重读任务：任务结果已删除即中止且不写入；已确认仍完成但不自动生效；
- 大模型调用期间不持有数据库事务；
- 卡住恢复：启动时一次、之后每 5 分钟；MATCHING / CONVERTING 超过 10 分钟未更新 → FAILED / MAPPING_INTERRUPTED。
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from datetime import timedelta

from flask import Flask

logger = logging.getLogger(__name__)

STALE_MINUTES = 10
RECOVER_EVERY_SECONDS = 5 * 60


class MappingWorker:
    def __init__(
        self, app: Flask, poll_seconds: float = 2.0, *, transport=None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.app = app
        self.poll_seconds = poll_seconds
        self.transport = transport  # 测试注入 httpx.MockTransport
        self.sleep = sleep
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._next_recover = 0.0

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="template-mapping-worker", daemon=True)
        self._thread.start()
        logger.info("template mapping worker started")

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._maybe_recover()
                mapping_id = self.next_pending()
                if mapping_id is not None:
                    self.process(mapping_id)
                    continue  # 队列中可能还有，立即取下一个
            except Exception:
                logger.exception("template mapping worker 轮询异常")
            self._stop.wait(self.poll_seconds)

    # ---- 恢复 ----

    def _maybe_recover(self) -> None:
        now = time.monotonic()
        if now < self._next_recover:
            return
        self._next_recover = now + RECOVER_EVERY_SECONDS
        self.recover_stale()

    def recover_stale(self) -> int:
        from doc_templates import service
        from doc_templates.llm import MAPPING_INTERRUPTED
        from extensions import db
        from models import TemplateMapping

        count = 0
        with self.app.app_context():
            cutoff = service.now() - timedelta(minutes=STALE_MINUTES)
            ids = [
                m.id for m in TemplateMapping.query.filter(
                    TemplateMapping.status.in_((service.MATCHING, service.CONVERTING)),
                    TemplateMapping.updated_at < cutoff,
                ).all()
            ]
            db.session.rollback()
            for mapping_id in ids:
                if self._fail(mapping_id, MAPPING_INTERRUPTED, "mapping interrupted (worker restart or timeout)",
                              only_if_stale_before=cutoff):
                    count += 1
        if count:
            logger.warning("template mapping recovery: %d interrupted", count)
        return count

    # ---- 处理 ----

    def next_pending(self) -> str | None:
        from models import TemplateMapping

        with self.app.app_context():
            row = (
                TemplateMapping.query.filter_by(status="PENDING")
                .order_by(TemplateMapping.created_at.asc())
                .first()
            )
            return row.id if row is not None else None

    def process(self, mapping_id: str) -> None:
        with self.app.app_context():
            self._process_inner(mapping_id)

    def _claim(self, mapping_id: str) -> str | None:
        from doc_templates import service
        from extensions import db
        from models import TemplateMapping

        mapping = db.session.get(TemplateMapping, mapping_id)
        if mapping is None or mapping.status != service.PENDING:
            db.session.rollback()
            return None
        target = service.MATCHING if mapping.template_version_id is None else service.CONVERTING
        stamp = service.now()
        claimed = (
            TemplateMapping.query.filter_by(id=mapping_id, status=service.PENDING)
            .update({"status": target, "started_at": stamp, "updated_at": stamp}, synchronize_session=False)
        )
        db.session.commit()
        return target if claimed else None

    def _job_alive(self, job_id: str, mapping_id: str, expected_status: str) -> bool:
        """重读任务与映射：任务或映射已不存在（结果被删除）、或映射已被恢复置为失败 → 中止。"""
        from extensions import db
        from models import OcrJob, TemplateMapping

        job = db.session.get(OcrJob, job_id, populate_existing=True)
        mapping = db.session.get(TemplateMapping, mapping_id, populate_existing=True)
        alive = job is not None and mapping is not None and mapping.status == expected_status
        return alive

    def _process_inner(self, mapping_id: str) -> None:
        from doc_templates import converter, matcher, service
        from doc_templates.llm import RAW_RESULT_MISSING, LlmClient, MappingError
        from doc_templates.repository import available_versions
        from extensions import db
        from models import (
            DocumentTemplateVersion,
            OcrJob,
            OcrRawResult,
            TemplateMapping,
        )

        stage = self._claim(mapping_id)
        if stage is None:
            return
        started = time.monotonic()
        client = LlmClient(self.app.config, transport=self.transport, sleep=self.sleep)
        prompt_versions: list[str] = []
        mapping = db.session.get(TemplateMapping, mapping_id)
        job_id = mapping.job_id
        try:
            if not self._job_alive(job_id, mapping_id, stage):
                db.session.rollback()
                return
            raw = db.session.get(OcrRawResult, mapping.raw_result_id)
            if raw is None:
                raise MappingError(RAW_RESULT_MISSING, "raw result missing")
            payload = raw.payload
            job_tenant = db.session.get(OcrJob, job_id).tenant_id

            if stage == service.MATCHING:
                candidates = [
                    matcher.Candidate(t.id, v.id, v.name, v.description, v.groups)
                    for t, v in available_versions(job_tenant)
                ]
                db.session.rollback()  # 调用大模型前结束读事务
                if len(candidates) > 1:
                    prompt_versions.append(matcher.PROMPT_VERSION)
                result = matcher.match(client, payload, candidates)
                if not self._job_alive(job_id, mapping_id, service.MATCHING):
                    db.session.rollback()
                    return
                updated = (
                    TemplateMapping.query.filter_by(id=mapping_id, status=service.MATCHING)
                    .update({
                        "template_id": result.template_id,
                        "template_version_id": result.template_version_id,
                        "match_score": result.score,
                        "match_reason": (result.reason or "")[:255],
                        "candidates": result.ranking,
                        "status": service.CONVERTING,
                        "updated_at": service.now(),
                    }, synchronize_session=False)
                )
                db.session.commit()
                if not updated:
                    return
                mapping = db.session.get(TemplateMapping, mapping_id, populate_existing=True)

            ver = db.session.get(DocumentTemplateVersion, mapping.template_version_id)
            if ver is None:
                raise MappingError("TEMPLATE_UNAVAILABLE", "template version missing")
            groups, name = ver.groups, ver.name
            raw_text = matcher.compact_raw(payload)
            db.session.rollback()
            prompt_versions.append(converter.PROMPT_VERSION)
            structured, warnings, dropped = converter.convert(client, raw_text, name, groups)

            job = service.lock_job(job_id)
            mapping = db.session.get(TemplateMapping, mapping_id, with_for_update=True, populate_existing=True)
            if job is None or mapping is None or mapping.status != service.CONVERTING:
                db.session.rollback()
                return
            _, applied = service.finalize_ready(mapping, job, structured, warnings=warnings, dropped=dropped)
            self._stats(mapping, client, prompt_versions, started)
            db.session.commit()
            logger.info(
                "template mapping ready mapping=%s job=%s applied=%s calls=%d ms=%d",
                mapping_id, job_id, applied, client.usage.calls, mapping.duration_ms,
            )
        except MappingError as exc:
            db.session.rollback()
            self._fail(mapping_id, exc.code, exc.message, client=client, prompt_versions=prompt_versions,
                       started=started)
        except Exception:
            db.session.rollback()
            logger.exception("template mapping crashed mapping=%s", mapping_id)
            from doc_templates.llm import MAPPING_INTERRUPTED

            self._fail(mapping_id, MAPPING_INTERRUPTED, "internal error", client=client,
                       prompt_versions=prompt_versions, started=started)

    @staticmethod
    def _stats(mapping, client, prompt_versions: list[str], started: float) -> None:
        mapping.llm_calls = client.usage.calls
        mapping.prompt_tokens = client.usage.prompt_tokens
        mapping.completion_tokens = client.usage.completion_tokens
        mapping.model = client.model[:64] if client.usage.calls else ""
        mapping.prompt_version = "+".join(prompt_versions)[:32]
        mapping.duration_ms = int((time.monotonic() - started) * 1000)

    def _fail(
        self, mapping_id: str, code: str, message: str, *, client=None, prompt_versions=None,
        started: float | None = None, only_if_stale_before=None,
    ) -> bool:
        from doc_templates import service
        from extensions import db
        from models import TemplateMapping

        with self.app.app_context():
            mapping = db.session.get(TemplateMapping, mapping_id)
            if mapping is None:
                db.session.rollback()
                return False
            job = service.lock_job(mapping.job_id)
            mapping = db.session.get(TemplateMapping, mapping_id, with_for_update=True, populate_existing=True)
            if mapping is None or mapping.status in (service.READY, service.FAILED):
                db.session.rollback()
                return False
            if only_if_stale_before is not None and (
                mapping.status not in (service.MATCHING, service.CONVERTING)
                or mapping.updated_at is None or mapping.updated_at >= only_if_stale_before
            ):
                db.session.rollback()
                return False
            service.fail(mapping, job, code, message)
            if client is not None:
                self._stats(mapping, client, prompt_versions or [], started or time.monotonic())
            db.session.commit()
            logger.warning("template mapping failed mapping=%s code=%s", mapping_id, code)
            return True


_worker: MappingWorker | None = None


def start_mapping_worker(app: Flask) -> None:
    global _worker
    if _worker is not None or not app.config.get("TEMPLATE_MAPPING_ENABLED"):
        return
    import os

    if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return
    _worker = MappingWorker(app)
    _worker.start()
