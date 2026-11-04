"""Shared helpers for the tenancy tests: extra clients, direct org setup, a test-only
business endpoint that goes through the tenant access rule (FR-SYS-017)."""

from typing import Annotated

import httpx
from fastapi import Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_tenant_context
from app.permissions import DEFAULT_ROLE
from app.services.tenant_access import TenantContext, submitter_scope
from tests.integration.db_fixtures import login, test_tenant_items


def client_like(api, cookie: str | None = None) -> httpx.AsyncClient:
    """Another browser on the same app, with its own cookie jar."""
    c = httpx.AsyncClient(
        transport=api._transport, base_url="https://test", headers=dict(api.headers)
    )
    if cookie:
        c.cookies.set("saiflow_session", cookie)
    return c


async def user_client(api, line, sub: str) -> tuple[httpx.AsyncClient, int]:
    c = client_like(api)
    me = await login(c, line, sub)
    return c, me["user_id"]


async def make_org(db, owner_id: int, name: str = "Org") -> tuple[int, int]:
    """An active organization with its default role and owner (bypasses the API)."""
    tid = (
        await db.execute(text("insert into tenants (kind) values ('organization') returning id"))
    ).scalar_one()
    await db.execute(
        text(
            "insert into organizations (tenant_id, name, contact_phone) "
            "values (:t, :n, '0812345678')"
        ),
        {"t": tid, "n": name},
    )
    role = await make_role(db, tid, "Member", sorted(DEFAULT_ROLE), is_default=True)
    await db.execute(
        text("insert into memberships (tenant_id, user_id, is_owner) values (:t, :u, true)"),
        {"t": tid, "u": owner_id},
    )
    await db.commit()
    return tid, role


async def make_role(db, tid: int, name: str, perms: list[str], is_default: bool = False) -> int:
    rid = (
        await db.execute(
            text(
                "insert into roles (tenant_id, name, permissions, is_default) "
                "values (:t, :n, :p, :d) returning id"
            ),
            {"t": tid, "n": name, "p": perms, "d": is_default},
        )
    ).scalar_one()
    await db.commit()
    return rid


async def add_member(db, tid: int, user_id: int, role_id: int) -> None:
    await db.execute(
        text("insert into memberships (tenant_id, user_id, role_id) values (:t, :u, :r)"),
        {"t": tid, "u": user_id, "r": role_id},
    )
    await db.commit()


def mount_items(api) -> None:
    """GET/POST /api/v1/_test/items: list or add items of the current tenant."""
    if getattr(api.app.state, "items_mounted", False):
        return
    api.app.state.items_mounted = True

    async def list_items(
        ctx: Annotated[TenantContext, Depends(get_tenant_context)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> list[str]:
        q = select(test_tenant_items.c.label).where(test_tenant_items.c.tenant_id == ctx.tenant_id)
        owner = submitter_scope(ctx)
        if owner is not None:
            q = q.where(test_tenant_items.c.created_by_user_id == owner)
        return sorted((await db.execute(q)).scalars())

    async def add_item(
        label: str,
        ctx: Annotated[TenantContext, Depends(get_tenant_context)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> dict:
        await db.execute(
            test_tenant_items.insert().values(
                tenant_id=ctx.tenant_id, label=label, created_by_user_id=ctx.user_id
            )
        )
        await db.commit()
        return {"tenant_id": ctx.tenant_id}

    api.app.add_api_route("/api/v1/_test/items", list_items, methods=["GET"])
    api.app.add_api_route("/api/v1/_test/items", add_item, methods=["POST"])


def tenant(tid: int | str) -> dict:
    return {"X-Tenant-Id": str(tid)}
