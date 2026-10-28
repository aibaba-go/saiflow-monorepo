"""套餐到期提醒引擎（FR-SYS-012/013）。

成熟 SaaS 的续费提醒节奏：**到期前 7/3/1 天各一次、到期当天一次、到期后一次**，
共 5 个节点（`D7 / D3 / D1 / D0 / EXPIRED`）。每个节点同时产出：

- 站内通知（`notifications` 表，首页铃铛读 `GET /me/notifications`）；
- 自动邮件（仅发给已注册且有邮箱的用户，线下续费靠联系销售）。

设计口径：

- **不补发错过的节点。** 只按「当天剩余天数」落到唯一一个节点：7→D7、3→D3、
  1→D1、0→D0、小于 0→EXPIRED。进程停了两天也不会一次补发 D7+D3，
  因为剩余天数已经越过那些节点，`stage_for` 直接返回 None。
- **幂等键 = (tenant_id, period_end, stage)**，即 `plan_reminders` 的
  `uq_plan_reminder_stage` 唯一约束。本地与 Cloud Run 共用同一个库、可能多实例
  并行，所以发送前先查记录，写入时再用唯一约束兜并发（IntegrityError 即视为
  别的实例已发，回滚跳过），绝不依赖内存标记。
- **续费后 `expires_at` 变化** → `period_end` 变成新值 → 新周期自然重新提醒；
  `EXPIRED` 节点因为 period_end 固定，所以每个周期只会发一次。
- **邮件失败不影响站内通知与幂等记录**：幂等记录与站内通知先一起提交，
  邮件结果只回写 `plan_reminders.email_sent`。

本模块是纯函数式的（`sweep()` 进来、统计字典出去），不起线程、不读全局时钟，
调度由 `worker.py` 的低频触发负责。
"""
from __future__ import annotations

import logging

from datetime import date, datetime

from sqlalchemy.exc import IntegrityError

import email_sender
import subscriptions
from auth import notify
from extensions import db
from models import Membership, PlanReminder, Subscription, Tenant, User, _now

logger = logging.getLogger(__name__)

# 提醒节点顺序（仅用于文档与测试断言；实际触发由 stage_for 单点判定）
STAGES = ("D7", "D3", "D1", "D0", "EXPIRED")

# 剩余自然日 → 节点；不在表里的天数（如 5 天、2 天）当天不发任何提醒
_DAY_STAGES = {7: "D7", 3: "D3", 1: "D1", 0: "D0"}

_EXPIRING_TYPE = "PLAN_EXPIRING"
_EXPIRED_TYPE = "PLAN_EXPIRED"


# ---- 节点判定 ----


def stage_for(days_left: int) -> str | None:
    """当天应落的唯一节点；错过的节点不补发，返回 None 表示今天不提醒。"""
    if days_left < 0:
        return "EXPIRED"
    return _DAY_STAGES.get(days_left)


# ---- 收件人 ----


def recipient_for(tenant_id: int) -> User | None:
    """提醒收件人：个人租户 = owner 用户；企业租户 = ACTIVE OWNER。

    企业没有 OWNER 时退回「ACTIVE 成员里最早加入的一个」，避免企业完全收不到
    到期提醒。游客（`users.line_provider='guest'`）不提醒，由调用方过滤。
    """
    tenant = db.session.get(Tenant, tenant_id)
    if tenant is None:
        return None
    if tenant.tenant_type == "PERSONAL":
        if tenant.owner_user_id is None:
            return None
        return db.session.get(User, tenant.owner_user_id)
    rows = (
        Membership.query.filter_by(tenant_id=tenant.id, status="ACTIVE")
        .order_by(Membership.created_at.asc())
        .all()
    )
    if not rows:
        return None
    chosen = next((m for m in rows if m.role == "OWNER"), rows[0])
    return db.session.get(User, chosen.user_id)


# ---- 文案（站内通知；邮件文案在 email_sender） ----


def _texts(language: str, plan_name: str, expires_on: str, days_left: int, stage: str) -> tuple[str, str]:
    """站内通知标题/正文；必须包含套餐名与到期日（泰国时区自然日）。"""
    thai = language == "th"
    if stage == "EXPIRED":
        if thai:
            return (
                f"แพ็กเกจ {plan_name} หมดอายุแล้ว",
                f"แพ็กเกจ SaiFlow {plan_name} ของคุณหมดอายุเมื่อวันที่ {expires_on}"
                " จึงไม่สามารถสร้างงาน OCR ใหม่ได้ กรุณาติดต่อฝ่ายขาย SaiFlow เพื่อต่ออายุ",
            )
        return (
            f"{plan_name} plan has expired",
            f"Your SaiFlow {plan_name} plan expired on {expires_on}."
            " New OCR tasks are blocked until renewal. Contact SaiFlow sales to renew.",
        )
    if days_left == 0:
        if thai:
            return (
                f"แพ็กเกจ {plan_name} หมดอายุวันนี้",
                f"แพ็กเกจ SaiFlow {plan_name} ของคุณหมดอายุวันนี้ ({expires_on})"
                " กรุณาติดต่อฝ่ายขาย SaiFlow เพื่อต่ออายุก่อนใช้งานต่อ",
            )
        return (
            f"{plan_name} plan expires today",
            f"Your SaiFlow {plan_name} plan expires today ({expires_on})."
            " Contact SaiFlow sales to renew and keep creating OCR tasks.",
        )
    if thai:
        return (
            f"แพ็กเกจ {plan_name} จะหมดอายุในอีก {days_left} วัน",
            f"แพ็กเกจ SaiFlow {plan_name} ของคุณจะหมดอายุวันที่ {expires_on}"
            f" (เหลืออีก {days_left} วัน) กรุณาติดต่อฝ่ายขาย SaiFlow เพื่อต่ออายุ",
        )
    unit = "day" if days_left == 1 else "days"
    return (
        f"{plan_name} plan expires in {days_left} {unit}",
        f"Your SaiFlow {plan_name} plan expires on {expires_on} ({days_left} {unit} left)."
        " Contact SaiFlow sales to renew and keep creating OCR tasks.",
    )


# ---- 单租户处理 ----


def _already_sent(tenant_id: int, period_end: datetime, stage: str) -> bool:
    return (
        PlanReminder.query.filter_by(
            tenant_id=tenant_id, period_end=period_end, stage=stage
        ).first()
        is not None
    )


def _claim(tenant_id: int, period_end: datetime, stage: str) -> PlanReminder | None:
    """抢占幂等记录；并发撞唯一约束即返回 None（别的实例已经发了）。"""
    record = PlanReminder(
        tenant_id=tenant_id, period_end=period_end, stage=stage, email_sent=False
    )
    db.session.add(record)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return None
    return record


def _expires_on(expires_at: datetime) -> str:
    """到期日按泰国时区显示 YYYY-MM-DD（与计量/剩余天数同一口径）。"""
    value: date = subscriptions.local_date(expires_at)
    return value.isoformat()


def remind(row: Subscription, *, now: datetime, stats: dict) -> bool:
    """处理单个租户的当天提醒；返回是否真的发出了站内通知。"""
    # 先跑一次惰性同步：人工审批只改申请状态（没有状态翻转钩子），若该租户
    # 近期无人访问，订阅行里还是旧 expires_at——不同步就会给已续费的客户发「已过期」。
    tenant = db.session.get(Tenant, row.tenant_id)
    if tenant is not None:
        synced = subscriptions.ensure_subscription(tenant, commit=True)
        if synced is not None:
            row = synced
    left = subscriptions.days_remaining(row.expires_at, now=now)
    stage = stage_for(left)
    if stage is None:
        return False
    user = recipient_for(row.tenant_id)
    if user is None or user.is_guest:
        # 游客试用不提醒（没有邮箱、认领后订阅也会被删掉）
        return False
    if _already_sent(row.tenant_id, row.expires_at, stage):
        return False
    record = _claim(row.tenant_id, row.expires_at, stage)
    if record is None:
        return False

    plan_name = subscriptions.plan_name(row.plan_code)
    expires_on = _expires_on(row.expires_at)
    language = user.language if user.language in ("th", "en") else "en"
    title, body = _texts(language, plan_name, expires_on, left, stage)
    # notify 内部 commit：幂等记录与站内通知在同一事务落库，之后邮件再失败也不会丢
    notify(user.id, _EXPIRED_TYPE if stage == "EXPIRED" else _EXPIRING_TYPE, title, body)
    stats["notified"] += 1
    logger.info("套餐到期提醒 tenant=%s stage=%s 剩余=%s", row.tenant_id, stage, left)

    if user.email and user.registered_at is not None:
        try:
            email_sender.send_plan_reminder(
                user.email,
                plan_name=plan_name,
                expires_on=expires_on,
                days_left=left,
                stage=stage,
                language=language,
            )
        except Exception:  # noqa: BLE001 邮件失败不影响站内通知与幂等记录
            # 不记录异常对象：SMTP 异常可能带收件人地址与厂商诊断（见 email_sender 安全约定）
            logger.warning(
                "套餐提醒邮件发送失败 tenant=%s stage=%s（站内通知已发）", row.tenant_id, stage
            )
        else:
            record.email_sent = True
            db.session.commit()
            stats["emailed"] += 1
    return True


# ---- 对外入口 ----


def sweep(now: datetime | None = None) -> dict:
    """扫描全部订阅并发送当天应落的提醒；返回统计，便于日志与测试断言。"""
    moment = now or _now()
    stats = {"scanned": 0, "notified": 0, "emailed": 0, "skipped": 0}
    rows = Subscription.query.order_by(Subscription.id.asc()).all()
    for row in rows:
        stats["scanned"] += 1
        try:
            if not remind(row, now=moment, stats=stats):
                stats["skipped"] += 1
        except Exception:  # noqa: BLE001 单个租户失败不影响其余租户
            db.session.rollback()
            stats["skipped"] += 1
            logger.exception("套餐到期提醒处理失败 tenant=%s", row.tenant_id)
    return stats
