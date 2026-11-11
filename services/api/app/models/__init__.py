"""ORM models (schema saiflow_v3). Importing this package registers every table."""

from app.models.admin import AdminAccount, AdminSession
from app.models.audit import AuditLog
from app.models.billing import FreeQuota, Plan, PlanApplication, QuotaReservation, Subscription
from app.models.document import Export, File, OcrJob, OcrRawResult, ResultVersion
from app.models.email_code import EmailCode
from app.models.impersonation import ImpersonationTicket
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
from app.models.report import Report, ReportSnapshot, ReportTemplateRef
from app.models.review import ResultChange, ReviewLevel, ReviewNotice, ReviewRecord, ReviewRound
from app.models.session import CustomerSession
from app.models.setting import SystemSetting
from app.models.template import (
    DocumentTemplate,
    DocumentTemplateVersion,
    TemplateGrantTarget,
    TemplateMapping,
)
from app.models.template_sample import TemplateSample
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
    "ImpersonationTicket",
    "OcrEngineHealth",
    "OcrJob",
    "OcrRawResult",
    "ResultVersion",
    "Report",
    "ReportSnapshot",
    "ReportTemplateRef",
    "ResultChange",
    "ReviewLevel",
    "ReviewNotice",
    "ReviewRecord",
    "ReviewRound",
    "TemplateGrantTarget",
    "TemplateMapping",
    "TemplateSample",
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
