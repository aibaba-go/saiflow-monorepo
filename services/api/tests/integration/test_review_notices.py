# ruff: noqa: F811  (pytest fixtures imported from test_results)
"""Review notifications: in-app always, email when the organization turned it on, each
email attempted once (FR-SYS-126; review-flow Task 6)."""

from sqlalchemy import text

from app.db import create_sessionmaker
from app.services import review_notice_service
from tests.integration.review_helpers import (
    confirm,
    member,
    org_job,
    review_org,
    set_level,
)
from tests.integration.tenancy_helpers import add_member, make_org, make_role
from tests.integration.test_results import ai_settings, llm, sm  # noqa: F401
from tests.integration.test_reviews import decide

SUBJECT = "SaiFlow: a document is waiting for your review"


async def notices(db, job_id: str) -> list[tuple]:
    return [
        tuple(r)
        for r in (
            await db.execute(
                text(
                    "select n.user_id, n.data->>'level', n.data->>'job_id', r.email_status "
                    "from review_notices r join notifications n on n.id = r.notification_id "
                    "where r.job_id = :j order by n.user_id, r.id"
                ),
                {"j": job_id},
            )
        ).all()
    ]


def review_mails(mail) -> list:
    return [m for m in mail.sent if m.subject == SUBJECT]


async def test_confirm_notifies_l1(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-SYS-126-01: R1b and the owner, not the confirmer R1
    org = await review_org(api, line, mail, db)
    r1b = await member(api, line, mail, "REV1B")
    await add_member(db, org.tenant_id, r1b.user_id, org.roles["r1"])
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.r1, org, store, sm, ai_settings, llm, db)
    await db.execute(
        text("update roles set permissions = :p where id = :r"),
        {"p": ["review_l1", "upload_ocr", "verify_own"], "r": org.roles["r1"]},
    )
    await db.commit()
    r = await confirm(org.r1, org, job["id"])
    assert r.status_code == 200, r.text
    got = await notices(db, job["id"])
    assert {u for u, *_ in got} == {org.owner.user_id, r1b.user_id}
    assert all(level == "1" and jid == job["id"] for _, level, jid, _ in got)
    data = (
        await db.execute(
            text("select data, tenant_id, type from notifications where user_id = :u"),
            {"u": r1b.user_id},
        )
    ).one()
    assert data[2] == "review_pending" and data[1] == org.tenant_id
    assert data[0]["stage"] == "l1" and data[0]["file_name"] and data[0]["confirmer_name"]
    assert data[0]["template_name"].startswith("Tax Invoice") and data[0]["round_no"] == 1


async def test_l1_approval_notifies_l2(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-SYS-126-02
    org = await review_org(api, line, mail, db)
    both = await make_role(db, org.tenant_id, "Both", ["review_l1", "review_l2"])
    await db.execute(
        text("update memberships set role_id = :r where tenant_id = :t and user_id = :u"),
        {"r": both, "t": org.tenant_id, "u": org.r1.user_id},
    )
    await db.commit()
    await set_level(db, org.tenant_id, 2)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    await db.execute(text("delete from review_notices"))
    await db.commit()
    assert (await decide(org.r1, org, job["id"], 1)).status_code == 200
    got = await notices(db, job["id"])
    assert {u for u, *_ in got} == {org.owner.user_id, org.r2.user_id}
    assert all(level == "2" for _, level, _, _ in got)


async def test_email_off_by_default(api, line, mail, store, sm, ai_settings, llm, db, db_engine):
    # AC-FR-SYS-126-03
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    assert {s for *_, s in await notices(db, job["id"])} == {"skipped"}
    sent = await review_notice_service.send_pending(create_sessionmaker(db_engine), mail)
    assert sent == 0 and review_mails(mail) == []


async def _email_org(api, line, mail, store, sm, ai_settings, llm, db):
    org = await review_org(api, line, mail, db)
    await db.execute(
        text("update organizations set review_email_enabled = true where tenant_id = :t"),
        {"t": org.tenant_id},
    )
    await db.commit()
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    return org, job


async def test_email_on_failure_not_retried(
    api, line, mail, store, sm, ai_settings, llm, db, db_engine
):  # AC-FR-SYS-126-04
    org, job = await _email_org(api, line, mail, store, sm, ai_settings, llm, db)
    assert {s for *_, s in await notices(db, job["id"])} == {"pending"}
    mail.fail_with = ConnectionError("smtp down")
    session = create_sessionmaker(db_engine)
    assert await review_notice_service.send_pending(session, mail) == 2  # owner and R1
    assert {s for *_, s in await notices(db, job["id"])} == {"failed"}
    mail.fail_with = None
    assert await review_notice_service.send_pending(session, mail) == 0
    assert review_mails(mail) == []


async def test_email_on_sends_once(api, line, mail, store, sm, ai_settings, llm, db, db_engine):
    org, job = await _email_org(api, line, mail, store, sm, ai_settings, llm, db)
    session = create_sessionmaker(db_engine)
    assert await review_notice_service.send_pending(session, mail) == 2
    assert await review_notice_service.send_pending(session, mail) == 0
    mails = review_mails(mail)
    assert sorted(m.to for m in mails) == ["owner@example.com", "rev1@example.com"]
    assert "Org" in mails[0].body and "Tax Invoice" in mails[0].body
    assert {s for *_, s in await notices(db, job["id"])} == {"sent"}


async def test_no_sender_marks_failed(api, line, mail, store, sm, ai_settings, llm, db, db_engine):
    org, job = await _email_org(api, line, mail, store, sm, ai_settings, llm, db)
    assert await review_notice_service.send_pending(create_sessionmaker(db_engine), None) == 2
    assert {s for *_, s in await notices(db, job["id"])} == {"failed"}


async def test_no_recipient_still_pending(api, line, mail, store, sm, ai_settings, llm, db):
    # Review Focus 5: only the owner, who confirms
    solo = await member(api, line, mail, "ONLY")
    org_id, _ = await make_org(db, solo.user_id)
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            "values (:t, 'starter', 'month', now() - interval '1 day', now() + interval '20 days', "
            "'admin')"
        ),
        {"t": org_id},
    )
    await db.commit()
    from tests.integration.review_helpers import ReviewOrg

    org = ReviewOrg(org_id, solo, solo, solo, solo, {})
    await set_level(db, org_id, 1)
    job = await org_job(solo, org, store, sm, ai_settings, llm, db)
    r = await confirm(solo, org, job["id"])
    assert r.status_code == 200, r.text
    assert r.json()["review"]["stage"] == "PENDING_L1"
    assert await notices(db, job["id"]) == []


async def test_return_and_reconfirm_notifies_again(
    api, line, mail, store, sm, ai_settings, llm, db
):
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    assert (await decide(org.r1, org, job["id"], 1, "return", "fix")).status_code == 200
    await confirm(org.clerk, org, job["id"])
    rounds = (
        await db.execute(
            text(
                "select round_no, count(*) from review_notices where job_id=:j "
                "group by 1 order by 1"
            ),
            {"j": job["id"]},
        )
    ).all()
    assert [tuple(x) for x in rounds] == [(1, 2), (2, 2)]


async def test_notifications_api_lists_review_pending(
    api, line, mail, store, sm, ai_settings, llm, db
):
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    body = (await org.r1.client.get("/api/v1/me/notifications")).json()
    items = [i for i in body["items"] if i["type"] == "review_pending"]
    assert len(items) == 1 and items[0]["data"]["job_id"] == job["id"]
    assert items[0]["tenant_id"] == org.tenant_id
