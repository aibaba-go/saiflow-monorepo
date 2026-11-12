from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class EmailCode(Base):
    """An email code; only a hash of user, email and code is stored. `purpose` is
    verify (registration, email change), login or reset (FR-SYS-020)."""

    __tablename__ = "email_codes"
    __table_args__ = (Index("ix_email_codes_user_sent", "user_id", "sent_at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    email: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str] = mapped_column(Text, server_default="verify")
    code_hash: Mapped[bytes] = mapped_column(LargeBinary)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    failed_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
