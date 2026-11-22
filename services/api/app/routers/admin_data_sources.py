from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import (
    BIGINT_MAX,
    AdminContext,
    get_admin,
    get_db,
    get_settings,
    require_csrf_header,
)
from app.schemas.data_source import (
    ConnectionTestOut,
    SourceIn,
    SourceOut,
    SourceQueryIn,
    SourcesOut,
    SourceTablesOut,
    TableResult,
)
from app.services import data_source_service as svc
from app.services import report_service
from app.services.tenant_access import not_found

router = APIRouter(
    prefix="/api/v1/admin/data-sources", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)
Db = Annotated[AsyncSession, Depends(get_db)]
Config = Annotated[Settings, Depends(get_settings)]
Admin = Annotated[AdminContext, Depends(get_admin)]
Tenant = Annotated[int, Query(gt=0, le=BIGINT_MAX)]
OptionalTenant = Annotated[int | None, Query(gt=0, le=BIGINT_MAX)]


async def target(db: AsyncSession, source_id: str, tenant_id: int | None) -> int | None:
    if source_id == svc.SYSTEM_ID:
        return None
    if tenant_id is None:
        raise not_found()
    return await report_service.organization_tenant(db, tenant_id)


@router.get("", operation_id="adminListDataSources", response_model=SourcesOut)
async def list_sources(admin: Admin, db: Db, settings: Config, tenant_id: OptionalTenant = None):
    tid = await report_service.organization_tenant(db, tenant_id) if tenant_id is not None else None
    return await svc.list_sources(db, tid, settings, admin=True)


@router.post("", operation_id="adminCreateDataSource", response_model=SourceOut, status_code=201)
async def create_source(body: SourceIn, admin: Admin, db: Db, settings: Config, tenant_id: Tenant):
    tid = await report_service.organization_tenant(db, tenant_id)
    return await svc.save_source(db, tid, body, settings, "admin", admin.account.id)


@router.get("/{source_id}", operation_id="adminGetDataSource", response_model=SourceOut)
async def get_source(
    source_id: str, admin: Admin, db: Db, settings: Config, tenant_id: OptionalTenant = None
):
    tid = await target(db, source_id, tenant_id)
    if tid is None:
        return svc.builtin_metadata(settings)
    items = (await svc.list_sources(db, tid, settings))["items"]
    for item in items:
        if item["id"] == source_id:
            return item
    raise not_found()


@router.put("/{source_id}", operation_id="adminUpdateDataSource", response_model=SourceOut)
async def update_source(
    source_id: str, body: SourceIn, admin: Admin, db: Db, settings: Config, tenant_id: Tenant
):
    tid = await report_service.organization_tenant(db, tenant_id)
    return await svc.save_source(db, tid, body, settings, "admin", admin.account.id, source_id)


@router.delete("/{source_id}", operation_id="adminDeleteDataSource", status_code=204)
async def delete_source(source_id: str, admin: Admin, db: Db, tenant_id: Tenant):
    tid = await report_service.organization_tenant(db, tenant_id)
    await svc.remove_source(db, tid, source_id, "admin", admin.account.id)
    return Response(status_code=204)


@router.get(
    "/{source_id}/tables", operation_id="adminListDataSourceTables", response_model=SourceTablesOut
)
async def tables(
    source_id: str, admin: Admin, db: Db, settings: Config, tenant_id: OptionalTenant = None
):
    tid = await target(db, source_id, tenant_id)
    return await svc.tables(db, tid, source_id, settings, admin=True)


@router.post("/{source_id}/query", operation_id="adminQueryDataSource", response_model=TableResult)
async def query_source(
    source_id: str,
    body: SourceQueryIn,
    admin: Admin,
    db: Db,
    settings: Config,
    tenant_id: OptionalTenant = None,
):
    tid = await target(db, source_id, tenant_id)
    return await svc.audited_query(
        db,
        tid,
        source_id,
        settings,
        body.sql,
        body.page,
        body.page_size,
        "admin",
        admin.account.id,
        admin=True,
    )


@router.post(
    "/{source_id}/test", operation_id="adminTestDataSource", response_model=ConnectionTestOut
)
async def test_source(
    source_id: str, admin: Admin, db: Db, settings: Config, tenant_id: OptionalTenant = None
):
    tid = await target(db, source_id, tenant_id)
    await svc.audited_query(
        db,
        tid,
        source_id,
        settings,
        "SELECT 1 AS connected",
        1,
        5,
        "admin",
        admin.account.id,
        admin=True,
        action="test",
    )
    return {"ok": True}
