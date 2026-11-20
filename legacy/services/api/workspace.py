"""租户解析（PRD §4.1）：个人租户 + 已授权企业租户。

归属只有一个表达——tenant_id。路由层不再各自判断「是不是企业空间」，
一律通过本模块把外部传入的 tenant_id 解析成可用的 Tenant，或在越权时抛错。
对外错误码沿用既有语义：参数不可用 → error.invalid_workspace（400）；
不是自己的租户 → PERMISSION_DENIED（403）；成员/企业失效 → ENTERPRISE_ACCESS_REVOKED（403）。
"""
from __future__ import annotations

from errors import ApiError, account_disabled, invalid_argument, permission_denied
from extensions import db
from models import Enterprise, Membership, Tenant, User


def _access_revoked() -> ApiError:
    return ApiError(403, "ENTERPRISE_ACCESS_REVOKED", "error.enterprise_access_revoked")


def ensure_personal_tenant(user: User, *, commit: bool = False) -> Tenant:
    """幂等创建/返回用户的个人租户（游客同样有租户）。

    默认只 flush 不 commit：调用方（登录、建上传会话等）会在同一事务里提交，
    避免在 _upsert_line_user 的 SELECT ... FOR UPDATE 期间提前释放行锁（FR-SYS-014）。
    """
    tenant = Tenant.query.filter_by(owner_user_id=user.id).first()
    if tenant is not None:
        return tenant
    tenant = Tenant(
        tenant_type="PERSONAL",
        owner_user_id=user.id,
        display_name=user.display_name or "",
        status="ACTIVE",
    )
    db.session.add(tenant)
    db.session.flush()  # 先拿到 id，业务行才能立刻带上 tenant_id
    if commit:
        db.session.commit()
    return tenant


def resolve_tenant(user: User, tenant_id: int | None = None) -> Tenant:
    """校验并返回可用租户。tenant_id 为空即本人个人租户。

    个人租户必须属于本人；企业租户必须有 ACTIVE 成员行且企业已 VERIFIED；
    任何租户都要求 tenants.status == ACTIVE。
    """
    if tenant_id is None or tenant_id == "":
        return ensure_personal_tenant(user)
    if isinstance(tenant_id, bool) or not isinstance(tenant_id, int):
        try:
            tenant_id = int(tenant_id)
        except (TypeError, ValueError):
            raise invalid_argument("error.invalid_workspace") from None

    tenant = db.session.get(Tenant, tenant_id)
    if tenant is None:
        raise invalid_argument("error.invalid_workspace")

    if tenant.tenant_type == "PERSONAL":
        # 他人的个人租户一律 403，不区分「存在但没权限」与「不存在」之外的细节
        if tenant.owner_user_id != user.id:
            raise permission_denied()
        if tenant.status != "ACTIVE":
            raise account_disabled()
        return tenant

    if tenant.tenant_type != "ENTERPRISE":
        raise invalid_argument("error.invalid_workspace")

    membership = Membership.query.filter_by(tenant_id=tenant.id, user_id=user.id).first()
    enterprise = Enterprise.query.filter_by(tenant_id=tenant.id).first()
    if membership is None or enterprise is None:
        raise permission_denied()
    if membership.status != "ACTIVE":
        raise _access_revoked()
    # 企业可用性仍由人工审核的 enterprises.status 把关（未过审不改变任何现有行为）
    if enterprise.status != "VERIFIED":
        raise _access_revoked()
    if tenant.status != "ACTIVE":
        raise _access_revoked()
    return tenant


def accessible_tenant_ids(user: User) -> list[int]:
    """当前用户可读的租户 ID：个人租户 + ACTIVE 成员的企业租户。

    与改造前 routes/ocr.py 的 _active_enterprise_ids 等价（只看成员是否 ACTIVE）；
    企业「能否开新任务」的 VERIFIED 门禁仍在 resolve_tenant / list_tenants。
    """
    ids = [ensure_personal_tenant(user).id]
    rows = (
        Membership.query.filter_by(user_id=user.id, status="ACTIVE")
        .order_by(Membership.created_at.asc())
        .all()
    )
    for m in rows:
        tenant = db.session.get(Tenant, m.tenant_id)
        if tenant is None or tenant.status != "ACTIVE" or tenant.id in ids:
            continue
        ids.append(tenant.id)
    return ids


def list_tenants(user: User) -> list[dict]:
    """当前有效身份列表（个人租户 + ACTIVE 成员且已 VERIFIED 的企业租户）。"""
    personal = ensure_personal_tenant(user, commit=True)
    out = [
        {
            "tenant_id": personal.id,
            "tenant_type": "PERSONAL",
            "name": None,
            "role": None,
        }
    ]
    rows = (
        Membership.query.filter_by(user_id=user.id, status="ACTIVE")
        .order_by(Membership.created_at.asc())
        .all()
    )
    for m in rows:
        tenant = db.session.get(Tenant, m.tenant_id)
        if tenant is None or tenant.status != "ACTIVE":
            continue
        enterprise = Enterprise.query.filter_by(tenant_id=m.tenant_id).first()
        if enterprise is None or enterprise.status != "VERIFIED":
            continue
        out.append(
            {
                "tenant_id": tenant.id,
                "tenant_type": "ENTERPRISE",
                "name": enterprise.legal_name,
                "role": m.role,
            }
        )
    return out
