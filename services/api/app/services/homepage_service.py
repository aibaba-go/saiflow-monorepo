from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models.report import HomepagePreference
from app.services import report_service as reports
from app.services.tenant_access import TenantContext


async def read(db: AsyncSession, ctx: TenantContext) -> dict:
    default = {"report_id": None, "default": ctx.kind}
    preference = await db.get(HomepagePreference, (ctx.user_id, ctx.tenant_id))
    if preference is None or preference.report_id is None:
        return default
    try:
        await reports.require(db, ctx, "view")
        await reports.published_page(db, ctx, preference.report_id)
    except AppError as exc:
        if exc.status in (403, 404):
            return default
        raise
    return {"report_id": preference.report_id, "default": ctx.kind}


async def choose(db: AsyncSession, ctx: TenantContext, report_id: int | None) -> dict:
    if report_id is None:
        await db.execute(
            delete(HomepagePreference).where(
                HomepagePreference.user_id == ctx.user_id,
                HomepagePreference.tenant_id == ctx.tenant_id,
            )
        )
    else:
        await reports.require(db, ctx, "view")
        await reports.get_report(db, ctx.tenant_id, report_id, for_update=True)
        await reports.published_page(db, ctx, report_id)
        await db.execute(
            insert(HomepagePreference)
            .values(user_id=ctx.user_id, tenant_id=ctx.tenant_id, report_id=report_id)
            .on_conflict_do_update(
                index_elements=["user_id", "tenant_id"], set_={"report_id": report_id}
            )
        )
    await db.commit()
    return {"report_id": report_id, "default": ctx.kind}
