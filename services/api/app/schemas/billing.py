"""Request and response models for plans, subscriptions, usage and applications
(rebuild-plans-metering)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, field_validator

from app.schemas.loose import LooseRequest

PlanCode = Literal["kinder", "starter", "intermediate", "advance"]
Period = Literal["month", "year"]


class PlanOut(BaseModel):
    code: PlanCode
    monthly_quota: int
    member_limit: int | None  # None = unlimited
    tenant_kind: Literal["personal", "organization"]
    monthly_price: str | None  # THB as a decimal string ("599.00"); None = contact sales
    yearly_price: str | None

    @field_validator("monthly_price", "yearly_price", mode="before")
    @classmethod
    def _decimal_text(cls, v: object) -> str | None:
        return None if v is None else f"{Decimal(str(v)):.2f}"


class PlanUpdateIn(LooseRequest):
    monthly_quota: int | None = None
    member_limit: int | None = None  # JSON null = unlimited; absent = unchanged
    monthly_price: str | int | float | None = None  # null = contact sales
    yearly_price: str | int | float | None = None


class SubscriptionOut(BaseModel):
    id: int
    plan_code: PlanCode
    period: Period
    starts_at: datetime
    ends_at: datetime
    source: Literal["auto", "admin", "application"]
    application_id: int | None


class SubscriptionIn(LooseRequest):
    plan_code: str | None = None
    period: str | None = None
    starts_at: str | None = None  # ISO 8601; omitted = default (FR-SYS-012)
    ends_at: str | None = None


class UsagePlan(BaseModel):
    code: PlanCode
    period: Period
    starts_at: datetime
    ends_at: datetime


class UsageMonth(BaseModel):
    month: date
    quota: int
    used: int
    remaining: int


class UsageFree(BaseModel):
    remaining: int
    expires_at: datetime | None
    paused: bool


class UsageOut(BaseModel):
    plan: UsagePlan | None
    active: bool
    month: UsageMonth
    free: UsageFree


class ReservationOut(BaseModel):
    id: int
    reference: str
    pages: int
    from_free: int
    from_monthly: int
    month: date
    reserved_at: datetime
    released_at: datetime | None


class PlanApplicationIn(LooseRequest):
    plan_code: str | None = None
    period: str | None = None
    note: str | None = None


class PlanApplicationOut(BaseModel):
    id: int
    tenant_id: int
    applicant_user_id: int
    plan_code: PlanCode
    period: Period
    note: str | None
    status: Literal["pending", "approved", "rejected"]
    reject_reason: str | None
    subscription_id: int | None
    created_at: datetime
    decided_at: datetime | None


class ApproveIn(LooseRequest):
    starts_at: str | None = None
    ends_at: str | None = None
