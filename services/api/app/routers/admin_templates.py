"""Platform admin template configuration (template-report-management: FR-TEMPLATE-009/011,
FR-SYS-142; contract §3). An explicit scope (system or a tenant) instead of a TenantContext;
configuration only: no customer OCR original, payload, sample or business result is read here
(the admin's own samples live in admin_template_samples)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    BIGINT_MAX,
    AdminContext,
    PathId,
    get_admin,
    get_db,
    require_csrf_header,
)
from app.ocr.templates.schema import validate_template
from app.schemas.template_management import (
    ActivateOut,
    AdminCreateTemplateIn,
    AdminTemplateListOut,
    GrantsIn,
    OrganizationCandidatesOut,
    OwnersOut,
    RevisionIn,
    SaveDraftIn,
    StatusIn,
    TemplateDetail,
    TemplateExport,
    UserCandidatesOut,
    ValidateIn,
    ValidateOut,
    VersionDetail,
)
from app.services import template_management_service as svc
from app.services import template_sample_service as sample_svc
from app.services.tenant_access import not_found

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]
SearchQ = Annotated[str, Query(max_length=100)]


async def _detail(db: AsyncSession, template_id: int) -> TemplateDetail:
    tpl = await svc.live(db, template_id)
    if tpl is None:
        raise not_found()
    detail = await svc.detail(db, tpl, can_manage=True, admin=True)
    names = await svc.owner_names(db, {tpl.tenant_id} if tpl.tenant_id is not None else set())
    return TemplateDetail(**detail, owner_name=names.get(tpl.tenant_id))


def _actor(admin: AdminContext) -> svc.Actor:
    return svc.admin_actor(admin.account.id)


# search helpers first: their paths would otherwise match /templates/{template_id}


@router.get(
    "/templates/grant-candidates/users",
    operation_id="adminSearchTemplateGrantUsers",
    response_model=UserCandidatesOut,
)
async def grant_users(db: Db, admin: Admin, q: SearchQ = "") -> UserCandidatesOut:
    return UserCandidatesOut(items=await svc.search_users(db, q))


@router.get(
    "/templates/grant-candidates/organizations",
    operation_id="adminSearchTemplateGrantOrganizations",
    response_model=OrganizationCandidatesOut,
)
async def grant_organizations(db: Db, admin: Admin, q: SearchQ = "") -> OrganizationCandidatesOut:
    return OrganizationCandidatesOut(items=await svc.search_organizations(db, q))


@router.get("/templates/owners", operation_id="adminSearchTemplateOwners", response_model=OwnersOut)
async def owners(db: Db, admin: Admin, q: SearchQ = "") -> OwnersOut:
    return OwnersOut(items=await svc.search_owners(db, q))


@router.post(
    "/templates/validate", operation_id="adminValidateTemplate", response_model=ValidateOut
)
async def validate(req: ValidateIn, admin: Admin) -> ValidateOut:
    return ValidateOut(errors=validate_template(svc.clean_content(req.content))[1])


@router.get("/templates", operation_id="adminListTemplates", response_model=AdminTemplateListOut)
async def list_templates(
    db: Db,
    admin: Admin,
    scope: Literal["system", "tenant"] | None = None,
    tenant_id: Annotated[int | None, Query(gt=0, le=BIGINT_MAX)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> AdminTemplateListOut:
    return AdminTemplateListOut(items=await svc.admin_list(db, scope, tenant_id, q))


@router.post(
    "/templates", operation_id="adminCreateTemplate", response_model=TemplateDetail, status_code=201
)
async def create(req: AdminCreateTemplateIn, db: Db, admin: Admin) -> TemplateDetail:
    actor = _actor(admin)
    target = f"new/{'system' if req.scope == 'system' else f'tenant:{req.tenant_id}'}"

    async def run():
        owner = await svc.admin_scope(db, req.scope, req.tenant_id)
        pending = None
        if req.source == "sample":
            await sample_svc.admin_ready_sample(db, admin.account.id, req.sample_id)
            pending = req.pending_confirmations
        tpl = await svc.create(db, actor, owner, req.content, pending=pending)
        await db.commit()
        return tpl.id

    template_id = await svc.audited(db, actor, "template.create", target, run)
    return await _detail(db, template_id)


@router.get(
    "/templates/{template_id}", operation_id="adminGetTemplate", response_model=TemplateDetail
)
async def get_template(template_id: PathId, db: Db, admin: Admin) -> TemplateDetail:
    return await _detail(db, template_id)


@router.put(
    "/templates/{template_id}/draft",
    operation_id="adminSaveTemplateDraft",
    response_model=TemplateDetail,
)
async def save_draft(template_id: PathId, req: SaveDraftIn, db: Db, admin: Admin) -> TemplateDetail:
    actor = _actor(admin)

    async def run():
        tpl = await svc.locked_live(db, template_id)
        await svc.save_draft(db, actor, tpl, req.revision, req.content, req.pending_confirmations)
        await db.commit()

    await svc.audited(db, actor, "template.save", str(template_id), run)
    return await _detail(db, template_id)


@router.delete(
    "/templates/{template_id}/draft",
    operation_id="adminDiscardTemplateDraft",
    response_model=TemplateDetail,
)
async def discard_draft(
    template_id: PathId, db: Db, admin: Admin, revision: Annotated[int, Query(gt=0)]
) -> TemplateDetail:
    actor = _actor(admin)

    async def run():
        tpl = await svc.locked_live(db, template_id)
        await svc.discard_draft(db, actor, tpl, revision)
        await db.commit()

    await svc.audited(db, actor, "template.discard", str(template_id), run)
    return await _detail(db, template_id)


@router.post(
    "/templates/{template_id}/activate",
    operation_id="adminActivateTemplate",
    response_model=ActivateOut,
)
async def activate(template_id: PathId, req: RevisionIn, db: Db, admin: Admin) -> ActivateOut:
    actor = _actor(admin)

    async def run():
        tpl = await svc.locked_live(db, template_id)
        result, ver = await svc.activate(db, actor, tpl, req.revision)
        await db.commit()
        return result, svc.version_detail(ver)

    result, version = await svc.audited(db, actor, "template.activate", str(template_id), run)
    detail = await _detail(db, template_id)
    return ActivateOut(result=result, version=VersionDetail(**version), template=detail)


@router.post(
    "/templates/{template_id}/status",
    operation_id="adminSetTemplateStatus",
    response_model=TemplateDetail,
)
async def set_status(template_id: PathId, req: StatusIn, db: Db, admin: Admin) -> TemplateDetail:
    actor = _actor(admin)

    async def run():
        tpl = await svc.locked_live(db, template_id)
        await svc.set_status(db, actor, tpl, req.revision, req.status)
        await db.commit()

    await svc.audited(db, actor, "template.status", str(template_id), run)
    return await _detail(db, template_id)


@router.put(
    "/templates/{template_id}/grants",
    operation_id="adminSetTemplateGrants",
    response_model=TemplateDetail,
)
async def set_grants(template_id: PathId, req: GrantsIn, db: Db, admin: Admin) -> TemplateDetail:
    actor = _actor(admin)

    async def run():
        tpl = await svc.locked_live(db, template_id)
        await svc.set_grants(
            db,
            actor,
            tpl,
            req.revision,
            req.mode,
            list(req.plans),
            req.user_ids,
            req.organization_tenant_ids,
        )
        await db.commit()

    await svc.audited(db, actor, "template.grant", str(template_id), run)
    return await _detail(db, template_id)


@router.delete("/templates/{template_id}", operation_id="adminDeleteTemplate", status_code=204)
async def delete_template(
    template_id: PathId, db: Db, admin: Admin, revision: Annotated[int, Query(gt=0)]
) -> Response:
    actor = _actor(admin)

    async def run():
        tpl = await svc.locked_live(db, template_id)
        await svc.delete_template(db, actor, tpl, revision)
        await db.commit()

    await svc.audited(db, actor, "template.delete", str(template_id), run)
    return Response(status_code=204)


@router.get(
    "/templates/{template_id}/export",
    operation_id="adminExportTemplate",
    response_model=TemplateExport,
)
async def export(
    template_id: PathId, db: Db, admin: Admin, draft: Annotated[int, Query(ge=0, le=1)] = 0
) -> TemplateExport:
    tpl = await svc.live(db, template_id)
    if tpl is None:
        raise not_found()
    ver = await svc.version_current(db, tpl)
    return TemplateExport(**svc.export_content(tpl, ver, bool(draft)))


@router.get(
    "/templates/{template_id}/versions/{version_id}",
    operation_id="adminGetTemplateVersion",
    response_model=VersionDetail,
)
async def get_version(
    template_id: PathId, version_id: PathId, db: Db, admin: Admin
) -> VersionDetail:
    tpl = await svc.live(db, template_id)
    if tpl is None:
        raise not_found()
    return VersionDetail(**svc.version_detail(await svc.version_of(db, tpl, version_id, full=True)))
