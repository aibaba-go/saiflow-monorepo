from typing import Literal

from pydantic import BaseModel


class MeResponse(BaseModel):
    kind: Literal["guest", "user"]
    tenant_id: int
    user_id: int | None
    registered: bool
    display_name: str | None = None
    avatar_url: str | None = None
    email: str | None = None
    phone: str | None = None
    email_suggestion: str | None = None  # LINE email, offered only before registration
