"""ORM models (schema saiflow_v3). Importing this package registers every table."""

from app.models.admin import AdminAccount, AdminSession
from app.models.audit import AuditLog
from app.models.billing import FreeQuota, Plan, PlanApplication, QuotaReservation, Subscription
from app.models.document import Export, File, OcrJob, OcrRawResult, ResultVersion
from app.models.email_code import EmailCode
from app.models.notification import Notification, Reminder
from app.models.ocr_engine import OcrEngineHealth
from app.models.organization import (
    Invitation,
    Membership,
    Organization,
    OrganizationApplication,
    Role,
    VerificationApplication,
)
from app.models.review import ResultChange, ReviewLevel, ReviewNotice, ReviewRecord, ReviewRound
from app.models.session import CustomerSession
from app.models.setting import SystemSetting
from app.models.template import DocumentTemplate, DocumentTemplateVersion, TemplateMapping
from app.models.tenant import Tenant
from app.models.user import User

__all__ = [
    "AdminAccount",
    "AdminSession",
    "AuditLog",
    "DocumentTemplate",
    "DocumentTemplateVersion",
    "Export",
    "File",
    "OcrEngineHealth",
    "OcrJob",
    "OcrRawResult",
    "ResultVersion",
    "ResultChange",
    "ReviewLevel",
    "ReviewNotice",
    "ReviewRecord",
    "ReviewRound",
    "TemplateMapping",
    "CustomerSession",
    "EmailCode",
    "FreeQuota",
    "Plan",
    "PlanApplication",
    "QuotaReservation",
    "Reminder",
    "Subscription",
    "Invitation",
    "Membership",
    "Notification",
    "Organization",
    "OrganizationApplication",
    "Role",
    "SystemSetting",
    "VerificationApplication",
    "Tenant",
    "User",
]
