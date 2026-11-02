from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Unified error body for every 4xx/5xx response (FR-PLAT-002)."""

    code: str
    message_key: str
    request_id: str
    fields: list[str] | None = None
