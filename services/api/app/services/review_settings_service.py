"""Review settings (FR-VERIFY-010, FR-SYS-126): the review level of each published template
and of 通用结果, and the organization's switch for emailing reviewers. Only the owner reads
or changes them; a change affects later confirms only. Personal and guest tenants are
always level 0.

Only templates the organization may newly use are offered for a new level
(FR-TEMPLATE-009); a template that stopped being usable (disabled, grant removed) keeps
its stored level, which the owner may still change or lower, until it is deleted.

The operation log has no detail column, so a change is written as its target:
`<tenant>/<template id or generic>/<before>-><after>` and `<tenant>/<before>-><after>`."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import DocumentTemplate, DocumentTemplateVersion, Organization, ReviewLevel
from app.services import audit_service, mapping_service, template_access
from app.services.audit_service import AuditEvent
from app.services.tenant_access import TenantContext, not_found


def require_owner(ctx: TenantContext) -> None:
    if ctx.kind != "organization" or not ctx.is_owner:
        raise AppError(403, "permission_denied", "error.permission_denied")


def _invalid(field: str) -> AppError:
    return AppError(422, "validation_error", "error.validation", [field])


async def level_for(db: AsyncSession, tenant_id: int, kind: str, template_id: int | None) -> int:
    """The level a confirm in this tenant gets for this template (None = 通用结果)."""
    if kind != "organization":
        return 0
    cond = (
        ReviewLevel.template_id.is_(None)
        if template_id is None
        else ReviewLevel.template_id == template_id
    )
    level = (
        await db.execute(select(ReviewLevel.level).where(ReviewLevel.tenant_id == tenant_id, cond))
    ).scalar_one_or_none()
    return level or 0


async def _org(db: AsyncSession, tenant_id: int, lock: bool = False) -> Organization:
    q = select(Organization).where(Organization.tenant_id == tenant_id)
    if lock:
        q = q.with_for_update()
    org = (await db.execute(q)).scalar_one_or_none()
    if org is None:
        raise not_found()
    return org


async def read(db: AsyncSession, ctx: TenantContext) -> dict:
    require_owner(ctx)
    org = await _org(db, ctx.tenant_id)
    stored = {
        row.template_id: row.level
        for row in (
            await db.execute(select(ReviewLevel).where(ReviewLevel.tenant_id == ctx.tenant_id))
        ).scalars()
    }
    usable = {t.id: v.name for t, v in await mapping_service.available_versions(db, ctx.tenant_id)}
    kept = [tid for tid, level in stored.items() if tid is not None and level > 0]
    kept = [tid for tid in kept if tid not in usable]
    if kept:  # stored levels of templates no longer usable but not deleted
        rows = await db.execute(
            select(DocumentTemplate.id, DocumentTemplate.name, DocumentTemplateVersion.name)
            .outerjoin(
                DocumentTemplateVersion,
                DocumentTemplateVersion.id == DocumentTemplate.current_version_id,
            )
            .where(DocumentTemplate.id.in_(kept), DocumentTemplate.deleted_at.is_(None))
        )
        for tid, tname, vname in rows.all():
            usable[tid] = vname or tname
    templates = sorted(usable.items(), key=lambda item: (item[1], item[0]))
    items = [
        {"template_id": tid, "name": name, "level": stored.get(tid, 0)} for tid, name in templates
    ]
    items.append({"template_id": None, "name": None, "level": stored.get(None, 0)})
    return {"email_enabled": org.review_email_enabled, "items": items}


async def _audit(db: AsyncSession, ctx: TenantContext, action: str, target: str) -> None:
    await audit_service.record(
        db, AuditEvent("user", str(ctx.user_id), action, "organization", target, "success")
    )


async def set_level(db: AsyncSession, ctx: TenantContext, template_id: Any, level: Any) -> dict:
    require_owner(ctx)
    if not isinstance(level, int) or isinstance(level, bool) or not 0 <= level <= 2:
        raise _invalid("level")
    if template_id is not None and (
        not isinstance(template_id, int) or isinstance(template_id, bool)
    ):
        raise _invalid("template_id")
    await _org(db, ctx.tenant_id, lock=True)  # serialize writers of this organization
    name = None
    tpl = None
    if template_id is not None:
        # org → template lock order; serializes with deleting the template (T15)
        tpl = await template_access.lock_template(db, template_id)
        if tpl is None or tpl.deleted_at is not None:
            raise not_found()
    cond = (
        ReviewLevel.template_id.is_(None)
        if template_id is None
        else ReviewLevel.template_id == template_id
    )
    row = (
        await db.execute(select(ReviewLevel).where(ReviewLevel.tenant_id == ctx.tenant_id, cond))
    ).scalar_one_or_none()
    before = row.level if row else 0
    if tpl is not None:
        # a new level needs a template usable now; an existing one may still be changed
        if before == 0 and not await template_access.is_usable(db, ctx.tenant_id, tpl.id):
            raise not_found()
        name = tpl.name
        if tpl.current_version_id is not None:
            ver = await db.get(DocumentTemplateVersion, tpl.current_version_id)
            name = ver.name if ver is not None else tpl.name
    if before != level:
        if row is None:
            db.add(
                ReviewLevel(
                    tenant_id=ctx.tenant_id,
                    template_id=template_id,
                    level=level,
                    updated_by_user_id=ctx.user_id,
                )
            )
        else:
            row.level, row.updated_by_user_id, row.updated_at = level, ctx.user_id, utcnow()
        key = "generic" if template_id is None else str(template_id)
        await _audit(db, ctx, "review.level_set", f"{ctx.tenant_id}/{key}/{before}->{level}")
    await db.commit()
    return {"template_id": template_id, "name": name, "level": level}


async def set_email(db: AsyncSession, ctx: TenantContext, enabled: Any) -> dict:
    require_owner(ctx)
    if not isinstance(enabled, bool):
        raise _invalid("enabled")
    org = await _org(db, ctx.tenant_id, lock=True)
    before = org.review_email_enabled
    if before != enabled:
        org.review_email_enabled = enabled
        await _audit(
            db,
            ctx,
            "review.email_set",
            f"{ctx.tenant_id}/{str(before).lower()}->{str(enabled).lower()}",
        )
    await db.commit()
    return await read(db, ctx)
