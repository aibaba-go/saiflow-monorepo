"""Who may manage a template and which templates a tenant may newly use
(FR-TEMPLATE-009, FR-TEMPLATE-001, FR-OCR-019; D1/D4).

Management (independent of use):
- a personal tenant: its user; a guest: never;
- an organization: its owner or a member whose role has template_manage (D1);
- the platform admin manages any scope through the admin routes (configuration only).

New use (candidates, applying, binding a report to a version) needs the template ENABLED,
not deleted, with an active version, and either
- owned by the tenant itself, or
- a system template granted to the tenant:
  - PLANS: the tenant's active subscription plan is one of the exact plans chosen (no
    "higher plan" inheritance). A template granted to all four plans is a universal system
    template and is usable by every tenant, also one without an active subscription (the
    behaviour of the seeded templates before grants existed; recognition is still gated by
    the existing plan and quota rules);
  - TARGETS: a named user applies only in that user's personal tenant, a named
    organization in that organization (membership is checked when the tenant is resolved);
    like an exact plan grant it needs an active subscription.

Everything here is computed from the tenant alone, so the OCR worker uses the same rule.
"""

from sqlalchemy import any_, exists, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import (
    DocumentTemplate,
    DocumentTemplateVersion,
    Subscription,
    TemplateGrantTarget,
    Tenant,
)
from app.models.template import PLAN_CODES
from app.permissions import Permission
from app.services.tenant_access import TenantContext

ENABLED = "ENABLED"
ALL_PLANS = frozenset(PLAN_CODES)


def can_manage(ctx: TenantContext) -> bool:
    if ctx.kind == "guest":
        return False
    if ctx.kind == "personal":
        return True
    return ctx.is_owner or ctx.has(Permission.TEMPLATE_MANAGE)


def require_manage(ctx: TenantContext) -> None:
    if not can_manage(ctx):
        raise AppError(403, "permission_denied", "error.permission_denied")


async def active_plan(db: AsyncSession, tenant_id: int) -> str | None:
    now = utcnow()
    return (
        await db.execute(
            select(Subscription.plan_code)
            .where(
                Subscription.tenant_id == tenant_id,
                Subscription.starts_at <= now,
                Subscription.ends_at > now,
            )
            .order_by(Subscription.starts_at.desc(), Subscription.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _grant_condition(db: AsyncSession, tenant_id: int):
    """The SQL condition on DocumentTemplate for "system template granted to this tenant"."""
    tenant = await db.get(Tenant, tenant_id)
    plan = await active_plan(db, tenant_id)
    universal = DocumentTemplate.grant_plans.contains(sorted(ALL_PLANS))
    by_plan = DocumentTemplate.grant_mode == "PLANS"
    plan_cond = (
        universal
        if plan is None
        else (universal | (literal(plan) == any_(DocumentTemplate.grant_plans)))
    )
    conds = [by_plan & plan_cond]
    target = None
    if tenant is not None and tenant.kind == "personal" and tenant.owner_user_id is not None:
        target = TemplateGrantTarget.user_id == tenant.owner_user_id
    elif tenant is not None and tenant.kind == "organization":
        target = TemplateGrantTarget.organization_tenant_id == tenant_id
    # a named grant is not universal: it needs an active subscription, like an exact plan
    # grant, so an expired tenant cannot bypass the recognition plan rules (AC-009-05)
    if target is not None and plan is not None:
        conds.append(
            (DocumentTemplate.grant_mode == "TARGETS")
            & exists().where(TemplateGrantTarget.template_id == DocumentTemplate.id, target)
        )
    return DocumentTemplate.tenant_id.is_(None) & or_(*conds)


async def usable_condition(db: AsyncSession, tenant_id: int):
    """Condition on DocumentTemplate: newly usable in this tenant (without the version join)."""
    granted = await _grant_condition(db, tenant_id)
    return (
        (DocumentTemplate.status == ENABLED)
        & DocumentTemplate.deleted_at.is_(None)
        & DocumentTemplate.current_version_id.is_not(None)
        & ((DocumentTemplate.tenant_id == tenant_id) | granted)
    )


async def usable_versions(
    db: AsyncSession, tenant_id: int
) -> list[tuple[DocumentTemplate, DocumentTemplateVersion]]:
    """The templates this tenant may newly use, at their active version, by id."""
    cond = await usable_condition(db, tenant_id)
    rows = await db.execute(
        select(DocumentTemplate, DocumentTemplateVersion)
        .join(
            DocumentTemplateVersion,
            DocumentTemplateVersion.id == DocumentTemplate.current_version_id,
        )
        .where(cond)
        .order_by(DocumentTemplate.id)
    )
    return [(t, v) for t, v in rows.all()]


async def is_usable(db: AsyncSession, tenant_id: int, template_id: int) -> bool:
    cond = await usable_condition(db, tenant_id)
    query = select(DocumentTemplate.id).where(DocumentTemplate.id == template_id, cond)
    return (await db.execute(query)).scalar_one_or_none() is not None


async def lock_template(db: AsyncSession, template_id: int) -> DocumentTemplate | None:
    """The template row under FOR UPDATE (fresh). Lock order: job → templates (by id) and
    report → templates (by id); never a template before a job or a report."""
    return (
        await db.execute(
            select(DocumentTemplate)
            .where(DocumentTemplate.id == template_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def claim_for_use(
    db: AsyncSession, tenant_id: int, template_id: int, version_id: int
) -> DocumentTemplate | None:
    """Right before a conversion actually starts (AUTO or MANUAL, T03/T13): lock the
    template (the caller already holds the job lock), check again that this tenant may
    newly use it at this active version, and mark it applied once and for ever
    (FR-TEMPLATE-010; scoring a candidate never comes here). None = not usable any more."""
    tpl = await lock_template(db, template_id)
    if (
        tpl is None
        or tpl.current_version_id != version_id
        or not await is_usable(db, tenant_id, template_id)
    ):
        return None
    if tpl.applied_at is None:
        tpl.applied_at = utcnow()
    return tpl
