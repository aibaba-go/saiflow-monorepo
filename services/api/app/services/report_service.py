"""Organization reports: access gate, configuration lifecycle, template binding refs,
catalog and the audited entry points of the queries (FR-REPORT-001..006/014..017,
FR-SYS-139; contract §5/§6).

- Gate: the tenant is an enabled organization (resolve_tenant) with an active starter /
  intermediate / advance subscription, otherwise 403 report_unavailable. Manage = owner or
  report_manage, view = owner or report_view, CSV = view and export; managing never grants
  viewing (FR-REPORT-001/005). The data scope is always computed here (submitter scope).
- Lifecycle: drafts may be incomplete (problems listed in `draft_errors`); save, publish,
  unpublish and delete compare the revision (409 revision_conflict). Publish validates the
  whole page (422 report_invalid, details.errors) and appends an immutable snapshot.
- Binding (FR-REPORT-006, FR-TEMPLATE-010): a card may bind versions of templates the tenant
  may newly use, or versions the same saved/published card already binds (history after a
  revoke / disable). Refs are rewritten under lock: report row first, then each template
  by id (`template_access.lock_template`), re-checking it is not deleted and, for a new
  binding, still usable.
- Audit: create/save/publish/unpublish/delete, preview/view/refresh/csv, and refusals,
  never with values (FR-REPORT-004)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import (
    DocumentTemplate,
    DocumentTemplateVersion,
    Organization,
    Tenant,
)
from app.models.report import Report, ReportSnapshot, ReportTemplateRef
from app.permissions import Permission
from app.services import audit_service, report_query_service, template_access
from app.services.audit_service import AuditEvent
from app.services.report_config import (
    MAX_NAME,
    VersionDef,
    bound_versions,
    catalog,
    empty_config,
    period_invalid,
    storable_errors,
    validate,
)
from app.services.tenant_access import TenantContext, not_found, submitter_scope

REPORT_PLANS = frozenset({"starter", "intermediate", "advance"})
TARGET_TYPE = "report"
AUDITED_FAILURES = (403, 409, 422)


# ---------------------------------------------------------------- actors and audit


@dataclass(frozen=True)
class Actor:
    kind: Literal["user", "admin"]
    id: int | None
    tenant_id: int

    @property
    def audit_id(self) -> str | None:
        return None if self.id is None else str(self.id)


def user_actor(ctx: TenantContext) -> Actor:
    return Actor("user", ctx.user_id, ctx.tenant_id)


def admin_actor(admin_id: int, tenant_id: int) -> Actor:
    return Actor("admin", admin_id, tenant_id)


def audit_target(
    tenant_id: int,
    report_id: int | None,
    *,
    version: int | None = None,
    revision: int | None = None,
    period: tuple[str, str] | None = None,
    scope: str | None = None,
    card_id: str | None = None,
    code: str | None = None,
) -> str:
    """Who/what, never a value: tenant/report[/v<published>][/r<revision>][/<from>..<to>]
    [/scope=all|own|synthetic][/card=<id>][/<error codes>]."""
    parts = [str(tenant_id), "-" if report_id is None else str(report_id)]
    if version is not None:
        parts.append(f"v{version}")
    if revision is not None:
        parts.append(f"r{revision}")
    if period is not None:
        parts.append(f"{period[0]}..{period[1]}")
    if scope is not None:
        parts.append(f"scope={scope}")
    if card_id is not None:
        parts.append(f"card={card_id}")
    if code:
        parts.append(code)
    return "/".join(parts)


async def audit(
    db: AsyncSession, actor: Actor, action: str, target: str, result: str = "success"
) -> None:
    await audit_service.record(
        db,
        AuditEvent(actor.kind, actor.audit_id, f"report.{action}", TARGET_TYPE, target, result),  # type: ignore[arg-type]
    )


async def audit_now(
    db: AsyncSession, actor: Actor, action: str, target: str, result: str = "success"
) -> None:
    """An entry in its own transaction (nothing else of the request is kept)."""
    await db.rollback()
    await audit(db, actor, action, target, result)
    await db.commit()


async def audited[T](
    db: AsyncSession,
    actor: Actor,
    action: str,
    report_id: int | None,
    fn: Callable[[], Awaitable[T]],
) -> T:
    """Run a request; a refusal (denied, conflict, invalid) is rolled back and logged as a
    failure in its own transaction. 404s are not logged (they reveal nothing new)."""
    try:
        return await fn()
    except AppError as exc:
        if exc.status in AUDITED_FAILURES and not getattr(exc, "audited", False):
            await audit_now(
                db,
                actor,
                action,
                audit_target(actor.tenant_id, report_id, code=exc.code),
                "failure",
            )
        raise


# ---------------------------------------------------------------- errors and access


def unavailable() -> AppError:
    return AppError(403, "report_unavailable", "error.report_unavailable")


def denied() -> AppError:
    return AppError(403, "permission_denied", "error.permission_denied")


def revision_conflict(current: int) -> AppError:
    return AppError(
        409, "revision_conflict", "error.revision_conflict", details={"revision": current}
    )


def invalid(errors: list[dict]) -> AppError:
    return AppError(422, "report_invalid", "error.report_invalid", details={"errors": errors})


def validation_error(fields: list[str]) -> AppError:
    return AppError(422, "validation_error", "error.validation", fields)


async def gate(db: AsyncSession, ctx: TenantContext) -> None:
    """Enabled organization (checked by resolve_tenant) with an active Starter+ plan."""
    if ctx.kind != "organization":
        raise unavailable()
    if await template_access.active_plan(db, ctx.tenant_id) not in REPORT_PLANS:
        raise unavailable()


def can_manage(ctx: TenantContext) -> bool:
    return ctx.is_owner or ctx.has(Permission.REPORT_MANAGE)


def can_view(ctx: TenantContext) -> bool:
    return ctx.is_owner or ctx.has(Permission.REPORT_VIEW)


def can_export(ctx: TenantContext) -> bool:
    return can_view(ctx) and (ctx.is_owner or ctx.has(Permission.EXPORT))


async def require(db: AsyncSession, ctx: TenantContext, *needs: str) -> None:
    """The gate, then each named right: "manage", "view", "export", "any" (manage or view)."""
    await gate(db, ctx)
    for need in needs:
        ok = {
            "manage": can_manage,
            "view": can_view,
            "export": can_export,
            "any": lambda c: can_manage(c) or can_view(c),
        }[need](ctx)
        if not ok:
            raise denied()


async def organization_tenant(db: AsyncSession, tenant_id: Any) -> int:
    """The admin's target: an existing organization tenant, otherwise 404."""
    if not isinstance(tenant_id, int) or isinstance(tenant_id, bool) or not 0 < tenant_id < 2**63:
        raise not_found()
    row = (
        await db.execute(
            select(Tenant.id)
            .join(Organization, Organization.tenant_id == Tenant.id)
            .where(Tenant.id == tenant_id, Tenant.kind == "organization")
        )
    ).scalar_one_or_none()
    if row is None:
        raise not_found()
    return tenant_id


async def admin_report_tenant(db: AsyncSession, report_id: int, tenant_id: Any = None) -> int:
    """The organization tenant of a live report for the admin routes (404 otherwise; a
    given tenant_id must match)."""
    found = (
        await db.execute(
            select(Report.tenant_id).where(Report.id == report_id, Report.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if found is None or (tenant_id is not None and tenant_id != found):
        raise not_found()
    return await organization_tenant(db, found)


async def get_report(
    db: AsyncSession, tenant_id: int, report_id: int, *, for_update: bool = False
) -> Report:
    q = select(Report).where(
        Report.id == report_id, Report.tenant_id == tenant_id, Report.deleted_at.is_(None)
    )
    if for_update:
        q = q.with_for_update().execution_options(populate_existing=True)
    report = (await db.execute(q)).scalar_one_or_none()
    if report is None:
        raise not_found()
    return report


async def snapshot_of(db: AsyncSession, report: Report) -> ReportSnapshot | None:
    if report.published_snapshot_id is None:
        return None
    return await db.get(ReportSnapshot, report.published_snapshot_id)


def _status(report: Report, snap: ReportSnapshot | None) -> str:
    if snap is None:
        return "draft"
    return "published" if snap.config == report.draft and snap.name == report.name else "changed"


def _check_name(name: Any) -> str:
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= MAX_NAME:
        raise validation_error(["name"])
    return name.strip()


def _check_revision(report: Report, revision: Any) -> None:
    if not isinstance(revision, int) or isinstance(revision, bool):
        raise validation_error(["revision"])
    if report.revision != revision:
        raise revision_conflict(report.revision)


# ---------------------------------------------------------------- versions a report may bind


async def _version_defs(db: AsyncSession, version_ids: set[int] | None, *, template_ids=None):
    q = select(DocumentTemplateVersion)
    if version_ids is not None:
        q = q.where(DocumentTemplateVersion.id.in_(version_ids))
    if template_ids is not None:
        q = q.where(DocumentTemplateVersion.template_id.in_(template_ids))
    rows = (await db.execute(q)).scalars().all()
    return {v.id: VersionDef(v.id, v.template_id, v.version, v.groups) for v in rows}


async def _ref_version_ids(db: AsyncSession, report_id: int | None) -> set[int]:
    if report_id is None:
        return set()
    rows = await db.execute(
        select(ReportTemplateRef.template_version_id)
        .join(DocumentTemplate, DocumentTemplate.id == ReportTemplateRef.template_id)
        .where(ReportTemplateRef.report_id == report_id, DocumentTemplate.deleted_at.is_(None))
    )
    return set(rows.scalars())


async def usable_template_ids(db: AsyncSession, tenant_id: int) -> set[int]:
    cond = await template_access.usable_condition(db, tenant_id)
    return set((await db.execute(select(DocumentTemplate.id).where(cond))).scalars())


async def allowed_versions(
    db: AsyncSession, tenant_id: int, report_id: int | None
) -> dict[int, VersionDef]:
    """Every version of a template this tenant may newly use, plus the versions this
    report already binds (as long as their template is not deleted)."""
    usable = await usable_template_ids(db, tenant_id)
    out = await _version_defs(db, None, template_ids=usable) if usable else {}
    kept = await _ref_version_ids(db, report_id) - set(out)
    if kept:
        out.update(await _version_defs(db, kept))
    return out


async def snapshot_versions(db: AsyncSession, config: Any) -> dict[int, VersionDef]:
    """A published page reads exactly the versions it names (history stays readable)."""
    ids = {vid for _, vid in bound_versions(config)}
    return await _version_defs(db, ids) if ids else {}


def _card_bindings(config: Any) -> set[tuple[str, int, int]]:
    """Exact card/template/version identities, never report-wide historical permission."""
    cards = config.get("cards") if isinstance(config, dict) else None
    out: set[tuple[str, int, int]] = set()
    for card in cards if isinstance(cards, list) else []:
        cid = card.get("id") if isinstance(card, dict) else None
        if isinstance(cid, str) and 1 <= len(cid) <= 64:
            out.update((cid, tid, vid) for tid, vid in bound_versions({"cards": [card]}))
    return out


async def _kept_bindings(db: AsyncSession, report_id: int) -> set[tuple[str, int, int]]:
    rows = await db.execute(
        select(
            ReportTemplateRef.card_id,
            ReportTemplateRef.template_id,
            ReportTemplateRef.template_version_id,
        )
        .join(DocumentTemplate, DocumentTemplate.id == ReportTemplateRef.template_id)
        .where(
            ReportTemplateRef.report_id == report_id,
            ReportTemplateRef.card_id.is_not(None),
            DocumentTemplate.deleted_at.is_(None),
        )
    )
    return {tuple(r) for r in rows}  # type: ignore[misc]


def _binding_problems(config: Any, rejected: set[tuple[str, int, int]]) -> list[dict]:
    cards = config.get("cards") if isinstance(config, dict) else None
    out = []
    for i, card in enumerate(cards if isinstance(cards, list) else []):
        data = card.get("data") if isinstance(card, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get("template_version_ids"), list):
            continue
        for j, vid in enumerate(data["template_version_ids"]):
            identity = (card.get("id"), data.get("template_id"), vid)
            # Malformed values are handled by validate, not used as hash keys here.
            if all(isinstance(v, (str, int)) for v in identity) and identity in rejected:
                out.append(
                    {
                        "card_id": card.get("id"),
                        "path": f"cards[{i}].data.template_version_ids[{j}]",
                        "message": "a new card binding requires an available template",
                    }
                )
    return out


async def binding_errors(
    db: AsyncSession, tenant_id: int, report_id: int, config: Any
) -> list[dict]:
    usable = await usable_template_ids(db, tenant_id)
    kept = await _kept_bindings(db, report_id)
    rejected = {p for p in _card_bindings(config) if p[1] not in usable and p not in kept}
    return _binding_problems(config, rejected)


async def _write_refs(
    db: AsyncSession,
    report: Report,
    tenant_id: int,
    kinds: tuple[str, ...],
    config: Any,
    allowed: dict[int, VersionDef],
    *,
    strict: bool,
) -> list[dict]:
    """Lock report first then templates in id order; persist only eligible exact card
    bindings. An invalid saved draft must never launder a rejected binding into history
    (AC-FR-REPORT-006-03 / 014-01). NULL legacy refs do not grant historical authorization."""
    pairs = {
        (cid, tid, vid)
        for cid, tid, vid in _card_bindings(config)
        if vid in allowed and allowed[vid].template_id == tid
    }
    before = await _kept_bindings(db, report.id)
    rejected: set[tuple[str, int, int]] = set()
    for tid in sorted({tid for _, tid, _ in pairs}):
        tpl = await template_access.lock_template(db, tid)
        usable = (
            tpl is not None
            and tpl.deleted_at is None
            and await template_access.is_usable(db, tenant_id, tid)
        )
        rejected.update(
            p
            for p in pairs
            if p[1] == tid
            and (tpl is None or tpl.deleted_at is not None or (not usable and p not in before))
        )
    problems = _binding_problems(config, rejected)
    if problems and strict:
        return problems
    pairs -= rejected
    await db.execute(
        delete(ReportTemplateRef).where(
            ReportTemplateRef.report_id == report.id, ReportTemplateRef.kind.in_(kinds)
        )
    )
    for kind in kinds:
        for cid, tid, vid in sorted(pairs):
            db.add(
                ReportTemplateRef(
                    report_id=report.id,
                    kind=kind,
                    card_id=cid,
                    template_id=tid,
                    template_version_id=vid,
                )
            )
    await db.flush()
    return problems


# ---------------------------------------------------------------- reading


async def summaries(db: AsyncSession, tenant_id: int, *, manage: bool, view: bool) -> list[dict]:
    q = (
        select(Report, ReportSnapshot)
        .outerjoin(ReportSnapshot, ReportSnapshot.id == Report.published_snapshot_id)
        .where(Report.tenant_id == tenant_id, Report.deleted_at.is_(None))
        .order_by(Report.updated_at.desc(), Report.id.desc())
    )
    if not manage:
        q = q.where(Report.published_snapshot_id.is_not(None))
    out = []
    for report, snap in (await db.execute(q)).all():
        out.append(
            {
                "id": report.id,
                "name": report.name if manage else snap.name,
                "status": _status(report, snap),
                "published_version": snap.version if snap else None,
                "published_at": snap.published_at if snap else None,
                "updated_at": report.updated_at,
                "revision": report.revision,
                "can_manage": manage,
            }
        )
    return out


async def _sources(db: AsyncSession, configs: list[Any]) -> list[dict]:
    """Template names and version numbers of the bindings in `configs` (FR-REPORT-002).
    A binding whose version is not of the named template is left out."""
    pairs: set[tuple[int, int]] = set()
    for config in configs:
        pairs |= bound_versions(config)
    if not pairs:
        return []
    rows = (
        await db.execute(
            select(
                DocumentTemplate.id,
                DocumentTemplate.name,
                DocumentTemplateVersion.id,
                DocumentTemplateVersion.version,
            )
            .join(
                DocumentTemplateVersion, DocumentTemplateVersion.template_id == DocumentTemplate.id
            )
            .where(DocumentTemplateVersion.id.in_({vid for _, vid in pairs}))
        )
    ).all()
    out: dict[int, dict] = {}
    for tid, name, vid, version in rows:
        if (tid, vid) not in pairs:
            continue
        entry = out.setdefault(tid, {"template_id": tid, "name": name, "versions": []})
        entry["versions"].append({"id": vid, "version": version})
    for entry in out.values():
        entry["versions"].sort(key=lambda v: v["version"])
    return sorted(out.values(), key=lambda e: e["template_id"])


async def detail(
    db: AsyncSession,
    report: Report,
    *,
    manage: bool,
    export: bool,
    allowed: dict[int, VersionDef] | None = None,
) -> dict:
    snap = await snapshot_of(db, report)
    errors: list[dict] = []
    if manage:
        if allowed is None:
            allowed = await allowed_versions(db, report.tenant_id, report.id)
        errors = validate(report.draft, allowed).errors
        errors += await binding_errors(db, report.tenant_id, report.id, report.draft)
    published = None
    if snap is not None:
        published = {
            "version": snap.version,
            "name": snap.name,
            "config": snap.config,
            "published_at": snap.published_at,
            "published_by_user_id": snap.published_by_user_id,
            "published_by_admin_id": snap.published_by_admin_id,
        }
    return {
        "id": report.id,
        "tenant_id": report.tenant_id,
        "name": report.name if manage or snap is None else snap.name,
        "revision": report.revision,
        "status": _status(report, snap),
        "draft": report.draft if manage else None,
        "draft_errors": errors,
        "published": published,
        "sources": await _sources(
            db, ([snap.config] if snap is not None else []) + ([report.draft] if manage else [])
        ),
        "can_manage": manage,
        "can_export": export,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


async def readable(db: AsyncSession, tenant_id: int, report_id: int, *, manage: bool) -> Report:
    """A report the caller may open: managers see every live one, viewers published ones."""
    report = await get_report(db, tenant_id, report_id)
    if not manage and report.published_snapshot_id is None:
        raise not_found()
    return report


# ---------------------------------------------------------------- lifecycle


def _touch(report: Report, actor: Actor) -> None:
    report.revision += 1
    report.updated_at = utcnow()
    if actor.kind == "user":
        report.updated_by_user_id = actor.id


async def create(db: AsyncSession, tenant_id: int, actor: Actor, name: Any) -> Report:
    clean = _check_name(name)
    report = Report(
        tenant_id=tenant_id,
        name=clean,
        draft=empty_config(),
        revision=1,
        created_by_user_id=actor.id if actor.kind == "user" else None,
        updated_by_user_id=actor.id if actor.kind == "user" else None,
    )
    db.add(report)
    await db.flush()
    await audit(db, actor, "create", audit_target(tenant_id, report.id, revision=1))
    await db.commit()
    await db.refresh(report)
    return report


async def save(
    db: AsyncSession,
    tenant_id: int,
    actor: Actor,
    report_id: int,
    revision: Any,
    name: Any,
    config: Any,
) -> Report:
    report = await get_report(db, tenant_id, report_id, for_update=True)
    _check_revision(report, revision)
    clean = _check_name(name)
    problems = storable_errors(config)
    if problems:
        raise invalid(problems)
    allowed = await allowed_versions(db, tenant_id, report.id)
    report.name = clean
    report.draft = config
    _touch(report, actor)
    await _write_refs(db, report, tenant_id, ("DRAFT",), config, allowed, strict=False)
    await audit(db, actor, "save", audit_target(tenant_id, report.id, revision=report.revision))
    await db.commit()
    return report


async def publish(
    db: AsyncSession, tenant_id: int, actor: Actor, report_id: int, revision: Any
) -> Report:
    report = await get_report(db, tenant_id, report_id, for_update=True)
    _check_revision(report, revision)
    config = report.draft
    problems = storable_errors(config)
    allowed = await allowed_versions(db, tenant_id, report.id)
    if not problems:
        problems = validate(config, allowed, for_publish=True).errors
        problems += await binding_errors(db, tenant_id, report.id, config)
    if problems:
        raise invalid(problems)  # the old snapshot stays published
    problems = await _write_refs(
        db, report, tenant_id, ("DRAFT", "PUBLISHED"), config, allowed, strict=True
    )
    if problems:
        raise invalid(problems)
    last = (
        await db.execute(
            select(func.max(ReportSnapshot.version)).where(ReportSnapshot.report_id == report.id)
        )
    ).scalar_one()
    snap = ReportSnapshot(
        report_id=report.id,
        version=(last or 0) + 1,
        name=report.name,
        config=config,
        published_by_user_id=actor.id if actor.kind == "user" else None,
        published_by_admin_id=actor.id if actor.kind == "admin" else None,
    )
    db.add(snap)
    await db.flush()
    report.published_snapshot_id = snap.id
    _touch(report, actor)
    await audit(
        db,
        actor,
        "publish",
        audit_target(tenant_id, report.id, version=snap.version, revision=report.revision),
    )
    await db.commit()
    return report


async def unpublish(
    db: AsyncSession, tenant_id: int, actor: Actor, report_id: int, revision: Any
) -> Report:
    report = await get_report(db, tenant_id, report_id, for_update=True)
    _check_revision(report, revision)
    snap = await snapshot_of(db, report)
    if snap is None:
        raise AppError(409, "report_not_published", "error.report_not_published")
    report.published_snapshot_id = None
    _touch(report, actor)
    await db.execute(
        delete(ReportTemplateRef).where(
            ReportTemplateRef.report_id == report.id, ReportTemplateRef.kind == "PUBLISHED"
        )
    )
    await audit(
        db,
        actor,
        "unpublish",
        audit_target(tenant_id, report.id, version=snap.version, revision=report.revision),
    )
    await db.commit()
    return report


async def remove(
    db: AsyncSession, tenant_id: int, actor: Actor, report_id: int, revision: Any
) -> None:
    report = await get_report(db, tenant_id, report_id, for_update=True)
    _check_revision(report, revision)
    report.deleted_at = utcnow()
    _touch(report, actor)
    await db.execute(delete(ReportTemplateRef).where(ReportTemplateRef.report_id == report.id))
    await audit(db, actor, "delete", audit_target(tenant_id, report.id, revision=report.revision))
    await db.commit()


# ---------------------------------------------------------------- catalog


async def catalog_templates(db: AsyncSession, tenant_id: int, report_id: int | None) -> list[dict]:
    usable = await usable_template_ids(db, tenant_id)
    allowed = await allowed_versions(db, tenant_id, report_id)
    by_template: dict[int, list[VersionDef]] = {}
    for v in allowed.values():
        by_template.setdefault(v.template_id, []).append(v)
    if not by_template:
        return []
    templates = (
        await db.execute(
            select(DocumentTemplate)
            .where(DocumentTemplate.id.in_(by_template))
            .order_by(DocumentTemplate.id)
        )
    ).scalars()
    names = {
        v.id: v.name
        for v in (
            await db.execute(
                select(DocumentTemplateVersion).where(DocumentTemplateVersion.id.in_(allowed))
            )
        ).scalars()
    }
    out = []
    for tpl in templates:
        out.append(
            {
                "template_id": tpl.id,
                "code": tpl.code,
                "name": tpl.name,
                "scope": "system" if tpl.tenant_id is None else "tenant",
                "usable": tpl.id in usable,
                "versions": [
                    {
                        "id": v.id,
                        "version": v.version,
                        "name": names.get(v.id, ""),
                        "current": v.id == tpl.current_version_id,
                    }
                    for v in sorted(by_template[tpl.id], key=lambda v: v.version)
                ],
            }
        )
    return out


def parse_version_ids(raw: str | None) -> list[int]:
    try:
        ids = [int(x) for x in (raw or "").split(",") if x.strip()]
    except ValueError:
        raise validation_error(["version_ids"]) from None
    if not 1 <= len(ids) <= 20 or any(not 0 < x < 2**63 for x in ids):
        raise validation_error(["version_ids"])
    return sorted(set(ids))


async def catalog_fields(
    db: AsyncSession, tenant_id: int, report_id: int | None, template_id: int, raw_ids: str | None
) -> dict:
    ids = parse_version_ids(raw_ids)
    allowed = await allowed_versions(db, tenant_id, report_id)
    chosen = [allowed.get(i) for i in ids]
    if any(v is None or v.template_id != template_id for v in chosen):
        raise not_found()
    return catalog([v for v in chosen if v is not None])


# ---------------------------------------------------------------- queries


def parse_period(period: Any) -> dict | None:
    """The page override as given ({from, to} or None); resolve_period checks it."""
    if period is None:
        return None
    raw = period if isinstance(period, dict) else period.model_dump(by_alias=True)
    if raw.get("from") is None and raw.get("to") is None:
        return None
    if not isinstance(raw.get("from"), str) or not isinstance(raw.get("to"), str):
        raise period_invalid([k for k in ("from", "to") if not isinstance(raw.get(k), str)])
    return {"from": raw["from"], "to": raw["to"]}


def _failure_codes(result: dict) -> str | None:
    codes = sorted({c["error_code"] for c in result["cards"] if c["error_code"]})
    return ",".join(codes) if codes else None


async def preview(
    db: AsyncSession, ctx: TenantContext, report_id: int, config: Any, period: Any
) -> dict:
    """The draft config on the caller's real data scope (manage only)."""
    report = await get_report(db, ctx.tenant_id, report_id)
    problems = storable_errors(config)
    if problems:
        raise invalid(problems)
    override = parse_period(period)
    rid, revision = report.id, report.revision  # the queries below end the transaction
    allowed = await allowed_versions(db, ctx.tenant_id, rid)
    problems = await binding_errors(db, ctx.tenant_id, rid, config)
    if problems:
        raise invalid(problems)
    scope_user = submitter_scope(ctx)
    result = await report_query_service.run_page(
        db,
        config=config,
        versions=allowed,
        tenant_id=ctx.tenant_id,
        scope_user_id=scope_user,
        override=override,
        now=utcnow(),
    )
    result["report_version"] = None
    code = _failure_codes(result)
    await audit_now(
        db,
        user_actor(ctx),
        "preview",
        audit_target(
            ctx.tenant_id,
            rid,
            revision=revision,
            period=(result["period"]["from"], result["period"]["to"]),
            scope=result["scope"],
            code=code,
        ),
        "failure" if code else "success",
    )
    return result


async def published_page(
    db: AsyncSession, ctx: TenantContext, report_id: int
) -> tuple[Report, ReportSnapshot]:
    report = await get_report(db, ctx.tenant_id, report_id)
    snap = await snapshot_of(db, report)
    if snap is None:
        raise not_found()
    return report, snap


async def data(
    db: AsyncSession, ctx: TenantContext, report_id: int, period: Any, refresh: bool
) -> dict:
    """The published snapshot on the caller's data scope, queried again every time."""
    report, snap = await published_page(db, ctx, report_id)
    override = parse_period(period)
    rid, version, config = report.id, snap.version, snap.config  # read before the queries
    versions = await snapshot_versions(db, config)
    result = await report_query_service.run_page(
        db,
        config=config,
        versions=versions,
        tenant_id=ctx.tenant_id,
        scope_user_id=submitter_scope(ctx),
        override=override,
        now=utcnow(),
    )
    result["report_version"] = version
    code = _failure_codes(result)
    await audit_now(
        db,
        user_actor(ctx),
        "refresh" if refresh else "view",
        audit_target(
            ctx.tenant_id,
            rid,
            version=version,
            period=(result["period"]["from"], result["period"]["to"]),
            scope=result["scope"],
            code=code,
        ),
        "failure" if code else "success",
    )
    return result


async def admin_preview(
    db: AsyncSession, tenant_id: int, actor: Actor, report_id: int, config: Any, period: Any
) -> dict:
    """Synthetic rows from the configuration only: the admin never sees business data."""
    report = await get_report(db, tenant_id, report_id)
    problems = storable_errors(config)
    if problems:
        raise invalid(problems)
    override = parse_period(period)
    rid, revision = report.id, report.revision
    allowed = await allowed_versions(db, tenant_id, rid)
    problems = await binding_errors(db, tenant_id, rid, config)
    if problems:
        raise invalid(problems)
    result = report_query_service.synthetic_page(
        config=config, versions=allowed, override=override, now=utcnow()
    )
    result["report_version"] = None
    await audit_now(
        db,
        actor,
        "preview",
        audit_target(
            tenant_id,
            rid,
            revision=revision,
            period=(result["period"]["from"], result["period"]["to"]),
            scope="synthetic",
        ),
    )
    return result
