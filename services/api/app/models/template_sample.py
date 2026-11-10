"""Template samples (FR-TEMPLATE-008, FR-TEMPLATE-014; D8): a sample PDF/image or an existing
OCR result from which a candidate template definition is generated.

A sample is never a business document: it has no OcrJob / OcrRawResult / ResultVersion.
This table holds only non-sensitive metadata. The original file, the OCR payload and the
candidate (structure plus the sample values shown beside it) live as private objects under
the sample's own key prefix, are readable for at most seven days and are removed on delete
or expiry (`purged_at`). The DB backup therefore never carries sample content."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

_TS = DateTime(timezone=True)

SAMPLE_SOURCES = ("UPLOAD", "OCR_RESULT")
# QUEUED -> OCR_RUNNING -> GENERATING -> READY; FAILED (stage says where); CANCELED.
SAMPLE_STATUSES = ("QUEUED", "OCR_RUNNING", "GENERATING", "READY", "FAILED", "CANCELED")
SAMPLE_STAGES = ("OCR", "GENERATE")
SAMPLE_RETENTION_DAYS = 7


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class TemplateSample(Base):
    __tablename__ = "template_samples"
    __table_args__ = (
        CheckConstraint(f"source in ({_in(SAMPLE_SOURCES)})", name="template_samples_source"),
        CheckConstraint(f"status in ({_in(SAMPLE_STATUSES)})", name="template_samples_status"),
        CheckConstraint(
            f"failed_stage is null or failed_stage in ({_in(SAMPLE_STAGES)})",
            name="template_samples_failed_stage",
        ),
        CheckConstraint(
            "(source = 'OCR_RESULT') = (source_job_id is not null)",
            name="template_samples_source_job",
        ),
        # a sample belongs to a tenant user, or (no tenant, nothing charged) to an admin
        CheckConstraint(
            "(tenant_id is null) = (created_by_admin_id is not null)",
            name="template_samples_owner",
        ),
        CheckConstraint(
            "created_by_admin_id is null or (source = 'UPLOAD' and reservation_id is null)",
            name="template_samples_admin_upload",
        ),
        Index("ix_template_samples_status", "status", "created_at"),
        Index(
            "ix_template_samples_expires", "expires_at", postgresql_where=text("purged_at is null")
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    # NULL only for a platform admin's sample (created_by_admin_id set; FR-SYS-142)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tenants.id"), index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    created_by_admin_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("admin_accounts.id"), index=True
    )
    source: Mapped[str] = mapped_column(Text)
    source_job_id: Mapped[str | None] = mapped_column(Text, ForeignKey("ocr_jobs.id"), index=True)
    status: Mapped[str] = mapped_column(Text, server_default="QUEUED")
    failed_stage: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)
    file_kind: Mapped[str | None] = mapped_column(Text)  # jpg | png | pdf (by content)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    pages: Mapped[int | None] = mapped_column(Integer)
    # object keys (private store); NULL once purged
    original_key: Mapped[str | None] = mapped_column(Text)
    ocr_key: Mapped[str | None] = mapped_column(Text)
    candidate_key: Mapped[str | None] = mapped_column(Text)
    engine: Mapped[str | None] = mapped_column(Text)
    reservation_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("quota_reservations.id"), index=True
    )
    ocr_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    generate_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    llm_calls: Mapped[int] = mapped_column(Integer, server_default="0")
    prompt_tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    claimed_at: Mapped[datetime | None] = mapped_column(_TS)
    ocr_done_at: Mapped[datetime | None] = mapped_column(_TS)
    ready_at: Mapped[datetime | None] = mapped_column(_TS)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(_TS)
    expires_at: Mapped[datetime] = mapped_column(_TS)
    deleted_at: Mapped[datetime | None] = mapped_column(_TS)
    purged_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
