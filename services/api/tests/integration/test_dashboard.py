import pytest
from pydantic import SecretStr
from sqlalchemy import text

from tests.integration.report_helpers import formal, join, report_org

pytestmark = pytest.mark.integration


async def test_real_default_dashboard_uses_scoped_reporter_queries(api, line, db, migrated_db):
    org = await report_org(api, line, db)
    member = await join(api, line, db, org, "MEMBER", [])
    own = await formal(db, org, member.user_id, {})
    other = await formal(db, org, org.owner.user_id, {})
    await db.execute(text("delete from subscriptions where tenant_id = :t"), {"t": org.tenant_id})
    await db.execute(
        text("update users set registered_at = now() where id in (:u, :v)"),
        {"u": member.user_id, "v": org.owner.user_id},
    )
    await db.commit()
    api.app.state.settings.report_db_password = SecretStr("local-reporter")
    mine = await member.client.get("/api/v1/me/dashboard", headers=org.h)
    assert mine.status_code == 200, mine.text
    assert mine.json()["counts"]["CONFIRMED"] == 1
    assert [row["id"] for row in mine.json()["recent"]] == [own.id]
    all_jobs = await org.owner.client.get("/api/v1/me/dashboard", headers=org.h)
    assert all_jobs.status_code == 200, all_jobs.text
    assert all_jobs.json()["counts"]["CONFIRMED"] == 2
    assert {row["id"] for row in all_jobs.json()["recent"]} == {own.id, other.id}
    personal = await member.client.get("/api/v1/me/dashboard")
    assert personal.status_code == 200, personal.text
    assert personal.json()["kind"] == "personal"
    assert personal.json()["recent"] == []
    for client, headers, result in [
        (org.owner.client, org.h, all_jobs),
        (member.client, {}, personal),
    ]:
        usage = (await client.get("/api/v1/billing/usage", headers=headers)).json()
        card = result.json()["usage"]
        assert card["free_remaining"] == usage["free"]["remaining"]
        assert card["free_expires_at"] == usage["free"]["expires_at"]
        assert card["free_paused"] == usage["free"]["paused"]
        assert card["quota"] == usage["month"]["quota"]
    assert "local-reporter" not in all_jobs.text
    assert "SELECT" not in all_jobs.text
    await member.client.aclose()
    await org.owner.client.aclose()
