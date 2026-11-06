"""Uploaded files, OCR jobs, raw results, result versions and exports (ocr-scan-flow).
Columns follow main's `models.py` (ADR-009 §2) with T1–T9 applied; the extra columns are
the ones the plan names. Files and jobs are tenant-scoped, so claiming a guest moves them."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.ocr.states import (
    ENGINES,
    EXPORT_FORMATS,
    EXPORT_STATUSES,
    FILE_STATUSES,
    JOB_STATUSES,
    REVIEW_STATUSES,
    sql_in,
)

_TS = DateTime(timezone=True)
_ID = Text  # 36-character UUID text (ADR-009 §2)


class File(Base):
    __tablename__ = "files"
    __table_args__ = (
        CheckConstraint(f"status in ({sql_in(FILE_STATUSES)})", name="files_status"),
        Index("ix_files_tenant_status", "tenant_id", "status"),
        {"info": {"tenant_scoped": True}},
    )

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"), index=True)
    # NULL while a guest owns it; set when the guest registers (A9)
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    purpose: Mapped[str] = mapped_column(Text, server_default="OCR_TASK")
    original_name: Mapped[str] = mapped_column(Text)
    storage_path: Mapped[str | None] = mapped_column(Text)  # GCS object name (T8)
    mime_type: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    page_count: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="UPLOADING")
    reject_reason: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(_TS)  # unfinished upload session
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class OcrJob(Base):
    __tablename__ = "ocr_jobs"
    __table_args__ = (
        CheckConstraint(f"status in ({sql_in(JOB_STATUSES)})", name="ocr_jobs_status"),
        CheckConstraint(
            f"review_status in ({sql_in(REVIEW_STATUSES)})", name="ocr_jobs_review_status"
        ),
        CheckConstraint(f"engine is null or engine in ({sql_in(ENGINES)})", name="ocr_jobs_engine"),
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_ocr_jobs_tenant_idempotency"),
        Index("ix_ocr_jobs_tenant_created", "tenant_id", "created_at"),
        Index("ix_ocr_jobs_status_created", "status", "created_at"),
        {"info": {"tenant_scoped": True}},
    )

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"), index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    file_id: Mapped[str] = mapped_column(_ID, ForeignKey("files.id"), index=True)
    params: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    capability: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(Text, server_default="QUEUED")
    idempotency_key: Mapped[str | None] = mapped_column(Text)
    parent_job_id: Mapped[str | None] = mapped_column(_ID, ForeignKey("ocr_jobs.id"), index=True)
    progress: Mapped[int] = mapped_column(Integer, server_default="0")
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    vendor_request_id: Mapped[str | None] = mapped_column(Text)
    engine: Mapped[str | None] = mapped_column(Text)
    page_count: Mapped[int] = mapped_column(Integer, server_default="0")
    table_count: Mapped[int] = mapped_column(Integer, server_default="0")
    field_count: Mapped[int] = mapped_column(Integer, server_default="0")
    duration_ms: Mapped[int] = mapped_column(BigInteger, server_default="0")
    missing_pages: Mapped[list | None] = mapped_column(JSONB)
    review_status: Mapped[str] = mapped_column(Text, server_default="UNREVIEWED")
    reservation_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("quota_reservations.id"), index=True
    )
    current_mapping_id: Mapped[str | None] = mapped_column(
        _ID,
        ForeignKey("template_mappings.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    pending_mapping_id: Mapped[str | None] = mapped_column(
        _ID,
        ForeignKey("template_mappings.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(_TS)
    confirmed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    confirmed_version_id: Mapped[str | None] = mapped_column(
        _ID,
        ForeignKey("result_versions.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    started_at: Mapped[datetime | None] = mapped_column(_TS)
    finished_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class OcrRawResult(Base):
    """Written once; UPDATE and DELETE are refused by a trigger (T7, NFR-SEC-010)."""

    __tablename__ = "ocr_raw_results"
    __table_args__ = (
        CheckConstraint(f"engine in ({sql_in(ENGINES)})", name="ocr_raw_results_engine"),
    )

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    job_id: Mapped[str] = mapped_column(_ID, ForeignKey("ocr_jobs.id"), index=True)
    engine: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict | list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class ResultVersion(Base):
    __tablename__ = "result_versions"
    __table_args__ = (
        UniqueConstraint("job_id", "version", name="uq_result_version_job_version"),
        Index(
            "uq_result_versions_job_current",
            "job_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
    )

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    job_id: Mapped[str] = mapped_column(_ID, ForeignKey("ocr_jobs.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    is_current: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    structured: Mapped[dict | None] = mapped_column(JSONB)
    mapping_id: Mapped[str | None] = mapped_column(
        _ID,
        ForeignKey("template_mappings.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class Export(Base):
    __tablename__ = "exports"
    __table_args__ = (
        CheckConstraint(f"format in ({sql_in(EXPORT_FORMATS)})", name="exports_format"),
        CheckConstraint(f"status in ({sql_in(EXPORT_STATUSES)})", name="exports_status"),
    )

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    job_id: Mapped[str] = mapped_column(_ID, ForeignKey("ocr_jobs.id"), index=True)
    result_version_id: Mapped[str] = mapped_column(
        _ID, ForeignKey("result_versions.id"), index=True
    )
    format: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="GENERATING")
    storage_path: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(_TS)
    created_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
