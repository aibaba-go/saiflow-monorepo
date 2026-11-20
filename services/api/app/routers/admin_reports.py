"""Platform admin report configuration for an organization tenant (template-report-management
contract §6; FR-REPORT-003/014, FR-SYS-142). Configuration only: the preview is built from
synthetic rows (`synthetic: true`), and there is no data or CSV route for the admin."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import (
    BIGINT_MAX,
    AdminContext,
    PathId,
    get_admin,
    get_db,
    get_settings,
    get_store,
    require_csrf_header,
)
from app.errors import AppError
from app.schemas.report import (
    AdminCreateReportIn,
    CatalogFieldsOut,
    CatalogTemplatesOut,
    PreviewIn,
    QueryResult,
    ReportAssetOut,
    ReportContentPolicyOut,
    ReportDetail,
    ReportListOut,
    RevisionIn,
    SaveReportIn,
)
from app.services import report_service as svc

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)

Config = Annotated[Settings, Depends(get_settings)]
Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]
TenantQ = Annotated[int, Query(gt=0, le=BIGINT_MAX)]
OptionalTenantQ = Annotated[int | None, Query(gt=0, le=BIGINT_MAX)]
OptionalReportId = Annotated[int | None, Query(gt=0, le=BIGINT_MAX)]


def _actor(admin: AdminContext, tenant_id: int) -> svc.Actor:
    return svc.admin_actor(admin.account.id, tenant_id)


async def _detail(db: AsyncSession, tenant_id: int, report_id: int) -> ReportDetail:
    report = await svc.get_report(db, tenant_id, report_id)
    return ReportDetail(**await svc.detail(db, report, manage=True, export=False))


@router.get(
    "/reports/catalog/templates",
    operation_id="adminListReportCatalogTemplates",
    response_model=CatalogTemplatesOut,
)
async def catalog_templates(
    admin: Admin, db: Db, tenant_id: TenantQ, report_id: OptionalReportId = None
) -> CatalogTemplatesOut:
    tid = await svc.organization_tenant(db, tenant_id)
    if report_id is not None:
        await svc.get_report(db, tid, report_id)
    return CatalogTemplatesOut(items=await svc.catalog_templates(db, tid, report_id))


@router.get(
    "/reports/catalog/fields",
    operation_id="adminGetReportCatalogFields",
    response_model=CatalogFieldsOut,
)
async def catalog_fields(
    admin: Admin,
    db: Db,
    tenant_id: TenantQ,
    template_id: Annotated[int, Query(gt=0, le=BIGINT_MAX)],
    version_ids: Annotated[str, Query(max_length=400)],
    report_id: OptionalReportId = None,
) -> CatalogFieldsOut:
    tid = await svc.organization_tenant(db, tenant_id)
    if report_id is not None:
        await svc.get_report(db, tid, report_id)
    return CatalogFieldsOut(
        **await svc.catalog_fields(db, tid, report_id, template_id, version_ids)
    )


@router.get("/reports", operation_id="adminListReports", response_model=ReportListOut)
async def list_reports(admin: Admin, db: Db, tenant_id: TenantQ) -> ReportListOut:
    tid = await svc.organization_tenant(db, tenant_id)
    return ReportListOut(items=await svc.summaries(db, tid, manage=True, view=False))


@router.post(
    "/reports", operation_id="adminCreateReport", status_code=201, response_model=ReportDetail
)
async def create_report(req: AdminCreateReportIn, admin: Admin, db: Db) -> ReportDetail:
    tid = await svc.organization_tenant(db, req.tenant_id)
    actor = _actor(admin, tid)

    async def run():
        report = await svc.create(db, tid, actor, req.name)
        return await _detail(db, tid, report.id)

    return await svc.audited(db, actor, "create", None, run)


@router.get(
    "/reports/content-policy",
    operation_id="adminGetReportContentPolicy",
    response_model=ReportContentPolicyOut,
)
async def content_policy(admin: Admin, settings: Config):
    from app.services.report_content import embed_origins

    return {"origins": embed_origins(settings)}


@router.post(
    "/reports/assets",
    operation_id="adminUploadReportAsset",
    status_code=201,
    response_model=ReportAssetOut,
)
async def upload_asset(request: Request, admin: Admin, db: Db, tenant_id: TenantQ):
    from app.services import report_asset_service

    tid = await svc.organization_tenant(db, tenant_id)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > report_asset_service.MAX_BYTES:
            raise AppError(422, "report_invalid", "error.report_invalid")
    asset_id = await report_asset_service.store_image(
        db, tid, _actor(admin, tid), get_store(request), bytes(raw)
    )
    return {"asset_id": str(asset_id)}


@router.get("/reports/assets/{asset_id}", operation_id="adminReadReportAsset")
async def read_asset(asset_id: str, request: Request, admin: Admin, db: Db, tenant_id: TenantQ):
    from app.services import report_asset_service
    from app.services.tenant_access import not_found

    tid = await svc.organization_tenant(db, tenant_id)
    try:
        aid = UUID(asset_id)
    except ValueError:
        raise not_found() from None
    raw = await report_asset_service.read_private(db, tid, get_store(request), aid)
    return Response(
        raw,
        media_type="image/png",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/reports/{report_id}", operation_id="adminGetReport", response_model=ReportDetail)
async def get_report(
    report_id: PathId, admin: Admin, db: Db, tenant_id: OptionalTenantQ = None
) -> ReportDetail:
    tid = await svc.admin_report_tenant(db, report_id, tenant_id)
    return await _detail(db, tid, report_id)


@router.put("/reports/{report_id}", operation_id="adminSaveReport", response_model=ReportDetail)
async def save_report(
    report_id: PathId,
    req: SaveReportIn,
    admin: Admin,
    db: Db,
    settings: Config,
    tenant_id: OptionalTenantQ = None,
) -> ReportDetail:
    tid = await svc.admin_report_tenant(db, report_id, tenant_id)
    actor = _actor(admin, tid)

    async def run():
        await svc.save(db, tid, actor, report_id, req.revision, req.name, req.config, settings)
        return await _detail(db, tid, report_id)

    return await svc.audited(db, actor, "save", report_id, run)


@router.post(
    "/reports/{report_id}/publish", operation_id="adminPublishReport", response_model=ReportDetail
)
async def publish_report(
    report_id: PathId,
    req: RevisionIn,
    admin: Admin,
    db: Db,
    settings: Config,
    tenant_id: OptionalTenantQ = None,
) -> ReportDetail:
    tid = await svc.admin_report_tenant(db, report_id, tenant_id)
    actor = _actor(admin, tid)

    async def run():
        await svc.publish(db, tid, actor, report_id, req.revision, settings)
        return await _detail(db, tid, report_id)

    return await svc.audited(db, actor, "publish", report_id, run)


@router.post(
    "/reports/{report_id}/unpublish",
    operation_id="adminUnpublishReport",
    response_model=ReportDetail,
)
async def unpublish_report(
    report_id: PathId,
    req: RevisionIn,
    admin: Admin,
    db: Db,
    tenant_id: OptionalTenantQ = None,
) -> ReportDetail:
    tid = await svc.admin_report_tenant(db, report_id, tenant_id)
    actor = _actor(admin, tid)

    async def run():
        await svc.unpublish(db, tid, actor, report_id, req.revision)
        return await _detail(db, tid, report_id)

    return await svc.audited(db, actor, "unpublish", report_id, run)


@router.delete("/reports/{report_id}", operation_id="adminDeleteReport", status_code=204)
async def delete_report(
    report_id: PathId,
    admin: Admin,
    db: Db,
    revision: Annotated[int, Query(ge=1, le=2**31 - 1)],
    tenant_id: OptionalTenantQ = None,
) -> Response:
    tid = await svc.admin_report_tenant(db, report_id, tenant_id)
    actor = _actor(admin, tid)

    async def run():
        await svc.remove(db, tid, actor, report_id, revision)
        return Response(status_code=204)

    return await svc.audited(db, actor, "delete", report_id, run)


@router.post(
    "/reports/{report_id}/preview", operation_id="adminPreviewReport", response_model=QueryResult
)
async def preview_report(
    report_id: PathId,
    req: PreviewIn,
    admin: Admin,
    db: Db,
    settings: Config,
    tenant_id: OptionalTenantQ = None,
) -> QueryResult:
    tid = await svc.admin_report_tenant(db, report_id, tenant_id)
    actor = _actor(admin, tid)

    async def run():
        return QueryResult(
            **await svc.admin_preview(db, tid, actor, report_id, req.config, req.period, settings)
        )

    return await svc.audited(db, actor, "preview", report_id, run)
