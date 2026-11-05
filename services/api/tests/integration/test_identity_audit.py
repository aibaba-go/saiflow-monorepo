import pytest
from sqlalchemy import text

from tests.integration.test_registration import register

pytestmark = pytest.mark.integration


async def test_identity_audit_trail(api, db, line, mail):  # AC-FR-SYS-003-01
    user = await register(api, line, mail)
    assert (await api.patch("/api/v1/me", json={"display_name": "Changed"})).status_code == 200
    assert (await api.post("/api/v1/auth/logout")).status_code == 204
    rows = (
        await db.execute(
            text(
                "select actor_type, actor_id, action, target_type, result, occurred_at "
                "from audit_log where action <> 'user.email_code' "
                "and action not like 'subscription.%' "
                "and action not like 'free_quota.%' order by id"
            )
        )
    ).all()
    assert [r.action for r in rows] == [
        "customer.login",
        "user.register",
        "user.update_profile",
        "customer.logout",
    ]
    for r in rows:
        assert r.actor_type == "user" and r.actor_id == str(user["user_id"])
        assert r.target_type and r.result == "success" and r.occurred_at is not None
