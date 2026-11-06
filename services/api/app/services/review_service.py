"""Review (FR-VERIFY-011, 012, 013, 019): what a confirm hands over to review, the review
state of a job, who may read a job because they review it, and (Task 5) the queues and
decisions.

States on ocr_jobs.review_status: PENDING_L1 / PENDING_L2 while a round is open,
CONFIRMED once it is official business data (official_at). A return ends the round and
puts the job back to "to verify" (EDITED)."""

from sqlalchemy import and_, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import OcrJob, ResultVersion, ReviewRecord, ReviewRound, TemplateMapping, User
from app.ocr import states
from app.permissions import Permission
from app.services import review_settings_service
from app.services.tenant_access import TenantContext


def reviewable(ctx: TenantContext):
    """Jobs the caller may read because they review them at their current level; such a
    reviewer needs no 数据浏览 (FR-VERIFY-019)."""
    if ctx.kind != "organization":
        return false()
    levels = []
    if ctx.has(Permission.REVIEW_L1):
        levels.append(states.PENDING_L1)
    if ctx.has(Permission.REVIEW_L2):
        levels.append(states.PENDING_L2)
    if not levels:
        return false()
    return and_(OcrJob.tenant_id == ctx.tenant_id, OcrJob.review_status.in_(levels))


async def _template_id(db: AsyncSession, version: ResultVersion) -> int | None:
    if version.mapping_id is None:
        return None
    mapping = await db.get(TemplateMapping, version.mapping_id)
    return mapping.template_id if mapping else None


async def open_round(db: AsyncSession, job_id: str) -> ReviewRound | None:
    return (
        await db.execute(
            select(ReviewRound).where(ReviewRound.job_id == job_id, ReviewRound.status == "OPEN")
        )
    ).scalar_one_or_none()


async def on_confirm(
    db: AsyncSession, ctx: TenantContext, job: OcrJob, version: ResultVersion
) -> ReviewRound | None:
    """After the confirm gate passed: level 0 makes the job official; level 1 or 2 opens a
    round at level 1 (FR-VERIFY-011). Returns the new round, if any."""
    level = await review_settings_service.level_for(
        db, ctx.tenant_id, ctx.kind, await _template_id(db, version)
    )
    now = utcnow()
    if level == 0:
        job.review_status, job.official_at = states.CONFIRMED, now
        return None
    last = (
        await db.execute(
            select(func.coalesce(func.max(ReviewRound.round_no), 0)).where(
                ReviewRound.job_id == job.id
            )
        )
    ).scalar_one()
    rnd = ReviewRound(
        job_id=job.id,
        round_no=last + 1,
        required_level=level,
        current_level=1,
        status="OPEN",
        confirmed_by_user_id=ctx.user_id,
        confirmed_version_id=version.id,
        level_entered_at=now,
    )
    db.add(rnd)
    job.review_status = states.PENDING_L1
    await db.flush()
    return rnd


async def records(db: AsyncSession, job_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(ReviewRecord, ReviewRound.round_no, User.display_name)
            .join(ReviewRound, ReviewRound.id == ReviewRecord.round_id)
            .outerjoin(User, User.id == ReviewRecord.reviewer_user_id)
            .where(ReviewRecord.job_id == job_id)
            .order_by(ReviewRecord.id)
        )
    ).all()
    return [
        {
            "round_no": round_no,
            "level": rec.level,
            "decision": rec.decision,
            "comment": rec.comment,
            "reviewer_name": name,
            "created_at": rec.created_at,
        }
        for rec, round_no, name in rows
    ]


async def review_state(db: AsyncSession, job: OcrJob) -> dict:
    """Stage NONE | PENDING_L1 | PENDING_L2 | CONFIRMED, the required level of the open
    round, every record, and the last return while the job waits for a new confirm."""
    history = await records(db, job.id)
    status = job.review_status
    stage = status if status in states.LOCKED else "NONE"
    required = None
    last_return = None
    if status in states.PENDING_REVIEW:
        rnd = await open_round(db, job.id)
        required = rnd.required_level if rnd else None
    elif status not in states.LOCKED:
        latest = (
            await db.execute(
                select(ReviewRound)
                .where(ReviewRound.job_id == job.id)
                .order_by(ReviewRound.round_no.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest is not None and latest.status == "RETURNED":
            last_return = next(
                (
                    r
                    for r in reversed(history)
                    if r["round_no"] == latest.round_no and r["decision"] == "RETURN"
                ),
                None,
            )
    return {
        "stage": stage,
        "required_level": required,
        "records": history,
        "last_return": last_return,
    }


def level_of(job: OcrJob) -> int | None:
    return {states.PENDING_L1: 1, states.PENDING_L2: 2}.get(job.review_status)
