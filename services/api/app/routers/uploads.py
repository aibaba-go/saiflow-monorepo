"""Uploads, pending records and originals (documents spec: FR-UPLOAD-003..013)."""

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
from app.schemas.document import FileOut, UploadIn
from app.schemas.loose import ensure_text
from app.services import upload_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1", tags=["documents"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]
Store = Annotated[ObjectStore, Depends(get_store)]


def _out(row) -> FileOut:
    return FileOut.model_validate(row, from_attributes=True)


async def _committing(db: AsyncSession, step):
    """A rejected upload is recorded (REJECTED, object removed) before the error answers."""
    try:
        row = await step
    except AppError:
        await db.commit()
        raise
    await db.commit()
    return row


async def _read_capped(request: Request) -> bytes:
    """The body, never more than one byte past the limit (the limit itself is checked later)."""
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        chunks.append(chunk)
        if size > upload_service.MAX_BYTES:
            break
    return b"".join(chunks)


@router.post("/uploads", operation_id="createUpload", status_code=201, response_model=FileOut)
async def create_upload(
    req: UploadIn, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> FileOut:
    ensure_text(req)
    row = await upload_service.create_upload(db, ctx, principal, req.file_name)
    await db.commit()
    return _out(row)


@router.put("/uploads/{upload_id}/content", operation_id="putUploadContent", response_model=FileOut)
async def put_content(
    upload_id: str, request: Request, ctx: Tenant, db: Db, store: Store
) -> FileOut:
    data = await _read_capped(request)
    return _out(await _committing(db, upload_service.put_content(db, store, ctx, upload_id, data)))


@router.post("/uploads/{upload_id}/complete", operation_id="completeUpload", response_model=FileOut)
async def complete(upload_id: str, ctx: Tenant, principal: Caller, db: Db, store: Store) -> FileOut:
    return _out(
        await _committing(db, upload_service.complete(db, store, ctx, principal, upload_id))
    )


@router.get("/files/pending", operation_id="listPendingFiles", response_model=list[FileOut])
async def pending(ctx: Tenant, db: Db) -> list[FileOut]:
    return [_out(r) for r in await upload_service.pending(db, ctx)]


@router.get("/files/{file_id}", operation_id="getFile", response_model=FileOut)
async def get_file(file_id: str, ctx: Tenant, db: Db) -> FileOut:
    """One original's details (main's confirm page): one the caller may read, else 404."""
    return _out(await upload_service.file_access(db, ctx, file_id))


@router.delete("/files/{file_id}", operation_id="deletePendingFile", status_code=204)
async def delete_pending(
    file_id: str, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> Response:
    await upload_service.delete_pending(db, store, ctx, principal, file_id)
    await db.commit()
    return Response(status_code=204)


@router.get("/files/{file_id}/content", operation_id="getFileContent", response_class=Response)
async def content(file_id: str, ctx: Tenant, db: Db, store: Store) -> Response:
    row = await upload_service.file_access(db, ctx, file_id)
    data = await upload_service.read_original(store, row)
    return Response(
        data,
        media_type=row.mime_type or "application/octet-stream",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get(
    "/files/{file_id}/pages/{page}/preview",
    operation_id="getFilePagePreview",
    response_class=Response,
)
async def preview(file_id: str, page: int, ctx: Tenant, db: Db, store: Store) -> Response:
    row = await upload_service.file_access(db, ctx, file_id)
    data, mime = await upload_service.page_preview(store, row, page)
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=300"})
