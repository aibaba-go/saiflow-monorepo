"""Organizations (FR-SYS-021..029): an organization is a `tenants` row of kind
'organization'; these tables hold its profile, members, roles, invitations and the
applications around it. None of them is tenant-scoped business data, so guest claiming
(claim_service) never touches them."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    LargeBinary,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

_TS = DateTime(timezone=True)


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("status in ('active', 'disabled')", name="organizations_status"),
        CheckConstraint(
            "verification_status in ('none', 'pending', 'verified', 'rejected')",
            name="organizations_verification_status",
        ),
    )

    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    contact_phone: Mapped[str] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="active")
    verification_status: Mapped[str] = mapped_column(Text, server_default="none")
    legal_name: Mapped[str | None] = mapped_column(Text)
    tax_id: Mapped[str | None] = mapped_column(Text)
    registered_address: Mapped[str | None] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class OrganizationApplication(Base):
    __tablename__ = "organization_applications"
    __table_args__ = (
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="organization_applications_status"
        ),
        Index(
            "organization_applications_one_pending",
            "applicant_user_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_organization_applications_applicant", "applicant_user_id"),
        Index("ix_organization_applications_tenant", "tenant_id"),
        Index("ix_organization_applications_admin", "decided_by_admin_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    applicant_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(Text)
    contact_phone: Mapped[str] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    reject_reason: Mapped[str | None] = mapped_column(Text)
    decided_by_admin_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("admin_accounts.id")
    )
    decided_at: Mapped[datetime | None] = mapped_column(_TS)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        Index("roles_name_per_tenant", "tenant_id", "name", unique=True),
        Index(
            "roles_one_default_per_tenant",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    name: Mapped[str] = mapped_column(Text)
    permissions: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    is_default: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        CheckConstraint(
            "(is_owner and role_id is null) or (not is_owner and role_id is not null)",
            name="memberships_owner_has_no_role",
        ),
        Index(
            "memberships_active_per_user",
            "tenant_id",
            "user_id",
            unique=True,
            postgresql_where=text("removed_at is null"),
        ),
        Index(
            "memberships_one_owner",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_owner and removed_at is null"),
        ),
        Index("ix_memberships_user", "user_id"),
        Index("ix_memberships_role", "role_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    role_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("roles.id"))
    is_owner: Mapped[bool] = mapped_column(Boolean, server_default="false")
    joined_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    removed_at: Mapped[datetime | None] = mapped_column(_TS)


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        Index("ix_invitations_tenant", "tenant_id"),
        Index("ix_invitations_created_by", "created_by_user_id"),
        Index("ix_invitations_accepted_by", "accepted_by_user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(_TS)
    revoked_at: Mapped[datetime | None] = mapped_column(_TS)
    accepted_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(_TS)


class VerificationApplication(Base):
    __tablename__ = "verification_applications"
    __table_args__ = (
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="verification_applications_status"
        ),
        Index(
            "verification_applications_one_pending",
            "tenant_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_verification_applications_tenant", "tenant_id"),
        Index("ix_verification_applications_submitter", "submitted_by_user_id"),
        Index("ix_verification_applications_admin", "decided_by_admin_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    submitted_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    legal_name: Mapped[str] = mapped_column(Text)
    tax_id: Mapped[str] = mapped_column(Text)
    registered_address: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    reject_reason: Mapped[str | None] = mapped_column(Text)
    decided_by_admin_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("admin_accounts.id")
    )
    decided_at: Mapped[datetime | None] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
