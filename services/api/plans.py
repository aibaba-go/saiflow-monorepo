"""套餐目录（PRD v1.4 §20.1 / P15 定价页）。

P0 仅作展示目录：支付完全线下（联系销售开通/续费），无在线下单、
无回调、无自动续费。没有 Free 档位、没有赠送次数：任何租户默认开通
Kinder 一个月，计量统一为 OCR_PAGE（每月页数），到期即停止新建任务，
续费由人工审批 PLAN_UPGRADE 申请时写入有效期。
"""
from __future__ import annotations

# 默认开通的档位与时长（FR-SYS-012/013）
DEFAULT_PLAN_CODE = "KINDER"
DEFAULT_PERIOD_MONTHS = 1
# 人工审批未显式指定有效期时的默认续期月数（Kinder 为年付目录价）
APPROVED_PERIOD_MONTHS = 12

PLAN_CATALOG: list[dict] = [
    {
        "code": "KINDER",
        "name": "Kinder",
        "price": {
            "monthly_thb": None,
            "yearly_thb": 888,
            "display": "THB 888 / year",
        },
        "quota_pages_per_month": 1000,
        "seats": 1,
        "features": ["OCR + Excel export", "TH / EN documents"],
    },
    {
        "code": "STARTER",
        "name": "Starter",
        "price": {
            "monthly_thb": 599,
            "yearly_thb": 5990,
            "display": "THB 599 / mo · THB 5,990 / yr",
        },
        "quota_pages_per_month": 5000,
        "seats": 2,
        "features": ["Approval flow", "Email notifications"],
    },
    {
        "code": "INTERMEDIATE",
        "name": "Intermediate",
        "price": {
            "monthly_thb": None,
            "yearly_thb": None,
            "display": "Contact us",
        },
        "quota_pages_per_month": 10000,
        "seats": 5,
        "features": ["LINE/SMS notifications", "Integration"],
    },
    {
        "code": "ADVANCE",
        "name": "Advance",
        "price": {
            "monthly_thb": None,
            "yearly_thb": None,
            "display": "Contact us",
        },
        "quota_pages_per_month": 100000,
        "seats": 10,
        "features": ["Custom dashboard", "API apps"],
    },
]


def get_plan(code: str) -> dict:
    for plan in PLAN_CATALOG:
        if plan["code"] == code:
            return plan
    return PLAN_CATALOG[0]
