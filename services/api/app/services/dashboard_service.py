from app.billing_time import month_key
from app.clock import utcnow
from app.config import Settings
from app.ocr.states import STAGES
from app.services.data_source_connection import system_report_rows
from app.services.tenant_access import TenantContext, submitter_scope

SCOPED_JOBS = """SELECT * FROM reporting.jobs
WHERE tenant_id = %(tenant_id)s
AND (%(user_id)s::bigint IS NULL OR created_by_user_id = %(user_id)s)"""
COUNTS_SQL = f"SELECT stage, count(*) AS total FROM ({SCOPED_JOBS}) j GROUP BY stage"
RECENT_SQL = f"""SELECT id, original_name, stage, created_at FROM ({SCOPED_JOBS}) j
ORDER BY created_at DESC, id DESC LIMIT 5"""
USAGE_SQL = """WITH latest AS (
  SELECT s.plan_code, s.ends_at, p.monthly_quota FROM reporting.subscriptions s
  JOIN reporting.plans p ON p.code = s.plan_code
  WHERE s.tenant_id = %(tenant_id)s AND s.starts_at <= %(now)s
  ORDER BY s.starts_at DESC LIMIT 1
), active AS (SELECT * FROM latest WHERE ends_at > %(now)s), used AS (
  SELECT coalesce(sum(from_monthly), 0) AS total FROM reporting.quota_reservations
  WHERE tenant_id = %(tenant_id)s AND month = %(month)s AND released_at IS NULL
), free AS (
  SELECT remaining, expires_at FROM reporting.free_quotas WHERE tenant_id = %(tenant_id)s
)
SELECT (SELECT plan_code FROM latest) AS plan_code, (SELECT ends_at FROM latest) AS ends_at,
EXISTS (SELECT 1 FROM active) AS plan_active,
coalesce((SELECT monthly_quota FROM active), 0) AS quota,
(SELECT total FROM used) AS used,
coalesce((SELECT CASE WHEN %(kind)s = 'personal' OR expires_at IS NULL OR expires_at > %(now)s
  THEN remaining ELSE 0 END FROM free), 0) AS free_remaining,
(SELECT expires_at FROM free) AS free_expires_at,
(%(kind)s = 'personal' AND NOT EXISTS (SELECT 1 FROM active)
  AND coalesce((SELECT remaining FROM free), 0) > 0) AS free_paused"""


def configuration(kind: str) -> dict:
    progress_width = 5 if kind == "personal" else 7
    cards = [
        {"id": stage, "type": "metric", "layout": {"x": i * 3, "y": 0, "w": 3, "h": 2}}
        for i, stage in enumerate(("VERIFYING", "OCR_PROCESSING", "PENDING_REVIEW", "CONFIRMED"))
    ]
    cards.extend(
        [
            {
                "id": "progress",
                "type": "bar",
                "layout": {"x": 0, "y": 2, "w": progress_width, "h": 4},
            },
            {
                "id": "usage",
                "type": "metric",
                "layout": {"x": progress_width, "y": 2, "w": 12 - progress_width, "h": 4},
            },
            {"id": "recent", "type": "table", "layout": {"x": 0, "y": 6, "w": 12, "h": 4}},
        ]
    )
    return {"version": 2, "grid": {"cols": 12, "row_height": 80}, "cards": cards}


async def read(settings: Settings, ctx: TenantContext) -> dict:
    now = utcnow()
    params = {
        "tenant_id": ctx.tenant_id,
        "user_id": submitter_scope(ctx),
        "kind": ctx.kind,
        "now": now,
        "month": month_key(now),
    }
    counts = {stage: 0 for stage in STAGES}
    for row in await system_report_rows(settings, COUNTS_SQL, params):
        counts[row["stage"]] = row["total"]
    recent = await system_report_rows(settings, RECENT_SQL, params)
    for row in recent:
        row["id"] = str(row["id"])
    usage = (await system_report_rows(settings, USAGE_SQL, params))[0]
    usage["remaining"] = max(usage["quota"] - usage["used"], 0)
    return {
        "kind": ctx.kind,
        "config": configuration(ctx.kind),
        "counts": counts,
        "usage": usage,
        "recent": recent,
        "generated_at": now,
    }
