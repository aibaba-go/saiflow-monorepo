"""Review queues, detail and decisions in the current organization (FR-VERIFY-019, 012,
013)."""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_principal, get_tenant_context, require_csrf_header
from app.schemas.job import JobOut
from app.services import review_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/reviews", tags=["reviews"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]


class ReviewItemOut(BaseModel):
    job_id: str
    file_id: str
    file_name: str
    page_count: int
    template_name: str | None  # None = the generic result
    confirmed_by_name: str | None
    confirmed_at: datetime | None
    level: int
    required_level: int
    level_entered_at: datetime
    block_reason: str | None  # own_confirmation, did_level1 or None


class ReviewPageOut(BaseModel):
    items: list[ReviewItemOut]
    total: int
    page: int
    page_size: int


class ReviewSummaryOut(BaseModel):
    l1: int | None  # None: the caller does not hold that level
    l2: int | None


class ReviewDetailOut(BaseModel):
    job: JobOut
    level: int | None  # None once the job is no longer waiting for review
    required_level: int
    confirmed_by_name: str | None
    confirmed_at: datetime | None
    block_reason: str | None


class DecisionIn(BaseModel):
    """Types are checked by the service, which answers 422 naming the field."""

    model_config = ConfigDict(extra="ignore")

    level: Any = None
    decision: Any = None
    comment: Any = None


@router.get("", operation_id="listReviews", response_model=ReviewPageOut)
async def list_reviews(
    ctx: Tenant,
    db: Db,
    level: str | None = None,
    page: str | None = None,
    page_size: str | None = None,
) -> ReviewPageOut:
    return ReviewPageOut(**await review_service.queue(db, ctx, level, page, page_size))


@router.get("/summary", operation_id="getReviewSummary", response_model=ReviewSummaryOut)
async def summary(ctx: Tenant, db: Db) -> ReviewSummaryOut:
    return ReviewSummaryOut(**await review_service.summary(db, ctx))


@router.get("/{job_id}", operation_id="getReview", response_model=ReviewDetailOut)
async def detail(job_id: str, ctx: Tenant, db: Db) -> ReviewDetailOut:
    return ReviewDetailOut(**await review_service.detail(db, ctx, job_id))


@router.post("/{job_id}/decision", operation_id="decideReview", response_model=ReviewDetailOut)
async def decide(
    job_id: str, req: DecisionIn, ctx: Tenant, principal: Caller, db: Db
) -> ReviewDetailOut:
    return ReviewDetailOut(
        **await review_service.decide(
            db, ctx, principal, job_id, req.level, req.decision, req.comment
        )
    )
