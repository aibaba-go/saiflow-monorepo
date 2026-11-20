"""Review settings of the current organization, owner only (FR-VERIFY-010, FR-SYS-126)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_tenant_context, require_csrf_header
from app.services import review_settings_service
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/review-settings",
    tags=["reviews"],
    dependencies=[Depends(require_csrf_header)],
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]


class ReviewLevelItem(BaseModel):
    template_id: int | None  # None = 通用结果
    name: str | None
    level: int


class ReviewSettingsOut(BaseModel):
    email_enabled: bool
    items: list[ReviewLevelItem]


class LevelIn(BaseModel):
    """Types are checked by the service, which answers 422 naming the field."""

    model_config = ConfigDict(extra="ignore")

    template_id: Any = None
    level: Any = None


class EmailIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: Any = None


@router.get("", operation_id="getReviewSettings", response_model=ReviewSettingsOut)
async def read(ctx: Tenant, db: Db) -> ReviewSettingsOut:
    return ReviewSettingsOut(**await review_settings_service.read(db, ctx))


@router.put("/levels", operation_id="setReviewLevel", response_model=ReviewLevelItem)
async def set_level(req: LevelIn, ctx: Tenant, db: Db) -> ReviewLevelItem:
    return ReviewLevelItem(
        **await review_settings_service.set_level(db, ctx, req.template_id, req.level)
    )


@router.put("/email", operation_id="setReviewEmail", response_model=ReviewSettingsOut)
async def set_email(req: EmailIn, ctx: Tenant, db: Db) -> ReviewSettingsOut:
    return ReviewSettingsOut(**await review_settings_service.set_email(db, ctx, req.enabled))
