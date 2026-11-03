"""Operation log (FR-SYS-003): append-only, each entry hashed together with the previous
entry's hash so any later change is detectable. Never put passwords, codes, tokens or
session values into an event."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import AuditLog
from app.repositories import audit_repo

GENESIS = bytes(32)


@dataclass(frozen=True)
class AuditEvent:
    actor_type: Literal["user", "guest", "admin", "system"]
    actor_id: str | None
    action: str
    target_type: str
    target_id: str | None
    result: Literal["success", "failure"]


def entry_hash(prev_hash: bytes, event: AuditEvent, occurred_at: datetime) -> bytes:
    payload = {
        "actor_type": event.actor_type,
        "actor_id": event.actor_id,
        "action": event.action,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "result": event.result,
        "occurred_at": occurred_at.astimezone(UTC).isoformat(),
    }
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(prev_hash + data.encode()).digest()


async def record(db: AsyncSession, event: AuditEvent) -> None:
    """Append one entry inside the caller's transaction; the caller commits."""
    await audit_repo.lock_chain(db)
    prev = await audit_repo.last_hash(db) or GENESIS
    at = utcnow()
    db.add(
        AuditLog(
            occurred_at=at,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            action=event.action,
            target_type=event.target_type,
            target_id=event.target_id,
            result=event.result,
            prev_hash=prev,
            hash=entry_hash(prev, event, at),
        )
    )
    await db.flush()


async def find_first_broken(db: AsyncSession) -> int | None:
    prev = GENESIS
    async for row in audit_repo.all_in_order(db):
        event = AuditEvent(
            row.actor_type, row.actor_id, row.action, row.target_type, row.target_id, row.result
        )
        if row.prev_hash != prev or row.hash != entry_hash(prev, event, row.occurred_at):
            return row.id
        prev = row.hash
    return None


async def count(db: AsyncSession) -> int:
    return (await db.execute(select(func.count()).select_from(AuditLog))).scalar_one()
