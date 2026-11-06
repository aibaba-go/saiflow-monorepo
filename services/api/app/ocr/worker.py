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
from app.ocr import states
from app.ocr.engines import (
    Engine,
    EngineFailure,
    EngineUnavailable,
    JobCancelled,
    build_engines,
    recognise,
)
from app.ocr.files import sniff
from app.services import ocr_settings_service, upload_service
from app.services.job_service import release_once

log = logging.getLogger("app.ocr.worker")
STALE_AFTER = timedelta(minutes=10)

# Task 8 sets this: start the automatic template mapping in the same transaction.
AfterRecognition = Callable[[AsyncSession, OcrJob, OcrRawResult, ResultVersion], Awaitable[None]]


async def _nothing(db, job, raw, version) -> None:
    return None


after_recognition: AfterRecognition = _nothing


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


async def _save(sm, job_id: str, result, started: datetime) -> None:
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
            structured=result.structured,
        )
        db.add_all([raw, version])
        now = utcnow()
        job.engine = result.engine
        job.page_count = result.page_count or job.page_count
        job.table_count, job.field_count = _count(result.structured)
        job.missing_pages = list(result.missing_pages or [])
        job.duration_ms = result.duration_ms or int((now - started).total_seconds() * 1000)
        job.status = states.PARTIAL_SUCCESS if result.missing_pages else states.SUCCEEDED
        job.progress, job.finished_at, job.updated_at = 100, now, now
        await db.flush()
        await after_recognition(db, job, raw, version)
        await db.commit()


async def run_once(
    sm: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    *,
    engines: dict[str, Engine] | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    now: Callable[[], datetime] = utcnow,
) -> bool:
    """Process the oldest queued job; False when there was none."""
    started = now()
    job_id = await _claim(sm, started)
    if job_id is None:
        return False
    async with sm() as db:
        job = await db.get(OcrJob, job_id)
        file = await db.get(File, job.file_id) if job else None
        ocr = await ocr_settings_service.get(db)
    if job is None:
        return True
    if file is None or file.status != "READY":
        await _finish(sm, job_id, states.FAILED, error_code="FILE_NOT_READY")
        return True
    try:
        content = await store.get(file.storage_path or "")
    except ObjectMissing:
        await _finish(sm, job_id, states.FAILED, error_code="FILE_MISSING")
        return True
    if await _cancel_requested(sm, job_id):
        await _finish(sm, job_id, states.CANCELLED)
        return True
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
        return True
    except EngineUnavailable:
        await _finish(sm, job_id, states.FAILED, error_code="OCR_UNAVAILABLE")
        return True
    except EngineFailure as err:
        code = "OCR_UNAVAILABLE" if err.kind == "service" and not err.code else err.code
        await _finish(sm, job_id, states.FAILED, error_code=code, error_message=err.message)
        return True
    if await _cancel_requested(sm, job_id):
        await _finish(sm, job_id, states.CANCELLED)
        return True
    await _finish(sm, job_id, states.POSTPROCESSING)
    await _save(sm, job_id, result, started)
    return True


async def recover(sm: async_sessionmaker[AsyncSession], now: datetime) -> None:
    """After a restart (main `_recover_stale_jobs`): jobs that never reached the engine go
    back to the queue; jobs whose engine call may have happened fail, uncertain, and are
    retried by hand only; requested cancels end. Scans of failed or cancelled jobs return."""
    stale = now - STALE_AFTER
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


# Task 8 sets this: one pass of template mapping work after recognition.
mapping_pass: Callable[..., Awaitable[bool]] | None = None


async def loop(
    sm: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    stop: asyncio.Event,
) -> None:
    await recover(sm, utcnow())
    last_purge = 0.0
    while not stop.is_set():
        busy = False
        try:
            if settings.ocr_worker_enabled:
                busy = await run_once(sm, store, settings)
                if mapping_pass is not None:
                    busy = await mapping_pass(sm, settings) or busy
                clock = asyncio.get_running_loop().time()
                if clock - last_purge > 60:
                    await purge_uploads(sm, store)
                    last_purge = clock
        except Exception:
            log.exception("ocr worker pass failed")
        if not busy:
            try:
                await asyncio.wait_for(stop.wait(), settings.ocr_poll_seconds)
            except TimeoutError:
                pass
