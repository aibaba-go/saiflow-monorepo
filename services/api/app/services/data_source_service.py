from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.errors import AppError
from app.models.data_source import DataSource, ReportSourceRef
from app.schemas.data_source import SourceIn
from app.services import report_service
from app.services.audit_service import AuditEvent, record
from app.services.data_source_connection import (
    resolve_target,
    result_page,
    source_rows,
    source_tables,
    system_query,
    system_tables,
)
from app.services.data_source_security import encrypt_password
from app.services.tenant_access import not_found

SYSTEM_ID = "system-pg"


def source_number(source_id: str) -> int:
    prefix, _, value = source_id.partition(":")
    if prefix != "postgres" or not value.isascii() or not value.isdigit() or len(value) > 19:
        raise not_found()
    number = int(value)
    if not 0 < number < 2**63:
        raise not_found()
    return number


def metadata(source: DataSource) -> dict:
    return {
        "id": f"postgres:{source.id}",
        "kind": "postgresql",
        "name": source.name,
        "tenant_id": source.tenant_id,
        "host": source.host,
        "port": source.port,
        "database": source.database,
        "username": source.username,
        "ssl_mode": source.ssl_mode,
        "password_configured": bool(source.password_cipher),
        "enabled": source.enabled,
    }


def builtin_metadata(settings: Settings) -> dict:
    return {
        "id": SYSTEM_ID,
        "name": "SaiFlow PostgreSQL",
        "kind": "system_pg",
        "password_configured": bool(settings.report_db_password),
        "enabled": True,
    }


async def get_source(db: AsyncSession, tenant_id: int, source_id: str, *, lock=False) -> DataSource:
    number = source_number(source_id)
    query = select(DataSource).where(DataSource.id == number, DataSource.tenant_id == tenant_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    source = (await db.execute(query)).scalar_one_or_none()
    if source is None:
        raise not_found()
    return source


async def list_sources(
    db: AsyncSession, tenant_id: int | None, settings: Settings, *, admin=False
) -> dict:
    items = [builtin_metadata(settings)] if admin else []
    if tenant_id is not None:
        sources = (
            (
                await db.execute(
                    select(DataSource)
                    .where(DataSource.tenant_id == tenant_id)
                    .order_by(DataSource.id)
                )
            )
            .scalars()
            .all()
        )
        items.extend(metadata(source) for source in sources)
        templates = await report_service.catalog_templates(db, tenant_id, None)
        items.extend(
            {
                "id": f"template:{t['template_id']}",
                "name": t["name"],
                "kind": "template",
                "template_id": t["template_id"],
                "tenant_id": tenant_id,
            }
            for t in templates
        )
    return {"items": items}


async def save_source(
    db: AsyncSession,
    tenant_id: int,
    body: SourceIn,
    settings: Settings,
    actor_kind: str,
    actor_id: int,
    source_id: str | None = None,
) -> dict:
    source = (
        await get_source(db, tenant_id, source_id, lock=True)
        if source_id
        else DataSource(tenant_id=tenant_id, password_cipher="")
    )
    for key in ("name", "host", "port", "database", "username", "ssl_mode", "enabled"):
        setattr(source, key, getattr(body, key))
    await resolve_target(settings, source)
    if source_id is None:
        db.add(source)
        await db.flush()
    password = body.password.get_secret_value()
    if password:
        source.password_cipher = encrypt_password(
            settings, password, tenant_id=tenant_id, source_id=source.id
        )
    elif not source.password_cipher:
        raise AppError(422, "validation_error", "error.validation", fields=["password"])
    source.updated_at = utcnow()
    result = metadata(source)
    await record(
        db,
        AuditEvent(
            actor_kind,
            str(actor_id),
            "data_source.save",
            "data_source",  # type: ignore[arg-type]
            f"{tenant_id}/{source.id}",
            "success",
        ),
    )
    await db.commit()
    return result


async def remove_source(
    db: AsyncSession, tenant_id: int, source_id: str, actor_kind: str, actor_id: int
) -> None:
    source = await get_source(db, tenant_id, source_id, lock=True)
    used = (
        await db.execute(
            select(ReportSourceRef.report_id).where(ReportSourceRef.source_id == source.id).limit(1)
        )
    ).first()
    if used:
        raise AppError(409, "data_source_in_use", "error.data_source_in_use")
    await db.delete(source)
    await record(
        db,
        AuditEvent(
            actor_kind,
            str(actor_id),
            "data_source.delete",
            "data_source",  # type: ignore[arg-type]
            f"{tenant_id}/{source.id}",
            "success",
        ),
    )
    await db.commit()


async def tables(
    db: AsyncSession, tenant_id: int | None, source_id: str, settings: Settings, *, admin=False
) -> dict:
    if source_id == SYSTEM_ID:
        if not admin:
            raise not_found()
        items = await system_tables(settings)
    else:
        if tenant_id is None:
            raise not_found()
        source = await get_source(db, tenant_id, source_id)
        if not source.enabled:
            raise AppError(503, "data_source_unavailable", "error.data_source_unavailable")
        items = await source_tables(settings, source)
    return {"items": items}


async def query_source(
    db: AsyncSession,
    tenant_id: int | None,
    source_id: str,
    settings: Settings,
    sql: str,
    page: int = 1,
    page_size: int = 20,
    *,
    admin=False,
) -> dict:
    if source_id == SYSTEM_ID:
        if not admin:
            raise not_found()
        columns, rows = await system_query(settings, sql)
    else:
        if tenant_id is None:
            raise not_found()
        source = await get_source(db, tenant_id, source_id)
        if not source.enabled:
            raise AppError(503, "data_source_unavailable", "error.data_source_unavailable")
        columns, rows = await source_rows(settings, source, sql)
    return result_page(columns, rows, page=page, page_size=page_size)


async def audited_query(
    db: AsyncSession,
    tenant_id: int | None,
    source_id: str,
    settings: Settings,
    sql: str,
    page: int,
    page_size: int,
    actor_kind: str,
    actor_id: int,
    *,
    admin=False,
    action="query",
) -> dict:
    outcome = "success"
    try:
        result = await query_source(
            db, tenant_id, source_id, settings, sql, page, page_size, admin=admin
        )
    except AppError as exc:
        if exc.status == 404:
            raise
        outcome = "failure"
        raise
    finally:
        if outcome == "failure":
            await db.rollback()
            await record(
                db,
                AuditEvent(
                    actor_kind,
                    str(actor_id),
                    f"data_source.{action}",
                    "data_source",
                    f"{tenant_id}/{source_id}",
                    outcome,
                ),
            )
            await db.commit()
    await record(
        db,
        AuditEvent(
            actor_kind,
            str(actor_id),
            f"data_source.{action}",
            "data_source",
            f"{tenant_id}/{source_id}",
            outcome,
        ),
    )
    await db.commit()
    return result


def bound_sources(config: Any) -> set[str]:
    cards = config.get("cards", []) if isinstance(config, dict) else []
    out = set()
    for card in cards if isinstance(cards, list) else []:
        data = card.get("data") if isinstance(card, dict) else None
        if isinstance(data, dict) and isinstance(data.get("source_id"), str):
            if not data["source_id"].startswith("template:"):
                out.add(data["source_id"])
    return out


async def binding_errors(db: AsyncSession, tenant_id: int, config: Any) -> list[dict]:
    available = set(
        (
            await db.execute(
                select(DataSource.id).where(
                    DataSource.tenant_id == tenant_id, DataSource.enabled.is_(True)
                )
            )
        ).scalars()
    )
    problems = []
    cards = config.get("cards", []) if isinstance(config, dict) else []
    for index, card in enumerate(cards if isinstance(cards, list) else []):
        data = card.get("data") if isinstance(card, dict) else None
        source_id = data.get("source_id") if isinstance(data, dict) else None
        if source_id is None or (isinstance(source_id, str) and source_id.startswith("template:")):
            continue
        try:
            valid = source_number(source_id) in available if isinstance(source_id, str) else False
        except AppError:
            valid = False
        if not valid:
            problems.append(
                {
                    "card_id": card.get("id"),
                    "path": f"cards[{index}].data.source_id",
                    "message": "the source is not available to this organization",
                }
            )
    return problems


async def write_refs(
    db: AsyncSession,
    report_id: int,
    tenant_id: int,
    kinds: tuple[str, ...],
    config: Any,
    *,
    strict: bool = False,
) -> list[dict]:
    sources = []
    for source_id in sorted(bound_sources(config)):
        try:
            sources.append(await get_source(db, tenant_id, source_id, lock=True))
        except AppError as exc:
            if exc.status != 404:
                raise
    problems = await binding_errors(db, tenant_id, config)
    if strict and problems:
        return problems
    await db.execute(
        delete(ReportSourceRef).where(
            ReportSourceRef.report_id == report_id, ReportSourceRef.kind.in_(kinds)
        )
    )
    for kind in kinds:
        for source in sources:
            db.add(ReportSourceRef(report_id=report_id, source_id=source.id, kind=kind))
    await db.flush()
    return problems
