"""Which system templates a tenant may newly use, and the checks when a conversion starts
(FR-TEMPLATE-009, FR-OCR-019; T03/T12/T13; AC-006-04)."""

from sqlalchemy import text

from app.services import mapping_service
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import admin_client, client_like, make_org, tenant
from tests.integration.test_template_management import ADMIN, activate, content
from tests.integration.test_template_mapping import (  # noqa: F401  (fixtures)
    JOBS,
    TAX_OUTPUT,
    _versions,
    ai_settings,
    llm,
    mapping_pass,
    recognised,
    sm,
)

LIST = "/api/v1/templates"


async def unsubscribe(db, tenant_id: int) -> None:
    """End every subscription of the tenant (a login starts a free one)."""
    await db.execute(
        text(
            "update subscriptions set starts_at = now() - interval '60 days', "
            "ends_at = now() - interval '50 days' where tenant_id = :t"
        ),
        {"t": tenant_id},
    )
    await db.commit()


async def subscribe(db, tenant_id: int, plan: str, active: bool = True) -> None:
    """The tenant's only subscription."""
    await unsubscribe(db, tenant_id)
    window = (
        "now() - interval '1 day', now() + interval '20 days'"
        if active
        else "now() - interval '40 days', now() - interval '10 days'"
    )
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            f"values (:t, :p, 'month', {window}, 'admin')"
        ),
        {"t": tenant_id, "p": plan},
    )
    await db.commit()


async def system_template(admin, code: str, grants: dict | None = None) -> dict:
    r = await admin.post(ADMIN, json={"scope": "system", "content": content(code=code)})
    assert r.status_code == 201, r.text
    tpl = (await activate(admin, r.json(), base=ADMIN)).json()["template"]
    if grants is not None:
        r = await admin.put(
            f"{ADMIN}/{tpl['id']}/grants", json={"revision": tpl["revision"], **grants}
        )
        assert r.status_code == 200, r.text
        tpl = r.json()
    return tpl


async def usable_ids(c, headers=None) -> set[int]:
    r = await c.get(LIST, headers=headers or {})
    assert r.status_code == 200, r.text
    return {t["template_id"] for t in r.json()}


async def test_exact_plan_grant(api, line, db):  # no higher-plan inheritance
    me = await login(api, line)
    admin = await admin_client(api, db)
    adv = await system_template(admin, "adv_only", {"mode": "PLANS", "plans": ["advance"]})
    starter = await system_template(admin, "starter_only", {"mode": "PLANS", "plans": ["starter"]})
    await unsubscribe(db, me["tenant_id"])
    assert not {adv["id"], starter["id"]} & await usable_ids(api)  # no subscription
    await subscribe(db, me["tenant_id"], "advance")
    ids = await usable_ids(api)
    assert adv["id"] in ids and starter["id"] not in ids
    # seeded universal templates stay usable
    assert len(ids) == 3


async def test_named_user_only_in_personal_tenant(api, line, db):
    me = await login(api, line)
    org, _ = await make_org(db, me["user_id"])
    await subscribe(db, me["tenant_id"], "starter")
    await subscribe(db, org, "starter")
    admin = await admin_client(api, db)
    tpl = await system_template(
        admin, "named_user", {"mode": "TARGETS", "user_ids": [me["user_id"]]}
    )
    assert tpl["grant"]["users"][0]["id"] == me["user_id"] and tpl["grant"]["plans"] == []
    assert tpl["id"] in await usable_ids(api)
    assert tpl["id"] not in await usable_ids(api, tenant(org))  # not in the user's org
    other = client_like(api)
    o = await login(other, line, "U2")
    await subscribe(db, o["tenant_id"], "starter")
    assert tpl["id"] not in await usable_ids(other)


async def test_named_organization(api, line, db):
    me = await login(api, line)
    org, _ = await make_org(db, me["user_id"])
    other_org, _ = await make_org(db, me["user_id"], name="Other")
    for t in (me["tenant_id"], org, other_org):
        await subscribe(db, t, "kinder")
    admin = await admin_client(api, db)
    tpl = await system_template(
        admin, "named_org", {"mode": "TARGETS", "organization_tenant_ids": [org]}
    )
    assert tpl["id"] in await usable_ids(api, tenant(org))
    assert tpl["id"] not in await usable_ids(api, tenant(other_org))
    assert tpl["id"] not in await usable_ids(api)


async def test_expired_subscription(api, line, db):  # AC-009-05
    me = await login(api, line)
    await subscribe(db, me["tenant_id"], "advance", active=False)
    admin = await admin_client(api, db)
    plan = await system_template(admin, "plan_t", {"mode": "PLANS", "plans": ["advance"]})
    named = await system_template(
        admin, "named_t", {"mode": "TARGETS", "user_ids": [me["user_id"]]}
    )
    ids = await usable_ids(api)
    assert plan["id"] not in ids and named["id"] not in ids
    assert len(ids) == 2  # the universal seeded templates only
    await subscribe(db, me["tenant_id"], "advance")
    assert {plan["id"], named["id"]} <= await usable_ids(api)


async def test_disabled_and_ungranted_not_offered(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    admin = await admin_client(api, db)
    await system_template(admin, "no_grant")
    await db.execute(
        text("update document_templates set status = 'DISABLED' where code = 'billing_note'")
    )
    await db.commit()
    job = await recognised(api, store, sm, ai_settings, llm)
    body = (await api.get(f"{JOBS}/{job['id']}/template-options")).json()
    assert [t["code"] for t in body["templates"]] == ["tax_invoice"]
    # an own draft-only template is not offered either
    await api.post("/api/v1/managed-templates", json={"content": content(code="draft_only")})
    body = (await api.get(f"{JOBS}/{job['id']}/template-options")).json()
    assert [t["code"] for t in body["templates"]] == ["tax_invoice"]


async def test_own_template_usable_after_activation(api, line, db):
    await login(api, line)
    r = await api.post("/api/v1/managed-templates", json={"content": content(code="mine")})
    tpl = r.json()
    assert tpl["id"] not in await usable_ids(api)
    await activate(api, tpl)
    assert tpl["id"] in await usable_ids(api)


async def test_manual_apply_after_revoke_404(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["billing_note"], "score": 0.4}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    await db.execute(
        text("update document_templates set grant_plans = '{starter}' where code = 'tax_invoice'")
    )
    await db.commit()
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["tax_invoice"]}
    )
    assert r.status_code == 404
    applied = (
        await db.execute(text("select applied_at from document_templates where code='tax_invoice'"))
    ).scalar_one()
    assert applied is None


async def test_auto_revoked_while_scoring_is_quiet(
    api,
    line,
    store,
    sm,  # noqa: F811
    ai_settings,  # noqa: F811
    llm,  # noqa: F811
    db,
    monkeypatch,
):  # AC-006-04
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    original = mapping_service.available_versions

    async def then_disable(session, tenant_id):
        found = await original(session, tenant_id)
        async with sm() as other:  # disabled after the candidates were read
            await other.execute(
                text("update document_templates set status='DISABLED' where code='tax_invoice'")
            )
            await other.commit()
        return found

    monkeypatch.setattr(mapping_service, "available_versions", then_disable)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.95}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    monkeypatch.setattr(mapping_service, "available_versions", original)
    assert "convert" not in llm.calls
    row = (
        await db.execute(
            text("select status, error_code, template_version_id from template_mappings")
        )
    ).one()
    assert tuple(row) == ("FAILED", "TEMPLATE_UNAVAILABLE", None)
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["template"] is None and result["mapping"] is None  # quiet free-form
    assert (await api.get(f"{JOBS}/{job['id']}")).json()["stage"] == "VERIFYING"
    applied = (
        await db.execute(text("select applied_at from document_templates where code='tax_invoice'"))
    ).scalar_one()
    assert applied is None


async def test_conversion_marks_applied(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    rows = dict(
        (
            await db.execute(text("select code, applied_at is not null from document_templates"))
        ).all()
    )
    assert rows == {"tax_invoice": True, "billing_note": False}
    assert (await api.get(f"{JOBS}/{job['id']}/result")).json()["template"] is not None


async def test_historical_version_through_job(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    v1 = versions["tax_invoice"]
    # the admin publishes version 2 of the Tax Invoice
    admin = await admin_client(api, db)
    tax = (
        await db.execute(
            text("select id, revision from document_templates where code='tax_invoice'")
        )
    ).one()
    exported = (await admin.get(f"{ADMIN}/{tax.id}/export")).json()
    exported["name"] = "Tax Invoice v2"
    r = await admin.put(
        f"{ADMIN}/{tax.id}/draft", json={"revision": tax.revision, "content": exported}
    )
    r = await activate(admin, r.json(), base=ADMIN)
    assert r.json()["version"]["version"] == 2
    assert (await api.get(f"{LIST}/versions/{v1}")).status_code == 404  # not newly usable
    r = await api.get(f"{LIST}/versions/{v1}", params={"job_id": job["id"]})
    assert r.status_code == 200 and r.json()["template_version_id"] == v1
    # never another version through the job
    other = versions["billing_note"]
    await db.execute(
        text("update document_templates set status='DISABLED' where code='billing_note'")
    )
    await db.commit()
    r = await api.get(f"{LIST}/versions/{other}", params={"job_id": job["id"]})
    assert r.status_code == 404
    # nor someone else's job
    c2 = client_like(api)
    await login(c2, line, "U2")
    r = await c2.get(f"{LIST}/versions/{v1}", params={"job_id": job["id"]})
    assert r.status_code == 404
