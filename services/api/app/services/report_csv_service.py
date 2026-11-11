"""CSV export of one published card (FR-REPORT-016): the aggregated rows only, with the
same scope, period, template versions, unit and diagnostics as the view. The whole file is
built in memory before anything is returned, so a failed card never yields a partial file.
Text cells that a spreadsheet would run as a formula are prefixed with "'"; numbers keep
their sign.

In the LINE in-app browser a download leaves for the system browser, which has no session:
as for result exports (FR-ENTRY-015), a 60-second ticket signed with DOWNLOAD_TICKET_SECRET
names the report, card, period, user and session, and redeeming it re-checks the session and
every right before the file is built."""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.errors import AppError
from app.models import CustomerSession
from app.services import report_query_service, report_service, tenant_access
from app.services.export_service import TICKET_TTL
from app.services.export_service import _key as ticket_key
from app.services.report_config import CardSpec, validate
from app.services.report_service import audit_now, audit_target, user_actor
from app.services.session_service import CUSTOMER_IDLE, Principal
from app.services.tenant_access import TenantContext, not_found, submitter_scope

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
HEADER = ("dimension", "series", "unit", "value", "count", "valid_count")


def guard(cell: Any) -> str:
    """A text cell as written: never starts like a formula."""
    if cell is None:
        return ""
    text = str(cell)
    return "'" + text if text.startswith(FORMULA_START) else text


def number(cell: Any) -> str:
    return "" if cell is None else str(cell)


def render(
    *,
    report_name: str,
    version: int,
    spec: CardSpec,
    result: dict,
    card: dict,
) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    diag = card["diagnostics"]
    unit = spec.unit_value if spec.unit_mode == "fixed" else ("field" if spec.unit_mode else "")
    meta = [
        ("report", guard(report_name)),
        ("published_version", number(version)),
        ("card", guard(spec.title)),
        ("card_id", guard(spec.id)),
        ("type", spec.type),
        ("aggregation", spec.agg),
        ("measure", guard(spec.measure.path if spec.measure else "")),
        ("period_from", result["period"]["from"]),
        ("period_to", result["period"]["to"]),
        ("period_applied", "true" if card["period_applied"] else "false"),
        ("template_id", number(spec.template_id)),
        ("template_version_ids", ";".join(str(v) for v in spec.version_ids)),
        ("grain", spec.grain if spec.grain == "document" else f"table:{spec.table_key}"),
        ("scope", result["scope"]),
        ("unit", guard(unit)),
        ("documents", number(diag["documents"])),
        ("items", number(diag["items"])),
    ]
    meta += [(f"excluded_{k}", number(v)) for k, v in diag["excluded"].items()]
    meta.append(("generated_at", result["generated_at"].isoformat()))
    for row in meta:
        w.writerow(row)
    w.writerow([])
    w.writerow(HEADER)
    for r in card["rows"]:
        w.writerow(
            [
                guard(r["dimension"]),
                guard(r["series"]),
                guard(r["unit"]),
                number(r["value"]),
                number(r["count"]),
                number(r["valid_count"]),
            ]
        )
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


async def export(
    db: AsyncSession,
    ctx: TenantContext,
    report_id: int,
    card_id: str,
    period: Any,
    expected_version: int | None = None,
) -> tuple[bytes, str]:
    """Same published definition as the view; compare the very snapshot used by the query."""
    report, snap = await report_service.published_page(db, ctx, report_id)
    if expected_version is not None and snap.version != expected_version:
        raise AppError(409, "revision_conflict", "error.revision_conflict")
    # read before the card query ends the transaction
    rid, version, name, config = report.id, snap.version, snap.name, snap.config
    versions = await report_service.snapshot_versions(db, config)
    check = validate(config, versions)
    if card_id not in check.card_ids:
        raise not_found()
    spec = check.cards.get(card_id)
    override = report_service.parse_period(period)
    result = await report_query_service.run_page(
        db,
        config=config,
        versions=versions,
        tenant_id=ctx.tenant_id,
        scope_user_id=submitter_scope(ctx),
        override=override,
        now=utcnow(),
        only_card=card_id,
    )
    card = result["cards"][0]
    target = audit_target(
        ctx.tenant_id,
        rid,
        version=version,
        period=(result["period"]["from"], result["period"]["to"]),
        scope=result["scope"],
        card_id=card_id,
        code=card["error_code"],
    )
    if spec is None or card["status"] == "error":
        await audit_now(db, user_actor(ctx), "csv", target, "failure")
        exc = AppError(
            409,
            "report_export_failed",
            "error.report_export_failed",
            details={"card_id": card_id, "error_code": card["error_code"] or "invalid_config"},
        )
        exc.audited = True  # type: ignore[attr-defined]
        raise exc
    body = render(report_name=name, version=version, spec=spec, result=result, card=card)
    await audit_now(db, user_actor(ctx), "csv", target)
    return body, f"report-{rid}-{card_id}.csv"


# a report ticket can never be read as a result-export ticket, nor the other way round
_TICKET_DOMAIN = b"report-csv."


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(key: bytes, body: str) -> bytes:
    return hmac.new(key, _TICKET_DOMAIN + body.encode("ascii"), hashlib.sha256).digest()


async def ticket(
    db: AsyncSession,
    settings: Settings,
    ctx: TenantContext,
    principal: Principal,
    report_id: int,
    card_id: str,
    period: Any,
    expected_version: int | None = None,
) -> str:
    """A 60-second CSV link bound to this session AND immutable published definition."""
    key = ticket_key(settings)
    await report_service.require(db, ctx, "view", "export")
    override = report_service.parse_period(period)
    _, snap = await report_service.published_page(db, ctx, report_id)
    if expected_version is not None and snap.version != expected_version:
        raise AppError(409, "revision_conflict", "error.revision_conflict")
    cards = snap.config.get("cards") if isinstance(snap.config, dict) else None
    if not any(isinstance(c, dict) and c.get("id") == card_id for c in cards or []):
        raise not_found()
    payload = {
        "t": ctx.tenant_id,
        "r": report_id,
        "v": snap.version,
        "c": card_id,
        "p": override,
        "u": principal.user_id or 0,
        "s": principal.session_id,
        "e": int((utcnow() + TICKET_TTL).timestamp()),
    }
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"/api/v1/report-downloads/{body}.{_b64(_sign(key, body))}"


async def redeem(
    db: AsyncSession, settings: Settings, token: str
) -> tuple[TenantContext, int, str, dict | None, int]:
    """(context, report, card, period, published version); invalid tickets are opaque."""
    key = ticket_key(settings)
    try:
        body, sig = token.split(".", 1)
        good = hmac.compare_digest(_unb64(sig), _sign(key, body))
        raw = json.loads(_unb64(body).decode("utf-8"))
        tenant_id, report_id, card_id = int(raw["t"]), int(raw["r"]), str(raw["c"])
        user, sid, until = int(raw["u"]), int(raw["s"]), int(raw["e"])
        period = raw["p"]
        version = raw["v"]
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise ValueError("Invalid published version")
    except (ValueError, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise not_found() from None
    now = utcnow()
    if not good or until < int(now.timestamp()):
        raise not_found()
    session = await db.get(CustomerSession, sid)
    if (
        session is None
        or session.revoked_at is not None
        or now - session.last_used_at > CUSTOMER_IDLE
        or (session.user_id or 0) != user
    ):
        raise not_found()
    principal = Principal(session.kind, session.id, session.tenant_id, session.user_id)  # type: ignore[arg-type]
    ctx = await tenant_access.resolve_tenant(db, principal, tenant_id)
    return ctx, report_id, card_id, period, version
