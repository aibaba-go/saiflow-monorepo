"""The notification center (rebuild-notifications, FR-SYS-036). Users only: guests get no
reminders and are answered 401 (A9). No delete endpoint (D7)."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import BIGINT_MAX, get_db, require_csrf_header, require_user
from app.errors import AppError
from app.schemas.loose import ensure_text
from app.schemas.notification import (
    MarkReadIn,
    MarkReadOut,
    NotificationListOut,
    NotificationOut,
)
from app.services import notification_service
from app.services.notification_service import DEFAULT_LIMIT, MAX_LIMIT
from app.services.session_service import Principal

router = APIRouter(
    prefix="/api/v1/me/notifications",
    tags=["notifications"],
    dependencies=[Depends(require_csrf_header)],
)
Db = Annotated[AsyncSession, Depends(get_db)]
User = Annotated[Principal, Depends(require_user)]
LIMIT_HELP = f"1-{MAX_LIMIT}, default {DEFAULT_LIMIT}"


def _int_param(raw: str | None, name: str, low: int, high: int) -> int | None:
    """Query integers are checked here so a bad value is 400 with the field, like bodies."""
    if raw is None:
        return None
    if not (raw.isascii() and raw.isdigit() and len(raw) <= 19) or not low <= int(raw) <= high:
        raise AppError(400, "validation_error", "error.validation", [name])
    return int(raw)


@router.get("", operation_id="listNotifications", response_model=NotificationListOut)
async def list_notifications(
    db: Db,
    user: User,
    limit: Annotated[
        str | None, Query(description=f"1-{MAX_LIMIT}, default {DEFAULT_LIMIT}")
    ] = None,
    before: Annotated[str | None, Query(description="next_before from the previous page")] = None,
) -> NotificationListOut:
    size = _int_param(limit, "limit", 1, MAX_LIMIT) or DEFAULT_LIMIT
    cursor = _int_param(before, "before", 1, BIGINT_MAX)
    rows, next_before = await notification_service.page(db, user.user_id, size, cursor)  # type: ignore[arg-type]
    return NotificationListOut(
        unread_count=await notification_service.unread_count(db, user.user_id),  # type: ignore[arg-type]
        items=[
            NotificationOut(
                id=n.id,
                type=n.type,
                tenant_id=n.tenant_id,
                data=n.data,
                created_at=n.created_at,
                read=n.read_at is not None,
            )
            for n in rows
        ],
        next_before=next_before,
    )


@router.post("/read", operation_id="markNotificationsRead", response_model=MarkReadOut)
async def mark_read(
    db: Db, user: User, req: Annotated[MarkReadIn | None, Body()] = None
) -> MarkReadOut:
    req = req or MarkReadIn()
    ensure_text(req)
    updated, unread = await notification_service.mark_read(db, user.user_id, req.ids)  # type: ignore[arg-type]
    return MarkReadOut(updated=updated, unread_count=unread)
