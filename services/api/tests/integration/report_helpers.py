"""Report integration fixtures (template-report-management): an organization on a Starter
plan with a report template (tests/report_samples.GROUPS) activated through the API, members
with chosen permissions, and formal business documents inserted directly in the database."""

import copy
import json
import uuid
from dataclasses import dataclass

import httpx
from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.report_samples import GROUPS, card

R = "/api/v1/reports"
ADMIN_R = "/api/v1/admin/reports"
TPL = "/api/v1/managed-templates"
YEAR = {"mode": "fixed", "from": "2026-01-01", "to": "2026-12-31"}


@dataclass
class Who:
    client: httpx.AsyncClient
    user_id: int


@dataclass
class Org:
    tenant_id: int
    owner: Who
    template_id: int
    version_id: int

    @property
    def h(self) -> dict:
        return tenant(self.tenant_id)

    def card(self, cid: str = "c_1", **kw) -> dict:
        kw.setdefault("template_id", self.template_id)
        kw.setdefault("version_ids", [self.version_id])
        return card(cid, **kw)


def template_content(groups=None, code: str = "rpt", name: str = "Report PO") -> dict:
    g = copy.deepcopy(groups or GROUPS)
    for group in g:
        for item in group["items"]:
            if item["key"] == "vendor":
                item["primary"] = True
    return {"code": code, "name": name, "groups": g}


async def subscribe(db, tid: int, plan: str = "starter", *, expired: bool = False) -> None:
    ends = "now() - interval '1 day'" if expired else "now() + interval '20 days'"
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            f"values (:t, :p, 'month', now() - interval '30 days', {ends}, 'admin')"
        ),
        {"t": tid, "p": plan},
    )
    await db.commit()


async def new_template(c, tid: int, groups=None, code: str = "rpt") -> dict:
    h = tenant(tid)
    r = await c.post(TPL, json={"content": template_content(groups, code)}, headers=h)
    assert r.status_code == 201, r.text
    tpl = r.json()
    r = await c.post(f"{TPL}/{tpl['id']}/activate", json={"revision": tpl["revision"]}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["template"]


async def new_version(c, tid: int, template_id: int, groups) -> int:
    """Save a new draft and activate it; returns the new version ID."""
    h = tenant(tid)
    tpl = (await c.get(f"{TPL}/{template_id}", headers=h)).json()
    before = tpl["current_version"]["id"]
    content = template_content(groups, tpl["code"], tpl["name"])
    r = await c.put(
        f"{TPL}/{template_id}/draft",
        json={"revision": tpl["revision"], "content": content},
        headers=h,
    )
    assert r.status_code == 200, r.text
    r = await c.post(
        f"{TPL}/{template_id}/activate", json={"revision": r.json()["revision"]}, headers=h
    )
    assert r.status_code == 200, r.text
    vid = r.json()["template"]["current_version"]["id"]
    assert vid != before, "the draft did not create a new version"
    return vid


async def report_org(api, line, db, sub: str = "OWNER", plan: str | None = "starter") -> Org:
    c = client_like(api)
    me = await login(c, line, sub)
    tid, _ = await make_org(db, me["user_id"], name=f"Org {sub}")
    if plan:
        await subscribe(db, tid, plan)
    tpl = await new_template(c, tid)
    return Org(tid, Who(c, me["user_id"]), tpl["id"], tpl["current_version"]["id"])


async def join(api, line, db, org: Org, sub: str, perms: list[str]) -> Who:
    c = client_like(api)
    me = await login(c, line, sub)
    role = await make_role(db, org.tenant_id, f"Role {sub}", perms)
    await add_member(db, org.tenant_id, me["user_id"], role)
    return Who(c, me["user_id"])


def doc(
    total=None,
    vendor="ACME",
    doc_date="2026-03-15",
    *,
    currency=None,
    qty=None,
    rate=None,
    items=None,
    fees=None,
) -> dict:
    header = {"doc_date": doc_date, "vendor": vendor, "total": total}
    if currency is not None:
        header["currency"] = currency
    if qty is not None:
        header["qty"] = qty
    if rate is not None:
        header["rate"] = rate
    return {"header": header, "lines": {"items": [] if items is None else items, "fees": fees}}


@dataclass
class Job:
    id: str
    result_id: str
    mapping_id: str


async def formal(
    db,
    org: Org | int,
    user_id: int,
    structured,
    *,
    version_id: int | None = None,
    template_id: int | None = None,
    review: str = "CONFIRMED",
    official: bool = True,
) -> Job:
    """A job with its own raw result, mapping and confirmed result version (1)."""
    tid = org if isinstance(org, int) else org.tenant_id
    if not isinstance(org, int):
        version_id = version_id or org.version_id
        template_id = template_id or org.template_id
    job, file, raw, mapping, rv = (str(uuid.uuid4()) for _ in range(5))
    p = {"t": tid, "u": user_id, "j": job, "f": file, "raw": raw, "m": mapping, "rv": rv}
    await db.execute(
        text(
            "insert into files (id, tenant_id, created_by_user_id, original_name, status) "
            "values (:f, :t, :u, 'doc.pdf', 'READY')"
        ),
        p,
    )
    await db.execute(
        text(
            "insert into ocr_jobs (id, tenant_id, created_by_user_id, file_id, status) "
            "values (:j, :t, :u, :f, 'SUCCEEDED')"
        ),
        p,
    )
    await db.execute(
        text(
            "insert into ocr_raw_results (id, job_id, engine, payload) "
            "values (:raw, :j, 'textin', '{}')"
        ),
        p,
    )
    await db.execute(
        text(
            "insert into template_mappings (id, job_id, raw_result_id, template_id, "
            "template_version_id, source, status) values (:m, :j, :raw, :tpl, :v, 'AUTO', 'READY')"
        ),
        {**p, "tpl": template_id, "v": version_id},
    )
    await db.execute(
        text(
            "insert into result_versions (id, job_id, version, is_current, structured, mapping_id, "
            "created_by_user_id) values (:rv, :j, 1, true, CAST(:s AS jsonb), :m, :u)"
        ),
        {**p, "s": json.dumps(structured, ensure_ascii=False)},
    )
    await db.execute(text("update template_mappings set result_version_id = :rv where id = :m"), p)
    official_sql = "now()" if official else "null"
    await db.execute(
        text(
            "update ocr_jobs set current_mapping_id = :m, review_status = :rs, "
            "confirmed_at = now(), confirmed_by_user_id = :u, confirmed_version_id = :rv, "
            f"official_at = {official_sql} where id = :j"
        ),
        {**p, "rs": review},
    )
    await db.commit()
    return Job(job, rv, mapping)


# ---------------------------------------------------------------- report API


async def create_report(who: Who, org: Org, config: dict, name: str = "Ops") -> dict:
    r = await who.client.post(R, json={"name": name}, headers=org.h)
    assert r.status_code == 201, r.text
    d = r.json()
    r = await who.client.put(
        f"{R}/{d['id']}",
        json={"revision": d["revision"], "name": name, "config": config},
        headers=org.h,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def publish(who: Who, org: Org, report: dict):
    return await who.client.post(
        f"{R}/{report['id']}/publish", json={"revision": report["revision"]}, headers=org.h
    )


async def published(who: Who, org: Org, config: dict, name: str = "Ops") -> dict:
    report = await create_report(who, org, config, name)
    r = await publish(who, org, report)
    assert r.status_code == 200, r.text
    return r.json()


async def query(who: Who, org: Org, report_id: int, period=None, refresh: bool = False, **extra):
    body = {"period": period, "refresh": refresh, **extra}
    return await who.client.post(f"{R}/{report_id}/data", json=body, headers=org.h)


async def data(who: Who, org: Org, report_id: int, period=None, **extra) -> dict:
    r = await query(who, org, report_id, period, **extra)
    assert r.status_code == 200, r.text
    return r.json()


async def preview(who: Who, org: Org, report_id: int, config: dict, period=None):
    return await who.client.post(
        f"{R}/{report_id}/preview", json={"config": config, "period": period}, headers=org.h
    )


def cards(result: dict) -> dict:
    return {c["card_id"]: c for c in result["cards"]}


def values(card_result: dict) -> dict:
    """(dimension, series) → value of a card's rows (or dimension → value without series)."""
    out = {}
    for r in card_result["rows"]:
        key = r["dimension"] if r["series"] is None else (r["dimension"], r["series"])
        out[key] = r["value"]
    return out


async def report_audits(db) -> list[tuple[str, str, str, str]]:
    rows = await db.execute(
        text(
            "select action, actor_type, target_id, result from audit_log "
            "where action like 'report.%' order by id"
        )
    )
    return [tuple(r) for r in rows.all()]
