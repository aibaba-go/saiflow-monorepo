"""XLSX exports of confirmed results and their downloads (FR-ENTRY-015)."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import (
    get_db,
    get_principal,
    get_settings,
    get_store,
    get_tenant_context,
    require_csrf_header,
)
from app.integrations.storage import ObjectStore
from app.schemas.loose import LooseRequest, ensure_text
from app.services import export_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(prefix="/api/v1", tags=["exports"], dependencies=[Depends(require_csrf_header)])

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]
Store = Annotated[ObjectStore, Depends(get_store)]


class ExportIn(LooseRequest):
    language: str | None = None


class ExportOut(BaseModel):
    id: str
    expires_at: str


class ExportStateOut(BaseModel):
    id: str
    status: str
    expires_at: str


class TicketOut(BaseModel):
    url: str


def _file(data: bytes, name: str, *, head_only: bool = False) -> Response:
    response = Response(
        data,
        media_type=export_service.XLSX_MIME,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "private, no-store",
        },
    )
    if head_only:
        # Preserve the GET Content-Length while sending no file bytes for HEAD.
        response.body = b""
    return response


@router.post(
    "/ocr/jobs/{job_id}/exports",
    operation_id="createExport",
    status_code=201,
    response_model=ExportOut,
)
async def create(
    job_id: str,
    ctx: Tenant,
    principal: Caller,
    db: Db,
    store: Store,
    response: Response,
    req: ExportIn | None = None,
) -> ExportOut:
    if req is not None:
        ensure_text(req)
    export, created = await export_service.create(
        db, store, ctx, principal, job_id, req.language if req else None
    )
    await db.commit()
    if not created:
        response.status_code = 200
    return ExportOut(id=export.id, expires_at=export.expires_at.isoformat())


@router.get("/exports/{export_id}", operation_id="getExport", response_model=ExportStateOut)
async def get_export(export_id: str, ctx: Tenant, db: Db) -> ExportStateOut:
    export = await export_service.status(db, ctx, export_id)
    return ExportStateOut(
        id=export.id, status=export.status, expires_at=export.expires_at.isoformat()
    )


@router.head("/exports/{export_id}/download", include_in_schema=False)
@router.get("/exports/{export_id}/download", operation_id="downloadExport", response_class=Response)
async def download(export_id: str, request: Request, ctx: Tenant, db: Db, store: Store) -> Response:
    data, name = await export_service.content(db, store, ctx, export_id)
    return _file(data, name, head_only=request.method == "HEAD")


@router.post(
    "/exports/{export_id}/ticket", operation_id="createDownloadTicket", response_model=TicketOut
)
async def ticket(
    export_id: str,
    ctx: Tenant,
    principal: Caller,
    db: Db,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TicketOut:
    return TicketOut(url=await export_service.ticket(db, settings, ctx, principal, export_id))


@router.head("/export-downloads/{token}", include_in_schema=False)
@router.get(
    "/export-downloads/{token}", operation_id="redeemDownloadTicket", response_class=Response
)
async def redeem(
    token: str,
    request: Request,
    db: Db,
    store: Store,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    data, name = await export_service.redeem(db, store, settings, token)
    await db.commit()
    return _file(data, name, head_only=request.method == "HEAD")
