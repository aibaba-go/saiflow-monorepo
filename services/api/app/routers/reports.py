"""Organization operational reports (template-report-management contract §5; FR-REPORT-001..017,
FR-SYS-139). The tenant comes from X-Tenant-Id; every route passes the report gate (enabled
Starter+ organization) and its own right (manage / view / view + export)."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import (
    BIGINT_MAX,
    PathId,
    get_db,
    get_principal,
    get_settings,
    get_store,
    get_tenant_context,
    require_csrf_header,
)
from app.errors import AppError
from app.schemas.report import (
    CatalogFieldsOut,
    CatalogTemplatesOut,
    CreateReportIn,
    CsvTicketIn,
    CsvTicketOut,
    DataIn,
    PreviewIn,
    QueryResult,
    ReportAssetOut,
    ReportContentPolicyOut,
    ReportDetail,
    ReportListOut,
    RevisionIn,
    SaveReportIn,
)
from app.services import report_csv_service
from app.services import report_service as svc
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext, not_found

router = APIRouter(
    prefix="/api/v1/reports", tags=["reports"], dependencies=[Depends(require_csrf_header)]
)

# the ticket redemption: opened by the system browser, so outside the tenant header and cookie
downloads_router = APIRouter(prefix="/api/v1", tags=["reports"])

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]
Config = Annotated[Settings, Depends(get_settings)]
OptionalReportId = Annotated[int | None, Query(gt=0, le=BIGINT_MAX)]


async def _detail(db: AsyncSession, ctx: TenantContext, report_id: int) -> ReportDetail:
    manage = svc.can_manage(ctx)
    report = await svc.readable(db, ctx.tenant_id, report_id, manage=manage)
    return ReportDetail(**await svc.detail(db, report, manage=manage, export=svc.can_export(ctx)))


@router.get(
    "/catalog/templates",
    operation_id="listReportCatalogTemplates",
    response_model=CatalogTemplatesOut,
)
async def catalog_templates(
    ctx: Tenant, db: Db, report_id: OptionalReportId = None
) -> CatalogTemplatesOut:
    async def run():
        await svc.require(db, ctx, "manage")
        if report_id is not None:
            await svc.get_report(db, ctx.tenant_id, report_id)
        return CatalogTemplatesOut(items=await svc.catalog_templates(db, ctx.tenant_id, report_id))

    return await svc.audited(db, svc.user_actor(ctx), "catalog", report_id, run)


@router.get(
    "/catalog/fields", operation_id="getReportCatalogFields", response_model=CatalogFieldsOut
)
async def catalog_fields(
    ctx: Tenant,
    db: Db,
    template_id: Annotated[int, Query(gt=0, le=BIGINT_MAX)],
    version_ids: Annotated[str, Query(max_length=400)],
    report_id: OptionalReportId = None,
) -> CatalogFieldsOut:
    async def run():
        await svc.require(db, ctx, "manage")
        if report_id is not None:
            await svc.get_report(db, ctx.tenant_id, report_id)
        return CatalogFieldsOut(
            **await svc.catalog_fields(db, ctx.tenant_id, report_id, template_id, version_ids)
        )

    return await svc.audited(db, svc.user_actor(ctx), "catalog", report_id, run)


@router.get("", operation_id="listReports", response_model=ReportListOut)
async def list_reports(ctx: Tenant, db: Db) -> ReportListOut:
    async def run():
        await svc.require(db, ctx, "any")
        items = await svc.summaries(
            db, ctx.tenant_id, manage=svc.can_manage(ctx), view=svc.can_view(ctx)
        )
        return ReportListOut(items=items)

    return await svc.audited(db, svc.user_actor(ctx), "list", None, run)


@router.post("", operation_id="createReport", status_code=201, response_model=ReportDetail)
async def create_report(req: CreateReportIn, ctx: Tenant, db: Db) -> ReportDetail:
    async def run():
        await svc.require(db, ctx, "manage")
        report = await svc.create(db, ctx.tenant_id, svc.user_actor(ctx), req.name)
        return await _detail(db, ctx, report.id)

    return await svc.audited(db, svc.user_actor(ctx), "create", None, run)


@router.get(
    "/content-policy", operation_id="getReportContentPolicy", response_model=ReportContentPolicyOut
)
async def content_policy(ctx: Tenant, db: Db, settings: Config):
    from app.services.report_content import embed_origins

    await svc.require(db, ctx, "any")
    return {"origins": embed_origins(settings)}


@router.post(
    "/assets", operation_id="uploadReportAsset", status_code=201, response_model=ReportAssetOut
)
async def upload_asset(request: Request, ctx: Tenant, db: Db):
    from app.services import report_asset_service

    await svc.require(db, ctx, "manage")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > report_asset_service.MAX_BYTES:
            raise AppError(422, "report_invalid", "error.report_invalid")
    asset_id = await report_asset_service.upload(db, ctx, get_store(request), bytes(raw))
    return {"asset_id": str(asset_id)}


@router.get("/assets/{asset_id}", operation_id="readReportAsset")
async def read_asset(
    asset_id: str, request: Request, ctx: Tenant, db: Db, report_id: OptionalReportId = None
):
    from uuid import UUID

    from app.services import report_asset_service

    try:
        key = UUID(asset_id)
    except ValueError:
        raise not_found() from None
    raw = await report_asset_service.read(db, ctx, get_store(request), key, report_id)
    return Response(
        raw,
        media_type="image/png",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{report_id}", operation_id="getReport", response_model=ReportDetail)
async def get_report(report_id: PathId, ctx: Tenant, db: Db) -> ReportDetail:
    async def run():
        await svc.require(db, ctx, "any")
        return await _detail(db, ctx, report_id)

    return await svc.audited(db, svc.user_actor(ctx), "open", report_id, run)


@router.put("/{report_id}", operation_id="saveReport", response_model=ReportDetail)
async def save_report(
    report_id: PathId, req: SaveReportIn, ctx: Tenant, db: Db, settings: Config
) -> ReportDetail:
    async def run():
        await svc.require(db, ctx, "manage")
        await svc.save(
            db,
            ctx.tenant_id,
            svc.user_actor(ctx),
            report_id,
            req.revision,
            req.name,
            req.config,
            settings,
        )
        return await _detail(db, ctx, report_id)

    return await svc.audited(db, svc.user_actor(ctx), "save", report_id, run)


@router.post("/{report_id}/publish", operation_id="publishReport", response_model=ReportDetail)
async def publish_report(
    report_id: PathId, req: RevisionIn, ctx: Tenant, db: Db, settings: Config
) -> ReportDetail:
    async def run():
        await svc.require(db, ctx, "manage")
        await svc.publish(db, ctx.tenant_id, svc.user_actor(ctx), report_id, req.revision, settings)
        return await _detail(db, ctx, report_id)

    return await svc.audited(db, svc.user_actor(ctx), "publish", report_id, run)


@router.post("/{report_id}/unpublish", operation_id="unpublishReport", response_model=ReportDetail)
async def unpublish_report(report_id: PathId, req: RevisionIn, ctx: Tenant, db: Db) -> ReportDetail:
    async def run():
        await svc.require(db, ctx, "manage")
        await svc.unpublish(db, ctx.tenant_id, svc.user_actor(ctx), report_id, req.revision)
        return await _detail(db, ctx, report_id)

    return await svc.audited(db, svc.user_actor(ctx), "unpublish", report_id, run)


@router.delete("/{report_id}", operation_id="deleteReport", status_code=204)
async def delete_report(
    report_id: PathId,
    ctx: Tenant,
    db: Db,
    revision: Annotated[int, Query(ge=1, le=2**31 - 1)],
) -> Response:
    async def run():
        await svc.require(db, ctx, "manage")
        await svc.remove(db, ctx.tenant_id, svc.user_actor(ctx), report_id, revision)
        return Response(status_code=204)

    return await svc.audited(db, svc.user_actor(ctx), "delete", report_id, run)


@router.post("/{report_id}/preview", operation_id="previewReport", response_model=QueryResult)
async def preview_report(
    report_id: PathId, req: PreviewIn, ctx: Tenant, db: Db, settings: Config
) -> QueryResult:
    async def run():
        await svc.require(db, ctx, "manage")
        return QueryResult(
            **await svc.preview(db, ctx, report_id, req.config, req.period, settings, req.pages)
        )

    return await svc.audited(db, svc.user_actor(ctx), "preview", report_id, run)


@router.post("/{report_id}/data", operation_id="queryReportData", response_model=QueryResult)
async def report_data(
    report_id: PathId, req: DataIn, ctx: Tenant, db: Db, settings: Config
) -> QueryResult:
    action = "refresh" if req.refresh else "view"

    async def run():
        await svc.require(db, ctx, "view")
        return QueryResult(
            **await svc.data(db, ctx, report_id, req.period, req.refresh, req.pages, settings)
        )

    return await svc.audited(db, svc.user_actor(ctx), action, report_id, run)


async def _csv(
    db: AsyncSession,
    ctx: TenantContext,
    report_id: int,
    card_id: str,
    period: dict | None,
    report_version: int | None = None,
    *,
    settings: Settings | None = None,
    head_only: bool = False,
) -> Response:
    async def run():
        await svc.require(db, ctx, "view", "export")
        body, name = await report_csv_service.export(
            db, ctx, report_id, card_id, period, report_version, settings
        )
        response = Response(
            body,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
                "Cache-Control": "private, no-store",
            },
        )
        if head_only:
            # Preserve the GET Content-Length while sending no file bytes for HEAD.
            response.body = b""
        return response

    return await svc.audited(db, svc.user_actor(ctx), "csv", report_id, run)


@router.head("/{report_id}/csv", include_in_schema=False)
@router.get("/{report_id}/csv", operation_id="exportReportCsv", response_class=Response)
async def export_csv(
    report_id: PathId,
    request: Request,
    ctx: Tenant,
    db: Db,
    settings: Config,
    card_id: Annotated[str, Query(min_length=1, max_length=64)],
    from_: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to: Annotated[str | None, Query(max_length=10)] = None,
    report_version: Annotated[int | None, Query(ge=1)] = None,
) -> Response:
    period = None if from_ is None and to is None else {"from": from_, "to": to}
    return await _csv(
        db,
        ctx,
        report_id,
        card_id,
        period,
        report_version,
        settings=settings,
        head_only=request.method == "HEAD",
    )


@router.post(
    "/{report_id}/csv/ticket", operation_id="createReportCsvTicket", response_model=CsvTicketOut
)
async def csv_ticket(
    report_id: PathId, req: CsvTicketIn, ctx: Tenant, principal: Caller, db: Db, settings: Config
) -> CsvTicketOut:
    """A 60-second link to one card's CSV for the LINE in-app browser (FR-REPORT-016)."""
    card_id = req.card_id
    if not isinstance(card_id, str) or not 1 <= len(card_id) <= 64:
        raise not_found()
    url = await report_csv_service.ticket(
        db, settings, ctx, principal, report_id, card_id, req.period, req.report_version
    )
    return CsvTicketOut(url=url)


@downloads_router.head("/report-downloads/{token}", include_in_schema=False)
@downloads_router.get(
    "/report-downloads/{token}", operation_id="redeemReportCsvTicket", response_class=Response
)
async def redeem_csv_ticket(token: str, request: Request, db: Db, settings: Config) -> Response:
    try:
        ctx, report_id, card_id, period, version = await report_csv_service.redeem(
            db, settings, token
        )
        return await _csv(
            db,
            ctx,
            report_id,
            card_id,
            period,
            version,
            settings=settings,
            head_only=request.method == "HEAD",
        )
    except AppError as exc:
        # AC-FR-REPORT-016-03: a revoked/ended ticket is opaque. _csv has already
        # recorded permission/plan refusals; authenticated CSV retains its usual 403.
        if exc.status in (401, 403, 404) or exc.code in (
            "revision_conflict",
            "report_not_published",
        ):
            raise not_found() from exc
        raise
