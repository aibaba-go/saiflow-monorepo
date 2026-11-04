"""System settings changed by the platform admin (DM-SystemSetting)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import SystemSetting
from app.services.audit_service import record
from app.services.organization_service import Actor

ORG_MEMBER_LIMIT_UNPAID = "org_member_limit_unpaid"


async def get_int(db: AsyncSession, key: str, default: int) -> int:
    row = await db.get(SystemSetting, key)
    return int(row.value) if row is not None else default


async def set_int(db: AsyncSession, key: str, value: int, admin_id: int) -> None:
    if isinstance(value, bool) or value < 1:
        raise AppError(400, "validation_error", "error.validation", ["value"])
    row = await db.get(SystemSetting, key, with_for_update=True)
    if row is None:
        db.add(SystemSetting(key=key, value=value))
    else:
        row.value, row.updated_at = value, utcnow()
    await record(db, Actor("admin", admin_id).event("setting.update", "system_setting", key))
    await db.commit()
