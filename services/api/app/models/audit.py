from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Identity, LargeBinary, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AuditLog(Base):
    """Append-only operation log with a hash chain (FR-SYS-003). A database trigger
    rejects UPDATE, DELETE and TRUNCATE."""

    __tablename__ = "audit_log"
    __table_args__ = (
        CheckConstraint(
            "actor_type in ('user', 'guest', 'admin', 'system')", name="audit_actor_type"
        ),
        CheckConstraint("result in ('success', 'failure')", name="audit_result"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    actor_type: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(Text)
    target_id: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str] = mapped_column(Text)
    prev_hash: Mapped[bytes] = mapped_column(LargeBinary)
    hash: Mapped[bytes] = mapped_column(LargeBinary)
