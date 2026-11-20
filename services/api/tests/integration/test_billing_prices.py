"""line-mini-account Task 1: plan prices and the customer catalog (FR-SYS-030 modified)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import admin_client, client_like, registered_client

pytestmark = pytest.mark.integration

PLANS = "/api/v1/admin/plans"
CATALOG = "/api/v1/billing/plans"


def _prices(rows) -> dict:
    return {p["code"]: (p["monthly_price"], p["yearly_price"]) for p in rows}


async def test_seeded_prices(api, db):  # AC-FR-SYS-030-01
    admin = await admin_client(api, db)
    assert _prices((await admin.get(PLANS)).json()) == {
        "kinder": (None, "888.00"),
        "starter": ("599.00", "5990.00"),
        "intermediate": (None, None),
        "advance": (None, None),
    }


async def test_admin_sets_and_clears_price(api, db):  # AC-FR-SYS-030-06
    admin = await admin_client(api, db)
    r = await admin.patch(f"{PLANS}/intermediate", json={"monthly_price": 1290})
    assert r.status_code == 200 and r.json()["monthly_price"] == "1290.00"
    r = await admin.patch(f"{PLANS}/intermediate", json={"monthly_price": None})
    assert r.status_code == 200 and r.json()["monthly_price"] is None
    prices = _prices((await admin.get(PLANS)).json())
    assert prices["starter"] == ("599.00", "5990.00") and prices["kinder"] == (None, "888.00")


@pytest.mark.parametrize("value", [-1, 1.234, "abc", True, 1e12, "1e3", "", " 5"])
async def test_price_validation_rejects(api, db, value):  # AC-FR-SYS-030-07
    admin = await admin_client(api, db)
    r = await admin.patch(f"{PLANS}/starter", json={"monthly_price": value})
    assert r.status_code == 400 and r.json()["fields"] == ["monthly_price"], value
    row = (await db.execute(text("select monthly_price from plans where code='starter'"))).one()
    assert str(row[0]) == "599.00"


@pytest.mark.parametrize(
    ("value", "stored"), [(599, "599.00"), (599.5, "599.50"), ("599.50", "599.50"), (0, "0.00")]
)
async def test_price_validation_accepts(api, db, value, stored):
    admin = await admin_client(api, db)
    r = await admin.patch(f"{PLANS}/starter", json={"yearly_price": value})
    assert r.status_code == 200 and r.json()["yearly_price"] == stored, value


async def test_customer_catalog(api, db, line, mail):  # AC-FR-SYS-030-08
    guest = client_like(api)
    assert (await guest.post("/api/v1/auth/guest")).status_code == 200
    user, _ = await registered_client(api, line, mail, "U")
    for c in (guest, user):
        r = await c.get(CATALOG)
        assert r.status_code == 200
        rows = r.json()
        assert [p["code"] for p in rows] == ["kinder", "starter", "intermediate", "advance"]
        assert set(rows[0]) == {
            "code",
            "monthly_quota",
            "member_limit",
            "tenant_kind",
            "monthly_price",
            "yearly_price",
        }
        assert _prices(rows)["starter"] == ("599.00", "5990.00")
    assert (await client_like(api).get(CATALOG)).status_code == 401


async def test_price_update_audited(api, db):
    admin = await admin_client(api, db)
    await admin.patch(f"{PLANS}/advance", json={"yearly_price": "99000"})
    count = (
        await db.execute(text("select count(*) from audit_log where action = 'plan.update'"))
    ).scalar_one()
    assert count == 1
