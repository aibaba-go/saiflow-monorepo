"""Template management API: lifecycle, revisions, activation, import/export, permissions and
admin grants (template-report-management contract §2/§3; FR-TEMPLATE-001..013)."""

import copy

from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import (
    add_member,
    admin_client,
    client_like,
    make_org,
    make_role,
    tenant,
)

URL = "/api/v1/managed-templates"
ADMIN = "/api/v1/admin/templates"


def content(code: str = "po", name: str = "Purchase Order", field: str = "po_no") -> dict:
    return {
        "code": code,
        "name": name,
        "groups": [
            {
                "key": "document",
                "name": "Document",
                "items": [{"kind": "field", "key": field, "name": "No.", "primary": True}],
            }
        ],
    }


async def create(c, body=None, headers=None, **extra):
    r = await c.post(URL, json={"content": body or content(), **extra}, headers=headers or {})
    assert r.status_code == 201, r.text
    return r.json()


async def activate(c, tpl, headers=None, base=URL):
    return await c.post(
        f"{base}/{tpl['id']}/activate", json={"revision": tpl["revision"]}, headers=headers or {}
    )


async def audits(db, prefix="template.") -> list[tuple[str, str, str, str]]:
    rows = await db.execute(
        text(
            "select action, actor_type, target_id, result from audit_log "
            "where action like :p order by id"
        ),
        {"p": f"{prefix}%"},
    )
    return [tuple(r) for r in rows.all()]


async def test_create_save_activate_lifecycle(api, line, db):  # FR-TEMPLATE-002/005/012/013
    await login(api, line)
    tpl = await create(api)
    assert tpl["scope"] == "personal" and tpl["has_draft"] and tpl["current_version"] is None
    assert tpl["revision"] == 1 and tpl["can_manage"] and tpl["draft_errors"] == []
    # an incomplete draft is saved and reports its errors
    bad = {"code": "po", "name": "Purchase Order", "groups": []}
    r = await api.put(f"{URL}/{tpl['id']}/draft", json={"revision": 1, "content": bad})
    assert r.status_code == 200, r.text
    tpl = r.json()
    assert tpl["revision"] == 2 and tpl["draft_errors"][0]["path"] == "groups"
    # stale revision
    r = await api.put(f"{URL}/{tpl['id']}/draft", json={"revision": 1, "content": content()})
    assert (r.status_code, r.json()["code"]) == (409, "revision_conflict")
    assert r.json()["message_key"] == "error.revision_conflict"
    assert r.json()["details"] == {"revision": 2}
    # activation refuses an invalid draft and changes nothing
    r = await activate(api, tpl)
    assert (r.status_code, r.json()["code"]) == (422, "template_invalid")
    assert r.json()["details"]["errors"]
    tpl = (await api.get(f"{URL}/{tpl['id']}")).json()
    assert tpl["revision"] == 2 and tpl["has_draft"]
    r = await api.put(f"{URL}/{tpl['id']}/draft", json={"revision": 2, "content": content()})
    tpl = r.json()
    r = await activate(api, tpl)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] == "activated" and body["version"]["version"] == 1
    tpl = body["template"]
    assert tpl["current_version"]["version"] == 1 and not tpl["has_draft"]
    assert tpl["status"] == "ENABLED" and tpl["revision"] == 4
    # the same content again: no new version
    r = await api.put(f"{URL}/{tpl['id']}/draft", json={"revision": 4, "content": content()})
    r = await activate(api, r.json())
    assert r.json()["result"] == "unchanged" and r.json()["version"]["version"] == 1
    # changed content: version 2, version 1 still readable
    tpl = r.json()["template"]
    r = await api.put(
        f"{URL}/{tpl['id']}/draft",
        json={"revision": tpl["revision"], "content": content(name="PO v2")},
    )
    r = await activate(api, r.json())
    assert (r.json()["result"], r.json()["version"]["version"]) == ("activated", 2)
    tpl = r.json()["template"]
    assert [v["version"] for v in tpl["versions"]] == [2, 1] and tpl["name"] == "PO v2"
    v1 = tpl["versions"][1]["id"]
    r = await api.get(f"{URL}/{tpl['id']}/versions/{v1}")
    assert r.status_code == 200 and r.json()["name"] == "Purchase Order"
    count = (
        await db.execute(
            text("select count(*) from document_template_versions where template_id = :t"),
            {"t": tpl["id"]},
        )
    ).scalar_one()
    assert count == 2
    actions = [a[0] for a in await audits(db)]
    assert actions[:2] == ["template.create", "template.save"]
    assert "template.activate" in actions and "template.activate_unchanged" in actions
    assert ("template.save", "failure") in [(a[0], a[3]) for a in await audits(db)]


async def test_audit_has_no_content(api, line, db):  # FR-TEMPLATE-007
    me = await login(api, line)
    tpl = await create(api, content(name="SecretName", field="secret_key"))
    await activate(api, tpl)
    rows = await audits(db)
    assert rows and all("Secret" not in r[2] and "secret_key" not in r[2] for r in rows)
    assert rows[0][1:3] == ("user", f"{tpl['id']}/tenant:{me['tenant_id']}/r1")


async def test_code_conflict_per_scope(api, line, db):  # T08
    await login(api, line)
    await create(api)
    r = await api.post(URL, json={"content": content(name="Other")})
    assert (r.status_code, r.json()["code"]) == (409, "template_code_conflict")
    assert r.json()["details"] == {"code": "po"}
    other = await create(api, content(code="po2"))
    r = await api.put(f"{URL}/{other['id']}/draft", json={"revision": 1, "content": content()})
    assert (r.status_code, r.json()["code"]) == (409, "template_code_conflict")
    # the same code in another tenant, and as a system code, is fine
    c2 = client_like(api)
    await login(c2, line, "U2")
    await create(c2)
    r = await api.post(URL, json={"content": content(code="tax_invoice")})
    assert r.status_code == 201


async def test_code_required_and_size(api, line):
    await login(api, line)
    r = await api.post(URL, json={"content": {"name": "x"}})
    assert (r.status_code, r.json()["fields"]) == (422, ["code"])
    big = content() | {"description": "x" * (512 * 1024 + 10)}
    r = await api.post(URL, json={"content": big})
    assert (r.status_code, r.json()["code"]) == (422, "template_too_large")


async def test_import_ignores_control_fields_and_export_round_trip(api, line):  # T09
    await login(api, line)
    imported = content() | {
        "status": "DISABLED",
        "grant_mode": "PLANS",
        "grant_plans": ["advance"],
        "tenant_id": 1,
        "revision": 50,
        "current_version_id": 1,
        "_pending_confirmations": [{"path": "groups[0]", "attr": "required"}],
    }
    tpl = await create(api, imported, source="import")
    assert tpl["status"] == "ENABLED" and tpl["revision"] == 1
    assert tpl["pending_confirmations"] == []
    assert set(tpl["draft"]) == {"code", "name", "groups"}
    r = await api.get(f"{URL}/{tpl['id']}/export", params={"draft": 1})
    assert r.status_code == 200 and r.json()["code"] == "po"
    assert (await api.get(f"{URL}/{tpl['id']}/export")).status_code == 404  # no version yet
    tpl = (await activate(api, tpl)).json()["template"]
    exported = (await api.get(f"{URL}/{tpl['id']}/export")).json()
    assert set(exported) >= {"code", "name", "groups"} and "status" not in exported
    exported["code"] = "po_copy"
    copy_tpl = await create(api, exported, source="import")
    r = await activate(api, copy_tpl)
    assert r.json()["version"]["content_hash"] == tpl["current"]["content_hash"]


async def test_validate_endpoint(api, line):
    await login(api, line)
    r = await api.post(f"{URL}/validate", json={"content": content()})
    assert r.json() == {"errors": []}
    r = await api.post(f"{URL}/validate", json={"content": {"code": "x"}})
    assert r.json()["errors"]


async def test_discard_status_and_delete(api, line, db):  # FR-TEMPLATE-010
    await login(api, line)
    tpl = await create(api)
    tpl = (await activate(api, tpl)).json()["template"]
    r = await api.put(
        f"{URL}/{tpl['id']}/draft",
        json={"revision": tpl["revision"], "content": content(name="X")},
    )
    tpl = r.json()
    r = await api.delete(f"{URL}/{tpl['id']}/draft", params={"revision": tpl["revision"]})
    assert r.status_code == 200 and not r.json()["has_draft"]
    assert r.json()["current"]["name"] == "Purchase Order"
    tpl = r.json()
    r = await api.post(
        f"{URL}/{tpl['id']}/status", json={"revision": tpl["revision"], "status": "DISABLED"}
    )
    assert r.status_code == 200 and r.json()["status"] == "DISABLED"
    tpl = r.json()
    assert len(tpl["versions"]) == 1  # status never creates a version
    # disabled: still managed and listed for the manager
    listed = (await api.get(URL)).json()["items"]
    assert [t["id"] for t in listed if t["id"] == tpl["id"]] == [tpl["id"]]
    r = await api.delete(f"{URL}/{tpl['id']}", params={"revision": tpl["revision"] - 1})
    assert r.status_code == 409
    assert tpl["deletable"] is True
    r = await api.delete(f"{URL}/{tpl['id']}", params={"revision": tpl["revision"]})
    assert r.status_code == 204
    assert (await api.get(f"{URL}/{tpl['id']}")).status_code == 404
    # the code is free again
    await create(api)
    actions = [a[0] for a in await audits(db)]
    assert {"template.discard", "template.disable", "template.delete"} <= set(actions)


async def test_system_templates_read_only(api, line, db):  # FR-TEMPLATE-001
    await login(api, line)
    items = (await api.get(URL)).json()["items"]
    system = [t for t in items if t["scope"] == "system"]
    assert sorted(t["code"] for t in system) == ["billing_note", "tax_invoice"]
    assert all(not t["can_manage"] and not t["deletable"] for t in system)
    tax = next(t for t in system if t["code"] == "tax_invoice")
    detail = (await api.get(f"{URL}/{tax['id']}")).json()
    assert detail["draft"] is None and detail["grant"] is None and len(detail["versions"]) == 1
    r = await api.put(f"{URL}/{tax['id']}/draft", json={"revision": 1, "content": content()})
    assert r.status_code == 404
    assert (await api.get(f"{URL}/{tax['id']}/export")).status_code == 404
    r = await api.delete(f"{URL}/{tax['id']}", params={"revision": tax["revision"]})
    assert r.status_code == 404


async def test_org_permissions(api, line, db):  # D1
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, default_role = await make_org(db, me["user_id"])
    h = tenant(org)
    tpl = await create(owner, headers=h)
    assert tpl["scope"] == "organization"
    tpl = (await activate(owner, tpl, h)).json()["template"]
    # a member without template_manage reads usable templates but changes nothing
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], default_role)
    listed = (await api.get(URL, headers=h)).json()["items"]
    mine = next(t for t in listed if t["id"] == tpl["id"])
    assert mine["can_manage"] is False
    detail = (await api.get(f"{URL}/{tpl['id']}", headers=h)).json()
    assert detail["draft"] is None
    r = await api.post(URL, json={"content": content(code="m1")}, headers=h)
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    r = await activate(api, tpl, h)
    assert r.status_code == 403
    denied = [a for a in await audits(db) if a[3] == "failure"]
    assert denied and all(a[2].endswith("/permission_denied") for a in denied)
    # a member with template_manage manages
    mgr = client_like(api)
    m2 = await login(mgr, line, "M2")
    role = await make_role(db, org, "Templates", ["template_manage"])
    await add_member(db, org, m2["user_id"], role)
    r = await mgr.put(
        f"{URL}/{tpl['id']}/draft",
        json={"revision": tpl["revision"], "content": content(name="Org PO 2")},
        headers=h,
    )
    assert r.status_code == 200, r.text
    # the personal tenant of the owner does not see the org template
    assert (await owner.get(f"{URL}/{tpl['id']}")).status_code == 404


async def test_guest_cannot_manage(api, db):
    r = await api.post("/api/v1/auth/guest")
    assert r.status_code in (200, 201), r.text
    r = await api.post(URL, json={"content": content()})
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    items = (await api.get(URL)).json()["items"]
    assert all(not t["can_manage"] for t in items)


async def test_pending_confirmations_block_activation(api, line, db):
    """Sample suggestions are confirmed by the editor before activation (FR-TEMPLATE-003)."""
    me = await login(api, line)
    sample_id = "11111111-1111-1111-1111-111111111111"
    await db.execute(
        text(
            "insert into template_samples (id, tenant_id, created_by_user_id, source, status, "
            "expires_at) values (:i, :t, :u, 'UPLOAD', 'READY', now() + interval '1 day')"
        ),
        {"i": sample_id, "t": me["tenant_id"], "u": me["user_id"]},
    )
    await db.commit()
    pending = [{"path": "groups[0].items[0]", "attr": "primary", "value": True}]
    tpl = await create(api, source="sample", sample_id=sample_id, pending_confirmations=pending)
    assert tpl["pending_confirmations"] == pending
    r = await activate(api, tpl)
    assert (r.status_code, r.json()["code"]) == (422, "template_unconfirmed")
    # the editor cannot add new entries, only clear confirmed ones
    more = pending + [{"path": "groups[0]", "attr": "required", "value": True}]
    r = await api.put(
        f"{URL}/{tpl['id']}/draft",
        json={"revision": 1, "content": content(), "pending_confirmations": more},
    )
    assert r.json()["pending_confirmations"] == pending
    r = await api.put(
        f"{URL}/{tpl['id']}/draft",
        json={"revision": 2, "content": content(), "pending_confirmations": []},
    )
    assert r.json()["pending_confirmations"] == []
    assert (await activate(api, r.json())).status_code == 200
    # someone else's or a missing sample is 404
    r = await api.post(
        URL,
        json={
            "content": content(code="x"),
            "source": "sample",
            "sample_id": "22222222-2222-2222-2222-222222222222",
        },
    )
    assert r.status_code == 404


# ---------------------------------------------------------------- admin


async def test_admin_system_template_and_grants(api, line, db):  # FR-TEMPLATE-009
    admin = await admin_client(api, db)
    r = await admin.post(ADMIN, json={"scope": "system", "content": content(code="sys_po")})
    assert r.status_code == 201, r.text
    tpl = r.json()
    assert tpl["scope"] == "system" and tpl["grant"] == {
        "mode": None,
        "plans": [],
        "users": [],
        "organizations": [],
    }
    tpl = (await activate(admin, tpl, base=ADMIN)).json()["template"]
    # no grant: not usable by a tenant
    await login(api, line)
    codes = [t["code"] for t in (await api.get(URL)).json()["items"]]
    assert "sys_po" not in codes
    # PLANS: universal four-plan grant
    r = await admin.put(
        f"{ADMIN}/{tpl['id']}/grants",
        json={
            "revision": tpl["revision"],
            "mode": "PLANS",
            "plans": ["kinder", "starter", "intermediate", "advance"],
        },
    )
    assert r.status_code == 200, r.text
    tpl = r.json()
    assert tpl["grant"]["mode"] == "PLANS" and len(tpl["grant"]["plans"]) == 4
    assert len(tpl["versions"]) == 1  # a grant never creates a version
    codes = [t["code"] for t in (await api.get(URL)).json()["items"]]
    assert "sys_po" in codes
    # stale revision on grants
    r = await admin.put(
        f"{ADMIN}/{tpl['id']}/grants",
        json={"revision": tpl["revision"] - 1, "mode": "PLANS", "plans": ["advance"]},
    )
    assert (r.status_code, r.json()["code"]) == (409, "revision_conflict")
    r = await admin.put(
        f"{ADMIN}/{tpl['id']}/grants",
        json={"revision": tpl["revision"], "mode": "PLANS", "plans": []},
    )
    assert r.status_code == 422
    r = await admin.put(
        f"{ADMIN}/{tpl['id']}/grants",
        json={"revision": tpl["revision"], "mode": "TARGETS", "user_ids": [99999999]},
    )
    assert r.status_code == 422
    actions = [a for a in await audits(db, "template.grant")]
    assert ("template.grant.plans", "admin") == actions[0][:2]
    assert actions[0][2] == f"{tpl['id']}/system/r{tpl['revision']}"


async def test_admin_tenant_scope_and_searches(api, line, db):
    me = await login(api, line, "U1", email="u1@example.com", name="Somchai")
    owner = client_like(api)
    o = await login(owner, line, "OWNER")
    org, _ = await make_org(db, o["user_id"], name="Siam Widgets")
    admin = await admin_client(api, db)
    r = await admin.post(
        ADMIN, json={"scope": "tenant", "tenant_id": org, "content": content(code="org_po")}
    )
    assert r.status_code == 201 and r.json()["scope"] == "organization"
    r = await admin.post(ADMIN, json={"scope": "tenant", "content": content(code="x")})
    assert r.status_code == 422
    r = await admin.post(
        ADMIN, json={"scope": "tenant", "tenant_id": 99999999, "content": content(code="x")}
    )
    assert r.status_code == 404
    listed = (await admin.get(ADMIN, params={"scope": "tenant", "tenant_id": org})).json()
    assert [t["code"] for t in listed["items"]] == ["org_po"]
    assert listed["items"][0]["owner_name"] == "Siam Widgets"
    r = await admin.post(
        ADMIN,
        json={"scope": "tenant", "tenant_id": me["tenant_id"], "content": content(code="mine")},
    )
    assert r.status_code == 201 and r.json()["scope"] == "personal"
    mine = (await admin.get(ADMIN, params={"scope": "tenant", "tenant_id": me["tenant_id"]})).json()
    assert [(t["code"], t["owner_name"]) for t in mine["items"]] == [("mine", "Somchai")]
    system = (await admin.get(ADMIN, params={"scope": "system"})).json()["items"]
    assert {"billing_note", "tax_invoice"} <= {t["code"] for t in system}
    assert {t["owner_name"] for t in system} == {None}
    tax = next(t for t in system if t["code"] == "tax_invoice")
    detail = (await admin.get(f"{ADMIN}/{tax['id']}")).json()
    assert detail["grant"]["mode"] == "PLANS" and len(detail["grant"]["plans"]) == 4
    orgs = await admin.get(f"{ADMIN}/grant-candidates/organizations", params={"q": "widget"})
    assert orgs.json()["items"] == [{"tenant_id": org, "name": "Siam Widgets"}]
    users = await admin.get(f"{ADMIN}/grant-candidates/users", params={"q": str(me["user_id"])})
    assert me["user_id"] in [u["id"] for u in users.json()["items"]]
    owners = (await admin.get(f"{ADMIN}/owners", params={"q": "Siam"})).json()["items"]
    assert {"tenant_id": org, "kind": "organization", "name": "Siam Widgets", "email": None} in (
        owners
    )
    assert (await admin.get(f"{ADMIN}/owners", params={"q": ""})).json()["items"] == []
    # a tenant template has no grants
    tenant_tpl = r = (await admin.get(ADMIN, params={"scope": "tenant", "tenant_id": org})).json()
    t0 = tenant_tpl["items"][0]
    assert (await admin.get(f"{ADMIN}/{t0['id']}")).json()["owner_name"] == "Siam Widgets"
    assert detail["owner_name"] is None
    r = await admin.put(
        f"{ADMIN}/{t0['id']}/grants",
        json={"revision": t0["revision"], "mode": "PLANS", "plans": ["advance"]},
    )
    assert (r.status_code, r.json()["code"]) == (409, "template_not_system")
    # tenant routes are not admin routes
    assert (await api.get(ADMIN)).status_code in (401, 403)


async def test_admin_edit_keeps_copy_of_content(api, line, db):
    """The admin edits through the same lifecycle; system code conflict is per scope."""
    admin = await admin_client(api, db)
    body = copy.deepcopy(content(code="tax_invoice"))
    r = await admin.post(ADMIN, json={"scope": "system", "content": body})
    assert (r.status_code, r.json()["code"]) == (409, "template_code_conflict")
    system = (await admin.get(ADMIN, params={"scope": "system"})).json()["items"]
    tax = next(t for t in system if t["code"] == "tax_invoice")
    exported = (await admin.get(f"{ADMIN}/{tax['id']}/export")).json()
    r = await admin.put(
        f"{ADMIN}/{tax['id']}/draft", json={"revision": tax["revision"], "content": exported}
    )
    assert r.status_code == 200, r.text
    r = await activate(admin, r.json(), base=ADMIN)
    assert r.json()["result"] == "unchanged"  # the seeded hash compares equal
