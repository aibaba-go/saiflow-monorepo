from contextlib import aclosing

import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import admin_client, client_like, make_org, mount_items

pytestmark = pytest.mark.integration
EMAIL = "new@example.com"
PASSWORD = "SafePass123"


async def create(admin, email=EMAIL):
    response = await admin.post(
        "/api/v1/admin/users",
        json={"email": email, "display_name": "New User", "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_admin_create_defaults_and_email_login(api, db):
    async with aclosing(await admin_client(api, db)) as admin:
        user = await create(admin, " NEW@Example.COM ")
        assert user["email"] == EMAIL and user["registered"] and not user["line_linked"]
        assert (await create(admin, "second@example.com"))["user_id"] != user["user_id"]
        duplicate = await admin.post(
            "/api/v1/admin/users",
            json={"email": EMAIL, "display_name": "Dup", "password": PASSWORD},
        )
        assert duplicate.status_code == 409 and duplicate.json()["code"] == "email_taken"
    await db.rollback()
    uid, tid = user["user_id"], user["personal_tenant_id"]
    row = (
        await db.execute(
            text("select line_user_id, password_hash from users where id=:u"), {"u": uid}
        )
    ).one()
    assert row.line_user_id is None and row.password_hash != PASSWORD
    subscription = (
        await db.execute(
            text("select plan_code, source from subscriptions where tenant_id=:t"), {"t": tid}
        )
    ).one()
    assert tuple(subscription) == ("kinder", "auto")
    quota = (
        await db.execute(
            text("select granted, remaining from free_quotas where tenant_id=:t"), {"t": tid}
        )
    ).one()
    assert quota.granted == quota.remaining == 100
    async with client_like(api) as customer:
        response = await customer.post(
            "/api/v1/auth/password", json={"email": EMAIL, "password": PASSWORD}
        )
        assert response.status_code == 200, response.text
        assert (response.json()["user_id"], response.json()["tenant_id"]) == (uid, tid)
        assert not response.json()["line_linked"]


async def test_create_delete_require_admin_and_csrf(api, db):
    body = {"email": EMAIL, "display_name": "New", "password": PASSWORD}
    assert (await api.post("/api/v1/admin/users", json=body)).status_code == 401
    assert (await api.delete("/api/v1/admin/users/1")).status_code == 401
    async with aclosing(await admin_client(api, db)) as admin:
        user = await create(admin)
        admin.headers.pop("X-Requested-With")
        for response in (
            await admin.post("/api/v1/admin/users", json=body),
            await admin.delete(f"/api/v1/admin/users/{user['user_id']}"),
        ):
            assert response.status_code == 403 and response.json()["code"] == "csrf_header_missing"


async def test_delete_empty_account_invalidates_sessions_preserves_audit(api, db):
    async with aclosing(await admin_client(api, db)) as admin, client_like(api) as customer:
        user = await create(admin)
        uid, tid = user["user_id"], user["personal_tenant_id"]
        assert (
            await customer.post(
                "/api/v1/auth/password", json={"email": EMAIL, "password": PASSWORD}
            )
        ).status_code == 200
        response = await admin.delete(f"/api/v1/admin/users/{uid}")
        assert response.status_code == 204, response.text
        assert (await customer.get("/api/v1/me")).status_code == 401
        assert (await admin.delete(f"/api/v1/admin/users/{uid}")).status_code == 404
    await db.rollback()
    assert not (await db.execute(text("select id from users where id=:u"), {"u": uid})).all()
    assert not (await db.execute(text("select id from tenants where id=:t"), {"t": tid})).all()
    actions = (
        (
            await db.execute(
                text("select action from audit_log where target_type='user' and target_id=:u"),
                {"u": str(uid)},
            )
        )
        .scalars()
        .all()
    )
    assert "admin.user.create" in actions and "admin.user.delete" in actions


@pytest.mark.parametrize(
    "association,error",
    [
        ("organization", "user_has_organization"),
        ("business", "user_has_data"),
        ("quota", "user_has_data"),
        ("billing", "user_has_billing"),
    ],
)
async def test_delete_protects_associations(api, db, association, error):
    async with aclosing(await admin_client(api, db)) as admin:
        user = await create(admin)
        uid, tid = user["user_id"], user["personal_tenant_id"]
        if association == "organization":
            await make_org(db, uid)
        elif association == "business":
            mount_items(api)
            async with client_like(api) as customer:
                await customer.post(
                    "/api/v1/auth/password", json={"email": EMAIL, "password": PASSWORD}
                )
                response = await customer.post(
                    "/api/v1/_test/items?label=protected", headers={"X-Tenant-Id": str(tid)}
                )
                assert response.status_code == 200, response.text
        elif association == "quota":
            await db.execute(
                text("update free_quotas set remaining=remaining-1 where tenant_id=:t"), {"t": tid}
            )
            await db.commit()
        else:
            await db.execute(
                text("update subscriptions set source='admin' where tenant_id=:t"), {"t": tid}
            )
            await db.commit()
        response = await admin.delete(f"/api/v1/admin/users/{uid}")
        assert response.status_code == 409 and response.json()["code"] == error, response.text
    await db.rollback()
    assert (
        await db.execute(text("select id from users where id=:u"), {"u": uid})
    ).scalar_one() == uid


async def test_link_password_preserves_identity_for_email_and_line(api, db, line):
    async with aclosing(await admin_client(api, db)) as admin:
        user = await create(admin)
    line.add("real-token", "real-sub", email="different@example.com")
    async with client_like(api) as customer:
        response = await customer.post(
            "/api/v1/auth/line-link",
            json={"id_token": "real-token", "email": EMAIL, "password": PASSWORD},
        )
        assert response.status_code == 200, response.text
        linked = response.json()
        assert linked["line_linked"] and linked["email"] == EMAIL
        assert (
            linked["user_id"] == user["user_id"]
            and linked["tenant_id"] == user["personal_tenant_id"]
        )
        assert (await login(customer, line, "real-sub"))["user_id"] == user["user_id"]
    await db.rollback()
    assert (await db.execute(text("select count(*) from users"))).scalar_one() == 1


async def test_link_email_code_single_use_and_wrong_password_lock(api, db, line, mail):
    async with aclosing(await admin_client(api, db)) as admin:
        await create(admin)
    line.add("real-token", "real-sub")
    async with client_like(api) as customer:
        body = {"id_token": "real-token", "email": EMAIL, "password": "WrongPass123"}
        for _ in range(5):
            response = await customer.post("/api/v1/auth/line-link", json=body)
            assert response.status_code == 401 and response.json()["code"] == "password_invalid"
        assert (
            await customer.post("/api/v1/auth/line-link", json={**body, "password": PASSWORD})
        ).status_code == 423
        assert (
            await customer.post(
                "/api/v1/auth/email-code", json={"email": EMAIL, "purpose": "login"}
            )
        ).status_code == 204
        proof = {"id_token": "real-token", "email": EMAIL, "email_code": mail.sent[-1].code}
        response = await customer.post("/api/v1/auth/line-link", json=proof)
        assert response.status_code == 200 and response.json()["line_linked"], response.text
        response = await customer.post("/api/v1/auth/line-link", json=proof)
        assert response.status_code == 400 and response.json()["fields"] == ["email_code"]


async def test_link_conflict_does_not_merge_accounts(api, db, line):
    async with aclosing(await admin_client(api, db)) as admin:
        user = await create(admin)
    owner = await login(api, line, "taken")
    line.add("taken-token", "taken", email=EMAIL)
    async with client_like(api) as customer:
        response = await customer.post(
            "/api/v1/auth/line-link",
            json={"id_token": "taken-token", "email": EMAIL, "password": PASSWORD},
        )
        assert response.status_code == 409 and response.json()["code"] == "line_already_linked"
        assert (await customer.get("/api/v1/me")).status_code == 401
    await db.rollback()
    assert (
        await db.execute(text("select line_user_id from users where id=:u"), {"u": user["user_id"]})
    ).scalar_one() is None
    assert owner["user_id"] != user["user_id"]
    assert (await db.execute(text("select count(*) from users"))).scalar_one() == 2


async def test_link_requires_real_line_and_csrf(api, db, line):
    async with aclosing(await admin_client(api, db)) as admin:
        await create(admin)
    async with client_like(api) as customer:
        response = await customer.post(
            "/api/v1/auth/line-link",
            json={"id_token": "fake-token", "email": EMAIL, "password": PASSWORD},
        )
        assert response.status_code == 401 and response.json()["code"] == "line_token_invalid"
        customer.headers.pop("X-Requested-With")
        assert (await customer.post("/api/v1/auth/line-link", json={})).status_code == 403


async def test_link_impersonation_cannot_supply_customer_proof(api, db, line):
    from tests.integration.test_impersonation import configure, enter, issue

    configure(api)
    async with aclosing(await admin_client(api, db)) as admin:
        user = await create(admin)
        ticket = await issue(admin, user["user_id"])
        customer, _ = await enter(api, ticket)
        async with aclosing(customer):
            line.add("real-token", "real-sub")
            response = await customer.post(
                "/api/v1/auth/line-link",
                json={"id_token": "real-token", "email": EMAIL, "password": PASSWORD},
            )
            assert (
                response.status_code == 403
                and response.json()["code"] == "impersonation_link_forbidden"
            )
