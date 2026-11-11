from typing import Literal

from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class LineLoginRequest(LooseRequest):
    """Either an ID token (LIFF) or an authorization code with its redirect URI (web-pc).
    Every field is optional here; the service decides what is acceptable."""

    id_token: str | None = None
    code: str | None = None
    redirect_uri: str | None = None


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
    impersonated: bool = False  # a platform admin entered as this user (FR-SYS-148)


class ImpersonationRedeemRequest(LooseRequest):
    """The one-time ticket from an admin's link (FR-SYS-145); checked by the service."""

    ticket: str | None = None
