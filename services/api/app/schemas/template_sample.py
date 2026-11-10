"""Template samples (FR-TEMPLATE-008, FR-TEMPLATE-014): progress, the candidate definition
and the sample values shown beside it (contract §4)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.loose import LooseRequest

SampleStatus = Literal["QUEUED", "OCR_RUNNING", "GENERATING", "READY", "FAILED", "CANCELED"]
SampleSource = Literal["UPLOAD", "OCR_RESULT"]
SampleStage = Literal["OCR", "GENERATE"]
SuggestionAttr = Literal["required", "primary", "role"]
# "<group>.<item>" → sample text; "<group>.<table>" → rows of cell texts in column order
SampleValue = str | None | list[list[str | None]]


class SampleFromJobIn(LooseRequest):
    job_id: str | None = None


class SampleSuggestion(BaseModel):
    """The model's opinion on one attribute; the person confirms or changes it."""

    path: str  # "groups[0].items[2]" or "groups[0].items[3].columns[1]"
    attr: SuggestionAttr
    value: bool | str | None


class SampleCandidate(BaseModel):
    content: dict[str, Any]  # {code, name, names?, description, groups} (TemplateDef shape)
    suggestions: list[SampleSuggestion]
    values: dict[str, SampleValue]


class SampleOut(BaseModel):
    id: str
    source: SampleSource
    source_job_id: str | None = None
    status: SampleStatus
    failed_stage: SampleStage | None
    error_code: str | None
    file_kind: str | None
    pages: int | None
    created_at: datetime
    expires_at: datetime
    ready_at: datetime | None
    charged_pages: int
    candidate: SampleCandidate | None = None


class SampleListOut(BaseModel):
    items: list[SampleOut]
