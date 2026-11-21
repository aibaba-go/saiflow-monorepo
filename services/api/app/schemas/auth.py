from typing import Literal

from pydantic import BaseModel

from app.schemas.loose import LooseRequest


class LineLoginRequest(LooseRequest):
    """Either an ID token (LIFF) or an authorization code with its redirect URI (web-pc).
    Every field is optional here; the service decides what is acceptable."""

    id_token: str | None = None
    code: str | None = None
    redirect_uri: str | None = None


class LineLinkRequest(LineLoginRequest):
    email: str | None = None
    password: str | None = None
    email_code: str | None = None


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
    line_linked: bool = False
    impersonated: bool = False  # a platform admin entered as this user (FR-SYS-148)


class EmailAuthCodeRequest(LooseRequest):
    """A login or reset code for a registered email, without a session (FR-SYS-020)."""

    email: str | None = None
    purpose: str | None = None  # "login" or "reset"; checked by the service


class PasswordLoginRequest(LooseRequest):
    email: str | None = None
    password: str | None = None


class EmailCodeLoginRequest(LooseRequest):
    email: str | None = None
    code: str | None = None


class PasswordResetRequest(LooseRequest):
    email: str | None = None
    code: str | None = None
    password: str | None = None


class ImpersonationRedeemRequest(LooseRequest):
    """The one-time ticket from an admin's link (FR-SYS-145); checked by the service."""

    ticket: str | None = None
