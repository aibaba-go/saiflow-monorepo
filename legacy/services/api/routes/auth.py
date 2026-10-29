"""认证路由：POST /api/v1/auth/line、GET /api/v1/auth/session、POST /api/v1/auth/logout。

PRD §14.1：/api/v1/auth/line 是全系统唯一免登录白名单；
但仍必须服务端验证 LINE ID token（签名/签发者/过期/渠道受众）。
开发身份仅允许 APP_ENV=development 且 AUTH_DEV_MODE=true 的本地环境（Cloud Run 强制禁用）。
"""
from __future__ import annotations

import hashlib
import logging
import secrets

from datetime import datetime, timezone

import httpx
from flask import Blueprint, current_app, g, request

import avatars
from auth import (
    clear_session_cookie,
    create_session,
    current_session,
    current_user,
    resolve_session,
    revoke_session,
    set_session_cookie,
)
from errors import ApiError, invalid_argument, ok, service_unavailable
from extensions import db
from models import Session, Tenant, User
import subscriptions
import storage
from workspace import ensure_personal_tenant, list_tenants

logger = logging.getLogger(__name__)
bp = Blueprint("auth", __name__)

LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"
LINE_ISSUER = "https://access.line.me"


def _issue_session_response(user: User, language: str | None = None):
    session, token, csrf = create_session(user, language=language)
    db.session.commit()
    payload = {
        "user": user.to_dict(),
        "csrf_token": csrf,
        "tenants": list_tenants(user),
    }
    resp = ok(payload)
    set_session_cookie(resp[0], token)
    return resp


def _rotate_csrf(session: Session) -> str:
    csrf = secrets.token_urlsafe(32)
    session.csrf_hash = hashlib.sha256(csrf.encode("utf-8")).hexdigest()
    db.session.commit()
    return csrf


def _upsert_line_user(
    provider: str,
    sub: str,
    profile: dict | None,
    language: str | None,
) -> User:
    """profile = LINE 资料（display_name/avatar_url/email/phone，开发环境可带 avatar_png）；None 表示不刷新。

    已注册用户的昵称/头像/邮箱由用户自行维护，登录时不再被 LINE 资料覆盖。
    """
    user = User.query.filter_by(line_provider=provider, line_sub=sub).first()
    if user is None:
        user = User(line_provider=provider, line_sub=sub, language=language or "th")
        db.session.add(user)
    else:
        # FR-SYS-014: registration may commit after the initial lookup. Lock and
        # reload before testing registered_at so LINE cannot overwrite saved data.
        db.session.refresh(user, with_for_update=True)
        if language in ("th", "en"):
            user.language = language
    if profile and user.registered_at is None:
        for field in ("display_name", "avatar_url", "email", "phone"):
            if profile.get(field):
                setattr(user, field, profile[field])
    if not user.display_name:
        user.display_name = sub
    db.session.flush()
    # 新建用户立刻补个人租户：业务行只认 tenant_id，缺租户会导致后续上传无从归属。
    # 这里只 flush 不 commit，避免提前释放 FR-SYS-014 的 SELECT ... FOR UPDATE 行锁。
    ensure_personal_tenant(user)
    if profile and profile.get("avatar_png") and user.registered_at is None:
        try:
            avatars.save_bytes(user, profile["avatar_png"], "png")
        except Exception:  # noqa: BLE001 头像存储失败不阻断登录
            logger.warning("dev avatar upload failed user=%s", user.id, exc_info=True)
    return user


_DEV_NAMES = ("Somchai", "Malee", "Niran", "Ploy", "Arthit", "Kanya", "Somsak", "Ratana", "Nok", "Krit")
_DEV_COLORS = ((74, 102, 247), (232, 137, 26), (22, 163, 74), (219, 39, 119), (124, 58, 237), (8, 145, 178))


def _dev_avatar_png(initial: str) -> bytes:
    """纯色底 + 首字母的 192px PNG。"""
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=96, height=96)
    page.draw_rect(page.rect, color=None, fill=[c / 255 for c in secrets.choice(_DEV_COLORS)])
    width = pymupdf.get_text_length(initial, fontname="helv", fontsize=44)
    page.insert_text(((96 - width) / 2, 63), initial, fontsize=44, fontname="helv", color=(1, 1, 1))
    png = page.get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes("png")
    doc.close()
    return png


def _dev_line_profile() -> dict:
    """开发环境模拟 LINE 资料：手机号/邮箱/昵称/头像均随机；约 1/3 概率无邮箱以覆盖必填录入。"""
    name = f"{secrets.choice(_DEV_NAMES)}{secrets.randbelow(90) + 10}"
    digits = "".join(str(secrets.randbelow(10)) for _ in range(8))
    phone = f"+66 8{digits[0]} {digits[1:4]} {digits[4:]}"
    email = "" if secrets.randbelow(3) == 0 else f"{name.lower()}@example.com"
    return {"display_name": name, "avatar_png": _dev_avatar_png(name[0]), "email": email, "phone": phone}


def _guest_context() -> tuple[Session | None, User | None]:
    """当前浏览器是否持有游客会话（登录时用于归并试用数据）。"""
    if not request.cookies.get(current_app.config["SESSION_COOKIE_NAME"]):
        return None, None
    session, user, _ = resolve_session()
    if session is not None and user is not None and user.is_guest:
        return session, user
    return None, None


def _claim_guest_data(guest: User, user: User, tenant: Tenant) -> str:
    """把游客的全部数据归并到刚登录的真实账号并删除游客账号（同事务，未 commit）；返回待删头像对象。

    归属已统一到 tenant_id，所以除了按 user 迁移的创建人字段，还要把游客租户下的
    业务行（File / OcrJob）改挂到目标用户的个人租户；游客租户自己的试用订阅与
    到期提醒记录一并删除（正式账号有自己的订阅周期，不继承游客试用期）。
    """
    from models import (
        Application,
        AuditEvent,
        DataRequest,
        EmailVerificationCode,
        Export,
        File,
        Invitation,
        Membership,
        Notification,
        OcrJob,
        PlanReminder,
        ResultVersion,
        Subscription,
    )

    def move(model, column: str) -> int:
        return model.query.filter(getattr(model, column) == guest.id).update(
            {column: user.id}, synchronize_session=False
        )

    guest_tenant = Tenant.query.filter_by(owner_user_id=guest.id).first()

    files = File.query.filter_by(created_by_user_id=guest.id).update(
        {"created_by_user_id": user.id, "uploader_user_id": user.id},
        synchronize_session=False,
    )
    move(File, "uploader_user_id")
    jobs = move(OcrJob, "created_by_user_id")
    move(ResultVersion, "created_by_user_id")
    move(Export, "created_by_user_id")
    move(Application, "applicant_user_id")
    move(Invitation, "created_by_user_id")
    move(Notification, "user_id")
    move(DataRequest, "user_id")
    move(AuditEvent, "user_id")
    owned = db.session.query(Membership.tenant_id).filter(Membership.user_id == user.id)
    Membership.query.filter(
        Membership.user_id == guest.id, Membership.tenant_id.in_(owned)
    ).delete(synchronize_session=False)
    move(Membership, "user_id")
    if guest_tenant is not None:
        for model in (File, OcrJob):
            model.query.filter(model.tenant_id == guest_tenant.id).update(
                {"tenant_id": tenant.id}, synchronize_session=False
            )
        # 游客试用订阅与其提醒记录随租户作废（正式账号按自己的周期计算有效期）
        Subscription.query.filter_by(tenant_id=guest_tenant.id).delete(synchronize_session=False)
        PlanReminder.query.filter_by(tenant_id=guest_tenant.id).delete(synchronize_session=False)
        # 个人套餐申请原本指向游客租户（NOT NULL FK），必须先改指向再删租户
        Application.query.filter(Application.target_tenant_id == guest_tenant.id).update(
            {"target_tenant_id": tenant.id}, synchronize_session=False
        )
    EmailVerificationCode.query.filter_by(user_id=guest.id).delete(synchronize_session=False)
    Session.query.filter_by(user_id=guest.id).delete(synchronize_session=False)
    avatar_path = guest.avatar_path
    if guest_tenant is not None:
        # tenants.owner_user_id → users.id，先删租户再删用户，顺序反了会 FK 失败
        db.session.delete(guest_tenant)
        db.session.flush()
    db.session.delete(guest)
    db.session.add(
        AuditEvent(
            user_id=user.id,
            action="guest.claim",
            object_type="user",
            object_id=str(guest.id),
            detail={"files": files, "jobs": jobs, "guest_deleted": True},
        )
    )
    return avatar_path


def _finish_login(
    user: User,
    language: str | None,
    guest_session: Session | None = None,
    guest_user: User | None = None,
):
    # 老账号可能建于租户改造之前，这里做一次幂等补偿，保证登录后一定有个人租户
    tenant = ensure_personal_tenant(user)
    if guest_session is not None and guest_user is not None and guest_user.id != user.id:
        guest_avatar = _claim_guest_data(guest_user, user, tenant)
        db.session.commit()
        storage.delete(guest_avatar)
    resp = _issue_session_response(user, language)
    subscriptions.ensure_subscription(tenant, commit=True)  # 默认开通 Kinder 一个月（幂等）
    return resp


def _verify_line_id_token(id_token: str) -> dict:
    """调用 LINE 服务端验真，并本地复核 iss/exp/aud（PRD §15）。"""
    channel_id = current_app.config["LINE_CHANNEL_ID"]
    if not channel_id:
        raise service_unavailable(
            "AUTH_SERVICE_UNAVAILABLE", "auth.line_not_configured"
        )
    try:
        # LINE 文档：验 ID token 必须用 POST + form（GET /verify 是验 access token 的端点）
        resp = httpx.post(
            LINE_VERIFY_URL,
            data={"id_token": id_token, "client_id": channel_id},
            timeout=httpx.Timeout(10.0, connect=5.0),
        )
    except httpx.HTTPError as e:
        logger.warning("LINE verify 网络失败: %s", e)
        raise service_unavailable(
            "AUTH_SERVICE_UNAVAILABLE", "auth.line_verify_unavailable"
        )
    if resp.status_code != 200:
        logger.warning("LINE verify failed: status=%s body=%s", resp.status_code, resp.text[:300])
        raise ApiError(401, "AUTH_REQUIRED", "auth.line_token_invalid")
    claims = resp.json()
    now = int(datetime.now(timezone.utc).timestamp())
    if claims.get("iss") != LINE_ISSUER:
        logger.warning(
            "LINE verify iss mismatch: iss=%r aud=%r", claims.get("iss"), claims.get("aud")
        )
        raise ApiError(401, "AUTH_REQUIRED", "auth.line_token_invalid")
    aud = claims.get("aud")
    if aud != channel_id and channel_id not in (
        aud if isinstance(aud, list) else [aud]
    ):
        raise ApiError(401, "AUTH_REQUIRED", "auth.line_channel_mismatch")
    if int(claims.get("exp", 0)) < now:
        raise ApiError(401, "AUTH_REQUIRED", "auth.line_token_expired")
    return claims


@bp.post("/auth/line")
def auth_line():
    """LINE ID token 换取 saiflow 会话（唯一匿名白名单接口）。"""
    body = request.get_json(silent=True) or {}
    dev_mode = current_app.config.get("AUTH_DEV_MODE", False)
    # FR-SYS-001：生产拒绝任何 dev_id（即使同时有 token），且不得先读写游客会话。
    if "dev_id" in body and not dev_mode:
        raise invalid_argument("auth.id_token_required")
    id_token = (body.get("id_token") or "").strip()
    language = body.get("language") if body.get("language") in ("th", "en") else None

    if not id_token:
        # 本地开发身份：先校验输入，再读取游客上下文或创建用户。
        dev_id = (body.get("dev_id") or "").strip()
        if dev_id and dev_mode:
            if len(dev_id) > 64:
                raise invalid_argument("error.invalid_argument")
            guest_session, guest_user = _guest_context()
            sub = f"dev:{dev_id}"
            is_new = User.query.filter_by(line_provider="line", line_sub=sub).first() is None
            user = _upsert_line_user("line", sub, _dev_line_profile() if is_new else None, language)
            return _finish_login(user, language, guest_session, guest_user)
        raise invalid_argument("auth.id_token_required")

    claims = _verify_line_id_token(id_token)
    guest_session, guest_user = _guest_context()
    user = _upsert_line_user(
        "line",
        str(claims.get("sub")),
        {
            "display_name": str(claims.get("name") or ""),
            "avatar_url": str(claims.get("picture") or ""),
            "email": str(claims.get("email") or "")[:254],
            "phone": str(claims.get("phone_number") or "")[:32],
        },
        language,
    )
    return _finish_login(user, language, guest_session, guest_user)


@bp.post("/auth/guest")
def auth_guest():
    """创建/复用游客会话：未登录也可上传与核验，登录后数据自动归并。"""
    body = request.get_json(silent=True) or {}
    language = body.get("language") if body.get("language") in ("th", "en") else None

    session, existing, _ = resolve_session()
    if existing is not None:
        return ok(
            {
                "user": existing.to_dict(),
                "csrf_token": _rotate_csrf(session),
                "tenants": list_tenants(existing),
            }
        )

    guest = User(
        line_provider="guest",
        line_sub=f"guest:{secrets.token_urlsafe(24)}",
        display_name="Guest",
        avatar_url="",
        language=language or "th",
        status="ACTIVE",
    )
    db.session.add(guest)
    db.session.flush()
    # 游客同样是一个个人租户：试用期的文件/任务也必须有 tenant_id 归属
    tenant = ensure_personal_tenant(guest)
    resp = _issue_session_response(guest, language)
    subscriptions.ensure_subscription(tenant, commit=True)  # 游客试用同样是 Kinder 一个月
    return resp


@bp.get("/auth/session")
def auth_session():
    """当前会话摘要 + 轮换下发 CSRF token（需登录态，本身不在白名单）。"""
    session = current_session()
    user = current_user()
    csrf = _rotate_csrf(session)
    return ok(
        {
            "user": user.to_dict(),
            "csrf_token": csrf,
            "tenants": list_tenants(user),
            "issued_at": session.issued_at.isoformat() if session.issued_at else None,
            "absolute_expires_at": (
                session.absolute_expires_at.isoformat() if session.absolute_expires_at else None
            ),
        }
    )


@bp.post("/auth/logout")
def auth_logout():
    session = current_session()
    revoke_session(session)
    resp = ok({"logged_out": True})
    clear_session_cookie(resp[0])
    return resp
