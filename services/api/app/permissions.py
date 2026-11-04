"""Permission points (FR-SYS-002, PRD §4.9): fixed at design time; roles combine them."""

from enum import StrEnum


class Permission(StrEnum):
    UPLOAD_OCR = "upload_ocr"  # 上传与识别
    VERIFY_OWN = "verify_own"  # 核验与确认
    VERIFY_OTHERS = "verify_others"  # 核验他人单据
    REVIEW_L1 = "review_l1"  # 一级复核
    REVIEW_L2 = "review_l2"  # 二级复核
    EXPORT = "export"  # 导出
    DATA_BROWSE = "data_browse"  # 数据浏览
    MEMBER_MANAGE = "member_manage"  # 成员管理
    ROLE_MANAGE = "role_manage"  # 角色管理
    PLAN_APPLY = "plan_apply"  # 套餐申请
    VERIFICATION_APPLY = "verification_apply"  # 企业认证申请
    TEMPLATE_MANAGE = "template_manage"  # 模板管理（P1）
    REPORT_VIEW = "report_view"  # 报表查看（P1）


ALL: frozenset[Permission] = frozenset(Permission)
DEFAULT_ROLE: frozenset[Permission] = frozenset(
    {Permission.UPLOAD_OCR, Permission.VERIFY_OWN, Permission.EXPORT}
)


def parse(codes: list[str]) -> frozenset[Permission] | None:
    """The permission set for these codes, or None if any code is unknown."""
    try:
        return frozenset(Permission(c) for c in codes)
    except ValueError:
        return None
