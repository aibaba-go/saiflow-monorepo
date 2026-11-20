"""An organization set up for review tests (review-flow Tasks 4-6): owner U, clerk M,
level-1 reviewer R1 and level-2 reviewer R2, all registered, with a valid Starter plan."""

from dataclasses import dataclass

import httpx
from sqlalchemy import text

from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.integration.test_registration import register
from tests.integration.test_results import result, save, tax_job

JOBS = "/api/v1/ocr/jobs"


@dataclass
class Member:
    client: httpx.AsyncClient
    user_id: int


@dataclass
class ReviewOrg:
    tenant_id: int
    owner: Member
    clerk: Member
    r1: Member
    r2: Member
    roles: dict

    @property
    def h(self) -> dict:
        return tenant(self.tenant_id)


async def member(api, line, mail, sub: str) -> Member:
    c = client_like(api)
    me = await register(c, line, mail, sub=sub, email=f"{sub.lower()}@example.com")
    return Member(c, me["user_id"])


async def review_org(api, line, mail, db) -> ReviewOrg:
    owner = await member(api, line, mail, "OWNER")
    clerk = await member(api, line, mail, "CLERK")
    r1 = await member(api, line, mail, "REV1")
    r2 = await member(api, line, mail, "REV2")
    org, _ = await make_org(db, owner.user_id)
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            "values (:t, 'starter', 'month', now() - interval '1 day', now() + interval '20 days', "
            "'admin')"
        ),
        {"t": org},
    )
    await db.commit()
    roles = {
        "clerk": await make_role(db, org, "Clerk", ["upload_ocr", "verify_own", "export"]),
        "r1": await make_role(db, org, "Reviewer1", ["review_l1"]),
        "r2": await make_role(db, org, "Reviewer2", ["review_l2"]),
    }
    await add_member(db, org, clerk.user_id, roles["clerk"])
    await add_member(db, org, r1.user_id, roles["r1"])
    await add_member(db, org, r2.user_id, roles["r2"])
    return ReviewOrg(org, owner, clerk, r1, r2, roles)


async def org_job(who: Member, org: ReviewOrg, store, sm, settings, llm, db) -> dict:
    """A converted Tax Invoice job of `who`, moved into the organization."""
    job = await tax_job(who.client, store, sm, settings, llm, db)
    await db.execute(
        text("update files set tenant_id = :t where id = :f"),
        {"t": org.tenant_id, "f": job["file_id"]},
    )
    await db.execute(
        text("update ocr_jobs set tenant_id = :t where id = :j"),
        {"t": org.tenant_id, "j": job["id"]},
    )
    await db.commit()
    return job


async def set_level(db, tenant_id: int, level: int, code: str | None = "tax_invoice") -> None:
    template = None
    if code is not None:
        template = (
            await db.execute(text("select id from document_templates where code = :c"), {"c": code})
        ).scalar_one()
    await db.execute(
        text(
            "delete from review_levels where tenant_id = :t and "
            "template_id is not distinct from :tpl"
        ),
        {"t": tenant_id, "tpl": template},
    )
    await db.execute(
        text("insert into review_levels (tenant_id, template_id, level) values (:t, :tpl, :l)"),
        {"t": tenant_id, "tpl": template, "l": level},
    )
    await db.commit()


async def confirm(who: Member, org: ReviewOrg, job_id: str):
    body = await result(who.client, job_id, org.h)
    return await save(who.client, job_id, body["version"], body["structured"], True, org.h)
