from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    LargeBinary,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CustomerSession(Base):
    """A guest or user session; only the SHA-256 of the cookie token is stored."""

    __tablename__ = "customer_sessions"
    __table_args__ = (
        CheckConstraint("kind in ('guest', 'user')", name="customer_sessions_kind"),
        Index("ix_customer_sessions_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    kind: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
