"""Document format templates, their immutable versions, and template mappings
(FR-TEMPLATE-006, FR-OCR-019/020; main `models.py`, ADR-009 §2 with T1–T9)."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
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
from app.ocr.states import MAPPING_SOURCES, MAPPING_STATUSES, TEMPLATE_STATUSES, sql_in

_TS = DateTime(timezone=True)


class DocumentTemplate(Base):
    """System templates have no tenant (all tenants, read-only)."""

    __tablename__ = "document_templates"
    __table_args__ = (
        CheckConstraint(
            f"status in ({sql_in(TEMPLATE_STATUSES)})", name="document_templates_status"
        ),
        Index(
            "uq_document_templates_scope_code",
            text("coalesce(tenant_id, 0)"),
            "code",
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tenants.id"), index=True)
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="ENABLED")
    current_version_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "document_template_versions.id", deferrable=True, initially="DEFERRED", use_alter=True
        ),
        index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class DocumentTemplateVersion(Base):
    """A snapshot that is only ever added; mappings point at one version."""

    __tablename__ = "document_template_versions"
    __table_args__ = (UniqueConstraint("template_id", "version", name="uq_template_version_no"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    template_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("document_templates.id"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    # [{key, name, names?, description, items: [{kind: field|table, key, name, names?, type,
    #   required, description, columns}]}]; the list keeps its order inside jsonb (T4)
    groups: Mapped[list] = mapped_column(JSONB)
    content_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class TemplateMapping(Base):
    __tablename__ = "template_mappings"
    __table_args__ = (
        CheckConstraint(f"source in ({sql_in(MAPPING_SOURCES)})", name="template_mappings_source"),
        CheckConstraint(f"status in ({sql_in(MAPPING_STATUSES)})", name="template_mappings_status"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    job_id: Mapped[str] = mapped_column(Text, ForeignKey("ocr_jobs.id"), index=True)
    raw_result_id: Mapped[str] = mapped_column(Text, ForeignKey("ocr_raw_results.id"), index=True)
    template_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("document_templates.id"), index=True
    )
    template_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("document_template_versions.id"), index=True
    )
    source: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="PENDING")
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    base_version_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("result_versions.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    result_version_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("result_versions.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    match_score: Mapped[float | None] = mapped_column(Float)
    match_reason: Mapped[str | None] = mapped_column(Text)
    candidates: Mapped[list | None] = mapped_column(JSONB)
    warnings: Mapped[list | None] = mapped_column(JSONB)
    dropped_keys: Mapped[int] = mapped_column(Integer, server_default="0")
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    llm_calls: Mapped[int] = mapped_column(Integer, server_default="0")
    prompt_tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    model: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int] = mapped_column(BigInteger, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(_TS)
    finished_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
