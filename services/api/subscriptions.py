"""租户订阅与有效期（FR-SYS-012/013）。

规则只有一条口径：**每个租户都有且只有一行订阅**。

- 个人租户（含游客）建租户即默认开通 Kinder 一个月，`source=DEFAULT`；
- 企业租户在 `enterprises.status=VERIFIED` 后按 `verified_at` 起算一个月；
- 没有 Free 档位、没有赠送次数：到期即硬停，不能再新建 OCR 任务，
  已有任务与历史结果仍可查看导出；
- 续费走线下人工审批：把 `PLAN_UPGRADE` 申请置为 `APPROVED`，并在
  `form.valid_from / valid_to` 写明有效期；本模块读取订阅时按
  `application_id` 惰性同步，没写日期就按 `APPROVED_PERIOD_MONTHS` 续。

发放与续期都是幂等的：`subscriptions.tenant_id` 唯一，重复创建由唯一约束
兜住；续期只在 `application_id` 发生变化时执行一次。
"""
from __future__ import annotations

import calendar
import logging

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError

from extensions import db
from models import Application, Enterprise, Subscription, Tenant, _now
from plans import (
    APPROVED_PERIOD_MONTHS,
    DEFAULT_PERIOD_MONTHS,
    DEFAULT_PLAN_CODE,
    PLAN_CATALOG,
    get_plan,
)

logger = logging.getLogger(__name__)

# 到期日按泰国时间（UTC+7）的自然日计算，与月页额度同一时区口径
BILLING_TZ = timezone(timedelta(hours=7))

PLAN_UPGRADE = "PLAN_UPGRADE"
_OPEN_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO")


# ---- 时间计算 ----


def add_months(moment: datetime, months: int) -> datetime:
    """加自然月；目标月没有该日号时落在该月最后一天（1/31 + 1 月 → 2/28）。"""
    total = moment.month - 1 + months
    year = moment.year + total // 12
    month = total % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def local_date(moment: datetime) -> date:
    """UTC naive 时间 → 泰国自然日。"""
    return moment.replace(tzinfo=timezone.utc).astimezone(BILLING_TZ).date()


def days_remaining(expires_at: datetime, *, now: datetime | None = None) -> int:
    """剩余自然日：今天到期返回 0，已过期返回负数。"""
    return (local_date(expires_at) - local_date(now or _now())).days


def plan_name(code: str) -> str:
    return next((p["name"] for p in PLAN_CATALOG if p["code"] == code), get_plan(code)["name"])


# ---- 默认开通 ----


def _start_for(tenant: Tenant) -> datetime | None:
    """本期起算时间；企业未认证返回 None（不开通，也不提醒）。"""
    if tenant.tenant_type == "PERSONAL":
        return tenant.created_at or _now()
    enterprise = Enterprise.query.filter_by(tenant_id=tenant.id).first()
    if enterprise is None or enterprise.status != "VERIFIED":
        return None
    if enterprise.verified_at is None:
        # 企业认证是人工改 status 的流程，没有状态翻转钩子：首次看到 VERIFIED 时补填
        enterprise.verified_at = _now()
        db.session.flush()
    return enterprise.verified_at


def ensure_subscription(tenant: Tenant, *, commit: bool = False) -> Subscription | None:
    """幂等返回租户订阅；首次调用按默认规则开通一个月。企业未认证返回 None。"""
    row = Subscription.query.filter_by(tenant_id=tenant.id).first()
    if row is not None:
        return _sync_approved(row, commit=commit)

    starts_at = _start_for(tenant)
    if starts_at is None:
        return None
    row = Subscription(
        tenant_id=tenant.id,
        plan_code=DEFAULT_PLAN_CODE,
        source="DEFAULT",
        starts_at=starts_at,
        expires_at=add_months(starts_at, DEFAULT_PERIOD_MONTHS),
    )
    db.session.add(row)
    try:
        db.session.flush()
    except IntegrityError:  # 并发首次访问：另一请求已开通
        db.session.rollback()
        existing = Subscription.query.filter_by(tenant_id=tenant.id).first()
        return _sync_approved(existing, commit=commit) if existing else None
    logger.info("默认开通 Kinder tenant=%s 至 %s", tenant.id, row.expires_at)
    if commit:
        db.session.commit()
    return _sync_approved(row, commit=commit)


# ---- 人工审批续期 ----


def _parse_moment(value) -> datetime | None:
    """接受 YYYY-MM-DD 或 ISO 时间串（人工填写，容忍末尾 Z）。"""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        logger.warning("审批有效期无法解析，按默认月数处理：%r", value)
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _latest_approved(tenant_id: int) -> Application | None:
    return (
        Application.query.filter(
            Application.type == PLAN_UPGRADE,
            Application.status == "APPROVED",
            Application.target_tenant_id == tenant_id,
        )
        .order_by(Application.updated_at.desc(), Application.id.desc())
        .first()
    )


def _sync_approved(row: Subscription, *, commit: bool = False) -> Subscription:
    """把最近一条 APPROVED 申请写进订阅（每条申请只生效一次）。"""
    approved = _latest_approved(row.tenant_id)
    if approved is None or row.application_id == approved.id:
        return row
    form = approved.form or {}
    now = _now()
    starts_at = _parse_moment(form.get("valid_from"))
    if starts_at is None:
        # 未到期就续费：从当期到期日接续，不浪费剩余天数
        starts_at = max(now, row.expires_at)
    expires_at = _parse_moment(form.get("valid_to"))
    if expires_at is None:
        months = form.get("period_months")
        months = months if isinstance(months, int) and 1 <= months <= 120 else APPROVED_PERIOD_MONTHS
        expires_at = add_months(starts_at, months)
    row.plan_code = form.get("plan_code") or row.plan_code
    row.source = "APPROVED"
    row.starts_at = starts_at
    row.expires_at = expires_at
    row.application_id = approved.id
    logger.info(
        "审批续期 tenant=%s application=%s plan=%s 至 %s",
        row.tenant_id, approved.id, row.plan_code, expires_at,
    )
    if commit:
        db.session.commit()
    return row


# ---- 对外状态 ----


def _pending(tenant_id: int) -> Application | None:
    return (
        Application.query.filter(
            Application.type == PLAN_UPGRADE,
            Application.status.in_(_OPEN_STATUSES),
            Application.target_tenant_id == tenant_id,
        )
        .order_by(Application.updated_at.desc())
        .first()
    )


def _brief(row: Application | None) -> dict:
    form = (row.form or {}) if row else {}
    return {
        "plan_code": form.get("plan_code"),
        "plan_name": form.get("plan_name"),
        "application_id": row.id if row else None,
        "submitted_at": row.submitted_at.isoformat() if row and row.submitted_at else None,
    }


def state(tenant_id: int, *, commit: bool = True) -> dict:
    """租户当前权益：ACTIVE / EXPIRED / NONE（企业未认证），pending 独立保留。

    status 只表达「现在能不能用」：pending 申请既不提升也不降低当前权益，
    前端在 status != ACTIVE 且有 pending 时才走「处理中」分流。
    """
    tenant = db.session.get(Tenant, tenant_id)
    row = ensure_subscription(tenant, commit=commit) if tenant is not None else None
    pending = _pending(tenant_id)
    if row is None:
        return {
            "status": "NONE",
            "plan_code": None,
            "plan_name": None,
            "source": None,
            "application_id": None,
            "starts_at": None,
            "expires_at": None,
            "days_remaining": None,
            "pending": _brief(pending) if pending else None,
        }
    left = days_remaining(row.expires_at)
    return {
        "status": "ACTIVE" if row.expires_at > _now() else "EXPIRED",
        "plan_code": row.plan_code,
        "plan_name": plan_name(row.plan_code),
        "source": row.source,
        "application_id": row.application_id,
        "starts_at": row.starts_at.isoformat() if row.starts_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "days_remaining": left,
        "pending": _brief(pending) if pending else None,
    }
