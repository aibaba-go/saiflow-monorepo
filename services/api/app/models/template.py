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
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.ocr.states import MAPPING_SOURCES, MAPPING_STATUSES, TEMPLATE_STATUSES, sql_in

_TS = DateTime(timezone=True)


GRANT_MODES = ("PLANS", "TARGETS")
PLAN_CODES = ("kinder", "starter", "intermediate", "advance")


class DocumentTemplate(Base):
    """tenant_id NULL = a system template (platform admin; used by grant, FR-TEMPLATE-009);
    otherwise the owning tenant: a personal tenant (its user) or an organization.

    Save and activation are separate (D2, FR-TEMPLATE-013): `draft` holds the editable,
    possibly incomplete content {name, description, groups}; NULL = no pending draft.
    `current_version_id` is the active immutable version (NULL until the first activation).
    `revision` guards every change (saves, activation, grants, status; FR-TEMPLATE-012).
    `applied_at` is set once any version is applied to a conversion and never cleared
    (FR-TEMPLATE-010); scoring a candidate does not set it."""

    __tablename__ = "document_templates"
    __table_args__ = (
        CheckConstraint(
            f"status in ({sql_in(TEMPLATE_STATUSES)})", name="document_templates_status"
        ),
        CheckConstraint(
            f"grant_mode is null or grant_mode in ({sql_in(GRANT_MODES)})",
            name="document_templates_grant_mode",
        ),
        CheckConstraint(
            f"grant_plans <@ array[{sql_in(PLAN_CODES)}]::text[]",
            name="document_templates_grant_plans",
        ),
        CheckConstraint(
            "tenant_id is null or (grant_mode is null and cardinality(grant_plans) = 0)",
            name="document_templates_grants_system_only",
        ),
        CheckConstraint("revision > 0", name="document_templates_revision"),
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
    draft: Mapped[dict | None] = mapped_column(JSONB)
    draft_updated_at: Mapped[datetime | None] = mapped_column(_TS)
    revision: Mapped[int] = mapped_column(Integer, server_default="1")
    grant_mode: Mapped[str | None] = mapped_column(Text)
    grant_plans: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    applied_at: Mapped[datetime | None] = mapped_column(_TS)
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class TemplateGrantTarget(Base):
    """A named grant of a system template (grant_mode TARGETS, D4): a user (only in that
    user's personal tenant) or an organization (its active members)."""

    __tablename__ = "template_grant_targets"
    __table_args__ = (
        CheckConstraint(
            "(user_id is null) <> (organization_tenant_id is null)",
            name="template_grant_targets_one",
        ),
        Index(
            "uq_template_grant_targets_user",
            "template_id",
            "user_id",
            unique=True,
            postgresql_where=text("user_id is not null"),
        ),
        Index(
            "uq_template_grant_targets_org",
            "template_id",
            "organization_tenant_id",
            unique=True,
            postgresql_where=text("organization_tenant_id is not null"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    template_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("document_templates.id"), index=True
    )
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    organization_tenant_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("tenants.id"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


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
    activated_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
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
