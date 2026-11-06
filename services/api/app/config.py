"""Runtime configuration, read only from environment variables (FR-PLAT-003).

Credentials have no defaults. A missing value stops startup with an error that
names the missing variables and never echoes any provided value.
"""

from typing import Literal

from pydantic import Field, SecretStr, ValidationError
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
    # web-pc's own LINE Login channel (same provider, so the same LINE user ID); a LINE MINI
    # App channel has no callback URL. Unset = web login uses line_channel_id as before.
    line_web_channel_id: str | None = None
    line_web_channel_secret: SecretStr | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str | None = None
    smtp_security: Literal["starttls", "ssl"] = "starttls"
    # OCR engine and LLM keys (FR-SYS-005): only their presence is ever reported
    textin_app_id: str | None = None
    textin_secret_code: SecretStr | None = None
    google_vision_api_key: SecretStr | None = None
    llm_api_key: SecretStr | None = None
    # Originals, previews and exports (ocr-scan-flow, ADR-008): a private GCS bucket; unset,
    # uploads and downloads answer 503. The credentials file is a mounted service-account key.
    gcs_bucket: str | None = None
    gcs_credentials_file: str | None = None
    # Signs the 60-second download tickets for exports (FR-ENTRY-015); unset = tickets 503
    download_ticket_secret: SecretStr | None = None
    # Recognition worker (saiflow-be-ocr): OCR_WORKER_ENABLED=false keeps it idle
    ocr_worker_enabled: bool = True
    ocr_poll_seconds: float = Field(default=2.0, ge=0.1, le=60)
    # Reminder process (rebuild-notifications, FR-SYS-037): a pass at least every 30 minutes
    reminders_enabled: bool = True
    reminder_interval_seconds: int = Field(default=900, ge=60, le=1800)


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
