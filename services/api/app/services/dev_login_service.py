"""Restricted local development login (NFR-DEV-002) and its idempotent seed.

Only with APP_ENV=development, DEV_LOGIN_ENABLED=true, an isolated loopback database
(app.config.dev_login_active) and a loopback client does the reserved token stand for one
fixed reserved identity. The request never chooses a user: any other token goes through
real LINE verification. Sessions, CSRF, tenancy, registration, plans and audit are the
real ones; customer users are never platform admins (admins are separate accounts)."""

import ipaddress
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, dev_login_active, is_development, is_isolated_dev_target
from app.errors import AppError
from app.integrations.line import LineIdentity
from app.schemas.auth import LineLoginRequest

DEV_LOGIN_TOKEN = "saiflow-local-development"
# Real LINE user IDs are "U" + 32 hex digits, so this can never be someone's LINE account.
DEV_LINE_USER_ID = "Udev-saiflow-local-0001"
DEV_DISPLAY_NAME = "SaiFlow Dev"
DEV_EMAIL = "dev@saiflow-local.example"  # RFC 2606 reserved: no mail is ever delivered

DEV_IDENTITY = LineIdentity(
    sub=DEV_LINE_USER_ID, name=DEV_DISPLAY_NAME, picture=None, email=DEV_EMAIL
)


def is_loopback_client(host: str | None) -> bool:
    """The TCP peer is this machine (127.0.0.0/8, ::1, or IPv4-mapped loopback)."""
    if not host:
        return False
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    mapped = getattr(address, "ipv4_mapped", None)
    return (mapped or address).is_loopback


def _hostname(authority: str) -> str:
    """The host part of a Host header value or of an Origin's authority, lower-cased."""
    authority = authority.strip().lower()
    if authority.startswith("["):  # [::1]:5173
        return authority[1 : authority.find("]")] if "]" in authority else ""
    return authority.rsplit(":", 1)[0] if authority.count(":") == 1 else authority


def is_loopback_name(hostname: str) -> bool:
    return hostname == "localhost" or is_loopback_client(hostname)


def is_loopback_browser(host_header: str | None, origin: str | None) -> bool:
    """The browser addressed this machine: through the local Vite proxy every request's TCP
    peer is 127.0.0.1, but the proxy passes on the Host the browser used (both vite.config.ts
    set changeOrigin: false), so a LAN device (vite --host) or a DNS-rebinding page is still
    told apart. An Origin, when sent, must be loopback as well."""
    if not host_header or not is_loopback_name(_hostname(host_header)):
        return False
    if origin is None:
        return True
    scheme, sep, rest = origin.partition("://")
    if not sep or scheme not in ("http", "https"):
        return False
    return is_loopback_name(_hostname(rest.split("/")[0]))


def carries_dev_token(req: LineLoginRequest) -> bool:
    """Exactly the reserved token, as the LIFF id_token or as the web-pc code."""
    return (req.id_token == DEV_LOGIN_TOKEN and not req.code) or (
        req.code == DEV_LOGIN_TOKEN and not req.id_token
    )


def dev_identity_for(
    settings: Settings,
    req: LineLoginRequest,
    client_host: str | None,
    host_header: str | None = None,
    origin: str | None = None,
):
    """The fixed dev identity for an allowed dev login, None for the normal LINE path.

    With the switch off the reserved token is an ordinary (invalid) LINE token. With the
    switch on, the reserved token from a non-loopback client, or from a browser that did not
    address this machine, fails like an invalid token, without being sent to LINE."""
    if not dev_login_active(settings) or not carries_dev_token(req):
        return None
    if not is_loopback_client(client_host) or not is_loopback_browser(host_header, origin):
        raise AppError(401, "line_token_invalid", "auth.line_token_invalid")
    return DEV_IDENTITY


def seed_allowed(settings: Settings) -> bool:
    """dev-seed writes only into an isolated local development database."""
    return is_development(settings) and is_isolated_dev_target(settings.db_host, settings.db_name)


class _CapturingSender:
    """Receives the one verification email of the seed's registration, never sends it."""

    def __init__(self) -> None:
        self.body = ""

    async def send(self, to: str, subject: str, body: str) -> None:
        self.body = body


def _code_from(body: str) -> str:
    return next(word.strip(".") for word in body.split() if word.strip(".").isdigit())


async def seed(db: AsyncSession, now: datetime) -> tuple[int, int]:
    """Create or bring up to date the fixed dev user: the user with its personal tenant and
    default plan (as at a first LINE login), registration through the real email-code flow,
    and a current plan period. Returns (user id, personal tenant id). Idempotent."""
    from app.services import auth_service, email_code_service, subscription_service, user_service

    user, tenant_id = await auth_service.ensure_user(db, DEV_IDENTITY)
    if user.registered_at is None:
        sender = _CapturingSender()
        await email_code_service.send_code(db, sender, user.id, DEV_EMAIL)  # type: ignore[arg-type]
        await user_service.register(
            db, user.id, DEV_EMAIL, _code_from(sender.body), DEV_DISPLAY_NAME, None
        )
    sub = await subscription_service.current(db, tenant_id, now)
    if sub is None or sub.ends_at <= now:  # neither a current nor an upcoming period
        await subscription_service.start_default(db, tenant_id, now)
        await db.commit()
    return user.id, tenant_id
