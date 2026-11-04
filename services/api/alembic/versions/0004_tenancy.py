"""tenancy: organizations, applications, roles, memberships, invitations, verification,
system settings (rebuild-tenant-rbac). New tables get the app role's data privileges from
the default privileges set in 0003; M9 takes back INSERT on alembic_version.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-04
"""

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)


def _app_role() -> str:
    role = os.environ.get("DB_APP_USER", "saiflow_v3_app")
    if not role.replace("_", "").isalnum():
        raise ValueError(f"unexpected DB_APP_USER {role!r}")
    return role


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True)


def _fk(name: str, target: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.BigInteger, sa.ForeignKey(f"{S}.{target}"), nullable=nullable)


def _now(name: str = "created_at") -> sa.Column:
    return sa.Column(name, TS, nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    op.drop_constraint("tenants_kind", "tenants", schema=S)
    op.create_check_constraint(
        "tenants_kind", "tenants", "kind in ('personal', 'guest', 'organization')", schema=S
    )

    op.create_table(
        "organizations",
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey(f"{S}.tenants.id"), primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("contact_phone", sa.Text, nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="active"),
        sa.Column("verification_status", sa.Text, nullable=False, server_default="none"),
        sa.Column("legal_name", sa.Text),
        sa.Column("tax_id", sa.Text),
        sa.Column("registered_address", sa.Text),
        sa.Column("verified_at", TS),
        _now(),
        sa.CheckConstraint("status in ('active', 'disabled')", name="organizations_status"),
        sa.CheckConstraint(
            "verification_status in ('none', 'pending', 'verified', 'rejected')",
            name="organizations_verification_status",
        ),
        schema=S,
    )

    op.create_table(
        "organization_applications",
        _id(),
        _fk("applicant_user_id", "users.id"),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("contact_phone", sa.Text, nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("reject_reason", sa.Text),
        _fk("decided_by_admin_id", "admin_accounts.id", nullable=True),
        sa.Column("decided_at", TS),
        _fk("tenant_id", "tenants.id", nullable=True),
        _now(),
        sa.CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="organization_applications_status"
        ),
        schema=S,
    )
    op.create_index(
        "organization_applications_one_pending",
        "organization_applications",
        ["applicant_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        schema=S,
    )
    for name, col in [
        ("ix_organization_applications_applicant", "applicant_user_id"),
        ("ix_organization_applications_tenant", "tenant_id"),
        ("ix_organization_applications_admin", "decided_by_admin_id"),
    ]:
        op.create_index(name, "organization_applications", [col], schema=S)

    op.create_table(
        "roles",
        _id(),
        _fk("tenant_id", "tenants.id"),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("permissions", ARRAY(sa.Text), nullable=False, server_default="{}"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        _now(),
        schema=S,
    )
    op.create_index("roles_name_per_tenant", "roles", ["tenant_id", "name"], unique=True, schema=S)
    op.create_index(
        "roles_one_default_per_tenant",
        "roles",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
        schema=S,
    )

    op.create_table(
        "memberships",
        _id(),
        _fk("tenant_id", "tenants.id"),
        _fk("user_id", "users.id"),
        _fk("role_id", "roles.id", nullable=True),
        sa.Column("is_owner", sa.Boolean, nullable=False, server_default="false"),
        _now("joined_at"),
        sa.Column("removed_at", TS),
        sa.CheckConstraint(
            "(is_owner and role_id is null) or (not is_owner and role_id is not null)",
            name="memberships_owner_has_no_role",
        ),
        schema=S,
    )
    op.create_index(
        "memberships_active_per_user",
        "memberships",
        ["tenant_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("removed_at is null"),
        schema=S,
    )
    op.create_index(
        "memberships_one_owner",
        "memberships",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_owner and removed_at is null"),
        schema=S,
    )
    op.create_index("ix_memberships_user", "memberships", ["user_id"], schema=S)
    op.create_index("ix_memberships_role", "memberships", ["role_id"], schema=S)

    op.create_table(
        "invitations",
        _id(),
        _fk("tenant_id", "tenants.id"),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        _fk("created_by_user_id", "users.id"),
        _now(),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("revoked_at", TS),
        _fk("accepted_by_user_id", "users.id", nullable=True),
        sa.Column("accepted_at", TS),
        schema=S,
    )
    for name, col in [
        ("ix_invitations_tenant", "tenant_id"),
        ("ix_invitations_created_by", "created_by_user_id"),
        ("ix_invitations_accepted_by", "accepted_by_user_id"),
    ]:
        op.create_index(name, "invitations", [col], schema=S)

    op.create_table(
        "verification_applications",
        _id(),
        _fk("tenant_id", "tenants.id"),
        _fk("submitted_by_user_id", "users.id"),
        sa.Column("legal_name", sa.Text, nullable=False),
        sa.Column("tax_id", sa.Text, nullable=False),
        sa.Column("registered_address", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("reject_reason", sa.Text),
        _fk("decided_by_admin_id", "admin_accounts.id", nullable=True),
        sa.Column("decided_at", TS),
        _now(),
        sa.CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="verification_applications_status"
        ),
        schema=S,
    )
    op.create_index(
        "verification_applications_one_pending",
        "verification_applications",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        schema=S,
    )
    for name, col in [
        ("ix_verification_applications_tenant", "tenant_id"),
        ("ix_verification_applications_submitter", "submitted_by_user_id"),
        ("ix_verification_applications_admin", "decided_by_admin_id"),
    ]:
        op.create_index(name, "verification_applications", [col], schema=S)

    op.create_table(
        "system_settings",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("value", JSONB, nullable=False),
        _now("updated_at"),
        schema=S,
    )
    op.execute(
        f"INSERT INTO {S}.system_settings (key, value) VALUES ('org_member_limit_unpaid', '2')"
    )

    app = _app_role()
    op.execute(f"REVOKE INSERT, UPDATE, DELETE ON {S}.alembic_version FROM {app}")  # M9


def downgrade() -> None:
    app = _app_role()
    op.execute(f"GRANT INSERT ON {S}.alembic_version TO {app}")
    for table in [
        "system_settings",
        "verification_applications",
        "invitations",
        "memberships",
        "roles",
        "organization_applications",
        "organizations",
    ]:
        op.drop_table(table, schema=S)
    op.drop_constraint("tenants_kind", "tenants", schema=S)
    op.create_check_constraint("tenants_kind", "tenants", "kind in ('personal', 'guest')", schema=S)
