"""Delete protection and its races with applying, reports and review levels
(FR-TEMPLATE-010; T15). Applying, report and review references take the template row lock,
so a delete either sees the reference or the other side sees the template deleted."""

import asyncio

from sqlalchemy import text

from app.services import template_access
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import client_like, make_org, tenant
from tests.integration.test_template_management import URL, activate, content, create
from tests.integration.test_template_mapping import (  # noqa: F401  (fixtures)
    JOBS,
    ai_settings,
    llm,
    mapping_pass,
    recognised,
    sm,
)

REVIEW = "/api/v1/review-settings/levels"


async def own_active(c, headers=None, code="po") -> dict:
    tpl = await create(c, content(code=code), headers=headers)
    r = await activate(c, tpl, headers)
    assert r.status_code == 200, r.text
    return r.json()["template"]


async def fresh(c, tpl, headers=None) -> dict:
    return (await c.get(f"{URL}/{tpl['id']}", headers=headers or {})).json()


async def delete(c, tpl, headers=None):
    return await c.delete(
        f"{URL}/{tpl['id']}", params={"revision": tpl["revision"]}, headers=headers or {}
    )


async def applied_at(db, template_id):
    return (
        await db.execute(
            text("select applied_at from document_templates where id = :t"), {"t": template_id}
        )
    ).scalar_one()


async def test_scoring_alone_not_applied(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    tpl = await own_active(api)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": tpl["current"]["id"], "score": 0.5}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    assert "convert" not in llm.calls
    assert await applied_at(db, tpl["id"]) is None
    options = (await api.get(f"{JOBS}/{job['id']}/template-options")).json()
    assert tpl["id"] in [o["template_id"] for o in options["templates"]]
    tpl = await fresh(api, tpl)
    assert tpl["deletable"] and tpl["protected_reasons"] == []
    assert (await delete(api, tpl)).status_code == 204


async def test_applied_template_cannot_be_deleted(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    tpl = await own_active(api)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": tpl["current"]["id"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [{"document": {"po_no": "PO-1"}}]
    await mapping_pass(sm, ai_settings, llm)
    assert (await api.get(f"{JOBS}/{job['id']}/result")).json()["template"] is not None
    assert await applied_at(db, tpl["id"]) is not None
    tpl = await fresh(api, tpl)
    assert tpl["protected_reasons"] == ["applied"] and tpl["deletable"] is False
    r = await delete(api, tpl)
    assert (r.status_code, r.json()["code"]) == (409, "template_in_use")
    assert r.json()["details"] == {"reasons": ["applied"]}
    # disabling stays possible and is permanent protection is unaffected
    r = await api.post(
        f"{URL}/{tpl['id']}/status", json={"revision": tpl["revision"], "status": "DISABLED"}
    )
    assert r.status_code == 200
    r = await delete(api, r.json())
    assert r.status_code == 409
    failures = (
        await db.execute(
            text(
                "select count(*) from audit_log where action = 'template.delete' "
                "and result = 'failure' and target_id like '%/template_in_use'"
            )
        )
    ).scalar_one()
    assert failures == 2


async def test_manual_apply_marks_applied(api, line, store, sm, ai_settings, llm, db):  # noqa: F811
    await login(api, line)
    tpl = await own_active(api)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": tpl["current"]["id"], "score": 0.3}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    assert await applied_at(db, tpl["id"]) is None
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": tpl["current"]["id"]}
    )
    assert r.status_code == 202, r.text
    assert await applied_at(db, tpl["id"]) is not None  # set when the conversion starts


async def test_report_reference_blocks_delete(api, line, db):
    me = await login(api, line)
    tpl = await own_active(api)
    report = (
        await db.execute(
            text(
                "insert into reports (tenant_id, name, draft) values (:t, 'R', '{}') returning id"
            ),
            {"t": me["tenant_id"]},
        )
    ).scalar_one()
    await db.execute(
        text(
            "insert into report_template_refs (report_id, kind, template_id, template_version_id) "
            "values (:r, 'DRAFT', :t, :v)"
        ),
        {"r": report, "t": tpl["id"], "v": tpl["current"]["id"]},
    )
    await db.commit()
    tpl = await fresh(api, tpl)
    assert tpl["protected_reasons"] == ["report"]
    r = await delete(api, tpl)
    assert (r.status_code, r.json()["details"]) == (409, {"reasons": ["report"]})


async def test_review_level_blocks_delete_and_survives_disable(api, line, db):
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    h = tenant(org)
    tpl = await own_active(owner, h)
    r = await owner.put(REVIEW, json={"template_id": tpl["id"], "level": 1}, headers=h)
    assert r.status_code == 200, r.text
    tpl = await fresh(owner, tpl, h)
    assert tpl["protected_reasons"] == ["review_settings"]
    r = await delete(owner, tpl, h)
    assert (r.status_code, r.json()["code"]) == (409, "template_in_use")
    # disabled: no longer newly usable, but the stored level stays listed and adjustable
    r = await owner.post(
        f"{URL}/{tpl['id']}/status",
        json={"revision": tpl["revision"], "status": "DISABLED"},
        headers=h,
    )
    tpl = r.json()
    items = (await owner.get("/api/v1/review-settings", headers=h)).json()["items"]
    assert {"template_id": tpl["id"], "name": "Purchase Order", "level": 1} in items
    r = await owner.put(REVIEW, json={"template_id": tpl["id"], "level": 2}, headers=h)
    assert r.status_code == 200 and r.json()["level"] == 2
    r = await owner.put(REVIEW, json={"template_id": tpl["id"], "level": 0}, headers=h)
    assert r.status_code == 200
    # back at 0 on a disabled template: not offered and cannot be raised again
    items = (await owner.get("/api/v1/review-settings", headers=h)).json()["items"]
    assert tpl["id"] not in [i["template_id"] for i in items]
    r = await owner.put(REVIEW, json={"template_id": tpl["id"], "level": 1}, headers=h)
    assert r.status_code == 404
    # a level of 0 is no reference: delete succeeds, and the deleted template is 404
    assert (await delete(owner, tpl, h)).status_code == 204
    r = await owner.put(REVIEW, json={"template_id": tpl["id"], "level": 0}, headers=h)
    assert r.status_code == 404


async def test_review_level_on_unusable_template_404(api, line, db):
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    h = tenant(org)
    draft_only = await create(owner, content(code="draft_only"), headers=h)
    r = await owner.put(REVIEW, json={"template_id": draft_only["id"], "level": 1}, headers=h)
    assert r.status_code == 404
    # another tenant's template
    other = client_like(api)
    await login(other, line, "OTHER")
    theirs = await own_active(other, code="theirs")
    r = await owner.put(REVIEW, json={"template_id": theirs["id"], "level": 1}, headers=h)
    assert r.status_code == 404


async def test_delete_waits_for_apply_lock(api, line, db, sm):  # noqa: F811
    """An apply holding the template lock commits first: the delete then sees "applied"."""
    me = await login(api, line)
    tpl = await own_active(api)
    async with sm() as session:
        claimed = await template_access.claim_for_use(
            session, me["tenant_id"], tpl["id"], tpl["current"]["id"]
        )
        assert claimed is not None
        task = asyncio.create_task(delete(api, tpl))
        await asyncio.sleep(0.5)
        assert not task.done()  # blocked on the template row lock
        await session.commit()
    r = await asyncio.wait_for(task, 10)
    assert (r.status_code, r.json()["details"]) == (409, {"reasons": ["applied"]})


async def test_apply_after_concurrent_delete_refused(api, line, db, sm):  # noqa: F811
    """A delete holding the lock commits first: the apply re-check sees it deleted."""
    me = await login(api, line)
    tpl = await own_active(api)
    async with sm() as session:
        locked = await template_access.lock_template(session, tpl["id"])
        assert locked is not None

        async def claim():
            async with sm() as other:
                found = await template_access.claim_for_use(
                    other, me["tenant_id"], tpl["id"], tpl["current"]["id"]
                )
                await other.commit()
                return found

        task = asyncio.create_task(claim())
        await asyncio.sleep(0.5)
        assert not task.done()
        await session.execute(
            text("update document_templates set deleted_at = now() where id = :t"),
            {"t": tpl["id"]},
        )
        await session.commit()
    assert await asyncio.wait_for(task, 10) is None
    assert await applied_at(db, tpl["id"]) is None
