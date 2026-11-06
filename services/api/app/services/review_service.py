"""Review (FR-VERIFY-011, 012, 013, 019): what a confirm hands over to review, the review
state of a job, who may read a job because they review it, and (Task 5) the queues and
decisions.

States on ocr_jobs.review_status: PENDING_L1 / PENDING_L2 while a round is open,
CONFIRMED once it is official business data (official_at). A return ends the round and
puts the job back to "to verify" (EDITED)."""

from sqlalchemy import and_, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import OcrJob, ResultVersion, ReviewRecord, ReviewRound, TemplateMapping, User
from app.ocr import states
from app.permissions import Permission
from app.services import review_settings_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext, not_found


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


# --- queues, detail and decisions (FR-VERIFY-019, 012, 013) -----------------------------

COMMENT_MAX = 500
_STATUS_OF = {1: states.PENDING_L1, 2: states.PENDING_L2}
_PERM_OF = {1: Permission.REVIEW_L1, 2: Permission.REVIEW_L2}


def _invalid(field: str, code: str = "validation_error") -> AppError:
    return AppError(422, code, "error.validation", [field])


def _held(ctx: TenantContext) -> list[int]:
    if ctx.kind != "organization":
        return []
    return [lvl for lvl, perm in _PERM_OF.items() if ctx.has(perm)]


def block_reason(rnd: ReviewRound, user_id: int | None, level: int) -> str | None:
    """Why this user may not decide this round at this level (FR-VERIFY-012 rule 2)."""
    if rnd.confirmed_by_user_id is not None and rnd.confirmed_by_user_id == user_id:
        return "own_confirmation"
    if level == 2 and rnd.l1_reviewer_user_id is not None and rnd.l1_reviewer_user_id == user_id:
        return "did_level1"
    return None


def _level_arg(raw) -> int:
    if not isinstance(raw, bool) and raw in ("1", "2", 1, 2):
        return int(raw)
    raise _invalid("level")


def _page(raw, field: str, low: int, high: int, default: int) -> int:
    if raw is None or raw == "":
        return default
    if not str(raw).isascii() or not str(raw).isdigit() or not low <= int(raw) <= high:
        raise AppError(400, "validation_error", "error.validation", [field])
    return int(raw)


def _queue_base(ctx: TenantContext, level: int):
    return (
        select(OcrJob, ReviewRound, User.display_name)
        .join(ReviewRound, and_(ReviewRound.job_id == OcrJob.id, ReviewRound.status == "OPEN"))
        .outerjoin(User, User.id == ReviewRound.confirmed_by_user_id)
        .where(OcrJob.tenant_id == ctx.tenant_id, OcrJob.review_status == _STATUS_OF[level])
    )


async def _items(db: AsyncSession, ctx: TenantContext, rows, level: int) -> list[dict]:
    from app.services import job_service

    jobs = [job for job, _, _ in rows]
    summaries = {s["id"]: s for s in await job_service.summaries(db, jobs)}
    return [
        {
            "job_id": job.id,
            "file_id": job.file_id,
            "file_name": summaries[job.id]["file_name"],
            "page_count": summaries[job.id]["page_count"],
            "template_name": summaries[job.id]["template_name"],
            "confirmed_by_name": name,
            "confirmed_at": job.confirmed_at,
            "level": level,
            "required_level": rnd.required_level,
            "level_entered_at": rnd.level_entered_at,
            "block_reason": block_reason(rnd, ctx.user_id, level),
        }
        for job, rnd, name in rows
    ]


async def queue(db: AsyncSession, ctx: TenantContext, level_raw, page, page_size) -> dict:
    level = _level_arg(level_raw)
    if level not in _held(ctx):
        raise AppError(403, "permission_denied", "error.permission_denied")
    number = _page(page, "page", 1, 100_000, 1)
    size = _page(page_size, "page_size", 1, 100, 20)
    base = _queue_base(ctx, level)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        await db.execute(
            base.order_by(ReviewRound.level_entered_at.desc(), OcrJob.id.desc())
            .offset((number - 1) * size)
            .limit(size)
        )
    ).all()
    return {
        "items": await _items(db, ctx, rows, level),
        "total": total,
        "page": number,
        "page_size": size,
    }


async def summary(db: AsyncSession, ctx: TenantContext) -> dict:
    """Jobs the caller can act on, per level; None for a level they do not hold."""
    out: dict[str, int | None] = {"l1": None, "l2": None}
    for level in _held(ctx):
        cond = [ReviewRound.confirmed_by_user_id.is_distinct_from(ctx.user_id)]
        if level == 2:
            cond.append(ReviewRound.l1_reviewer_user_id.is_distinct_from(ctx.user_id))
        q = _queue_base(ctx, level).where(*cond)
        out[f"l{level}"] = (
            await db.execute(select(func.count()).select_from(q.subquery()))
        ).scalar_one()
    return out


async def _tail(db: AsyncSession, ctx: TenantContext, job: OcrJob, rnd: ReviewRound) -> dict:
    level = level_of(job)
    confirmer = await db.get(User, rnd.confirmed_by_user_id) if rnd.confirmed_by_user_id else None
    return {
        "level": level,
        "required_level": rnd.required_level,
        "confirmed_by_name": confirmer.display_name if confirmer else None,
        "confirmed_at": job.confirmed_at,
        "block_reason": block_reason(rnd, ctx.user_id, level) if level else None,
    }


async def detail(db: AsyncSession, ctx: TenantContext, job_id: str) -> dict:
    """A job waiting at a level the caller holds; anything else is 404."""
    from app.services import job_service

    job = await job_service.job_access(db, ctx, job_id, review=True)
    level = level_of(job)
    rnd = await open_round(db, job.id)
    if level is None or rnd is None or level not in _held(ctx):
        raise not_found()
    return {"job": (await job_service.summaries(db, [job]))[0]} | await _tail(db, ctx, job, rnd)


async def decide(
    db: AsyncSession,
    ctx: TenantContext,
    principal: Principal,
    job_id: str,
    level_raw,
    decision,
    comment,
) -> dict:
    """Approve or return the current level (FR-VERIFY-012, 013). The job row is locked and
    its state checked after the lock, so of two reviewers only one decides; the other gets
    409."""
    from app.services import job_service

    level = _level_arg(level_raw)
    if decision not in ("approve", "return"):
        raise _invalid("decision")
    if comment is not None and not isinstance(comment, str):
        raise _invalid("comment")
    text_ = (comment or "").strip()
    if len(text_) > COMMENT_MAX:
        raise _invalid("comment")
    if decision == "return" and not text_:
        raise _invalid("comment", "comment_required")
    job = (
        await db.execute(
            select(OcrJob)
            .where(OcrJob.id == job_id, OcrJob.tenant_id == ctx.tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if job is None or ctx.kind != "organization":
        raise not_found()
    if level not in _held(ctx):
        raise AppError(403, "permission_denied", "error.permission_denied")
    rnd = await open_round(db, job.id)
    if job.review_status != _STATUS_OF[level] or rnd is None or rnd.current_level != level:
        raise AppError(409, "review_state_changed", "error.review_state_changed")
    if block_reason(rnd, ctx.user_id, level):
        raise AppError(403, "reviewer_conflict", "error.reviewer_conflict")
    now = utcnow()
    db.add(
        ReviewRecord(
            round_id=rnd.id,
            job_id=job.id,
            level=level,
            reviewer_user_id=ctx.user_id,
            decision="APPROVE" if decision == "approve" else "RETURN",
            comment=text_ or None,
        )
    )
    entered_l2 = False
    if decision == "return":
        rnd.status, rnd.closed_at = "RETURNED", now
        job.review_status = "EDITED"
        job.confirmed_at = job.confirmed_by_user_id = job.confirmed_version_id = None
    elif level == 1 and rnd.required_level == 2:
        rnd.current_level, rnd.l1_reviewer_user_id, rnd.level_entered_at = 2, ctx.user_id, now
        job.review_status = states.PENDING_L2
        entered_l2 = True
    else:
        rnd.status, rnd.closed_at = "APPROVED", now
        job.review_status, job.official_at = states.CONFIRMED, now
    job.updated_at = now
    await db.flush()
    if entered_l2:
        await on_level_entered(db, job, rnd, 2)
    await job_service.audit(db, principal, f"review.{decision}", job.id)
    await db.commit()
    return {"job": (await job_service.summaries(db, [job]))[0]} | await _tail(db, ctx, job, rnd)


async def on_level_entered(db: AsyncSession, job: OcrJob, rnd: ReviewRound, level: int) -> None:
    """Notify the reviewers of this level (FR-SYS-126; Task 6)."""
    return None
