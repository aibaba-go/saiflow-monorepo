"""Organization report DTOs (template-report-management contract §5/§6)."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.data_source import TableResult

PageNumber = Annotated[int, Field(ge=1, le=10000, strict=True)]


class _In(BaseModel):
    """Values are typed `Any` where the service checks them and answers 422 naming the field."""

    model_config = ConfigDict(extra="ignore")


class ReportAssetOut(BaseModel):
    asset_id: str


class ReportContentPolicyOut(BaseModel):
    origins: list[str]


class CreateReportIn(_In):
    name: Any = None


class SaveReportIn(_In):
    revision: Any = None
    name: Any = None
    config: Any = None


class RevisionIn(_In):
    revision: Any = None


class PeriodIn(_In):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    from_: Any = Field(default=None, alias="from")
    to: Any = None


class PreviewIn(_In):
    config: Any = None
    period: PeriodIn | None = None
    pages: dict[str, PageNumber] = Field(default_factory=dict, max_length=30)


class DataIn(_In):
    model_config = ConfigDict(extra="forbid")

    period: PeriodIn | None = None
    refresh: bool = False  # a manual refresh (audited as report.refresh)
    pages: dict[str, PageNumber] = Field(default_factory=dict, max_length=30)


class CsvTicketIn(_In):
    card_id: Any = None
    period: PeriodIn | None = None
    report_version: int | None = Field(default=None, ge=1, strict=True)


class CsvTicketOut(BaseModel):
    url: str


class AdminCreateReportIn(_In):
    tenant_id: Any = None
    name: Any = None


class ReportError(BaseModel):
    card_id: str | None
    path: str
    message: str


class ReportSummary(BaseModel):
    id: int
    name: str
    status: Literal["draft", "published", "changed"]
    published_version: int | None
    published_at: datetime | None
    updated_at: datetime
    revision: int
    can_manage: bool


class ReportListOut(BaseModel):
    items: list[ReportSummary]


class PublishedReport(BaseModel):
    version: int
    name: str
    config: dict
    published_at: datetime
    published_by_user_id: int | None = None
    published_by_admin_id: int | None = None


class SourceVersion(BaseModel):
    id: int
    version: int


class ReportSource(BaseModel):
    """A template the page reads, with the versions it names (FR-REPORT-002): viewers have
    no catalog access, so the page shows these names and version numbers."""

    template_id: int
    name: str
    versions: list[SourceVersion]


class ReportDetail(BaseModel):
    id: int
    tenant_id: int
    name: str
    revision: int
    status: Literal["draft", "published", "changed"]
    draft: dict | None  # managers only
    draft_errors: list[ReportError]
    published: PublishedReport | None
    # templates named by the published config (and the draft, for managers)
    sources: list[ReportSource] = []
    can_manage: bool
    can_export: bool
    created_at: datetime
    updated_at: datetime


class CatalogVersion(BaseModel):
    id: int
    version: int
    name: str
    current: bool


class CatalogTemplate(BaseModel):
    template_id: int
    code: str
    name: str
    scope: Literal["system", "tenant"]
    usable: bool  # false = only kept for versions this report already binds
    versions: list[CatalogVersion]


class CatalogTemplatesOut(BaseModel):
    items: list[CatalogTemplate]


class CatalogGrain(BaseModel):
    grain: Literal["document", "table"]
    table_key: str | None = None
    name: str | None = None
    names: dict | None = None
    versions: list[int]
    compatible: bool


class CatalogField(BaseModel):
    path: str
    name: str
    names: dict | None
    type: str
    grain: Literal["document", "table"]
    table_key: str | None
    versions: list[int]
    compatible: bool


class CatalogFieldsOut(BaseModel):
    grains: list[CatalogGrain]
    fields: list[CatalogField]


class QueryRow(BaseModel):
    dimension: str | None
    series: str | None
    unit: str | None
    value: str | None  # exact decimal string; null = no valid value (never 0)
    count: int
    valid_count: int


class Excluded(BaseModel):
    invalid_number: int = 0
    too_precise: int = 0
    invalid_date: int = 0
    missing_date: int = 0
    empty_row: int = 0
    invalid_structure: int = 0
    missing: int = 0


class Diagnostics(BaseModel):
    documents: int = 0
    items: int = 0
    excluded: Excluded = Field(default_factory=Excluded)


class QueryCard(BaseModel):
    card_id: str | None
    status: Literal["ok", "error", "not_applicable", "empty"]
    error_code: (
        Literal[
            "query_timeout",
            "group_limit",
            "mixed_units",
            "negative_in_pie",
            "invalid_config",
            "row_limit",
            "source_unavailable",
            "source_fields_changed",
        ]
        | None
    )
    period_applied: bool
    rows: list[QueryRow]
    table: TableResult | None = None
    diagnostics: Diagnostics


class QueryPeriod(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str


class QueryResult(BaseModel):
    generated_at: datetime
    period: QueryPeriod
    scope: Literal["all", "own", "synthetic"]
    synthetic: bool
    report_version: int | None  # the published version queried (None = draft preview)
    cards: list[QueryCard]
