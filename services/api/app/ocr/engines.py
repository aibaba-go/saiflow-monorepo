"""Which OCR engine reads a document, and what happens when it fails (FR-OCR-021).

- Per document: a service failure (timeout, transport, throttling, server error, balance or
  key problem) is retried `retry_per_document` times with backoff 2, 4, 8 … seconds; then the
  backup engine gets the same budget. A content failure (unreadable image, bad file) fails at
  once, is not retried, is not sent to the backup, and does not count.
- Globally: consecutive service failures of the primary are counted in `ocr_engine_health`;
  at `switch_threshold` the primary is switched off, and documents go to the backup. Every
  `probe_interval_seconds` one document tries the primary first; a success switches back.

Engines are synchronous (moved TextIn code, httpx.Client); they run in a worker thread.
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import OcrEngineHealth
from app.ocr.textin.errors import TextInAPIError
from app.ocr.vision import VisionError
from app.services.ocr_settings_service import OcrSettings

Kind = Literal["service", "content"]

# TextIn codes that mean "try again" (main worker._is_retryable)
TEXTIN_TRANSIENT = {"408", "429", "458", "459", "30203", "40306", "-1"}


@dataclass
class EngineResult:
    engine: str
    raw: Any
    structured: Any  # TextIn's prompt-mode JSON; None for Vision (built later, FR-OCR-023)
    page_count: int
    missing_pages: list[int] = field(default_factory=list)
    duration_ms: int = 0


class EngineFailure(RuntimeError):
    def __init__(self, kind: Kind, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.kind, self.code, self.message = kind, code, message


class EngineUnavailable(RuntimeError):
    """No configured engine can be used (keys missing)."""


class Engine(Protocol):
    name: str

    def run(self, *, kind: str, content: bytes, filename: str, pages: int) -> EngineResult: ...


def classify(err: BaseException) -> Kind:
    if isinstance(err, (httpx.TimeoutException, httpx.TransportError)):
        return "service"
    if isinstance(err, TextInAPIError):
        code = str(err.code)
        if code in TEXTIN_TRANSIENT:
            return "service"
        status = err.http_status
        if status is not None and (status in (408, 429) or status >= 500):
            return "service"
        numeric = int(code) if code.lstrip("-").isdigit() else None
        if numeric is not None and 500 <= numeric < 600:
            return "service"
        return "content"
    if isinstance(err, VisionError):
        status = err.http_status
        if status is None:
            return "content"  # an error inside one page's response
        # throttling, outage, or a key/billing problem: the service, not the document
        if status in (401, 403, 408, 429) or status >= 500:
            return "service"
        return "content"
    if isinstance(err, EngineFailure):
        return err.kind
    return "content"


def error_code(engine: str, err: BaseException) -> str:
    if isinstance(err, EngineFailure):
        return err.code
    if isinstance(err, httpx.TimeoutException):
        return "VENDOR_TIMEOUT"
    if isinstance(err, httpx.TransportError):
        return "VENDOR_TRANSPORT"
    if isinstance(err, TextInAPIError):
        return f"TEXTIN_ERROR_{err.code}"
    if isinstance(err, VisionError):
        return f"VISION_ERROR_{err.code}"
    return "OCR_CONTENT_FAILED"


async def _health(sm: async_sessionmaker[AsyncSession], engine: str) -> OcrEngineHealth | None:
    async with sm() as db:
        return await db.get(OcrEngineHealth, engine)


async def _update_health(
    sm: async_sessionmaker[AsyncSession], engine: str, change: Callable[[OcrEngineHealth], None]
) -> None:
    async with sm() as db:
        row = (
            await db.execute(
                select(OcrEngineHealth).where(OcrEngineHealth.engine == engine).with_for_update()
            )
        ).scalar_one_or_none()
        if row is None:
            row = OcrEngineHealth(engine=engine, consecutive_failures=0)
            db.add(row)
        change(row)
        await db.commit()


def _record_failure(threshold: int, now: datetime, has_backup: bool):
    def change(row: OcrEngineHealth) -> None:
        row.consecutive_failures = (row.consecutive_failures or 0) + 1
        if has_backup and row.consecutive_failures >= threshold and row.switched_at is None:
            row.switched_at = now

    return change


def _record_success(row: OcrEngineHealth) -> None:
    row.consecutive_failures, row.switched_at = 0, None


async def _plan(
    sm, settings: OcrSettings, engines: dict[str, Engine], now: datetime
) -> list[tuple[str, int]]:
    """The engines to try, in order, each with its number of attempts."""
    primary = settings.primary_engine
    backup = settings.backup_engine if settings.backup_engine != "none" else None
    tries = settings.retry_per_document + 1
    order: list[tuple[str, int]] = [(primary, tries)] + ([(backup, tries)] if backup else [])
    health = await _health(sm, primary)
    if backup and health is not None and health.switched_at is not None:
        since = health.last_probe_at or health.switched_at
        if now - since >= timedelta(seconds=settings.probe_interval_seconds):
            await _update_health(sm, primary, lambda r: setattr(r, "last_probe_at", now))
            order = [(primary, 1), (backup, tries)]  # one probe, then the backup as usual
        else:
            order = [(backup, tries), (primary, tries)]  # switched: the primary is the fallback
    usable = [(name, n) for name, n in order if name in engines]
    if not usable:
        raise EngineUnavailable("no OCR engine is configured")
    return usable


async def recognise(
    sm: async_sessionmaker[AsyncSession],
    *,
    kind: str,
    content: bytes,
    filename: str,
    pages: int,
    settings: OcrSettings,
    engines: dict[str, Engine],
    now: datetime,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> EngineResult:
    """Read the document with the planned engines; raises EngineFailure or EngineUnavailable.
    `cancelled` is checked before every engine call (FR-OCR-022)."""
    plan = await _plan(sm, settings, engines, now)
    has_backup = settings.backup_engine != "none" and settings.backup_engine in engines
    last: EngineFailure | None = None
    for name, attempts in plan:
        engine = engines[name]
        for attempt in range(attempts):
            if cancelled is not None and await cancelled():
                raise asyncio.CancelledError
            try:
                result = await asyncio.to_thread(
                    engine.run, kind=kind, content=content, filename=filename, pages=pages
                )
            except Exception as err:  # noqa: BLE001  every engine error is classified
                failure = (
                    err
                    if isinstance(err, EngineFailure)
                    else EngineFailure(classify(err), error_code(name, err), str(err)[:300])
                )
                if failure.kind == "content":
                    raise failure from err
                last = failure
                if name == settings.primary_engine:
                    await _update_health(
                        sm, name, _record_failure(settings.switch_threshold, now, has_backup)
                    )
                if attempt < attempts - 1:
                    await sleep(2 ** (attempt + 1))
                continue
            if name == settings.primary_engine:
                await _update_health(sm, name, _record_success)
            return result
    assert last is not None
    raise last


class TextInEngine:
    """TextIn prompt-mode extraction (main's only OCR path): its JSON is both the raw result
    and the first structured result."""

    name = "textin"

    def __init__(self, client) -> None:
        self._client = client

    def run(self, *, kind: str, content: bytes, filename: str, pages: int) -> EngineResult:
        from app.ocr.textin.adapter import run_extraction

        out = run_extraction(self._client, filename=filename, content=content, params={})
        return EngineResult(
            engine=self.name,
            raw=out["structured"],
            structured=out["structured"],
            page_count=out["page_count"] or pages,
            missing_pages=list(out.get("missing_pages") or []),
            duration_ms=out.get("duration_ms") or 0,
        )


class VisionEngine:
    """Google Vision text detection: raw pages only; the LLM builds the structure later."""

    name = "google_vision"

    def __init__(self, client) -> None:
        self._client = client

    def run(self, *, kind: str, content: bytes, filename: str, pages: int) -> EngineResult:
        raw = self._client.annotate(content, kind, pages=pages)
        return EngineResult(
            engine=self.name, raw=raw, structured=None, page_count=len(raw["pages"]) or pages
        )


def build_engines(settings) -> dict[str, Engine]:
    """The engines whose keys are configured (FR-SYS-005 key status); others are unavailable."""
    from app.ocr.textin.client import TextInClient
    from app.ocr.textin.config import textin_settings
    from app.ocr.vision import VisionClient

    engines: dict[str, Engine] = {}
    textin = textin_settings(settings)
    if textin is not None:
        engines["textin"] = TextInEngine(TextInClient(textin))
    key = settings.google_vision_api_key
    if key is not None and key.get_secret_value().strip():
        engines["google_vision"] = VisionEngine(VisionClient(key))
    return engines
