"""OCR engine and LLM settings bodies (FR-SYS-005)."""

from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class KeyStatusOut(BaseModel):
    textin: bool
    google_docai: bool
    llm: bool


class OcrSettingsOut(BaseModel):
    primary_engine: str
    backup_engine: str
    retry_per_document: int
    switch_threshold: int
    probe_interval_seconds: int
    llm_base_url: str
    llm_model: str
    keys: KeyStatusOut


class OcrSettingsIn(LooseRequest):
    """Only the fields present change."""

    primary_engine: str | None = None
    backup_engine: str | None = None
    retry_per_document: int | None = None
    switch_threshold: int | None = None
    probe_interval_seconds: int | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
