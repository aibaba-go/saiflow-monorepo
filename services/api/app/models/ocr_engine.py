"""Shared switching state of each OCR engine (FR-OCR-021): kept in the database so a
worker restart keeps a global switch to the backup engine."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.ocr.states import ENGINES, sql_in


class OcrEngineHealth(Base):
    __tablename__ = "ocr_engine_health"
    __table_args__ = (
        CheckConstraint(f"engine in ({sql_in(ENGINES)})", name="ocr_engine_health_engine"),
    )

    engine: Mapped[str] = mapped_column(Text, primary_key=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, server_default="0")
    # set when the primary reached the switch threshold; cleared when a probe succeeds
    switched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_probe_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
