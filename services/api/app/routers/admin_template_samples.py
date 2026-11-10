"""Platform admin template samples (FR-SYS-142, FR-TEMPLATE-008): the admin console starts a
system or tenant template from a sample PDF/image. Upload only (no customer OCR result is read
here); no tenant quota is reserved or charged; a sample is visible to its admin alone."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminContext, get_admin, get_db, get_store, require_csrf_header
from app.errors import AppError
from app.integrations.storage import ObjectStore
from app.routers.template_samples import _NO_STORE, _UPLOAD_BODY, _read_capped
from app.schemas.template_sample import SampleListOut, SampleOut
from app.services import template_sample_service as service

router = APIRouter(
    prefix="/api/v1/admin/template-samples",
    tags=["admin"],
    dependencies=[Depends(require_csrf_header)],
)

Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]
Store = Annotated[ObjectStore, Depends(get_store)]


async def _one(db: AsyncSession, store: ObjectStore, sample, *, with_candidate=True) -> SampleOut:
    (item,) = await service.outputs(db, store, [sample], with_candidate=with_candidate)
    return SampleOut(**item)


async def _denied(db: AsyncSession, admin_id: int, action: str, target, step):
    """Run a step; a refusal (404) is audited without content before it answers. The
    admin ID is taken beforehand: the rollback expires every loaded row."""
    try:
        return await step
    except AppError as exc:
        if exc.status in (403, 404):
            await db.rollback()
            await service.audit_admin(db, admin_id, action, target, ok=False)
            await db.commit()
        raise


@router.post(
    "",
    operation_id="adminCreateTemplateSample",
    status_code=202,
    response_model=SampleOut,
    openapi_extra=_UPLOAD_BODY,
)
async def create_sample(request: Request, db: Db, admin: Admin, store: Store) -> SampleOut:
    data = service.extract_file(request.headers.get("content-type"), await _read_capped(request))
    sample = await service.admin_create_upload(db, store, admin.account.id, data)
    await db.commit()
    return await _one(db, store, sample, with_candidate=False)


@router.get("", operation_id="adminListTemplateSamples", response_model=SampleListOut)
async def list_samples(db: Db, admin: Admin) -> SampleListOut:
    rows = await service.admin_list(db, admin.account.id)
    items = await service.outputs(db, None, rows, with_candidate=False)
    return SampleListOut(items=[SampleOut(**i) for i in items])


@router.get("/{sample_id}", operation_id="adminGetTemplateSample", response_model=SampleOut)
async def get_sample(sample_id: str, db: Db, admin: Admin, store: Store) -> SampleOut:
    return await _one(db, store, await service.admin_sample(db, admin.account.id, sample_id))


@router.get(
    "/{sample_id}/original",
    operation_id="adminGetTemplateSampleOriginal",
    response_class=Response,
)
async def get_original(sample_id: str, db: Db, admin: Admin, store: Store) -> Response:
    data, mime = await service.admin_original(db, store, admin.account.id, sample_id)
    return Response(data, media_type=mime, headers=_NO_STORE)


@router.get(
    "/{sample_id}/pages/{page}",
    operation_id="adminGetTemplateSamplePage",
    response_class=Response,
)
async def get_page(sample_id: str, page: int, db: Db, admin: Admin, store: Store) -> Response:
    data, mime = await service.admin_page(db, store, admin.account.id, sample_id, page)
    return Response(data, media_type=mime, headers=_NO_STORE)


@router.post(
    "/{sample_id}/retry", operation_id="adminRetryTemplateSample", response_model=SampleOut
)
async def retry_sample(sample_id: str, db: Db, admin: Admin, store: Store) -> SampleOut:
    sample = await _denied(
        db,
        admin.account.id,
        "template_sample.retry",
        sample_id[:64],
        service.admin_retry(db, admin.account.id, sample_id),
    )
    await db.commit()
    return await _one(db, store, sample)


@router.post(
    "/{sample_id}/cancel", operation_id="adminCancelTemplateSample", response_model=SampleOut
)
async def cancel_sample(sample_id: str, db: Db, admin: Admin, store: Store) -> SampleOut:
    sample = await _denied(
        db,
        admin.account.id,
        "template_sample.cancel",
        sample_id[:64],
        service.admin_cancel(db, admin.account.id, sample_id),
    )
    await db.commit()
    return await _one(db, store, sample)


@router.delete("/{sample_id}", operation_id="adminDeleteTemplateSample", status_code=204)
async def delete_sample(sample_id: str, db: Db, admin: Admin, store: Store) -> Response:
    await _denied(
        db,
        admin.account.id,
        "template_sample.delete",
        sample_id[:64],
        service.admin_delete(db, store, admin.account.id, sample_id),
    )
    await db.commit()
    return Response(status_code=204)
