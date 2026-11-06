"""OCR jobs (FR-OCR-017, FR-VERIFY-017)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    get_db,
    get_principal,
    get_store,
    get_tenant_context,
    require_csrf_header,
)
from app.integrations.storage import ObjectStore
from app.schemas.job import JobIn, JobOut, JobPageOut
from app.schemas.loose import ensure_text
from app.services import job_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/ocr/jobs", tags=["ocr"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]


async def _out(db: AsyncSession, job) -> JobOut:
    return JobOut(**(await job_service.summaries(db, [job]))[0])


@router.post("", operation_id="createOcrJob", status_code=201, response_model=JobOut)
async def create_job(
    req: JobIn, ctx: Tenant, principal: Caller, db: Db, response: Response
) -> JobOut:
    ensure_text(req)
    job, created = await job_service.create_job(
        db, ctx, principal, req.file_id, req.idempotency_key
    )
    await db.commit()
    if not created:
        response.status_code = 200
    return await _out(db, job)


@router.get("", operation_id="listOcrJobs", response_model=JobPageOut)
async def list_jobs(
    ctx: Tenant,
    db: Db,
    stage: str | None = None,
    q: str | None = None,
    page: str | None = None,
    page_size: str | None = None,
) -> JobPageOut:
    body = await job_service.list_jobs(
        db, ctx, stage_filter=stage, q=q, page=page, page_size=page_size
    )
    return JobPageOut(**body)


@router.get("/{job_id}", operation_id="getOcrJob", response_model=JobOut)
async def get_job(job_id: str, ctx: Tenant, db: Db) -> JobOut:
    return await _out(db, await job_service.job_access(db, ctx, job_id))


@router.post("/{job_id}/cancel", operation_id="cancelOcrJob", response_model=JobOut)
async def cancel(job_id: str, ctx: Tenant, principal: Caller, db: Db) -> JobOut:
    job = await job_service.cancel(db, ctx, principal, job_id)
    await db.commit()
    return await _out(db, job)


@router.post("/{job_id}/rerun", operation_id="rerunOcrJob", status_code=201, response_model=JobOut)
async def rerun(job_id: str, ctx: Tenant, principal: Caller, db: Db) -> JobOut:
    job = await job_service.rerun(db, ctx, principal, job_id)
    await db.commit()
    return await _out(db, job)


@router.delete("/{job_id}/results", operation_id="deleteOcrResults", status_code=204)
async def delete_results(
    job_id: str,
    ctx: Tenant,
    principal: Caller,
    db: Db,
    store: Annotated[ObjectStore, Depends(get_store)],
) -> Response:
    await job_service.delete_results(db, store, ctx, principal, job_id)
    await db.commit()
    return Response(status_code=204)
