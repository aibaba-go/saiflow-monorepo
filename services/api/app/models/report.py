"""Organization operational reports (FR-REPORT-005..018, D6/D7).

`reports.draft` is the editable, possibly incomplete page config (cards on a native grid);
a publish writes an immutable `report_snapshots` row and points `published_snapshot_id`
at it. Only configuration is stored, never statistics: every view queries the formal data
again (FR-REPORT-015). `report_template_refs` lists the template versions the draft and the
published snapshot are bound to, so a referenced template cannot be deleted
(FR-TEMPLATE-010); rows are rewritten with the draft / publish and removed on unpublish or
delete."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
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

_TS = DateTime(timezone=True)

REPORT_REF_KINDS = ("DRAFT", "PUBLISHED")


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("revision > 0", name="reports_revision"),
        Index("ix_reports_tenant", "tenant_id", postgresql_where=text("deleted_at is null")),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    name: Mapped[str] = mapped_column(Text)  # the draft's title (user text, never translated)
    draft: Mapped[dict] = mapped_column(JSONB)
    revision: Mapped[int] = mapped_column(Integer, server_default="1")
    published_snapshot_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("report_snapshots.id", deferrable=True, initially="DEFERRED", use_alter=True),
        index=True,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    updated_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class ReportSnapshot(Base):
    """An immutable published configuration (FR-REPORT-014)."""

    __tablename__ = "report_snapshots"
    __table_args__ = (UniqueConstraint("report_id", "version", name="uq_report_snapshot_no"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    report_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("reports.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONB)
    published_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    published_by_admin_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("admin_accounts.id")
    )
    published_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class ReportTemplateRef(Base):
    __tablename__ = "report_template_refs"
    __table_args__ = (
        CheckConstraint(
            "kind in (" + ", ".join(f"'{k}'" for k in REPORT_REF_KINDS) + ")",
            name="report_template_refs_kind",
        ),
        UniqueConstraint("report_id", "kind", "template_version_id", name="uq_report_template_ref"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    report_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("reports.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    template_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("document_templates.id"), index=True
    )
    template_version_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("document_template_versions.id"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
