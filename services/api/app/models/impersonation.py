from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, LargeBinary, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ImpersonationTicket(Base):
    """A one-time, 60-second ticket for an admin to enter web-pc as a user (FR-SYS-145);
    only the SHA-256 of the ticket is stored."""

    __tablename__ = "impersonation_tickets"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    admin_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("admin_accounts.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
