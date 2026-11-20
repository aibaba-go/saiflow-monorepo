"""TextIn settings (rewritten, not moved: main's version carried credential defaults, which
FR-PLAT-003 forbids). Built from app Settings; the keys come only from the environment."""

from dataclasses import dataclass

from app.config import Settings


@dataclass(frozen=True)
class TextInSettings:
    textin_app_id: str
    textin_secret_code: str
    textin_endpoint: str = "https://api.textin.ai/api/v1/xparse/parse/sync"
    textin_extract_endpoint: str = "https://api.textin.ai/api/v1/xparse/extract/sync"
    textin_prompt_endpoint: str = "https://api.textin.ai/ai/service/v2/entity_extraction"
    timeout_seconds: float = 60.0
    prompt_timeout_seconds: float = 180.0
    connect_timeout_seconds: float = 10.0

    def has_credentials(self) -> bool:
        return bool(self.textin_app_id and self.textin_secret_code)


def textin_settings(settings: Settings) -> TextInSettings | None:
    """None when TEXTIN_APP_ID or TEXTIN_SECRET_CODE is missing (the engine is unavailable)."""
    secret = settings.textin_secret_code.get_secret_value() if settings.textin_secret_code else ""
    if not settings.textin_app_id or not secret:
        return None
    return TextInSettings(textin_app_id=settings.textin_app_id, textin_secret_code=secret)
