"""Reminder email text (rebuild-notifications, FR-SYS-037; A7: English, like the
verification-code email). In-app notifications carry data only; the frontend words them."""

from datetime import datetime

from app.billing_time import BANGKOK

_DAYS = {"d7": 7, "d3": 3, "d1": 1}
_FOOTER = "To renew or upgrade, open SaiFlow."


def _days(stage: str) -> str:
    n = _DAYS[stage]
    return f"{n} day" if n == 1 else f"{n} days"


def _when(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(BANGKOK).strftime("%Y-%m-%d %H:%M (UTC+7)")


def _plan(data: dict) -> str:
    return str(data.get("plan_code") or "").capitalize()


def render(kind: str, stage: str, data: dict, tenant_label: str) -> tuple[str, str]:
    """(subject, body) for one reminder. tenant_label is the organization's name or
    "your personal account"."""
    if kind == "subscription_expiry":
        if stage == "after":
            subject = "SaiFlow: your plan has expired"
            line = f"The {_plan(data)} plan of {tenant_label} expired on {_when(data['ends_at'])}."
            line += " New scans are paused; your documents can still be viewed and exported."
        else:
            subject = (
                "SaiFlow: your plan expires today"
                if stage == "d0"
                else f"SaiFlow: your plan expires in {_days(stage)}"
            )
            line = f"The {_plan(data)} plan of {tenant_label} ends on {_when(data['ends_at'])}."
    elif kind == "usage":
        remaining, quota = data["remaining"], data["quota"]
        if stage == "low":
            subject = "SaiFlow: less than 20% of this month's scans left"
            line = f"{tenant_label} has {remaining:,} of {quota:,} scans left this month."
        else:
            subject = "SaiFlow: unused scans reset at the end of this month"
            line = (
                f"{tenant_label} has {remaining:,} of {quota:,} scans left this month."
                " Unused scans do not carry over to next month."
            )
    elif kind == "free_quota_expiry":
        subject = (
            "SaiFlow: your organization's free scans expire today"
            if stage == "d0"
            else f"SaiFlow: your organization's free scans expire in {_days(stage)}"
        )
        line = (
            f"{tenant_label} has {data['remaining']:,} free scans left."
            f" They expire on {_when(data['expires_at'])}."
        )
    else:
        raise ValueError(f"unknown reminder kind {kind}")
    return subject, f"Hello,\n\n{line}\n\n{_FOOTER}\n"
