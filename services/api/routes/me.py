"""个人域路由：/api/v1/me/*（PRD §14.2）。"""
from __future__ import annotations

import hashlib
import io
import logging
import re
import secrets

from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, request, send_file
from sqlalchemy import select

import avatars
import email_sender
import storage
from auth import ACCOUNT_NOTIFICATION_TYPES, audit, current_user
from errors import (
    invalid_argument,
    not_found,
    ok,
    permission_denied,
    rate_limited,
    service_unavailable,
    state_conflict,
)
from extensions import db
import quota
from models import (
    Application,
    AuditEvent,
    DataRequest,
    EmailVerificationCode,
    Notification,
    User,
)
from workspace import list_tenants

logger = logging.getLogger(__name__)
bp = Blueprint("me", __name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_EMAIL_CODE_TTL = timedelta(minutes=10)
_EMAIL_CODE_COOLDOWN = timedelta(seconds=60)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _field_error(field: str, key: str = "error.invalid_argument"):
    return invalid_argument(
        "error.invalid_argument", field_errors=[{"field": field, "message_key": key}]
    )


def _clean_display_name(value) -> str:
    name = str(value or "").strip()
    if not name or len(name) > 128:
        raise _field_error("display_name", "error.field_required")
    return name


def _clean_email(value) -> str:
    email = str(value or "").strip()
    if not email:
        raise _field_error("email", "error.field_required")
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise _field_error("email", "error.email_invalid")
    return email


def _clean_phone(value) -> str:
    phone = str(value or "").strip()
    if not phone:
        return ""
    digits = re.sub(r"[^0-9]", "", phone)
    if len(phone) > 32 or not re.fullmatch(r"\+?[0-9() .-]+", phone) or not 6 <= len(digits) <= 15:
        raise _field_error("phone", "error.phone_invalid")
    return phone


def _set_avatar(user, value) -> str:
    """更新头像，返回提交后应删除的旧对象名。"""
    try:
        return avatars.apply(user, value)
    except ValueError:
        raise _field_error("avatar_url", "error.avatar_invalid") from None
    except Exception:  # noqa: BLE001 对象存储不可用
        logger.exception("avatar upload failed user=%s", user.id)
        raise service_unavailable("STORAGE_UNAVAILABLE", "avatar.upload_failed") from None


def _require_member():
    user = current_user()
    if user.is_guest:
        raise permission_denied()
    return user


def _lock_user(user) -> None:
    # Serialize sending/consuming codes for this user, including concurrent requests.
    db.session.execute(select(User.id).where(User.id == user.id).with_for_update())
    db.session.refresh(user)


def _consume_email_code(user, email: str, code: str) -> None:
    """校验并消费发往 email 的验证码；开发环境不校验。"""
    if not code:
        raise _field_error("code", "error.field_required")
    if current_app.config.get("AUTH_DEV_MODE"):
        return
    if not re.fullmatch(r"[0-9]{6}", code):
        raise _field_error("code", "error.email_code_invalid")
    record = (
        EmailVerificationCode.query.filter_by(user_id=user.id, email=email, consumed_at=None)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    now = _now()
    if (
        record is None
        or record.expires_at <= now
        or not secrets.compare_digest(record.code_hash, code_hash)
    ):
        raise _field_error("code", "error.email_code_invalid")
    record.consumed_at = now


@bp.get("/me")
def me_get():
    return ok(current_user().to_dict())


@bp.get("/me/quota")
def me_quota():
    """当前有效租户的额度视图（PRD v1.4 §20：套餐月页 + 订阅有效期）。"""
    return ok({"tenants": quota.quota_summary(current_user())})


@bp.patch("/me")
def me_patch():
    """字段白名单：display_name / phone / avatar_url / language（PRD §14.2，FR-SYS-015）。"""
    user = current_user()
    body = request.get_json(silent=True) or {}
    changed = []
    old_avatar = ""
    if "display_name" in body:
        user.display_name = _clean_display_name(body["display_name"])
        changed.append("display_name")
    if "phone" in body:
        # FR-SYS-015：个人中心手机号可修改，校验与注册完全一致（空串清空、可选）。
        # 游客没有注册资料，不开放修改，避免试用会话写入可被认领的联系方式。
        if user.is_guest:
            raise permission_denied()
        user.phone = _clean_phone(body["phone"])
        changed.append("phone")
    if "language" in body:
        if body["language"] not in ("th", "en"):
            raise _field_error("language")
        user.language = body["language"]
        changed.append("language")
    if "avatar_url" in body:
        if user.is_guest:
            raise permission_denied()
        old_avatar = _set_avatar(user, body["avatar_url"])
        changed.append("avatar_url")
    if changed:
        db.session.commit()
        storage.delete(old_avatar)
        audit("me.update", "user", str(user.id), {"fields": changed})
    return ok(user.to_dict())


@bp.get("/me/avatar")
def me_avatar():
    """当前用户头像字节（对象存储经后端代理，FR-SYS-014/015）。"""
    user = current_user()
    if not user.avatar_path or not storage.exists(user.avatar_path):
        raise not_found()
    resp = send_file(
        io.BytesIO(storage.get_bytes(user.avatar_path)), mimetype=avatars.mime_of(user.avatar_path)
    )
    resp.headers["Cache-Control"] = "private, max-age=86400"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@bp.post("/me/registration")
def me_registration():
    """FR-SYS-014：手机号默认 LINE、注册时可改；邮箱须凭验证码确认。"""
    user = _require_member()
    _lock_user(user)
    if user.registered_at is not None:
        raise state_conflict("registration.already_done")
    body = request.get_json(silent=True) or {}
    display_name = _clean_display_name(body.get("display_name"))
    phone = _clean_phone(body.get("phone", user.phone))
    email = _clean_email(body.get("email"))
    _consume_email_code(user, email, str(body.get("code") or "").strip())
    old_avatar = _set_avatar(user, body["avatar_url"]) if "avatar_url" in body else ""
    user.display_name = display_name
    user.phone = phone
    user.email = email
    user.registered_at = _now()
    db.session.commit()
    storage.delete(old_avatar)
    audit("user.register", "user", str(user.id))
    return ok(user.to_dict())


@bp.post("/me/email/code")
def me_email_code():
    """TLS SMTP 邮箱验证码（FR-SYS-014/016）；仅显式本地开发模式不发信。"""
    user = _require_member()
    body = request.get_json(silent=True) or {}
    email = _clean_email(body.get("email"))
    if user.registered_at is not None and email.lower() == (user.email or "").lower():
        raise _field_error("email", "error.email_unchanged")
    dev_mode = bool(current_app.config.get("AUTH_DEV_MODE"))
    if not dev_mode:
        try:
            email_sender.ensure_configured()
        except email_sender.EmailDeliveryError:
            raise service_unavailable("EMAIL_SERVICE_UNAVAILABLE", "email.sender_unavailable") from None
    _lock_user(user)
    if user.registered_at is not None and email.lower() == (user.email or "").lower():
        raise _field_error("email", "error.email_unchanged")
    last = (
        EmailVerificationCode.query.filter_by(user_id=user.id)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    now = _now()
    if last is not None and now - last.created_at < _EMAIL_CODE_COOLDOWN:
        raise rate_limited()
    code = f"{secrets.randbelow(1_000_000):06d}"
    if not dev_mode:
        try:
            email_sender.send_verification_code(
                email, code, language=user.language, ttl_minutes=int(_EMAIL_CODE_TTL.total_seconds() // 60)
            )
        except email_sender.EmailDeliveryError:
            db.session.rollback()
            logger.warning("Verification email delivery failed user=%s", user.id)
            raise service_unavailable("EMAIL_SERVICE_UNAVAILABLE", "email.sender_unavailable") from None
    # Only a successfully accepted email produces a valid new code. Invalidate older
    # codes so a previously sent code cannot be reused after the newest one is consumed.
    EmailVerificationCode.query.filter_by(user_id=user.id, consumed_at=None).update(
        {"consumed_at": now}, synchronize_session=False
    )
    db.session.add(
        EmailVerificationCode(
            user_id=user.id,
            email=email,
            code_hash=hashlib.sha256(code.encode("utf-8")).hexdigest(),
            expires_at=now + _EMAIL_CODE_TTL,
            created_at=now,
        )
    )
    db.session.commit()
    if dev_mode:
        logger.info("[dev] Verification email simulated user=%s", user.id)
    audit("me.email_code", "user", str(user.id))
    return ok({"sent": True, "cooldown_seconds": int(_EMAIL_CODE_COOLDOWN.total_seconds())})


@bp.post("/me/email")
def me_email_change():
    """凭新邮箱 + 验证码更换邮箱（FR-SYS-016）；开发环境不校验验证码。"""
    user = _require_member()
    _lock_user(user)
    body = request.get_json(silent=True) or {}
    email = _clean_email(body.get("email"))
    if email.lower() == (user.email or "").lower():
        raise _field_error("email", "error.email_unchanged")
    _consume_email_code(user, email, str(body.get("code") or "").strip())
    old = user.email
    user.email = email
    db.session.commit()
    audit("me.email_change", "user", str(user.id), {"had_email": bool(old)})
    return ok(user.to_dict())


@bp.get("/me/tenants")
def me_tenants():
    user = current_user()
    pending = (
        Application.query.filter(
            Application.applicant_user_id == user.id,
            Application.status.in_(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO"]),
        )
        .order_by(Application.updated_at.desc())
        .all()
    )
    return ok(
        {
            "tenants": list_tenants(user),
            "pending_applications": [
                {"id": a.id, "type": a.type, "status": a.status} for a in pending
            ],
        }
    )


@bp.get("/me/applications")
def me_applications():
    rows = (
        Application.query.filter_by(applicant_user_id=current_user().id)
        .order_by(Application.updated_at.desc())
        .all()
    )
    return ok({"items": [a.to_dict() for a in rows]})


def _account_notifications(user_id: int):
    """本人的账户变动类通知（列表、未读数与标记已读同一口径）。"""
    return Notification.query.filter(
        Notification.user_id == user_id,
        Notification.type.in_(ACCOUNT_NOTIFICATION_TYPES),
    )


@bp.get("/me/notifications")
def me_notifications():
    """站内通知列表 + 未读数（首页铃铛的数据源）：只含账户变动类通知。"""
    user = current_user()
    mine = _account_notifications(user.id)
    rows = mine.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(50).all()
    unread = mine.filter(Notification.read_at.is_(None)).count()
    return ok(
        {
            "unread_count": unread,
            "items": [
                {
                    "id": n.id,
                    "type": n.type,
                    "title": n.title,
                    "body": n.body,
                    "read": n.read_at is not None,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
                for n in rows
            ],
        }
    )


@bp.post("/me/notifications/read")
def me_notifications_read():
    """标记已读：body.ids 为空或缺省则全部标记（幂等，只影响本人通知）。"""
    user = current_user()
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") if isinstance(body, dict) else None
    query = _account_notifications(user.id).filter(Notification.read_at.is_(None))
    if isinstance(ids, list) and ids:
        wanted = [i for i in ids if isinstance(i, int) and not isinstance(i, bool)]
        if len(wanted) != len(ids):
            raise _field_error("ids")
        query = query.filter(Notification.id.in_(wanted))
    elif ids not in (None, []):
        raise _field_error("ids")
    updated = query.update({"read_at": _now()}, synchronize_session=False)
    db.session.commit()
    unread = _account_notifications(user.id).filter(Notification.read_at.is_(None)).count()
    return ok({"updated": int(updated or 0), "unread_count": unread})


@bp.get("/me/activity-events")
def me_activity_events():
    rows = (
        AuditEvent.query.filter_by(user_id=current_user().id)
        .order_by(AuditEvent.created_at.desc())
        .limit(50)
        .all()
    )
    return ok(
        {
            "items": [
                {
                    "action": e.action,
                    "object_type": e.object_type,
                    "object_id": e.object_id,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in rows
            ]
        }
    )


@bp.post("/me/data-requests")
def me_data_requests():
    """数据访问/删除请求：需单独确认（confirmed=true 明确发起）。"""
    body = request.get_json(silent=True) or {}
    kind = body.get("kind")
    if kind not in ("ACCESS", "DELETION"):
        raise invalid_argument(
            "error.invalid_argument",
            field_errors=[{"field": "kind", "message_key": "error.invalid_argument"}],
        )
    if body.get("confirmed") is not True:
        raise invalid_argument("data_request.confirm_required")
    req = DataRequest(
        user_id=current_user().id,
        kind=kind,
        note=str(body.get("note") or "")[:255],
    )
    db.session.add(req)
    db.session.commit()
    audit("data_request.create", "data_request", str(req.id), {"kind": kind})
    return ok(
        {
            "id": req.id,
            "kind": req.kind,
            "status": req.status,
            "created_at": req.created_at.isoformat() if req.created_at else None,
        },
        status=201,
    )
