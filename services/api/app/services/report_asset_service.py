import asyncio
from uuid import UUID, uuid4

import pymupdf
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.integrations.storage import ObjectMissing, ObjectStore
from app.models.report import ReportAsset
from app.services import report_service as reports
from app.services.tenant_access import TenantContext, not_found

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000


def image_bytes(raw: bytes) -> bytes:
    if (
        not raw
        or len(raw) > MAX_BYTES
        or not (raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff"))
    ):
        raise AppError(422, "report_invalid", "error.report_invalid")
    try:
        # image_profile's SWIG format probe rejects bytes in the installed MuPDF binding.
        buffer = pymupdf.mupdf.fz_new_buffer_from_copied_data(raw)
        metadata = pymupdf.mupdf.fz_new_image_from_buffer(buffer)
        if metadata.w() * metadata.h() > MAX_PIXELS:
            raise ValueError("image dimensions exceed the limit")
        image = pymupdf.Pixmap(raw)
        if image.colorspace and image.colorspace.n > 3:
            image = pymupdf.Pixmap(pymupdf.csRGB, image)
        return image.tobytes("png")
    except Exception as exc:
        raise AppError(422, "report_invalid", "error.report_invalid") from exc


async def upload(db: AsyncSession, ctx: TenantContext, store: ObjectStore, raw: bytes) -> UUID:
    await reports.require(db, ctx, "manage")
    return await store_image(db, ctx.tenant_id, reports.user_actor(ctx), store, raw)


async def store_image(
    db: AsyncSession, tenant_id: int, actor: reports.Actor, store: ObjectStore, raw: bytes
) -> UUID:
    clean = await asyncio.to_thread(image_bytes, raw)
    asset_id = uuid4()
    key = f"report-assets/{tenant_id}/{asset_id}.png"
    await store.put(key, clean, "image/png")
    try:
        db.add(
            ReportAsset(id=asset_id, tenant_id=tenant_id, object_key=key, content_type="image/png")
        )
        await reports.audit(db, actor, "asset_upload", f"{tenant_id}/{asset_id}")
        await db.commit()
    except Exception:
        await db.rollback()
        await store.delete(key)
        raise
    return asset_id


async def read_private(
    db: AsyncSession, tenant_id: int, store: ObjectStore, asset_id: UUID
) -> bytes:
    asset = await db.scalar(
        select(ReportAsset).where(ReportAsset.id == asset_id, ReportAsset.tenant_id == tenant_id)
    )
    if asset is None:
        raise not_found()
    try:
        return await store.get(asset.object_key)
    except ObjectMissing:
        raise not_found() from None


async def binding_errors(db: AsyncSession, tenant_id: int, config: dict) -> list[dict]:
    problems = []
    for i, card in enumerate(config.get("cards", [])):
        if not isinstance(card, dict) or card.get("type") != "image":
            continue
        try:
            asset_id = UUID((card.get("content") or {}).get("asset_id", ""))
        except (ValueError, TypeError, AttributeError):
            continue
        found = await db.scalar(
            select(ReportAsset.id).where(
                ReportAsset.id == asset_id, ReportAsset.tenant_id == tenant_id
            )
        )
        if found is None:
            problems.append(
                {
                    "card_id": card.get("id"),
                    "path": f"cards[{i}].content.asset_id",
                    "message": "image is not available in this organization",
                }
            )
    return problems


async def read(
    db: AsyncSession, ctx: TenantContext, store: ObjectStore, asset_id: UUID, report_id: int | None
) -> bytes:
    await reports.require(db, ctx, "any")
    asset = await db.scalar(
        select(ReportAsset).where(
            ReportAsset.id == asset_id, ReportAsset.tenant_id == ctx.tenant_id
        )
    )
    if asset is None:
        raise not_found()
    if not reports.can_manage(ctx):
        if report_id is None:
            raise not_found()
        _, snapshot = await reports.published_page(db, ctx, report_id)
        if not any(
            c.get("type") == "image" and (c.get("content") or {}).get("asset_id") == str(asset_id)
            for c in snapshot.config.get("cards", [])
        ):
            raise not_found()
    try:
        return await store.get(asset.object_key)
    except ObjectMissing:
        raise not_found() from None
