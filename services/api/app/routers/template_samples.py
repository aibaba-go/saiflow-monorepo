"""Template samples (FR-TEMPLATE-008, FR-TEMPLATE-014; contract §4): upload a sample or
start from an existing OCR result, follow progress, read the candidate beside the
original, retry, cancel and delete."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    get_db,
    get_principal,
    get_store,
    get_tenant_context,
    require_csrf_header,
)
from app.errors import AppError
from app.integrations.storage import ObjectStore
from app.schemas.loose import ensure_text
from app.schemas.template_sample import SampleFromJobIn, SampleListOut, SampleOut
from app.services import template_sample_service as service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/template-samples",
    tags=["templates"],
    dependencies=[Depends(require_csrf_header)],
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]
Store = Annotated[ObjectStore, Depends(get_store)]

_UPLOAD_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"],
                    "properties": {"file": {"type": "string", "format": "binary"}},
                }
            },
            "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
        },
    }
}
_NO_STORE = {"Cache-Control": "private, no-store"}


async def _denied(db: AsyncSession, principal: Principal, action: str, target, step):
    """Run a step; a refusal (403/404) is audited without content before it answers."""
    try:
        return await step
    except AppError as exc:
        if exc.status in (403, 404):
            await db.rollback()
            await service.audit(db, principal, action, target, ok=False)
            await db.commit()
        raise


async def _read_capped(request: Request) -> bytes:
    """The body, never much more than the limit (the limit itself is checked after)."""
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        chunks.append(chunk)
        if size > service.MAX_BYTES + service.ENVELOPE:
            raise service.invalid("sample_file_too_large")
    return b"".join(chunks)


async def _one(db: AsyncSession, store: ObjectStore, sample, *, with_candidate=True) -> SampleOut:
    (item,) = await service.outputs(db, store, [sample], with_candidate=with_candidate)
    return SampleOut(**item)


@router.post(
    "",
    operation_id="createTemplateSample",
    status_code=202,
    response_model=SampleOut,
    openapi_extra=_UPLOAD_BODY,
)
async def create_sample(
    request: Request, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> SampleOut:
    # permissions before the body is read: a refused caller never uploads 20 MB
    await _denied(db, principal, "template_sample.create", None, _check(ctx))
    data = service.extract_file(request.headers.get("content-type"), await _read_capped(request))
    sample = await service.create_upload(db, store, ctx, principal, data)
    await db.commit()
    return await _one(db, store, sample, with_candidate=False)


async def _check(ctx: TenantContext) -> None:
    service.require_create(ctx)


@router.post(
    "/from-job",
    operation_id="createTemplateSampleFromJob",
    status_code=202,
    response_model=SampleOut,
)
async def create_from_job(
    req: SampleFromJobIn, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> SampleOut:
    ensure_text(req)
    sample = await _denied(
        db,
        principal,
        "template_sample.create_from_job",
        req.job_id if isinstance(req.job_id, str) and len(req.job_id) <= 64 else None,
        service.create_from_job(db, store, ctx, principal, req.job_id),
    )
    await db.commit()
    return await _one(db, store, sample, with_candidate=False)


@router.get("", operation_id="listTemplateSamples", response_model=SampleListOut)
async def list_samples(ctx: Tenant, db: Db) -> SampleListOut:
    # the list reads no objects, so it answers even while storage is unavailable
    rows = await service.list_samples(db, ctx)
    items = await service.outputs(db, None, rows, with_candidate=False)
    return SampleListOut(items=[SampleOut(**i) for i in items])


@router.get("/{sample_id}", operation_id="getTemplateSample", response_model=SampleOut)
async def get_sample(sample_id: str, ctx: Tenant, db: Db, store: Store) -> SampleOut:
    return await _one(db, store, await service.own_sample(db, ctx, sample_id))


@router.get(
    "/{sample_id}/original",
    operation_id="getTemplateSampleOriginal",
    response_class=Response,
)
async def get_original(sample_id: str, ctx: Tenant, db: Db, store: Store) -> Response:
    data, mime = await service.original(db, store, ctx, sample_id)
    return Response(data, media_type=mime, headers=_NO_STORE)


@router.get(
    "/{sample_id}/pages/{page}",
    operation_id="getTemplateSamplePage",
    response_class=Response,
)
async def get_page(sample_id: str, page: int, ctx: Tenant, db: Db, store: Store) -> Response:
    data, mime = await service.page_image(db, store, ctx, sample_id, page)
    return Response(data, media_type=mime, headers=_NO_STORE)


@router.post("/{sample_id}/retry", operation_id="retryTemplateSample", response_model=SampleOut)
async def retry_sample(
    sample_id: str, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> SampleOut:
    sample = await _denied(
        db,
        principal,
        "template_sample.retry",
        sample_id[:64],
        service.retry(db, ctx, principal, sample_id),
    )
    await db.commit()
    return await _one(db, store, sample)


@router.post("/{sample_id}/cancel", operation_id="cancelTemplateSample", response_model=SampleOut)
async def cancel_sample(
    sample_id: str, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> SampleOut:
    sample = await _denied(
        db,
        principal,
        "template_sample.cancel",
        sample_id[:64],
        service.cancel(db, ctx, principal, sample_id),
    )
    await db.commit()
    return await _one(db, store, sample)


@router.delete("/{sample_id}", operation_id="deleteTemplateSample", status_code=204)
async def delete_sample(
    sample_id: str, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> Response:
    await _denied(
        db,
        principal,
        "template_sample.delete",
        sample_id[:64],
        service.delete(db, store, ctx, principal, sample_id),
    )
    await db.commit()
    return Response(status_code=204)
