"""Admin read-only query bodies (web-admin-console, FR-SYS-003, FR-SYS-080)."""

from datetime import datetime

from pydantic import BaseModel


class AuditEntryOut(BaseModel):
    id: int
    occurred_at: datetime
    actor_type: str
    actor_id: str | None
    action: str
    target_type: str
    target_id: str | None
    result: str


class AuditPageOut(BaseModel):
    items: list[AuditEntryOut]
    next_before: int | None


class AdminUserOut(BaseModel):
    user_id: int
    display_name: str | None
    email: str | None
    phone: str | None
    registered: bool
    registered_at: datetime | None
    created_at: datetime
    personal_tenant_id: int | None


class UserPageOut(BaseModel):
    items: list[AdminUserOut]
    has_more: bool


class ImpersonationLinkOut(BaseModel):
    """A one-time web-pc link that enters as the user (FR-SYS-145)."""

    url: str
    expires_in: int  # seconds
