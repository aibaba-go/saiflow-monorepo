"""Uploads and files (documents spec)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class UploadIn(LooseRequest):
    file_name: str | None = None


class FileOut(BaseModel):
    id: str
    original_name: str
    status: Literal["UPLOADING", "UPLOADED", "READY", "REJECTED", "DELETED"]
    reject_reason: str | None
    mime_type: str | None
    size_bytes: int | None
    page_count: int | None
    expires_at: datetime | None
    created_at: datetime
