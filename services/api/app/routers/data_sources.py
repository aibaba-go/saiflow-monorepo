from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import get_db, get_settings, get_tenant_context, require_csrf_header
from app.permissions import Permission
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
from app.services.tenant_access import TenantContext, not_found

router = APIRouter(
    prefix="/api/v1/data-sources",
    tags=["data-sources"],
    dependencies=[Depends(require_csrf_header)],
)
Db = Annotated[AsyncSession, Depends(get_db)]
Config = Annotated[Settings, Depends(get_settings)]


async def manager(
    db: Db, ctx: Annotated[TenantContext, Depends(get_tenant_context)]
) -> TenantContext:
    await report_service.require(db, ctx, "manage")
    return ctx


Manager = Annotated[TenantContext, Depends(manager)]


@router.get("", operation_id="listDataSources", response_model=SourcesOut)
async def list_sources(ctx: Manager, db: Db, settings: Config):
    return await svc.list_sources(db, ctx.tenant_id, settings)


@router.post("", operation_id="createDataSource", response_model=SourceOut, status_code=201)
async def create_source(body: SourceIn, ctx: Manager, db: Db, settings: Config):
    return await svc.save_source(db, ctx.tenant_id, body, settings, "user", ctx.user_id)


@router.get("/{source_id}", operation_id="getDataSource", response_model=SourceOut)
async def get_source(source_id: str, ctx: Manager, db: Db, settings: Config):
    if source_id.startswith("template:"):
        items = (await svc.list_sources(db, ctx.tenant_id, settings))["items"]
        for item in items:
            if item["id"] == source_id:
                return item
        raise not_found()
    return svc.metadata(await svc.get_source(db, ctx.tenant_id, source_id))


@router.put("/{source_id}", operation_id="updateDataSource", response_model=SourceOut)
async def update_source(source_id: str, body: SourceIn, ctx: Manager, db: Db, settings: Config):
    return await svc.save_source(db, ctx.tenant_id, body, settings, "user", ctx.user_id, source_id)


@router.delete("/{source_id}", operation_id="deleteDataSource", status_code=204)
async def delete_source(source_id: str, ctx: Manager, db: Db):
    await svc.remove_source(db, ctx.tenant_id, source_id, "user", ctx.user_id)
    return Response(status_code=204)


@router.get(
    "/{source_id}/tables", operation_id="listDataSourceTables", response_model=SourceTablesOut
)
async def tables(source_id: str, ctx: Manager, db: Db, settings: Config):
    if not ctx.has(Permission.DATA_BROWSE):
        raise not_found()
    return await svc.tables(db, ctx.tenant_id, source_id, settings)


@router.post("/{source_id}/query", operation_id="queryDataSource", response_model=TableResult)
async def query_source(source_id: str, body: SourceQueryIn, ctx: Manager, db: Db, settings: Config):
    if not ctx.has(Permission.DATA_BROWSE):
        raise not_found()
    return await svc.audited_query(
        db,
        ctx.tenant_id,
        source_id,
        settings,
        body.sql,
        body.page,
        body.page_size,
        "user",
        ctx.user_id,
    )


@router.post("/{source_id}/test", operation_id="testDataSource", response_model=ConnectionTestOut)
async def test_source(source_id: str, ctx: Manager, db: Db, settings: Config):
    await svc.audited_query(
        db,
        ctx.tenant_id,
        source_id,
        settings,
        "SELECT 1 AS connected",
        1,
        5,
        "user",
        ctx.user_id,
        action="test",
    )
    return {"ok": True}
