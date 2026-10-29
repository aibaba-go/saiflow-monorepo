"""套餐申请人工审批运维脚本（FR-SYS-012/013）。

续费完全线下：销售收款后由运维用本脚本把 `PLAN_UPGRADE` 申请置为 APPROVED，
并把有效期写进 `applications.form.valid_from / valid_to`（或 `period_months`）；
提交后立刻调用 `subscriptions.state()` 让订阅同步，并给申请人发站内通知。

用法（必须在 services/api 目录内执行）：

    .venv/Scripts/python.exe admin_plans.py list-pending
    .venv/Scripts/python.exe admin_plans.py show --tenant-id 12
    .venv/Scripts/python.exe admin_plans.py approve --application-id 7 --months 12
    .venv/Scripts/python.exe admin_plans.py approve --application-id 7 \
        --valid-from 2026-11-01 --valid-to 2027-11-01 --note "bank transfer #123"
    .venv/Scripts/python.exe admin_plans.py reject --application-id 7 --note "未收到款项"

约定：
- 所有写操作默认二次确认，`--yes` 跳过（便于脚本化）；
- 参数校验失败一律在写库之前退出（只读校验，不留半成品状态）；
- 连接参数与 Flask 完全一致（PGHOST/PGUSER/...），脚本不打印任何密码或连接串。
"""
from __future__ import annotations

import argparse
import sys

from datetime import datetime

from flask import Flask

from config import Config
from extensions import configure_schema, db

PLAN_UPGRADE = "PLAN_UPGRADE"
_OPEN_STATUSES = ("DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO")


def build_app() -> Flask:
    """与 setup_db.py 一致的最小 Flask：只连库，不注册路由、不起 worker。"""
    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    configure_schema(app)
    return app


# ---- 只读参数校验（任何失败都发生在写库之前） ----


def _parse_day(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise SystemExit(f"参数 --{field} 必须是 YYYY-MM-DD，收到 {text!r}") from None
    return text


def _validate_period(args) -> tuple[str, str, int | None]:
    """只读校验：任何不合法的组合都在写库之前退出。"""
    valid_from = _parse_day(args.valid_from, "valid-from") or ""
    valid_to = _parse_day(args.valid_to, "valid-to") or ""
    months = args.months
    if months is not None and not 1 <= months <= 120:
        raise SystemExit("参数 --months 必须在 1~120 之间")
    if valid_from and valid_to and valid_to <= valid_from:
        raise SystemExit("参数 --valid-to 必须晚于 --valid-from")
    # 只给 --valid-to 也合法：起算日由 subscriptions 接续当期到期日
    return valid_from, valid_to, months


def _confirm(question: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    answer = input(f"{question} [y/N] ").strip().lower()
    if answer not in ("y", "yes"):
        raise SystemExit("已取消，未写入任何数据")


# ---- 公共读取 ----


def _load_application(application_id: int):
    from models import Application

    row = db.session.get(Application, application_id)
    if row is None:
        raise SystemExit(f"申请 {application_id} 不存在")
    if row.type != PLAN_UPGRADE:
        raise SystemExit(f"申请 {application_id} 类型为 {row.type}，不是 {PLAN_UPGRADE}")
    return row


def _tenant_label(tenant_id: int) -> str:
    from models import Enterprise, Tenant

    tenant = db.session.get(Tenant, tenant_id)
    if tenant is None:
        return f"tenant#{tenant_id}(缺失)"
    if tenant.tenant_type == "ENTERPRISE":
        enterprise = Enterprise.query.filter_by(tenant_id=tenant_id).first()
        name = (enterprise.legal_name if enterprise else "") or tenant.display_name
        status = enterprise.status if enterprise else "?"
        return f"tenant#{tenant_id} ENTERPRISE {name!r} ({status})"
    return f"tenant#{tenant_id} PERSONAL {tenant.display_name!r}"


def _print_state(tenant_id: int) -> None:
    import subscriptions

    state = subscriptions.state(tenant_id)
    print(
        f"  订阅: status={state['status']} plan={state['plan_code']} source={state['source']}"
        f" starts_at={state['starts_at']} expires_at={state['expires_at']}"
        f" days_remaining={state['days_remaining']} application_id={state['application_id']}"
    )


def _audit(action: str, application, detail: dict) -> None:
    """运维审批没有登录会话，审计事件挂在申请人名下（user_id 为 NOT NULL 外键）。"""
    from models import AuditEvent

    db.session.add(
        AuditEvent(
            user_id=application.applicant_user_id,
            action=action,
            object_type="application",
            object_id=str(application.id),
            detail={"by": "admin_plans", **detail},
        )
    )
    db.session.commit()


# ---- 子命令 ----


def cmd_list_pending(args) -> int:
    from models import Application

    rows = (
        Application.query.filter(
            Application.type == PLAN_UPGRADE,
            Application.status.in_(_OPEN_STATUSES),
        )
        .order_by(Application.submitted_at.asc(), Application.id.asc())
        .all()
    )
    if not rows:
        print("没有待审批的 PLAN_UPGRADE 申请")
        return 0
    print(f"待审批 PLAN_UPGRADE 申请 {len(rows)} 条：")
    for row in rows:
        form = row.form or {}
        submitted = row.submitted_at.isoformat() if row.submitted_at else "(未提交)"
        print(
            f"  #{row.id} status={row.status} plan={form.get('plan_code')}"
            f" {_tenant_label(row.target_tenant_id)} applicant_user={row.applicant_user_id}"
            f" submitted_at={submitted}"
        )
    return 0


def cmd_show(args) -> int:
    from models import Application, PlanReminder

    tenant_id = args.tenant_id
    print(_tenant_label(tenant_id))
    _print_state(tenant_id)
    rows = (
        Application.query.filter(
            Application.type == PLAN_UPGRADE,
            Application.target_tenant_id == tenant_id,
        )
        .order_by(Application.id.desc())
        .limit(10)
        .all()
    )
    print(f"  最近申请 {len(rows)} 条：")
    for row in rows:
        form = row.form or {}
        print(
            f"    #{row.id} {row.status} plan={form.get('plan_code')}"
            f" valid_from={form.get('valid_from') or '-'} valid_to={form.get('valid_to') or '-'}"
            f" period_months={form.get('period_months') or '-'}"
        )
    reminders_rows = (
        PlanReminder.query.filter_by(tenant_id=tenant_id)
        .order_by(PlanReminder.id.desc())
        .limit(10)
        .all()
    )
    print(f"  最近提醒 {len(reminders_rows)} 条：")
    for row in reminders_rows:
        print(
            f"    {row.stage} period_end={row.period_end.isoformat() if row.period_end else '-'}"
            f" email_sent={row.email_sent}"
            f" created_at={row.created_at.isoformat() if row.created_at else '-'}"
        )
    return 0


def cmd_approve(args) -> int:
    from auth import notify
    from models import _now
    from plans import APPROVED_PERIOD_MONTHS

    valid_from, valid_to, months = _validate_period(args)
    application = _load_application(args.application_id)
    if application.status == "APPROVED":
        raise SystemExit(f"申请 {application.id} 已是 APPROVED，不重复审批")
    form = dict(application.form or {})
    plan_code = form.get("plan_code") or "KINDER"
    span = months if months is not None else APPROVED_PERIOD_MONTHS
    period = (
        f"valid_to={valid_to}" if valid_to else f"{span} 个月"
    )
    print(f"即将批准 #{application.id} plan={plan_code} {_tenant_label(application.target_tenant_id)}")
    print(f"  有效期: 起算={valid_from or '接续当期到期日'} 时长/截止={period}")
    _confirm("确认批准？", args.yes)

    form["valid_from"] = valid_from
    form["valid_to"] = valid_to
    if months is not None:
        form["period_months"] = months
    application.form = form
    application.status = "APPROVED"
    application.review_note = (args.note or "")[:512]
    application.updated_at = _now()
    db.session.commit()

    _audit(
        "plan_application.approve",
        application,
        {
            "plan_code": plan_code,
            "tenant_id": application.target_tenant_id,
            "valid_from": valid_from,
            "valid_to": valid_to,
            "period_months": months,
            "note": application.review_note,
        },
    )
    notify(
        application.applicant_user_id,
        "PLAN_UPGRADE_APPROVED",
        "Plan request approved",
        f"{form.get('plan_name') or plan_code} is active"
        + (f" until {valid_to}" if valid_to else ""),
    )
    # 提交后立刻读一次订阅状态：subscriptions 会据 application_id 惰性续期
    print(f"已批准 #{application.id}，同步后的订阅状态：")
    _print_state(application.target_tenant_id)
    return 0


def cmd_reject(args) -> int:
    from auth import notify
    from models import _now

    note = (args.note or "").strip()
    if not note:
        raise SystemExit("参数 --note 必填：拒绝原因会写入审计与站内通知")
    application = _load_application(args.application_id)
    if application.status == "REJECTED":
        raise SystemExit(f"申请 {application.id} 已是 REJECTED，不重复处理")
    print(f"即将拒绝 #{application.id} {_tenant_label(application.target_tenant_id)}")
    print(f"  原因: {note}")
    _confirm("确认拒绝？", args.yes)

    application.status = "REJECTED"
    application.review_note = note[:512]
    application.updated_at = _now()
    db.session.commit()
    _audit(
        "plan_application.reject",
        application,
        {"tenant_id": application.target_tenant_id, "note": application.review_note},
    )
    notify(
        application.applicant_user_id,
        "PLAN_UPGRADE_REJECTED",
        "Plan request rejected",
        application.review_note,
    )
    print(f"已拒绝 #{application.id}，当前订阅状态：")
    _print_state(application.target_tenant_id)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SaiFlow 套餐申请人工审批（线下续费）")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list-pending", help="列出待审批的 PLAN_UPGRADE 申请").set_defaults(
        handler=cmd_list_pending
    )

    show = sub.add_parser("show", help="打印租户订阅与最近提醒记录")
    show.add_argument("--tenant-id", type=int, required=True)
    show.set_defaults(handler=cmd_show)

    approve = sub.add_parser("approve", help="批准申请并写入有效期")
    approve.add_argument("--application-id", type=int, required=True)
    approve.add_argument("--valid-from", default=None, help="起算日 YYYY-MM-DD（缺省接续当期到期日）")
    approve.add_argument("--valid-to", default=None, help="到期日 YYYY-MM-DD（缺省按 --months）")
    approve.add_argument("--months", type=int, default=None, help="续期月数 1~120（缺省 12）")
    approve.add_argument("--note", default="", help="审批备注（写入 review_note 与审计）")
    approve.add_argument("--yes", action="store_true", help="跳过二次确认")
    approve.set_defaults(handler=cmd_approve)

    reject = sub.add_parser("reject", help="拒绝申请")
    reject.add_argument("--application-id", type=int, required=True)
    reject.add_argument("--note", required=True, help="拒绝原因（必填）")
    reject.add_argument("--yes", action="store_true", help="跳过二次确认")
    reject.set_defaults(handler=cmd_reject)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    app = build_app()
    with app.app_context():
        return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
