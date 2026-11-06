"""Import a file from a URL into Pending (FR-UPLOAD-014)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
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
from app.ocr import fetch
from app.permissions import Permission
from app.schemas.document import FileOut
from app.schemas.loose import LooseRequest, ensure_text
from app.services import upload_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext, require

router = APIRouter(prefix="/api/v1", tags=["uploads"], dependencies=[Depends(require_csrf_header)])

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]
Store = Annotated[ObjectStore, Depends(get_store)]


class ImportIn(LooseRequest):
    url: str | None = None


def _bad(code: str) -> AppError:
    return AppError(400, code, f"error.{code}", ["url"])


@router.post("/file-imports", operation_id="importFile", status_code=201, response_model=FileOut)
async def import_file(
    req: ImportIn, request: Request, ctx: Tenant, principal: Caller, db: Db, store: Store
) -> FileOut:
    ensure_text(req)
    require(ctx, Permission.UPLOAD_OCR)  # before anything is fetched
    fetcher = getattr(request.app.state, "fetch_public", fetch.fetch_public)  # tests inject one
    url = (req.url or "").strip()
    try:
        fetch.parse_url(url)  # http/https with a host, before anything else
        got = await fetcher(url)
    except fetch.InvalidUrl:
        raise _bad("import_invalid_url") from None
    except fetch.AddressNotAllowed:
        raise _bad("import_address_not_allowed") from None
    except fetch.TooLarge:
        raise upload_service.rejected("file_too_large") from None
    except fetch.FetchFailed:
        raise _bad("import_fetch_failed") from None
    try:
        row = await upload_service.import_bytes(db, store, ctx, principal, got.final_url, got.data)
    except AppError:
        await db.commit()  # a rejected file is recorded (REJECTED, object removed)
        raise
    await db.commit()
    return FileOut.model_validate(row, from_attributes=True)
