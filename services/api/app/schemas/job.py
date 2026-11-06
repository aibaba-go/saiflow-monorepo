"""OCR jobs (FR-OCR-017, FR-VERIFY-017)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.loose import LooseRequest

Stage = Literal[
    "OCR_PROCESSING",
    "OCR_FAILED",
    "TEMPLATE_MATCHING",
    "VERIFYING",
    "PENDING_REVIEW",
    "CONFIRMED",
]


class JobIn(LooseRequest):
    file_id: str | None = None
    idempotency_key: str | None = None


class JobOut(BaseModel):
    id: str
    file_id: str
    file_name: str
    page_count: int
    status: str
    stage: Stage
    error_code: str | None
    engine: str | None
    template_name: str | None
    created_at: datetime
    confirmed_at: datetime | None
    review_level: int | None = None  # 1 or 2 while waiting for review


class JobPageOut(BaseModel):
    items: list[JobOut]
    total: int
    page: int
    page_size: int
