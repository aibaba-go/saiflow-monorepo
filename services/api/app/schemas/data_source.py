from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class SourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=5432, ge=1, le=65535, strict=True)
    database: str = Field(min_length=1, max_length=63)
    username: str = Field(min_length=1, max_length=63)
    password: SecretStr = Field(default=SecretStr(""), max_length=1000)
    ssl_mode: Literal["verify-full"] = "verify-full"
    enabled: bool = True

    @field_validator("host")
    @classmethod
    def clean_host(cls, value: str) -> str:
        import ipaddress
        import re

        value = value.strip().lower().rstrip(".")
        try:
            ipaddress.ip_address(value)
        except ValueError:
            if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", value):
                raise ValueError("invalid host") from None
        return value

    @field_validator("name", "database", "username")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value or "\x00" in value:
            raise ValueError("invalid value")
        return value


class SourceOut(BaseModel):
    id: str
    name: str
    kind: Literal["template", "postgresql", "system_pg"]
    tenant_id: int | None = None
    template_id: int | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    ssl_mode: str | None = None
    password_configured: bool = False
    enabled: bool = True


class SourcesOut(BaseModel):
    items: list[SourceOut]


class SourceQueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sql: str = Field(min_length=1, max_length=20000)
    page: int = Field(default=1, ge=1, le=10000, strict=True)
    page_size: int = Field(default=20, ge=5, le=100, strict=True)


class DataColumn(BaseModel):
    key: str
    label: str
    type: str


class TableResult(BaseModel):
    columns: list[DataColumn]
    rows: list[dict[str, str | None]]
    page: int
    page_size: int
    total: int


class SourceRelation(BaseModel):
    schema_name: str = Field(alias="schema")
    name: str
    kind: Literal["table", "view"]


class SourceTablesOut(BaseModel):
    items: list[SourceRelation]


class ConnectionTestOut(BaseModel):
    ok: bool
