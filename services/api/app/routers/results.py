"""The result of a job: read, save a draft, confirm (FR-VERIFY-015, 009, 006)."""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_principal, get_tenant_context, require_csrf_header
from app.services import change_log, job_service, result_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/ocr/jobs", tags=["ocr"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
Caller = Annotated[Principal, Depends(get_principal)]


class TemplateOut(BaseModel):
    template_version_id: int
    name: str
    groups: list[dict[str, Any]]


class MappingStateOut(BaseModel):
    status: str
    error: str | None


class MatchOut(BaseModel):
    template_version_id: int
    score: float | None
    low_score: bool


class WarningOut(BaseModel):
    path: str
    code: str


class AmountIssueOut(BaseModel):
    path: str
    computed: str
    recognised: str


class ReviewRecordOut(BaseModel):
    round_no: int
    level: int
    decision: str  # APPROVE or RETURN
    comment: str | None
    reviewer_name: str | None
    created_at: datetime


class ReviewStateOut(BaseModel):
    stage: str  # NONE, PENDING_L1, PENDING_L2 or CONFIRMED
    required_level: int | None
    records: list[ReviewRecordOut]
    last_return: ReviewRecordOut | None


class ResultOut(BaseModel):
    version: int
    structured: dict[str, Any] | list[Any] | None
    template: TemplateOut | None
    missing_required: list[str]
    mapping: MappingStateOut | None
    match: MatchOut | None = None
    warnings: list[WarningOut] = []
    amount_issues: list[AmountIssueOut] = []
    confirmed: bool  # locked: waiting for review or official
    review: ReviewStateOut


class ChangeOut(BaseModel):
    kind: str  # FIELD or TEMPLATE
    path: str | None
    before: Any = None
    after: Any = None
    from_template: str | None  # None = the generic result
    to_template: str | None
    user_name: str | None
    created_at: datetime
    version: int | None


class ResultIn(BaseModel):
    """Types are checked by the service, which answers 400 naming the field."""

    model_config = ConfigDict(extra="ignore")

    expected_version: Any = None
    structured: Any = None
    confirm: Any = False


@router.get("/{job_id}/result", operation_id="getOcrResult", response_model=ResultOut)
async def read(job_id: str, ctx: Tenant, db: Db) -> ResultOut:
    job = await job_service.job_access(db, ctx, job_id, review=True)
    return ResultOut(**await result_service.read(db, job))


@router.patch("/{job_id}/result", operation_id="saveOcrResult", response_model=ResultOut)
async def save(job_id: str, req: ResultIn, ctx: Tenant, principal: Caller, db: Db) -> ResultOut:
    job = await job_service.job_access(db, ctx, job_id, for_update=True)
    body, actions = await result_service.save(
        db,
        ctx,
        principal,
        job,
        expected_version=req.expected_version,
        structured=req.structured,
        confirm=req.confirm,
    )
    for action in actions:
        await job_service.audit(db, principal, action, job.id)
    await db.commit()
    return ResultOut(**body)


@router.get(
    "/{job_id}/changes", operation_id="listOcrResultChanges", response_model=list[ChangeOut]
)
async def changes(job_id: str, ctx: Tenant, db: Db) -> list[ChangeOut]:
    """The change log, oldest first (FR-VERIFY-007)."""
    job = await job_service.job_access(db, ctx, job_id, review=True)
    return [ChangeOut(**c) for c in await change_log.list_changes(db, job.id)]
