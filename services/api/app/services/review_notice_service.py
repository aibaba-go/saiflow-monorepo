"""Review notices (FR-SYS-126): when a job enters a review level, every member who can
decide it gets an in-app notification; when the organization turned email on and the
member is registered with an email address, one email is also attempted, later, by the
reminders loop (`send_pending`). A failed email is never retried. Notices are not written
to the operation log."""

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clock import utcnow
from app.models import (
    File,
    Membership,
    Notification,
    OcrJob,
    Organization,
    ReviewNotice,
    ReviewRound,
    Role,
    User,
)
from app.review_mail import render

logger = logging.getLogger(__name__)


async def _recipients(db: AsyncSession, job: OcrJob, rnd: ReviewRound, level: int) -> list[User]:
    code = f"review_l{level}"
    excluded = {rnd.confirmed_by_user_id}
    if level == 2:
        excluded.add(rnd.l1_reviewer_user_id)
    rows = (
        await db.execute(
            select(User, Membership.is_owner, Role.permissions)
            .join(Membership, Membership.user_id == User.id)
            .outerjoin(Role, Role.id == Membership.role_id)
            .where(Membership.tenant_id == job.tenant_id, Membership.removed_at.is_(None))
            .order_by(User.id)
        )
    ).all()
    return [
        user
        for user, is_owner, perms in rows
        if user.id not in excluded and (is_owner or code in (perms or []))
    ]


async def notify(db: AsyncSession, job: OcrJob, rnd: ReviewRound, level: int) -> int:
    """In the caller's transaction: one notification and one notice per recipient."""
    from app.services import job_service

    users = await _recipients(db, job, rnd, level)
    if not users:
        return 0
    org = await db.get(Organization, job.tenant_id)
    file = await db.get(File, job.file_id)
    confirmer = await db.get(User, rnd.confirmed_by_user_id) if rnd.confirmed_by_user_id else None
    template = (await job_service.summaries(db, [job]))[0]["template_name"]
    data = {
        "stage": f"l{level}",
        "job_id": job.id,
        "file_name": file.original_name if file else "",
        "template_name": template,
        "level": level,
        "confirmer_name": confirmer.display_name if confirmer else None,
        "round_no": rnd.round_no,
    }
    email_on = bool(org and org.review_email_enabled)
    for user in users:
        note = Notification(
            user_id=user.id, tenant_id=job.tenant_id, type="review_pending", data=data
        )
        db.add(note)
        await db.flush()
        can_email = email_on and user.registered_at is not None and bool(user.email)
        db.add(
            ReviewNotice(
                job_id=job.id,
                round_no=rnd.round_no,
                level=level,
                recipient_user_id=user.id,
                notification_id=note.id,
                email_status="pending" if can_email else "skipped",
            )
        )
    await db.flush()
    return len(users)


async def send_pending(sessionmaker: async_sessionmaker, sender) -> int:
    """Claim every pending email, attempt each once, record sent or failed. Returns how
    many were attempted. Without a sender (no SMTP configured) they are recorded failed."""
    async with sessionmaker() as db:
        claimed = list(
            (
                await db.execute(
                    update(ReviewNotice)
                    .where(ReviewNotice.email_status == "pending")
                    .values(email_status="sending")
                    .returning(ReviewNotice.id)
                )
            ).scalars()
        )
        await db.commit()
    for notice_id in claimed:
        status, error = "sent", None
        try:
            if sender is None:
                raise RuntimeError("not_configured")
            async with sessionmaker() as db:
                notice = await db.get(ReviewNotice, notice_id)
                note = await db.get(Notification, notice.notification_id)  # type: ignore[union-attr]
                user = await db.get(User, notice.recipient_user_id)  # type: ignore[union-attr]
                org = await db.get(Organization, note.tenant_id)  # type: ignore[union-attr]
                to = user.email  # type: ignore[union-attr]
                subject, body = render(note.data, org.name if org else "")  # type: ignore[union-attr]
            await sender.send(to, subject, body)
        except Exception as exc:  # one attempt only (FR-SYS-126)
            status = "failed"
            error = "not_configured" if sender is None else type(exc).__name__
            logger.warning("review notice %s email failed: %s", notice_id, error)
        async with sessionmaker() as db:
            await db.execute(
                update(ReviewNotice)
                .where(ReviewNotice.id == notice_id)
                .values(email_status=status, email_error=error, email_at=utcnow())
            )
            await db.commit()
    return len(claimed)
