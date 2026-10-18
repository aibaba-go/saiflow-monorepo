"""套餐目录与套餐升级申请（PRD v1.4 §20.1 / §14，FR-SYS-011/012/013）。

支付完全线下（联系销售）：申请仅登记意向工单（applications.type=PLAN_UPGRADE），
由后台人工审核开通（APPROVED 即视为已购买），无下单、无回调、无在线支付。

订阅按工作空间计：个人空间 = 本人提交且 target_enterprise_id 为空的申请；
企业空间 = target_enterprise_id 为该企业的申请（任一成员提交，全体成员共享）。
"""
from __future__ import annotations

from flask import Blueprint, request

from auth import audit, current_user, notify
from errors import auth_required, invalid_argument, ok, permission_denied, state_conflict
from extensions import db
from models import Application, Membership, _now
from plans import PLAN_CATALOG
from workspace import resolve_workspace

bp = Blueprint("plans", __name__)

PLAN_UPGRADE = "PLAN_UPGRADE"
_OPEN_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO")
_PLAN_MANAGER_ROLES = ("OWNER",)


def plan_rank(code: str | None) -> int:
    return next((i for i, p in enumerate(PLAN_CATALOG) if p["code"] == code), -1)


def _brief(row: Application | None) -> dict:
    form = (row.form or {}) if row else {}
    return {
        "plan_code": form.get("plan_code"),
        "plan_name": form.get("plan_name"),
        "application_id": row.id if row else None,
        "submitted_at": row.submitted_at.isoformat() if row and row.submitted_at else None,
    }


def subscription_state(user_id: int, enterprise_id: int | None = None) -> dict:
    """ACTIVE=已开通（取已批准的最高档）/ PENDING=仅有申请处理中 / NONE=未申请；pending 为处理中的申请。"""
    query = Application.query.filter(
        Application.type == PLAN_UPGRADE,
        Application.status.in_(("APPROVED", *_OPEN_STATUSES)),
    )
    if enterprise_id is None:
        query = query.filter(
            Application.applicant_user_id == user_id,
            Application.target_enterprise_id.is_(None),
        )
    else:
        query = query.filter(Application.target_enterprise_id == enterprise_id)
    rows = query.order_by(Application.updated_at.desc()).all()
    approved = [a for a in rows if a.status == "APPROVED"]
    active = max(approved, key=lambda a: plan_rank((a.form or {}).get("plan_code"))) if approved else None
    pending = next((a for a in rows if a.status in _OPEN_STATUSES), None)
    status = "ACTIVE" if active else "PENDING" if pending else "NONE"
    return {
        "status": status,
        **_brief(active or pending),
        "pending": _brief(pending) if pending else None,
    }


def _can_manage_plan(user_id: int, enterprise_id: int | None) -> bool:
    if enterprise_id is None:
        return True
    m = Membership.query.filter_by(enterprise_id=enterprise_id, user_id=user_id, status="ACTIVE").first()
    return m is not None and m.role in _PLAN_MANAGER_ROLES


def _workspace_view(user_id: int, enterprise_id: int | None) -> dict:
    return {
        **subscription_state(user_id, enterprise_id),
        "workspace_type": "ENTERPRISE" if enterprise_id else "PERSONAL",
        "enterprise_id": enterprise_id,
        "can_manage": _can_manage_plan(user_id, enterprise_id),
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
    _, enterprise_id = resolve_workspace(
        user, request.args.get("workspace_type"), request.args.get("enterprise_id", type=int)
    )
    return ok(_workspace_view(user.id, enterprise_id))


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

    raw_eid = body.get("enterprise_id")
    if raw_eid is not None and (not isinstance(raw_eid, int) or isinstance(raw_eid, bool)):
        raise invalid_argument(field_errors=[{"field": "enterprise_id", "reason": "invalid"}])
    ws_type, enterprise_id = resolve_workspace(user, body.get("workspace_type"), raw_eid)
    if not _can_manage_plan(user.id, enterprise_id):
        raise permission_denied("plan.enterprise_owner_only")

    state = subscription_state(user.id, enterprise_id)
    if state["pending"]:
        raise state_conflict("plan.application_pending")
    if state["status"] == "ACTIVE" and plan_rank(plan["code"]) <= plan_rank(state["plan_code"]):
        raise state_conflict("plan.not_upgrade")

    row = Application(
        type=PLAN_UPGRADE,
        applicant_user_id=user.id,
        target_enterprise_id=enterprise_id,
        form={
            "plan_code": plan["code"],
            "plan_name": plan["name"],
            "workspace_type": ws_type,
            "enterprise_id": enterprise_id,
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
        {"plan_code": plan["code"], "workspace_type": ws_type, "enterprise_id": enterprise_id},
    )
    notify(user.id, "PLAN_UPGRADE_SUBMITTED", "Plan upgrade request received", plan["name"])
    return ok(_workspace_view(user.id, enterprise_id), status=201)
