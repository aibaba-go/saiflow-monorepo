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
    # web-pc's public origin, e.g. https://saiflow-app.aibaba.asia: where an admin's
    # "log in as this user" link points (FR-SYS-145); unset = that link answers 503
    web_pc_origin: str | None = None
    report_embed_origins: str = ""
    data_source_key: SecretStr | None = None
    data_source_allowed_hosts: str = ""
    report_db_user: str = "saiflow_v3_reporter"
    report_db_password: SecretStr | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str | None = None
    smtp_security: Literal["starttls", "ssl"] = "starttls"
    # OCR engine and LLM keys (FR-SYS-005): only their presence is ever reported
    textin_app_id: str | None = None
    textin_secret_code: SecretStr | None = None
    llm_api_key: SecretStr | None = None
    # Google Document AI OCR (FR-OCR-027): the processor; its credentials are the GCS
    # service-account key below. Unset project/processor = the engine is unavailable.
    docai_project_id: str | None = None
    docai_location: str = "asia-southeast1"
    docai_processor_id: str | None = None
    docai_processor_version: str | None = None  # unset = the processor's default version
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
    # Local development (NFR-DEV-001/002): production-like unless set explicitly. The
    # restricted dev login also needs DEV_LOGIN_ENABLED and an isolated loopback database.
    app_env: str = "production"
    dev_login_enabled: bool = False


DEVELOPMENT = "development"
LOOPBACK_DB_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
DEV_DB_NAME = "saiflow_dev"


def is_isolated_dev_target(db_host: str, db_name: str) -> bool:
    """A local development database (NFR-DEV-001): loopback host and the name saiflow_dev
    or saiflow_dev_<suffix>. Never the restored saiflow database or a remote server."""
    host = db_host.strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    named = db_name == DEV_DB_NAME or (
        db_name.startswith(DEV_DB_NAME + "_") and len(db_name) > len(DEV_DB_NAME) + 1
    )
    return host in LOOPBACK_DB_HOSTS and named


def is_development(settings: Settings) -> bool:
    return settings.app_env.strip().lower() == DEVELOPMENT


def check_dev_login(settings: Settings) -> None:
    """Fail closed (AC-NFR-DEV-002-02): the dev login switch is refused at startup unless
    APP_ENV=development and the database is an isolated local target. Values never echo."""
    if not settings.dev_login_enabled:
        return
    if not is_development(settings):
        raise ConfigError("invalid configuration: DEV_LOGIN_ENABLED requires APP_ENV=development")
    if not is_isolated_dev_target(settings.db_host, settings.db_name):
        raise ConfigError(
            "invalid configuration: DEV_LOGIN_ENABLED requires a loopback DB_HOST and "
            "DB_NAME saiflow_dev or saiflow_dev_*"
        )


def dev_login_active(settings: Settings) -> bool:
    """Whether the restricted dev login may be used at all (checked again per request)."""
    return (
        settings.dev_login_enabled
        and is_development(settings)
        and is_isolated_dev_target(settings.db_host, settings.db_name)
    )


def load_settings() -> Settings:
    settings = _read_settings()
    check_dev_login(settings)
    return settings


def _read_settings() -> Settings:
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
