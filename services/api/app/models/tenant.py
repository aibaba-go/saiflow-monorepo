from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Tenant(Base):
    """A tenant: a user's personal tenant, a guest's temporary tenant, or an organization
    (rebuild-tenant-rbac; its profile is in `organizations`)."""

    __tablename__ = "tenants"
    __table_args__ = (
        CheckConstraint("kind in ('personal', 'guest', 'organization')", name="tenants_kind"),
        CheckConstraint("status in ('active', 'claimed')", name="tenants_status"),
        Index(
            "tenants_one_personal_per_user",
            "owner_user_id",
            unique=True,
            postgresql_where=text("kind = 'personal'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    owner_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(Text, server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
