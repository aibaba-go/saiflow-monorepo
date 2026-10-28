"""套餐目录与套餐升级/续费申请（PRD v1.4 §20.1 / §14，FR-SYS-011/012/013）。

支付完全线下（联系销售）：申请仅登记意向工单（applications.type=PLAN_UPGRADE），
由后台人工审核开通（APPROVED 即视为已购买/已续费），无下单、无回调、无在线支付。
审批时在 form.valid_from / valid_to 写有效期，订阅状态由 subscriptions.py 据此同步。

订阅按租户计：applications.target_tenant_id 既可以是个人租户（本人专属），
也可以是企业租户（任一成员提交，全体成员共享），查询只需单条件。
"""
from __future__ import annotations

from flask import Blueprint, request

import subscriptions
from auth import audit, current_user, notify
from errors import auth_required, invalid_argument, ok, permission_denied, state_conflict
from extensions import db
from models import Application, Membership, Tenant, _now
from plans import PLAN_CATALOG
from workspace import resolve_tenant

bp = Blueprint("plans", __name__)

PLAN_UPGRADE = "PLAN_UPGRADE"
_PLAN_MANAGER_ROLES = ("OWNER",)


def plan_rank(code: str | None) -> int:
    return next((i for i, p in enumerate(PLAN_CATALOG) if p["code"] == code), -1)


def subscription_state(tenant_id: int, *, commit: bool = True) -> dict:
    """兼容入口：租户当前权益与有效期（实现见 subscriptions.state）。"""
    return subscriptions.state(tenant_id, commit=commit)



def _can_manage_plan(user_id: int, tenant: Tenant) -> bool:
    """个人租户本人恒可管理；企业租户只有 ACTIVE OWNER 能管。"""
    if tenant.tenant_type == "PERSONAL":
        return True
    m = Membership.query.filter_by(tenant_id=tenant.id, user_id=user_id, status="ACTIVE").first()
    return m is not None and m.role in _PLAN_MANAGER_ROLES


def _tenant_view(user_id: int, tenant: Tenant) -> dict:
    return {
        **subscription_state(tenant.id),
        "tenant_id": tenant.id,
        "tenant_type": tenant.tenant_type,
        "can_manage": _can_manage_plan(user_id, tenant),
    }


@bp.get("/plans")
def list_plans():
    return ok(
        {
            "currency": "THB",
            "payment": "OFFLINE",
            "items": PLAN_CATALOG,
        }
    )


@bp.get("/me/subscription")
def me_subscription():
    user = current_user()
    tenant = resolve_tenant(user, request.args.get("tenant_id"))
    return ok(_tenant_view(user.id, tenant))


@bp.post("/me/plan-applications")
def submit_plan_application():
    user = current_user()
    if user.is_guest:
        raise auth_required()

    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        raise invalid_argument()
    code = body.get("plan_code")
    plan = next((p for p in PLAN_CATALOG if p["code"] == code), None)
    if plan is None:
        raise invalid_argument(field_errors=[{"field": "plan_code", "reason": "invalid"}])

    raw_tid = body.get("tenant_id")
    if raw_tid is not None and (not isinstance(raw_tid, int) or isinstance(raw_tid, bool)):
        raise invalid_argument(field_errors=[{"field": "tenant_id", "reason": "invalid"}])
    tenant = resolve_tenant(user, raw_tid)
    if not _can_manage_plan(user.id, tenant):
        raise permission_denied("plan.enterprise_owner_only")

    state = subscription_state(tenant.id)
    if state["pending"]:
        raise state_conflict("plan.application_pending")
    # 有有效期后「同档续费」是正常诉求：只拦截降档（到期/未开通时任意档位都可申请）
    if state["status"] == "ACTIVE" and plan_rank(plan["code"]) < plan_rank(state["plan_code"]):
        raise state_conflict("plan.not_upgrade")

    row = Application(
        type=PLAN_UPGRADE,
        applicant_user_id=user.id,
        target_tenant_id=tenant.id,
        form={
            "plan_code": plan["code"],
            "plan_name": plan["name"],
            "tenant_id": tenant.id,
            "tenant_type": tenant.tenant_type,
            # 人工审批时填写有效期；留空则按 plans.APPROVED_PERIOD_MONTHS 续期
            "valid_from": "",
            "valid_to": "",
        },
        status="SUBMITTED",
        submitted_at=_now(),
    )
    db.session.add(row)
    db.session.commit()
    audit(
        "plan_application.submit",
        "application",
        str(row.id),
        {"plan_code": plan["code"], "tenant_id": tenant.id, "tenant_type": tenant.tenant_type},
    )
    notify(user.id, "PLAN_UPGRADE_SUBMITTED", "Plan upgrade request received", plan["name"])
    return ok(_tenant_view(user.id, tenant), status=201)
