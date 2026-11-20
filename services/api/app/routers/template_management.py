"""Template management in the current tenant (template-report-management:
FR-TEMPLATE-001..013; contract §2). The scope is always the current tenant (personal or
organization); system templates are listed read-only when usable. Changes need
`template_access.require_manage` and the client's revision."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import PathId, get_db, get_tenant_context, require_csrf_header
from app.ocr.templates.schema import validate_template
from app.schemas.template_management import (
    ActivateOut,
    CreateTemplateIn,
    RevisionIn,
    SaveDraftIn,
    StatusIn,
    TemplateDetail,
    TemplateExport,
    TemplateListOut,
    ValidateIn,
    ValidateOut,
    VersionDetail,
)
from app.services import template_access
from app.services import template_management_service as svc
from app.services.tenant_access import TenantContext, not_found

router = APIRouter(
    prefix="/api/v1/managed-templates",
    tags=["templates"],
    dependencies=[Depends(require_csrf_header)],
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]


async def _detail(db: AsyncSession, ctx: TenantContext, template_id: int) -> TemplateDetail:
    tpl, manage = await svc.tenant_visible(db, ctx, template_id)
    return TemplateDetail(**await svc.detail(db, tpl, can_manage=manage))


def _new_target(ctx: TenantContext) -> str:
    return f"new/{svc.scope_label(ctx.tenant_id)}"


@router.get("", operation_id="listManagedTemplates", response_model=TemplateListOut)
async def list_templates(ctx: Tenant, db: Db) -> TemplateListOut:
    return TemplateListOut(items=await svc.tenant_list(db, ctx))


@router.post(
    "", operation_id="createManagedTemplate", response_model=TemplateDetail, status_code=201
)
async def create(req: CreateTemplateIn, ctx: Tenant, db: Db) -> TemplateDetail:
    actor = svc.tenant_actor(ctx)

    async def run():
        template_access.require_manage(ctx)
        pending = None
        if req.source == "sample":
            await svc.require_sample(db, ctx, req.sample_id)
            pending = req.pending_confirmations
        tpl = await svc.create(db, actor, ctx.tenant_id, req.content, pending=pending)
        await db.commit()
        return tpl.id

    template_id = await svc.audited(db, actor, "template.create", _new_target(ctx), run)
    return await _detail(db, ctx, template_id)


@router.post("/validate", operation_id="validateManagedTemplate", response_model=ValidateOut)
async def validate(req: ValidateIn, ctx: Tenant) -> ValidateOut:
    content = svc.clean_content(req.content)
    return ValidateOut(errors=validate_template(content)[1])


@router.get("/{template_id}", operation_id="getManagedTemplate", response_model=TemplateDetail)
async def get_template(template_id: PathId, ctx: Tenant, db: Db) -> TemplateDetail:
    return await _detail(db, ctx, template_id)


@router.put(
    "/{template_id}/draft", operation_id="saveManagedTemplateDraft", response_model=TemplateDetail
)
async def save_draft(template_id: PathId, req: SaveDraftIn, ctx: Tenant, db: Db) -> TemplateDetail:
    actor = svc.tenant_actor(ctx)

    async def run():
        tpl = await svc.tenant_locked(db, ctx, template_id)
        await svc.save_draft(db, actor, tpl, req.revision, req.content, req.pending_confirmations)
        await db.commit()

    await svc.audited(db, actor, "template.save", str(template_id), run)
    return await _detail(db, ctx, template_id)


@router.delete(
    "/{template_id}/draft",
    operation_id="discardManagedTemplateDraft",
    response_model=TemplateDetail,
)
async def discard_draft(
    template_id: PathId, ctx: Tenant, db: Db, revision: Annotated[int, Query(gt=0)]
) -> TemplateDetail:
    actor = svc.tenant_actor(ctx)

    async def run():
        tpl = await svc.tenant_locked(db, ctx, template_id)
        await svc.discard_draft(db, actor, tpl, revision)
        await db.commit()

    await svc.audited(db, actor, "template.discard", str(template_id), run)
    return await _detail(db, ctx, template_id)


@router.post(
    "/{template_id}/activate", operation_id="activateManagedTemplate", response_model=ActivateOut
)
async def activate(template_id: PathId, req: RevisionIn, ctx: Tenant, db: Db) -> ActivateOut:
    actor = svc.tenant_actor(ctx)

    async def run():
        tpl = await svc.tenant_locked(db, ctx, template_id)
        result, ver = await svc.activate(db, actor, tpl, req.revision)
        await db.commit()
        return result, svc.version_detail(ver)

    result, version = await svc.audited(db, actor, "template.activate", str(template_id), run)
    detail = await _detail(db, ctx, template_id)
    return ActivateOut(result=result, version=VersionDetail(**version), template=detail)


@router.post(
    "/{template_id}/status", operation_id="setManagedTemplateStatus", response_model=TemplateDetail
)
async def set_status(template_id: PathId, req: StatusIn, ctx: Tenant, db: Db) -> TemplateDetail:
    actor = svc.tenant_actor(ctx)

    async def run():
        tpl = await svc.tenant_locked(db, ctx, template_id)
        await svc.set_status(db, actor, tpl, req.revision, req.status)
        await db.commit()

    await svc.audited(db, actor, "template.status", str(template_id), run)
    return await _detail(db, ctx, template_id)


@router.delete("/{template_id}", operation_id="deleteManagedTemplate", status_code=204)
async def delete_template(
    template_id: PathId, ctx: Tenant, db: Db, revision: Annotated[int, Query(gt=0)]
) -> Response:
    actor = svc.tenant_actor(ctx)

    async def run():
        tpl = await svc.tenant_locked(db, ctx, template_id)
        await svc.delete_template(db, actor, tpl, revision)
        await db.commit()

    await svc.audited(db, actor, "template.delete", str(template_id), run)
    return Response(status_code=204)


@router.get(
    "/{template_id}/export", operation_id="exportManagedTemplate", response_model=TemplateExport
)
async def export(
    template_id: PathId, ctx: Tenant, db: Db, draft: Annotated[int, Query(ge=0, le=1)] = 0
) -> TemplateExport:
    """The structure JSON (FR-TEMPLATE-011), for managers of the template only."""
    tpl, manage = await svc.tenant_visible(db, ctx, template_id)
    if not manage:
        raise not_found()
    ver = await svc.version_current(db, tpl)
    return TemplateExport(**svc.export_content(tpl, ver, bool(draft)))


@router.get(
    "/{template_id}/versions/{version_id}",
    operation_id="getManagedTemplateVersion",
    response_model=VersionDetail,
)
async def get_version(
    template_id: PathId, version_id: PathId, ctx: Tenant, db: Db
) -> VersionDetail:
    tpl, manage = await svc.tenant_visible(db, ctx, template_id)
    ver = await svc.version_of(db, tpl, version_id, full=manage)
    return VersionDetail(**svc.version_detail(ver))
