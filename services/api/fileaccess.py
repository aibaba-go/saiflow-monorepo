"""文件对象访问控制：本人范围 + 企业租户 ACTIVE 成员（PRD §14.2/§15）。

跨用户/跨租户资源一律 404，不泄露存在性。
"""
from __future__ import annotations

from errors import not_found
from extensions import db
from models import File, Membership, User


def get_file_for_user(file_id: str, user: User) -> File:
    f = db.session.get(File, file_id)
    if f is None:
        raise not_found()
    if f.created_by_user_id == user.id:
        return f
    if f.tenant_id:
        # memberships 只存在于企业租户，所以按 tenant_id 查到 ACTIVE 成员即代表同企业；
        # 他人的个人租户查不到成员记录，依旧 404。
        m = Membership.query.filter_by(
            tenant_id=f.tenant_id, user_id=user.id, status="ACTIVE"
        ).first()
        if m is not None:
            return f
    raise not_found()
