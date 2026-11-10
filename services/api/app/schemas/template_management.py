"""DTOs of template management (template-report-management: FR-TEMPLATE-001..013, D2/D4/D5).

Content (a draft or an import) is a JSON object shaped like `app/ocr/templates/schema.py`
`TemplateDef` ({code, name, names?, description, groups}); a draft may be incomplete, so it
is typed as a free object here and checked by the service."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Scope = Literal["system", "personal", "organization"]
TemplateStatus = Literal["ENABLED", "DISABLED"]
Source = Literal["manual", "import", "sample"]
GrantMode = Literal["PLANS", "TARGETS"]
PlanCode = Literal["kinder", "starter", "intermediate", "advance"]
ProtectedReason = Literal["applied", "report", "review_settings"]


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ConfigError(BaseModel):
    path: str
    message: str


class PendingConfirmation(BaseModel):
    """A required/primary/role suggestion from a sample that a person must confirm
    (FR-TEMPLATE-008); activation is refused while any is left."""

    path: str
    attr: Literal["required", "primary", "role"]
    value: Any = None


class CurrentVersionBrief(BaseModel):
    id: int
    version: int
    activated_at: datetime


class TemplateSummary(BaseModel):
    id: int
    scope: Scope
    tenant_id: int | None
    code: str
    name: str
    status: TemplateStatus
    has_draft: bool
    current_version: CurrentVersionBrief | None
    revision: int
    can_manage: bool
    deletable: bool
    protected_reasons: list[ProtectedReason]
    updated_at: datetime


class TemplateListOut(BaseModel):
    items: list[TemplateSummary]


class AdminTemplateSummary(TemplateSummary):
    # who owns a tenant template: the user's name or email, or the organization's name
    owner_name: str | None = None


class AdminTemplateListOut(BaseModel):
    items: list[AdminTemplateSummary]


class VersionDetail(BaseModel):
    id: int
    template_id: int
    version: int
    name: str
    description: str | None
    groups: list[dict[str, Any]]
    content_hash: str
    created_at: datetime


class VersionBrief(BaseModel):
    id: int
    version: int
    name: str
    created_at: datetime
    activated_by_user_id: int | None


class GrantUser(BaseModel):
    id: int
    display_name: str | None
    email: str | None


class GrantOrganization(BaseModel):
    tenant_id: int
    name: str


class GrantOut(BaseModel):
    mode: GrantMode | None
    plans: list[PlanCode]
    users: list[GrantUser]
    organizations: list[GrantOrganization]


class TemplateDetail(TemplateSummary):
    draft: dict[str, Any] | None
    draft_errors: list[ConfigError]
    pending_confirmations: list[PendingConfirmation]
    current: VersionDetail | None
    versions: list[VersionBrief]
    grant: GrantOut | None = None  # system templates, admin only
    owner_name: str | None = None  # tenant templates, admin only (see AdminTemplateSummary)


class CreateTemplateIn(_In):
    content: dict[str, Any]
    source: Source = "manual"
    sample_id: str | None = None
    # only for source "sample": the sample suggestions still unconfirmed
    pending_confirmations: list[PendingConfirmation] | None = None


class AdminCreateTemplateIn(_In):
    scope: Literal["system", "tenant"]
    tenant_id: int | None = Field(default=None, gt=0, le=2**63 - 1)
    content: dict[str, Any]
    source: Literal["manual", "import"] = "manual"


class SaveDraftIn(_In):
    revision: int = Field(gt=0)
    content: dict[str, Any]
    # None = keep; else the remaining unconfirmed entries (only removal is possible)
    pending_confirmations: list[PendingConfirmation] | None = None


class RevisionIn(_In):
    revision: int = Field(gt=0)


class StatusIn(_In):
    revision: int = Field(gt=0)
    status: TemplateStatus


class ActivateOut(BaseModel):
    result: Literal["activated", "unchanged"]
    version: VersionDetail
    template: TemplateDetail


class ValidateIn(_In):
    content: dict[str, Any]


class ValidateOut(BaseModel):
    errors: list[ConfigError]


class TemplateExport(BaseModel):
    """The structure only (FR-TEMPLATE-011): no owner, grant, status, version or sample
    values."""

    code: str | None = None
    name: str | None = None
    names: dict[str, Any] | None = None
    description: str | None = None
    groups: list[Any] = Field(default_factory=list)


class GrantsIn(_In):
    revision: int = Field(gt=0)
    mode: GrantMode
    plans: list[PlanCode] = Field(default_factory=list)
    user_ids: list[int] = Field(default_factory=list)
    organization_tenant_ids: list[int] = Field(default_factory=list)


class UserCandidatesOut(BaseModel):
    items: list[GrantUser]


class OrganizationCandidatesOut(BaseModel):
    items: list[GrantOrganization]


class OwnerItem(BaseModel):
    tenant_id: int
    kind: Literal["personal", "organization"]
    name: str | None
    email: str | None = None


class OwnersOut(BaseModel):
    items: list[OwnerItem]
