"""rebuild-notifications Task 3: reminder email text (A7: English)."""

import pytest

from app.reminder_mail import render

END = "2026-12-10T03:00:00+00:00"

SUBJECTS = [
    ("subscription_expiry", "d7", "SaiFlow: your plan expires in 7 days"),
    ("subscription_expiry", "d3", "SaiFlow: your plan expires in 3 days"),
    ("subscription_expiry", "d1", "SaiFlow: your plan expires in 1 day"),
    ("subscription_expiry", "d0", "SaiFlow: your plan expires today"),
    ("subscription_expiry", "after", "SaiFlow: your plan has expired"),
    ("usage", "low", "SaiFlow: less than 20% of this month's scans left"),
    ("usage", "month_end", "SaiFlow: unused scans reset at the end of this month"),
    ("free_quota_expiry", "d7", "SaiFlow: your organization's free scans expire in 7 days"),
    ("free_quota_expiry", "d3", "SaiFlow: your organization's free scans expire in 3 days"),
    ("free_quota_expiry", "d1", "SaiFlow: your organization's free scans expire in 1 day"),
    ("free_quota_expiry", "d0", "SaiFlow: your organization's free scans expire today"),
]


@pytest.mark.parametrize(("kind", "stage", "subject"), SUBJECTS)
def test_render_subjects(kind, stage, subject):
    data = {
        "stage": stage,
        "plan_code": "starter",
        "ends_at": END,
        "expires_at": END,
        "remaining": 42,
        "quota": 5000,
        "used": 4958,
        "month": "2026-12-01",
    }
    got_subject, body = render(kind, stage, data, "Siam Tools")
    assert got_subject == subject
    assert "Siam Tools" in body
    assert body.rstrip().endswith("To renew or upgrade, open SaiFlow.")


def test_expiry_body_has_plan_and_bangkok_time():
    _, body = render(
        "subscription_expiry",
        "d3",
        {"stage": "d3", "plan_code": "starter", "ends_at": END},
        "your personal account",
    )
    assert "Starter" in body and "2026-12-10 10:00 (UTC+7)" in body


def test_usage_and_free_quota_bodies_have_remaining():
    _, usage = render(
        "usage",
        "low",
        {"stage": "low", "plan_code": "kinder", "quota": 1000, "used": 850, "remaining": 150},
        "your personal account",
    )
    assert "150" in usage and "1,000" in usage
    _, free = render(
        "free_quota_expiry", "d1", {"stage": "d1", "remaining": 60, "expires_at": END}, "Org"
    )
    assert "60" in free and "2026-12-10 10:00 (UTC+7)" in free
