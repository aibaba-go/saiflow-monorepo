"""OCR engine and LLM settings (FR-SYS-005, PRD §4.6), changed by the platform admin.

Recognition (B-3) reads them with `get(db)`: a missing row falls back to the default. Keys
are never stored here: they live in the server environment file and are only reported as
configured or not (`key_status`)."""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.errors import AppError
from app.models import SystemSetting
from app.ocr.docai import docai_configured
from app.ocr.states import ENGINES  # the selectable engines
from app.services.audit_service import record
from app.services.organization_service import Actor

# setting key → (attribute, default)
FIELDS: dict[str, tuple[str, object]] = {
    "ocr_primary_engine": ("primary_engine", "textin"),
    "ocr_backup_engine": ("backup_engine", "google_docai"),
    "ocr_retry_per_document": ("retry_per_document", 3),
    "ocr_switch_threshold": ("switch_threshold", 5),
    "ocr_probe_interval_seconds": ("probe_interval_seconds", 300),
    "llm_base_url": ("llm_base_url", "https://api.deepseek.com"),
    "llm_model": ("llm_model", "deepseek-flash"),
}
DEFAULTS = {key: default for key, (_, default) in FIELDS.items()}
INT_RANGES = {
    "retry_per_document": (1, 10),
    "switch_threshold": (1, 100),
    "probe_interval_seconds": (30, 86_400),
}


@dataclass(frozen=True)
class OcrSettings:
    primary_engine: str
    backup_engine: str
    retry_per_document: int
    switch_threshold: int
    probe_interval_seconds: int
    llm_base_url: str
    llm_model: str


async def get(db: AsyncSession) -> OcrSettings:
    """The current settings, for recognition and the admin console."""
    values = {}
    for key, (attr, default) in FIELDS.items():
        row = await db.get(SystemSetting, key)
        values[attr] = row.value if row is not None else default
    return OcrSettings(**values)


def _valid(attr: str, value: object, merged: dict) -> bool:
    if attr == "primary_engine":
        return value in ENGINES
    if attr == "backup_engine":
        return value == "none" or (value in ENGINES and value != merged["primary_engine"])
    if attr in INT_RANGES:
        low, high = INT_RANGES[attr]
        return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high
    if attr == "llm_base_url":
        return isinstance(value, str) and value.startswith("https://") and len(value) <= 500
    if attr == "llm_model":
        return isinstance(value, str) and 1 <= len(value.strip()) <= 100
    return False


async def update(db: AsyncSession, admin_id: int, changes: dict[str, object]) -> OcrSettings:
    """Apply the given fields (by attribute name); the whole result must be valid, else 400
    lists every bad field and nothing changes. Each changed key is audited."""
    current = await get(db)
    merged = {**current.__dict__, **changes}
    if isinstance(merged.get("llm_model"), str):
        merged["llm_model"] = merged["llm_model"].strip()
    bad = [attr for attr in current.__dict__ if not _valid(attr, merged[attr], merged)]
    if bad:
        # a primary change that collides with the unchanged backup points at the backup
        raise AppError(400, "validation_error", "error.validation", bad)
    actor = Actor("admin", admin_id)
    for key, (attr, _) in FIELDS.items():
        if merged[attr] == getattr(current, attr):
            continue
        row = await db.get(SystemSetting, key, with_for_update=True)
        if row is None:
            db.add(SystemSetting(key=key, value=merged[attr]))
        else:
            row.value, row.updated_at = merged[attr], utcnow()
        await record(db, actor.event("setting.update", "system_setting", key))
    await db.commit()
    return await get(db)


def key_status(settings: Settings) -> dict[str, bool]:
    """Whether each engine and the LLM have their keys in the environment (never the keys)."""

    def present(value) -> bool:
        if value is None:
            return False
        raw = value.get_secret_value() if hasattr(value, "get_secret_value") else value
        return bool(str(raw).strip())

    return {
        "textin": present(settings.textin_app_id) and present(settings.textin_secret_code),
        "google_docai": docai_configured(settings),
        "llm": present(settings.llm_api_key),
    }
