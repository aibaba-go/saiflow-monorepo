"""Request and response models for tenants and organizations (rebuild-tenant-rbac)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class RoleRef(BaseModel):
    id: int
    name: str


class UsableTenantOut(BaseModel):
    tenant_id: int
    kind: Literal["personal", "organization"]
    name: str | None
    is_owner: bool
    role: RoleRef | None
    permissions: list[str]


class OrganizationProfileIn(LooseRequest):
    name: str | None = None
    contact_phone: str | None = None
    address: str | None = None


class ApplicationOut(BaseModel):
    id: int
    name: str
    contact_phone: str
    address: str | None
    status: Literal["pending", "approved", "rejected"]
    reject_reason: str | None
    tenant_id: int | None
    created_at: datetime
    decided_at: datetime | None


class AdminApplicationOut(ApplicationOut):
    applicant_user_id: int


class RejectIn(LooseRequest):
    reason: str | None = None


class OrganizationOut(BaseModel):
    tenant_id: int
    name: str
    contact_phone: str
    address: str | None
    status: Literal["active", "disabled"]
    verification_status: Literal["none", "pending", "verified", "rejected"]
    member_count: int
    created_at: datetime


class OrganizationDetailOut(OrganizationOut):
    """What members see: also the member limit (None = unlimited) and the seats in use,
    open invitations included (FR-SYS-025, FR-SYS-048)."""

    member_limit: int | None
    seats_used: int


class RoleIn(LooseRequest):
    name: str | None = None


class RoleCreateIn(RoleIn):
    permissions: list[str] | None = None


class RoleOut(BaseModel):
    id: int
    name: str
    permissions: list[str]
    is_default: bool


class AssignRoleIn(LooseRequest):
    role_id: int | None = None


class MemberOut(BaseModel):
    user_id: int
    display_name: str | None
    is_owner: bool
    role: RoleRef | None
    joined_at: datetime


class TransferIn(LooseRequest):
    user_id: int | None = None


class InvitationOut(BaseModel):
    id: int
    created_at: datetime
    expires_at: datetime


class InvitationCreatedOut(InvitationOut):
    token: str


class AcceptIn(LooseRequest):
    token: str | None = None


class AcceptedOut(BaseModel):
    tenant_id: int


class VerificationIn(LooseRequest):
    legal_name: str | None = None
    tax_id: str | None = None
    registered_address: str | None = None


class VerificationOut(BaseModel):
    status: Literal["none", "pending", "verified", "rejected"]
    legal_name: str | None
    tax_id: str | None
    registered_address: str | None
    reject_reason: str | None


class AdminVerificationOut(BaseModel):
    id: int
    tenant_id: int
    legal_name: str
    tax_id: str
    registered_address: str
    status: Literal["pending", "approved", "rejected"]
    reject_reason: str | None
    created_at: datetime


class SetVerifiedIn(LooseRequest):
    verified: bool | None = None


class IntSettingOut(BaseModel):
    value: int


class IntSettingIn(LooseRequest):
    value: int | None = None


class RoleAssignedOut(BaseModel):
    user_id: int
    role_id: int


class OwnerTransferredOut(BaseModel):
    owner_user_id: int


class StatusOut(BaseModel):
    status: str


class VerifiedOut(BaseModel):
    verified: bool
