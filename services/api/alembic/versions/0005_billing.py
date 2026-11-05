"""billing: plans, subscriptions, free quotas, scan reservations, plan applications
(rebuild-plans-metering). App-role privileges come from the default privileges set in 0003.
Existing personal and guest tenants get a Kinder month from now (A2).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True)


def _fk(name: str, target: str, nullable: bool = False, type_=sa.BigInteger) -> sa.Column:
    return sa.Column(name, type_, sa.ForeignKey(f"{S}.{target}"), nullable=nullable)


def _now(name: str = "created_at") -> sa.Column:
    return sa.Column(name, TS, nullable=False, server_default=sa.func.now())


def _indexes(table: str, cols: list[tuple[str, str]]) -> None:
    for name, col in cols:
        op.create_index(name, table, [col], schema=S)


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("code", sa.Text, primary_key=True),
        sa.Column("monthly_quota", sa.Integer, nullable=False),
        sa.Column("member_limit", sa.Integer),
        sa.Column("tenant_kind", sa.Text, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        _now("updated_at"),
        sa.CheckConstraint("monthly_quota > 0", name="plans_quota_positive"),
        sa.CheckConstraint("member_limit is null or member_limit > 0", name="plans_limit_positive"),
        sa.CheckConstraint("tenant_kind in ('personal', 'organization')", name="plans_tenant_kind"),
        sa.CheckConstraint("code <> 'kinder' or member_limit = 1", name="plans_kinder_one_member"),
        schema=S,
    )
    op.execute(
        f"INSERT INTO {S}.plans (code, monthly_quota, member_limit, tenant_kind, sort_order) "
        "VALUES "
        "('kinder', 1000, 1, 'personal', 1), ('starter', 5000, 2, 'organization', 2), "
        "('intermediate', 10000, 5, 'organization', 3), "
        "('advance', 100000, NULL, 'organization', 4)"
    )

    op.create_table(
        "plan_applications",
        _id(),
        _fk("tenant_id", "tenants.id"),
        _fk("applicant_user_id", "users.id"),
        _fk("plan_code", "plans.code", type_=sa.Text),
        sa.Column("period", sa.Text, nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("reject_reason", sa.Text),
        _fk("decided_by_admin_id", "admin_accounts.id", nullable=True),
        sa.Column("decided_at", TS),
        sa.Column("subscription_id", sa.BigInteger),  # FK added after subscriptions
        _now(),
        sa.CheckConstraint("period in ('month', 'year')", name="plan_applications_period"),
        sa.CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="plan_applications_status"
        ),
        schema=S,
    )
    op.create_index(
        "plan_applications_one_pending",
        "plan_applications",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        schema=S,
    )
    _indexes(
        "plan_applications",
        [
            ("ix_plan_applications_tenant", "tenant_id"),
            ("ix_plan_applications_applicant", "applicant_user_id"),
            ("ix_plan_applications_plan", "plan_code"),
            ("ix_plan_applications_admin", "decided_by_admin_id"),
            ("ix_plan_applications_subscription", "subscription_id"),
        ],
    )

    op.create_table(
        "subscriptions",
        _id(),
        _fk("tenant_id", "tenants.id"),
        _fk("plan_code", "plans.code", type_=sa.Text),
        sa.Column("period", sa.Text, nullable=False),
        sa.Column("starts_at", TS, nullable=False),
        sa.Column("ends_at", TS, nullable=False),
        sa.Column("source", sa.Text, nullable=False),
        _fk("application_id", "plan_applications.id", nullable=True),
        _fk("set_by_admin_id", "admin_accounts.id", nullable=True),
        _now(),
        sa.CheckConstraint("period in ('month', 'year')", name="subscriptions_period"),
        sa.CheckConstraint("ends_at > starts_at", name="subscriptions_end_after_start"),
        sa.CheckConstraint(
            "source in ('auto', 'admin', 'application')", name="subscriptions_source"
        ),
        schema=S,
    )
    op.create_index(
        "ix_subscriptions_tenant_start", "subscriptions", ["tenant_id", "starts_at"], schema=S
    )
    _indexes(
        "subscriptions",
        [
            ("ix_subscriptions_plan", "plan_code"),
            ("ix_subscriptions_application", "application_id"),
            ("ix_subscriptions_admin", "set_by_admin_id"),
        ],
    )
    op.create_foreign_key(
        "plan_applications_subscription_id_fkey",
        "plan_applications",
        "subscriptions",
        ["subscription_id"],
        ["id"],
        source_schema=S,
        referent_schema=S,
    )

    op.create_table(
        "free_quotas",
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey(f"{S}.tenants.id"), primary_key=True),
        sa.Column("granted", sa.Integer, nullable=False),
        sa.Column("remaining", sa.Integer, nullable=False),
        sa.Column("expires_at", TS),
        _now("granted_at"),
        sa.CheckConstraint("remaining >= 0", name="free_quotas_remaining"),
        schema=S,
    )

    op.create_table(
        "quota_reservations",
        _id(),
        _fk("tenant_id", "tenants.id"),
        sa.Column("reference", sa.Text, nullable=False),
        sa.Column("pages", sa.Integer, nullable=False),
        sa.Column("from_free", sa.Integer, nullable=False),
        sa.Column("from_monthly", sa.Integer, nullable=False),
        sa.Column("month", sa.Date, nullable=False),
        _now("reserved_at"),
        sa.Column("released_at", TS),
        sa.CheckConstraint("pages > 0", name="quota_reservations_pages"),
        sa.CheckConstraint(
            "from_free >= 0 and from_monthly >= 0 and from_free + from_monthly = pages",
            name="quota_reservations_split",
        ),
        schema=S,
    )
    op.create_index(
        "ix_quota_reservations_tenant_month",
        "quota_reservations",
        ["tenant_id", "month"],
        schema=S,
    )
    op.create_index(
        "quota_reservations_reference",
        "quota_reservations",
        ["tenant_id", "reference"],
        unique=True,
        schema=S,
    )

    op.execute(
        f"INSERT INTO {S}.system_settings (key, value) VALUES "
        "('free_quota_personal', '100'), ('free_quota_organization', '100')"
    )
    # A2: existing personal and guest tenants get a Kinder month starting now
    op.execute(
        f"INSERT INTO {S}.subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
        f"SELECT id, 'kinder', 'month', now(), now() + interval '1 month', 'auto' "
        f"FROM {S}.tenants WHERE kind IN ('personal', 'guest')"
    )


def downgrade() -> None:
    # Dropping these tables would silently erase subscriptions, free quotas, reservations
    # and applications. Refuse while any exist; roll back the image instead.
    bind = op.get_bind()
    for table in ["subscriptions", "free_quotas", "quota_reservations", "plan_applications"]:
        if bind.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {S}.{table})")).scalar():
            raise RuntimeError(
                f"refusing to downgrade 0005: billing data present in {S}.{table}; "
                "roll back the image instead (docs/deployment/README.md §4)"
            )
    op.execute(
        f"DELETE FROM {S}.system_settings "
        "WHERE key IN ('free_quota_personal', 'free_quota_organization')"
    )
    op.drop_constraint("plan_applications_subscription_id_fkey", "plan_applications", schema=S)
    for table in [
        "quota_reservations",
        "free_quotas",
        "subscriptions",
        "plan_applications",
        "plans",
    ]:
        op.drop_table(table, schema=S)
