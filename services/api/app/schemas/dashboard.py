from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class DashboardUsage(BaseModel):
    plan_code: str | None
    ends_at: datetime | None
    quota: int
    used: int
    remaining: int
    free_remaining: int
    free_expires_at: datetime | None
    free_paused: bool
    plan_active: bool


class DashboardJob(BaseModel):
    id: str
    original_name: str
    stage: str
    created_at: datetime


class HomepageTemplate(BaseModel):
    id: str
    kind: Literal["personal", "organization"]
    name: str
    source_id: Literal["system-pg"]
    readonly: Literal[True]
    config: dict


class HomepageTemplatesOut(BaseModel):
    items: list[HomepageTemplate]


class DashboardOut(BaseModel):
    kind: Literal["personal", "organization"]
    config: dict
    counts: dict[str, int]
    usage: DashboardUsage
    recent: list[DashboardJob]
    generated_at: datetime
