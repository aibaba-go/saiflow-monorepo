"""Notification center bodies (rebuild-notifications, FR-SYS-036)."""

from datetime import datetime

from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class NotificationOut(BaseModel):
    id: int
    type: str
    tenant_id: int
    data: dict
    created_at: datetime
    read: bool


class NotificationListOut(BaseModel):
    unread_count: int
    items: list[NotificationOut]
    next_before: int | None


class MarkReadIn(LooseRequest):
    """`ids` absent or null: every unread notification; [] marks nothing."""

    ids: list[int] | None = None


class MarkReadOut(BaseModel):
    updated: int
    unread_count: int
