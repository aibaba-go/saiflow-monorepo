"""Choosing a template or the generic result for a job (FR-OCR-019, FR-OCR-020, FR-OCR-023)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_principal, get_tenant_context, require_csrf_header
from app.errors import AppError
from app.schemas.loose import LooseRequest, ensure_text
from app.services import job_service, mapping_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/ocr/jobs", tags=["ocr"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]


class TemplateOption(BaseModel):
    template_id: int
    template_version_id: int
    code: str
    name: str
    score: float | None = None
    recommended: bool = False


class TemplateVersionOut(BaseModel):
    template_version_id: int
    template_id: int
    code: str
    name: str
    groups: list[dict]


class TemplateOptionsOut(BaseModel):
    templates: list[TemplateOption]
    generic: bool
    current_template_version_id: int | None
    attempts: int
    limit: int
    last_failure: str | None


class ApplyTemplateIn(LooseRequest):
    template_version_id: int | None = None


class MappingOut(BaseModel):
    result: str  # "switched" (an earlier conversion, no LLM call) or "started"
    mapping_id: str | None


@router.get(
    "/{job_id}/template-options",
    operation_id="getTemplateOptions",
    response_model=TemplateOptionsOut,
)
async def options(job_id: str, ctx: Tenant, db: Db) -> TemplateOptionsOut:
    job = await job_service.job_access(db, ctx, job_id)
    return TemplateOptionsOut(**await mapping_service.template_options(db, job))


@router.post(
    "/{job_id}/template",
    operation_id="applyTemplate",
    response_model=MappingOut,
    responses={202: {"model": MappingOut}},
)
async def apply_template(
    job_id: str, req: ApplyTemplateIn, ctx: Tenant, principal: Caller, db: Db, response: Response
) -> MappingOut:
    ensure_text(req)
    if not isinstance(req.template_version_id, int) or isinstance(req.template_version_id, bool):
        raise AppError(400, "validation_error", "error.validation", ["template_version_id"])
    job = await job_service.job_access(db, ctx, job_id, for_update=True)
    job_service.require_edit(ctx, job)
    result, mapping = await mapping_service.apply_template(
        db, job, req.template_version_id, ctx.user_id
    )
    await job_service.audit(db, principal, "template.apply", job.id)
    await db.commit()
    if result == "started":
        response.status_code = 202
    return MappingOut(result=result, mapping_id=mapping.id if mapping else None)


@router.post("/{job_id}/generic", operation_id="useGenericResult", response_model=MappingOut)
async def use_generic(job_id: str, ctx: Tenant, principal: Caller, db: Db) -> MappingOut:
    job = await job_service.job_access(db, ctx, job_id, for_update=True)
    job_service.require_edit(ctx, job)
    await mapping_service.use_generic(db, job, ctx.user_id)
    await job_service.audit(db, principal, "template.generic", job.id)
    await db.commit()
    return MappingOut(result="switched", mapping_id=None)


versions_router = APIRouter(
    prefix="/api/v1/templates", tags=["ocr"], dependencies=[Depends(require_csrf_header)]
)


@versions_router.get(
    "/versions/{version_id}",
    operation_id="getTemplateVersion",
    response_model=TemplateVersionOut,
)
async def template_version(version_id: int, ctx: Tenant, db: Db) -> TemplateVersionOut:
    """A published template version's fields, for preview before applying (FR-OCR-024)."""
    for tpl, ver in await mapping_service.available_versions(db, ctx.tenant_id):
        if ver.id == version_id:
            return TemplateVersionOut(
                template_version_id=ver.id,
                template_id=tpl.id,
                code=tpl.code,
                name=ver.name,
                groups=ver.groups,
            )
    raise AppError(404, "not_found", "error.not_found")
