"""额度计量（PRD v1.4 §20）。

只有一种计量：**OCR_PAGE 月页额度**。没有 Free 档位、没有赠送次数流水——
每个租户默认开通 Kinder 一个月（见 `subscriptions.py`），按套餐的
`quota_pages_per_month` 在泰国自然月内计页；企业租户天然汇总全体成员。

- 订阅非 ACTIVE（到期或企业未认证）→ 不能新建任务（`plan.expired` 硬停）；
- 订阅 ACTIVE 但本月页数用尽 → `QUOTA_EXCEEDED`；
- 页数按 `ocr_jobs.page_count` 实时汇总，FAILED/CANCELLED 不计，
  所以不需要消耗流水与返还逻辑。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func

import subscriptions
from errors import ApiError, quota_exceeded
from extensions import db
from models import OcrJob
from plans import get_plan

logger = logging.getLogger(__name__)

_UNBILLED_STATUSES = ("FAILED", "CANCELLED")


def plan_expired() -> ApiError:
    """套餐已到期/未开通：需人工审批续费后才能继续新建任务。"""
    return ApiError(402, "PLAN_EXPIRED", "plan.expired")


# ---- 月页统计 ----


def _month_start_utc() -> datetime:
    local = datetime.now(subscriptions.BILLING_TZ)
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def pages_used(tenant_id: int) -> int:
    """本月该租户已识别页数（失败/取消的任务不计）；企业租户天然汇总全体成员。"""
    row = db.session.query(
        func.coalesce(func.sum(OcrJob.page_count), 0)
    ).filter(
        OcrJob.created_at >= _month_start_utc(),
        OcrJob.status.notin_(_UNBILLED_STATUSES),
        OcrJob.tenant_id == tenant_id,
    )
    return int(row.scalar() or 0)


def entitled_plan(tenant_id: int, *, commit: bool = True) -> dict | None:
    """有效期内的套餐；到期或未开通返回 None。"""
    sub = subscriptions.state(tenant_id, commit=commit)
    if sub["status"] != "ACTIVE":
        return None
    return {**get_plan(sub["plan_code"]), "source": sub["source"], "expires_at": sub["expires_at"]}


def pages_view(plan: dict, tenant_id: int) -> dict:
    total = plan["quota_pages_per_month"]
    return {"monthly_total": total, "remaining": max(total - pages_used(tenant_id), 0)}


# ---- 新建任务门禁（随任务事务提交） ----


def check_and_consume(job) -> None:
    """门禁：订阅必须 ACTIVE 且本月页数未用尽（不写流水，页数即消耗）。"""
    active = entitled_plan(job.tenant_id, commit=False)
    if active is None:
        raise plan_expired()
    if pages_view(active, job.tenant_id)["remaining"] <= 0:
        raise quota_exceeded()


# ---- 汇总（/me/quota） ----


def quota_summary(user) -> list[dict]:
    """当前有效租户的额度视图（含默认开通自愈）。"""
    from workspace import list_tenants

    items: list[dict] = []
    for tenant in list_tenants(user):
        tid = tenant["tenant_id"]
        sub = subscriptions.state(tid)
        active = sub["status"] == "ACTIVE"
        plan = get_plan(sub["plan_code"]) if sub["plan_code"] else None
        items.append(
            {
                "tenant_id": tid,
                "tenant_type": tenant["tenant_type"],
                "name": tenant["name"],
                "plan": {
                    "code": sub["plan_code"],
                    "name": sub["plan_name"],
                    "is_paid": sub["source"] == "APPROVED",
                    "source": sub["source"],
                    "metering": "OCR_PAGE",
                },
                "subscription": {
                    "status": sub["status"],
                    "starts_at": sub["starts_at"],
                    "expires_at": sub["expires_at"],
                    "days_remaining": sub["days_remaining"],
                },
                "pages": pages_view(plan, tid) if active and plan else {
                    "monthly_total": plan["quota_pages_per_month"] if plan else 0,
                    "remaining": 0,
                },
            }
        )
    return items
