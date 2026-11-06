"""The recognition worker (FR-OCR-018, FR-OCR-022): its own process (`saiflow-be-ocr`),
never inside the web service (ADR-009 class C). Rules from main's `worker.py`:

- a QUEUED job is claimed with a conditional update (several workers may run);
- QUEUED → PREPROCESSING → PROCESSING (engine) → POSTPROCESSING → SUCCEEDED / PARTIAL_SUCCESS,
  or FAILED / CANCELLED with the reservation released (once);
- the cancel flag is checked before and after every engine call, and a job that ended
  meanwhile is never overwritten;
- on start, recovery re-queues jobs that never reached the engine and fails, as
  "result uncertain", jobs whose engine call may have happened.
"""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clock import utcnow
from app.config import Settings
from app.integrations.storage import ObjectMissing, ObjectStore
from app.models import File, OcrJob, OcrRawResult, ResultVersion
from app.ocr import mapping_worker, states
from app.ocr.engines import (
    Engine,
    EngineFailure,
    EngineUnavailable,
    JobCancelled,
    build_engines,
    recognise,
)
from app.ocr.files import sniff
from app.services import mapping_service, ocr_settings_service, upload_service
from app.services.job_service import release_once

log = logging.getLogger("app.ocr.worker")
STALE_AFTER = timedelta(minutes=10)
RECOVER_EVERY = 60.0  # seconds between recovery checks while the loop runs


def _count(node) -> tuple[int, int]:
    from app.ocr.textin.adapter import _count_structure

    return _count_structure(node) if node is not None else (0, 0)


async def _claim(sm: async_sessionmaker[AsyncSession], now: datetime) -> str | None:
    async with sm() as db:
        job_id = (
            await db.execute(
                text(
                    "update ocr_jobs set status = 'PREPROCESSING', progress = 10, "
                    "started_at = coalesce(started_at, :now), updated_at = :now "
                    "where id = (select id from ocr_jobs where status = 'QUEUED' "
                    "order by created_at, id limit 1 for update skip locked) returning id"
                ),
                {"now": now},
            )
        ).scalar()
        await db.commit()
        return job_id


async def _finish(
    sm: async_sessionmaker[AsyncSession],
    job_id: str,
    status: str,
    *,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """End (or move on) a job under its row lock; a job that ended meanwhile stays as it is.
    A requested cancel always wins. FAILED and CANCELLED give the scans back."""
    async with sm() as db:
        job = (
            await db.execute(select(OcrJob).where(OcrJob.id == job_id).with_for_update())
        ).scalar_one_or_none()
        if job is None or job.status in states.TERMINAL:
            return
        now = utcnow()
        if job.status == states.CANCEL_REQUESTED:
            status = states.CANCELLED
        job.status, job.updated_at = status, now
        if status == states.FAILED:
            job.error_code, job.error_message = error_code, (error_message or None)
        if status in states.TERMINAL:
            job.finished_at = now
        if status in (states.FAILED, states.CANCELLED):
            await release_once(db, job)
        await db.commit()


async def _cancel_requested(sm: async_sessionmaker[AsyncSession], job_id: str) -> bool:
    async with sm() as db:
        status = (await db.execute(select(OcrJob.status).where(OcrJob.id == job_id))).scalar()
    return status is None or status == states.CANCEL_REQUESTED or status in states.TERMINAL


def _page_texts(raw) -> dict:
    """What a generic result is built from when the engine gave no structure (Vision):
    the text of each page, not the coordinates."""
    pages = raw.get("pages") if isinstance(raw, dict) else None
    texts = [((p or {}).get("fullTextAnnotation") or {}).get("text", "") for p in (pages or [])]
    return {"pages": texts}


async def _generic(raw, llm: dict, transport) -> dict | None:
    """The generic result from the LLM (FR-OCR-023); None when the LLM is unavailable."""
    from app.ocr import deepseek

    if not deepseek.is_configured(llm):
        return None
    try:
        return await asyncio.to_thread(
            deepseek.refine_json, _page_texts(raw), llm, transport=transport
        )
    except Exception:  # noqa: BLE001  no generic structure: the person still sees the job
        log.warning("generic result could not be built")
        return None


async def _save(sm, job_id: str, result, started: datetime, structured=None) -> None:
    async with sm() as db:
        job = (
            await db.execute(select(OcrJob).where(OcrJob.id == job_id).with_for_update())
        ).scalar_one_or_none()
        if job is None or job.status in states.TERMINAL:
            return
        if job.status == states.CANCEL_REQUESTED:
            await db.rollback()
            await _finish(sm, job_id, states.CANCELLED)
            return
        raw = OcrRawResult(
            id=str(uuid.uuid4()), job_id=job.id, engine=result.engine, payload=result.raw
        )
        version = ResultVersion(
            id=str(uuid.uuid4()),
            job_id=job.id,
            version=1,
            is_current=True,
            structured=result.structured if structured is None else structured,
        )
        db.add_all([raw, version])
        now = utcnow()
        job.engine = result.engine
        job.page_count = result.page_count or job.page_count
        job.table_count, job.field_count = _count(version.structured)
        job.missing_pages = list(result.missing_pages or [])
        job.duration_ms = result.duration_ms or int((now - started).total_seconds() * 1000)
        job.status = states.PARTIAL_SUCCESS if result.missing_pages else states.SUCCEEDED
        job.progress, job.finished_at, job.updated_at = 100, now, now
        await db.flush()
        await mapping_service.start_auto_mapping(db, job, raw, version)  # FR-OCR-019
        await db.commit()


async def run_once(
    sm: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    *,
    engines: dict[str, Engine] | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    now: Callable[[], datetime] = utcnow,
    llm_transport=None,
) -> bool:
    """Process the oldest queued job; False when there was none. An unexpected error (a
    storage or database hiccup) ends the job as WORKER_ERROR with its scans returned, so
    it is never left mid-way (final review 1)."""
    started = now()
    job_id = await _claim(sm, started)
    if job_id is None:
        return False
    try:
        await _process(sm, store, settings, job_id, started, engines, sleep, now, llm_transport)
    except Exception:
        log.exception("ocr job %s failed unexpectedly", job_id)
        await _finish(sm, job_id, states.FAILED, error_code="WORKER_ERROR")
    return True


async def _process(
    sm, store, settings, job_id, started, engines, sleep, now, llm_transport
) -> None:
    async with sm() as db:
        job = await db.get(OcrJob, job_id)
        file = await db.get(File, job.file_id) if job else None
        ocr = await ocr_settings_service.get(db)
    if job is None:
        return
    if file is None or file.status != "READY":
        await _finish(sm, job_id, states.FAILED, error_code="FILE_NOT_READY")
        return
    try:
        content = await store.get(file.storage_path or "")
    except ObjectMissing:
        await _finish(sm, job_id, states.FAILED, error_code="FILE_MISSING")
        return
    if await _cancel_requested(sm, job_id):
        await _finish(sm, job_id, states.CANCELLED)
        return
    await _finish(sm, job_id, states.PROCESSING)
    try:
        result = await recognise(
            sm,
            kind=sniff(content) or "png",
            content=content,
            filename=file.original_name,
            pages=file.page_count or 1,
            settings=ocr,
            engines=build_engines(settings) if engines is None else engines,
            now=now(),
            sleep=sleep,
            cancelled=lambda: _cancel_requested(sm, job_id),
        )
    except JobCancelled:
        await _finish(sm, job_id, states.CANCELLED)
        return
    except EngineUnavailable:
        await _finish(sm, job_id, states.FAILED, error_code="OCR_UNAVAILABLE")
        return
    except EngineFailure as err:
        code = "OCR_UNAVAILABLE" if err.kind == "service" and not err.code else err.code
        await _finish(sm, job_id, states.FAILED, error_code=code, error_message=err.message)
        return
    if await _cancel_requested(sm, job_id):
        await _finish(sm, job_id, states.CANCELLED)
        return
    await _finish(sm, job_id, states.POSTPROCESSING)
    generic = None
    if result.structured is None:  # Vision gives text only: the LLM builds the generic result
        generic = await _generic(
            result.raw, mapping_service.llm_config(ocr, settings), llm_transport
        )
    await _save(sm, job_id, result, started, generic)


async def recover(
    sm: async_sessionmaker[AsyncSession], now: datetime, *, startup: bool = False
) -> None:
    """Jobs left behind (main `_recover_stale_jobs`): jobs that never reached the engine go
    back to the queue; jobs whose engine call may have happened fail, uncertain, and are
    retried by hand only; requested cancels end. Scans of failed or cancelled jobs return.
    At startup nothing can still be running (one worker), so age does not matter; while
    the loop runs, only jobs untouched for 10 minutes are taken (final review 1)."""
    stale = now if startup else now - STALE_AFTER
    async with sm() as db:
        await db.execute(
            update(OcrJob)
            .where(OcrJob.status == states.PREPROCESSING, OcrJob.updated_at < stale)
            .values(status=states.QUEUED, progress=0, updated_at=now)
        )
        doomed = list(
            (
                await db.execute(
                    select(OcrJob)
                    .where(
                        (
                            OcrJob.status.in_((states.PROCESSING, states.POSTPROCESSING))
                            & (OcrJob.updated_at < stale)
                        )
                        | (OcrJob.status == states.CANCEL_REQUESTED)
                    )
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        for job in doomed:
            if job.status == states.CANCEL_REQUESTED:
                job.status = states.CANCELLED
            else:
                job.status, job.error_code = states.FAILED, "VENDOR_UNCERTAIN"
                job.error_message = "engine result uncertain after a restart; rerun by hand"
            job.finished_at = job.updated_at = now
            await release_once(db, job)
        await db.commit()


async def purge_uploads(sm: async_sessionmaker[AsyncSession], store: ObjectStore) -> int:
    async with sm() as db:
        count = await upload_service.purge_expired(db, store)
        await db.commit()
        return count


async def loop(
    sm: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    stop: asyncio.Event,
) -> None:
    await recover(sm, utcnow(), startup=True)
    await mapping_worker.recover(sm, startup=True)
    last_purge = last_recover = asyncio.get_running_loop().time()
    while not stop.is_set():
        busy = False
        try:
            if settings.ocr_worker_enabled:
                busy = await run_once(sm, store, settings)
                busy = await mapping_worker.run_once(sm, settings) or busy
                clock = asyncio.get_running_loop().time()
                if clock - last_purge > 60:
                    await purge_uploads(sm, store)
                    last_purge = clock
            clock = asyncio.get_running_loop().time()
            if clock - last_recover >= RECOVER_EVERY:
                await recover(sm, utcnow())
                await mapping_worker.recover(sm)
                last_recover = clock
        except Exception:
            log.exception("ocr worker pass failed")
        if not busy:
            try:
                await asyncio.wait_for(stop.wait(), settings.ocr_poll_seconds)
            except TimeoutError:
                pass
