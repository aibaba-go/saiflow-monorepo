"""Read-only admin queries (web-admin-console): the operation log (FR-SYS-003) and customer
user search (FR-SYS-080). Neither writes to the operation log."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Tenant, User

USERS_PER_PAGE = 50


def like_literal(value: str) -> str:
    """Escape LIKE wildcards so user input is matched literally (ESCAPE '\\')."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass(frozen=True)
class AuditFilter:
    limit: int = 50
    before: int | None = None
    since: datetime | None = None
    until: datetime | None = None
    actor_type: str | None = None
    action_prefix: str | None = None
    target_type: str | None = None
    target_id: str | None = None


async def audit_page(db: AsyncSession, f: AuditFilter) -> tuple[list[AuditLog], int | None]:
    """Newest first; the next page continues before the last id returned."""
    q = select(AuditLog)
    if f.before is not None:
        q = q.where(AuditLog.id < f.before)
    if f.since is not None:
        q = q.where(AuditLog.occurred_at >= f.since)
    if f.until is not None:
        q = q.where(AuditLog.occurred_at < f.until)
    if f.actor_type is not None:
        q = q.where(AuditLog.actor_type == f.actor_type)
    if f.action_prefix:
        q = q.where(AuditLog.action.like(like_literal(f.action_prefix) + "%", escape="\\"))
    if f.target_type is not None:
        q = q.where(AuditLog.target_type == f.target_type)
    if f.target_id is not None:
        q = q.where(AuditLog.target_id == f.target_id)
    rows = list((await db.execute(q.order_by(AuditLog.id.desc()).limit(f.limit + 1))).scalars())
    more = len(rows) > f.limit
    rows = rows[: f.limit]
    return rows, rows[-1].id if more else None


async def search_users(db: AsyncSession, q: str, page: int) -> tuple[list[dict], bool]:
    """Email or nickname contains q (>= 2 chars, case-insensitive), or the exact user id when
    q is all digits. Guests have no user row, so they never appear."""
    conditions = []
    if q.isdigit() and len(q) <= 19:
        conditions.append(User.id == int(q))
    if len(q) >= 2:
        pattern = f"%{like_literal(q)}%"
        conditions.append(User.email.ilike(pattern, escape="\\"))
        conditions.append(User.display_name.ilike(pattern, escape="\\"))
    personal = (
        select(Tenant.id)
        .where(Tenant.owner_user_id == User.id, Tenant.kind == "personal")
        .scalar_subquery()
    )
    query = (
        select(User, personal.label("personal_tenant_id"))
        .where(or_(*conditions))
        .order_by(func.coalesce(User.registered_at, User.created_at).desc(), User.id.desc())
        .offset((page - 1) * USERS_PER_PAGE)
        .limit(USERS_PER_PAGE + 1)
    )
    rows = (await db.execute(query)).all()
    items = [
        {
            "user_id": u.id,
            "display_name": u.display_name,
            "email": u.email,
            "phone": u.phone,
            "registered": u.registered_at is not None,
            "registered_at": u.registered_at,
            "created_at": u.created_at,
            "personal_tenant_id": tenant_id,
        }
        for u, tenant_id in rows[:USERS_PER_PAGE]
    ]
    return items, len(rows) > USERS_PER_PAGE
