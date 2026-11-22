from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DataSource(Base):
    __tablename__ = "data_sources"
    __table_args__ = (
        CheckConstraint("port between 1 and 65535", name="data_sources_port"),
        CheckConstraint("ssl_mode = 'verify-full'", name="data_sources_tls"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(Text)
    host: Mapped[str] = mapped_column(Text)
    port: Mapped[int] = mapped_column(Integer, server_default="5432")
    database: Mapped[str] = mapped_column(Text)
    username: Mapped[str] = mapped_column(Text)
    password_cipher: Mapped[str] = mapped_column(Text)
    ssl_mode: Mapped[str] = mapped_column(Text, server_default="verify-full")
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportSourceRef(Base):
    __tablename__ = "report_source_refs"
    __table_args__ = (
        CheckConstraint("kind in ('draft', 'published')", name="report_source_refs_kind"),
    )

    report_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("reports.id"), primary_key=True)
    source_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("data_sources.id"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
