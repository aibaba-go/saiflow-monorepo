"""Runtime configuration, read only from environment variables (FR-PLAT-003).

Credentials have no defaults. A missing value stops startup with an error that
names the missing variables and never echoes any provided value.
"""

from typing import Literal

from pydantic import SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    db_host: str
    db_port: int = 5432
    db_name: str
    db_user: str
    db_password: SecretStr
    app_version: str = "dev"
    # Optional integrations: when unset, the features that need them answer 503.
    line_channel_id: str | None = None
    line_channel_secret: SecretStr | None = None
    line_login_redirect_uris: str = ""  # comma-separated allowlist for web-pc LINE login
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str | None = None
    smtp_security: Literal["starttls", "ssl"] = "starttls"


def load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        order = list(Settings.model_fields)
        missing = {str(err["loc"][0]) for err in exc.errors() if err["type"] == "missing"}
        invalid = {str(err["loc"][0]) for err in exc.errors()} - missing
        parts = []
        if missing:
            names = ", ".join(n.upper() for n in order if n in missing)
            parts.append(f"missing configuration: {names}")
        if invalid:
            names = ", ".join(n.upper() for n in order if n in invalid)
            parts.append(f"invalid configuration: {names}")
        raise ConfigError("; ".join(parts)) from None
