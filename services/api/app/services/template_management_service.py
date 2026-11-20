"""Template management (template-report-management: FR-TEMPLATE-001..013, D1/D2/D4/D5).

Lifecycle of a document format template, shared by the tenant routes
(`routers/template_management.py`, the current tenant is the scope) and the platform admin
routes (`routers/admin_templates.py`, an explicit scope: system or a tenant):

- a draft is stored as given (an object of at most 512 KB, only the content keys) and may
  be incomplete; every read reports `validate_template` errors for it;
- activation validates fully, refuses unconfirmed sample suggestions, and creates an
  immutable version (max + 1) only when the canonical content hash differs from the
  current version (FR-TEMPLATE-013);
- every change takes the template row lock and compares the client's revision
  (FR-TEMPLATE-012); grants and status never create a version;
- delete re-checks the protections inside the lock and soft-deletes (FR-TEMPLATE-010).

This module never reads OCR originals, payloads, samples' content or business results.
Audit entries carry the actor, scope, template id, revision and version only, never content
(FR-TEMPLATE-007); the operation log has no detail column, so they are encoded in
`target_id` as `<template id>/<scope>/r<revision>[/v<version>]`."""

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import (
    DocumentTemplate,
    DocumentTemplateVersion,
    Organization,
    ReportTemplateRef,
    ReviewLevel,
    TemplateGrantTarget,
    TemplateSample,
    Tenant,
    User,
)
from app.models.template import PLAN_CODES
from app.ocr.templates.schema import CODE_PATTERN, canonical_groups, validate_template
from app.services import audit_service, template_access
from app.services.admin_query_service import like_literal
from app.services.audit_service import AuditEvent
from app.services.tenant_access import TenantContext, not_found

MAX_CONTENT_BYTES = 512 * 1024
CONTENT_KEYS = ("code", "name", "names", "description", "groups")
PENDING_KEY = "_pending_confirmations"
PENDING_ATTRS = ("required", "primary", "role")
TARGET_TYPE = "document_template"
SEARCH_LIMIT = 20
ADMIN_LIST_LIMIT = 500
_CODE_INDEX = "uq_document_templates_scope_code"

_CODE_RE = re.compile(CODE_PATTERN)


# ---------------------------------------------------------------- errors


def _conflict(code: str, details: dict | None = None) -> AppError:
    return AppError(409, code, f"error.{code}", details=details)


def revision_conflict(current: int) -> AppError:
    return _conflict("revision_conflict", {"revision": current})


def code_conflict(code: str) -> AppError:
    return _conflict("template_code_conflict", {"code": code})


def invalid(errors: list[dict]) -> AppError:
    return AppError(422, "template_invalid", "error.template_invalid", details={"errors": errors})


def _validation(field: str) -> AppError:
    return AppError(422, "validation_error", "error.validation", [field])


# ---------------------------------------------------------------- content


def content_hash(version: dict) -> str:
    """sha256 of the canonical JSON of {name, description, groups}; the same algorithm as
    migration 0009 (its seed versions compare equal). Grants, revision, status and audit
    metadata are not part of it (T02)."""
    canonical = json.dumps(
        {k: version.get(k) for k in ("name", "description", "groups")},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def version_content(model) -> dict:
    """The versioned part of a valid template (names of the template itself are not)."""
    return {
        "name": model.name,
        "description": model.description,
        "groups": canonical_groups(model),
    }


def clean_content(raw: Any) -> dict:
    """Only the structure (FR-TEMPLATE-011): any owner/grant/status/version/revision key,
    and the internal pending list, is dropped. 422 when not an object or too large."""
    if not isinstance(raw, dict):
        raise _validation("content")
    content = {k: raw[k] for k in CONTENT_KEYS if k in raw}
    size = len(json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_CONTENT_BYTES:
        raise AppError(
            422,
            "template_too_large",
            "error.template_too_large",
            details={"limit_bytes": MAX_CONTENT_BYTES},
        )
    return content


def content_code(content: dict) -> str:
    """The code every stored template needs (unique per scope among live templates)."""
    code = content.get("code")
    if not isinstance(code, str) or not _CODE_RE.match(code):
        raise _validation("code")
    return code


def content_name(content: dict, fallback: str) -> str:
    name = content.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()[:100]
    return fallback


def draft_content(draft: dict | None) -> dict | None:
    if draft is None:
        return None
    return {k: v for k, v in draft.items() if k != PENDING_KEY}


def pending_of(draft: dict | None) -> list[dict]:
    if not draft:
        return []
    found = draft.get(PENDING_KEY)
    return [p for p in found if isinstance(p, dict)] if isinstance(found, list) else []


def clean_pending(entries: list | None) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for entry in entries or []:
        if hasattr(entry, "model_dump"):
            entry = entry.model_dump()
        if not isinstance(entry, dict):
            continue
        path, attr = entry.get("path"), entry.get("attr")
        if not isinstance(path, str) or attr not in PENDING_ATTRS or (path, attr) in seen:
            continue
        seen.add((path, attr))
        value = entry.get("value")
        if not isinstance(value, (str, bool, int, float)) and value is not None:
            value = None
        out.append({"path": path[:200], "attr": attr, "value": value})
    return out


def remaining_pending(existing: list[dict], given: list | None) -> list[dict]:
    """The editor clears confirmed entries; it cannot add new ones. A reorder moves an entry
    to another path, so each given entry takes one unused stored entry with the same
    attribute and suggested value, under the path the editor now gives it."""
    if given is None:
        return existing
    entries = clean_pending(given)
    taken: dict[int, dict] = {}  # index in `entries` -> the stored entry it keeps
    unused = list(existing)
    for same_path in (True, False):  # an unmoved entry first, then a moved one
        for i, entry in enumerate(entries):
            if i in taken:
                continue
            match = next(
                (
                    p
                    for p in unused
                    if p.get("attr") == entry["attr"]
                    and (
                        p.get("path") == entry["path"]
                        if same_path
                        else p.get("value") == entry["value"]
                    )
                ),
                None,
            )
            if match is not None:
                unused.remove(match)
                taken[i] = match
    return [
        {"path": entries[i]["path"], "attr": taken[i]["attr"], "value": taken[i].get("value")}
        for i in sorted(taken)
    ]


def make_draft(content: dict, pending: list[dict]) -> dict:
    draft = dict(content)
    if pending:
        draft[PENDING_KEY] = pending
    return draft


def draft_errors(draft: dict | None) -> list[dict]:
    if draft is None:
        return []
    return validate_template(draft_content(draft))[1]


def export_content(tpl: DocumentTemplate, ver: DocumentTemplateVersion | None, draft: bool):
    if draft:
        content = draft_content(tpl.draft)
        if content is None:
            raise not_found()
        return {k: content.get(k) for k in CONTENT_KEYS if k in content}
    if ver is None:
        raise not_found()
    return {
        "code": tpl.code,
        "name": ver.name,
        "description": ver.description or "",
        "groups": ver.groups,
    }


# ---------------------------------------------------------------- actors and audit


@dataclass(frozen=True)
class Actor:
    kind: Literal["user", "guest", "admin"]
    id: str | None
    user_id: int | None = None
    admin_id: int | None = None


def tenant_actor(ctx: TenantContext) -> Actor:
    if ctx.kind == "guest" or ctx.user_id is None:
        return Actor("guest", str(ctx.tenant_id))
    return Actor("user", str(ctx.user_id), user_id=ctx.user_id)


def admin_actor(admin_id: int) -> Actor:
    return Actor("admin", str(admin_id), admin_id=admin_id)


def scope_label(tenant_id: int | None) -> str:
    return "system" if tenant_id is None else f"tenant:{tenant_id}"


def audit_target(
    template_id: int | str, tenant_id: int | None | str, revision: int, version: int | None = None
) -> str:
    scope = tenant_id if isinstance(tenant_id, str) else scope_label(tenant_id)
    target = f"{template_id}/{scope}/r{revision}"
    return f"{target}/v{version}" if version is not None else target


async def audit(
    db: AsyncSession, actor: Actor, action: str, target: str, result: str = "success"
) -> None:
    await audit_service.record(
        db,
        AuditEvent(actor.kind, actor.id, action, TARGET_TYPE, target, result),  # type: ignore[arg-type]
    )


AUDITED_FAILURES = (403, 409, 422)


async def audited[T](
    db: AsyncSession, actor: Actor, action: str, target: str, fn: Callable[[], Awaitable[T]]
) -> T:
    """Run a change; a refusal (denied, conflict, invalid) is rolled back and logged as a
    failure in its own transaction. 404s are not logged (they would reveal nothing new)."""
    try:
        return await fn()
    except AppError as exc:
        if exc.status in AUDITED_FAILURES:
            await db.rollback()
            await audit(db, actor, action, f"{target}/{exc.code}", "failure")
            await db.commit()
        raise


# ---------------------------------------------------------------- reading


async def live(db: AsyncSession, template_id: int) -> DocumentTemplate | None:
    tpl = await db.get(DocumentTemplate, template_id)
    return None if tpl is None or tpl.deleted_at is not None else tpl


async def locked_live(db: AsyncSession, template_id: int) -> DocumentTemplate:
    tpl = await template_access.lock_template(db, template_id)
    if tpl is None or tpl.deleted_at is not None:
        raise not_found()
    return tpl


def check_revision(tpl: DocumentTemplate, revision: int) -> None:
    if tpl.revision != revision:
        raise revision_conflict(tpl.revision)


def _bump(tpl: DocumentTemplate) -> None:
    tpl.revision += 1
    tpl.updated_at = utcnow()


async def _scope_kinds(db: AsyncSession, tenant_ids: set[int]) -> dict[int, str]:
    if not tenant_ids:
        return {}
    rows = await db.execute(select(Tenant.id, Tenant.kind).where(Tenant.id.in_(tenant_ids)))
    return dict(rows.all())


async def protections(db: AsyncSession, templates: list[DocumentTemplate]) -> dict[int, list[str]]:
    """Why each template cannot be deleted (FR-TEMPLATE-010): applied once, referenced by a
    report draft/snapshot, or by a review level above 0 (in any tenant)."""
    ids = [t.id for t in templates]
    out: dict[int, list[str]] = {t.id: (["applied"] if t.applied_at else []) for t in templates}
    if not ids:
        return out
    reports = set(
        (
            await db.execute(
                select(ReportTemplateRef.template_id)
                .where(ReportTemplateRef.template_id.in_(ids))
                .distinct()
            )
        ).scalars()
    )
    reviews = set(
        (
            await db.execute(
                select(ReviewLevel.template_id)
                .where(ReviewLevel.template_id.in_(ids), ReviewLevel.level > 0)
                .distinct()
            )
        ).scalars()
    )
    for tid in ids:
        if tid in reports:
            out[tid].append("report")
        if tid in reviews:
            out[tid].append("review_settings")
    return out


async def _current_versions(
    db: AsyncSession, templates: list[DocumentTemplate]
) -> dict[int, DocumentTemplateVersion]:
    ids = [t.current_version_id for t in templates if t.current_version_id is not None]
    if not ids:
        return {}
    rows = await db.execute(
        select(DocumentTemplateVersion).where(DocumentTemplateVersion.id.in_(ids))
    )
    return {v.id: v for v in rows.scalars()}


def _scope(tpl: DocumentTemplate, kinds: dict[int, str]) -> str:
    if tpl.tenant_id is None:
        return "system"
    return "organization" if kinds.get(tpl.tenant_id) == "organization" else "personal"


async def summaries(
    db: AsyncSession, templates: list[DocumentTemplate], manageable: Callable[[Any], bool]
) -> list[dict]:
    kinds = await _scope_kinds(db, {t.tenant_id for t in templates if t.tenant_id is not None})
    versions = await _current_versions(db, templates)
    reasons = await protections(db, templates)
    out = []
    for t in templates:
        cur = versions.get(t.current_version_id) if t.current_version_id else None
        manage = manageable(t)
        out.append(
            {
                "id": t.id,
                "scope": _scope(t, kinds),
                "tenant_id": t.tenant_id,
                "code": t.code,
                "name": t.name,
                "status": t.status,
                "has_draft": t.draft is not None,
                "current_version": (
                    {"id": cur.id, "version": cur.version, "activated_at": cur.created_at}
                    if cur
                    else None
                ),
                "revision": t.revision,
                "can_manage": manage,
                "deletable": manage and not reasons[t.id],
                "protected_reasons": reasons[t.id],
                "updated_at": t.updated_at,
            }
        )
    return out


def version_detail(ver: DocumentTemplateVersion) -> dict:
    return {
        "id": ver.id,
        "template_id": ver.template_id,
        "version": ver.version,
        "name": ver.name,
        "description": ver.description,
        "groups": ver.groups,
        "content_hash": ver.content_hash,
        "created_at": ver.created_at,
    }


async def grant_of(db: AsyncSession, tpl: DocumentTemplate) -> dict:
    users = (
        await db.execute(
            select(User)
            .join(TemplateGrantTarget, TemplateGrantTarget.user_id == User.id)
            .where(TemplateGrantTarget.template_id == tpl.id)
            .order_by(User.id)
        )
    ).scalars()
    orgs = (
        await db.execute(
            select(Organization.tenant_id, Organization.name)
            .join(
                TemplateGrantTarget,
                TemplateGrantTarget.organization_tenant_id == Organization.tenant_id,
            )
            .where(TemplateGrantTarget.template_id == tpl.id)
            .order_by(Organization.tenant_id)
        )
    ).all()
    return {
        "mode": tpl.grant_mode,
        "plans": [p for p in PLAN_CODES if p in (tpl.grant_plans or [])],
        "users": [{"id": u.id, "display_name": u.display_name, "email": u.email} for u in users],
        "organizations": [{"tenant_id": tid, "name": name} for tid, name in orgs],
    }


async def detail(
    db: AsyncSession,
    tpl: DocumentTemplate,
    *,
    can_manage: bool,
    admin: bool = False,
) -> dict:
    """Managers (and the admin) see the draft and every version; anyone else only the
    current version of a template they may use."""
    (summary,) = await summaries(db, [tpl], lambda _t: can_manage)
    full = can_manage or admin
    current = (
        await db.get(DocumentTemplateVersion, tpl.current_version_id)
        if tpl.current_version_id
        else None
    )
    if full:
        rows = (
            await db.execute(
                select(DocumentTemplateVersion)
                .where(DocumentTemplateVersion.template_id == tpl.id)
                .order_by(DocumentTemplateVersion.version.desc())
            )
        ).scalars()
        versions = list(rows)
    else:
        versions = [current] if current else []
    draft = tpl.draft if full else None
    out = {
        **summary,
        "draft": draft_content(draft),
        "draft_errors": draft_errors(draft),
        "pending_confirmations": pending_of(draft),
        "current": version_detail(current) if current else None,
        "versions": [
            {
                "id": v.id,
                "version": v.version,
                "name": v.name,
                "created_at": v.created_at,
                "activated_by_user_id": v.activated_by_user_id,
            }
            for v in versions
        ],
        "grant": await grant_of(db, tpl) if admin and tpl.tenant_id is None else None,
    }
    return out


async def version_current(
    db: AsyncSession, tpl: DocumentTemplate
) -> DocumentTemplateVersion | None:
    if tpl.current_version_id is None:
        return None
    return await db.get(DocumentTemplateVersion, tpl.current_version_id)


async def version_of(
    db: AsyncSession, tpl: DocumentTemplate, version_id: int, *, full: bool
) -> DocumentTemplateVersion:
    ver = await db.get(DocumentTemplateVersion, version_id)
    if ver is None or ver.template_id != tpl.id:
        raise not_found()
    if not full and ver.id != tpl.current_version_id:
        raise not_found()
    return ver


# ---------------------------------------------------------------- tenant access


async def tenant_list(db: AsyncSession, ctx: TenantContext) -> list[dict]:
    """Own-tenant templates (all live ones to a manager, the usable ones otherwise) plus the
    system templates this tenant may newly use, read-only (FR-TEMPLATE-001)."""
    manage = template_access.can_manage(ctx)
    usable = await template_access.usable_condition(db, ctx.tenant_id)
    own = DocumentTemplate.tenant_id == ctx.tenant_id
    cond = (own | usable) if manage else usable
    rows = (
        await db.execute(
            select(DocumentTemplate)
            .where(DocumentTemplate.deleted_at.is_(None), cond)
            .order_by(DocumentTemplate.id)
        )
    ).scalars()
    templates = list(rows)
    return await summaries(db, templates, lambda t: manage and t.tenant_id == ctx.tenant_id)


async def tenant_visible(
    db: AsyncSession, ctx: TenantContext, template_id: int
) -> tuple[DocumentTemplate, bool]:
    """(template, can_manage) for a template this tenant may read; else 404."""
    tpl = await live(db, template_id)
    if tpl is None:
        raise not_found()
    if tpl.tenant_id == ctx.tenant_id and template_access.can_manage(ctx):
        return tpl, True
    if (
        tpl.tenant_id == ctx.tenant_id or tpl.tenant_id is None
    ) and await template_access.is_usable(db, ctx.tenant_id, tpl.id):
        return tpl, False
    raise not_found()


async def tenant_locked(db: AsyncSession, ctx: TenantContext, template_id: int):
    """The current tenant's own template, locked, for a change by a manager."""
    template_access.require_manage(ctx)
    tpl = await locked_live(db, template_id)
    if tpl.tenant_id != ctx.tenant_id:
        raise not_found()
    return tpl


async def require_sample(db: AsyncSession, ctx: TenantContext, sample_id: Any) -> TemplateSample:
    if not isinstance(sample_id, str) or not sample_id:
        raise _validation("sample_id")
    sample = await db.get(TemplateSample, sample_id)
    if (
        sample is None
        or sample.tenant_id != ctx.tenant_id
        or sample.created_by_user_id != ctx.user_id
        or sample.status != "READY"
        or sample.deleted_at is not None
        or sample.purged_at is not None
        or sample.expires_at <= utcnow()
    ):
        raise not_found()
    return sample


# ---------------------------------------------------------------- changes


async def _code_taken(
    db: AsyncSession, tenant_id: int | None, code: str, exclude: int | None = None
) -> bool:
    scope = (
        DocumentTemplate.tenant_id.is_(None)
        if tenant_id is None
        else DocumentTemplate.tenant_id == tenant_id
    )
    q = select(DocumentTemplate.id).where(
        scope, DocumentTemplate.code == code, DocumentTemplate.deleted_at.is_(None)
    )
    if exclude is not None:
        q = q.where(DocumentTemplate.id != exclude)
    return (await db.execute(q.limit(1))).first() is not None


async def _flush_code(db: AsyncSession, code: str) -> None:
    """Flush; the unique live-code index losing a race is the same 409 (T08)."""
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        if _CODE_INDEX in str(exc.orig):
            raise code_conflict(code) from None
        raise


async def create(
    db: AsyncSession,
    actor: Actor,
    tenant_id: int | None,
    raw: Any,
    *,
    pending: list | None = None,
) -> DocumentTemplate:
    """A new template holding only a draft (no version; not usable until activated)."""
    content = clean_content(raw)
    code = content_code(content)
    if await _code_taken(db, tenant_id, code):
        raise code_conflict(code)
    now = utcnow()
    tpl = DocumentTemplate(
        tenant_id=tenant_id,
        code=code,
        name=content_name(content, code),
        status=template_access.ENABLED,
        draft=make_draft(content, clean_pending(pending)),
        draft_updated_at=now,
        revision=1,
        created_by_user_id=actor.user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(tpl)
    await _flush_code(db, code)
    await audit(db, actor, "template.create", audit_target(tpl.id, tenant_id, tpl.revision))
    return tpl


async def save_draft(
    db: AsyncSession,
    actor: Actor,
    tpl: DocumentTemplate,
    revision: int,
    raw: Any,
    pending: list | None = None,
) -> DocumentTemplate:
    check_revision(tpl, revision)
    content = clean_content(raw)
    code = content_code(content)
    if await _code_taken(db, tpl.tenant_id, code, exclude=tpl.id):
        raise code_conflict(code)
    now = utcnow()
    tpl.draft = make_draft(content, remaining_pending(pending_of(tpl.draft), pending))
    tpl.draft_updated_at = now
    if tpl.current_version_id is None:  # nothing active yet: the list shows the draft
        tpl.code, tpl.name = code, content_name(content, code)
    _bump(tpl)
    await _flush_code(db, code)
    await audit(db, actor, "template.save", audit_target(tpl.id, tpl.tenant_id, tpl.revision))
    return tpl


async def discard_draft(
    db: AsyncSession, actor: Actor, tpl: DocumentTemplate, revision: int
) -> DocumentTemplate:
    check_revision(tpl, revision)
    if tpl.draft is None:
        return tpl
    tpl.draft, tpl.draft_updated_at = None, None
    _bump(tpl)
    await db.flush()
    await audit(db, actor, "template.discard", audit_target(tpl.id, tpl.tenant_id, tpl.revision))
    return tpl


def _same_as(current: DocumentTemplateVersion, code: str, digest: str) -> bool:
    if current.content_hash == digest:
        return True
    model, _ = validate_template(
        {
            "code": code,
            "name": current.name,
            "description": current.description or "",
            "groups": current.groups,
        }
    )
    return model is not None and content_hash(version_content(model)) == digest


async def activate(
    db: AsyncSession, actor: Actor, tpl: DocumentTemplate, revision: int
) -> tuple[str, DocumentTemplateVersion]:
    """("activated" | "unchanged", the active version) (D2, FR-TEMPLATE-005/013). A
    failure changes nothing: the draft and the old active version stay."""
    check_revision(tpl, revision)
    current = (
        await db.get(DocumentTemplateVersion, tpl.current_version_id)
        if tpl.current_version_id
        else None
    )
    if tpl.draft is None:
        if current is None:
            raise invalid([{"path": "$", "message": "nothing to activate"}])
        return "unchanged", current
    pending = pending_of(tpl.draft)
    if pending:
        raise AppError(
            422, "template_unconfirmed", "error.template_unconfirmed", details={"pending": pending}
        )
    model, errors = validate_template(draft_content(tpl.draft))
    if errors or model is None:
        raise invalid(errors)
    content = version_content(model)
    digest = content_hash(content)
    if model.code != tpl.code and await _code_taken(db, tpl.tenant_id, model.code, tpl.id):
        raise code_conflict(model.code)
    if current is not None and _same_as(current, model.code, digest):
        tpl.code = model.code  # the code is not versioned
        tpl.draft, tpl.draft_updated_at = None, None
        _bump(tpl)
        await _flush_code(db, model.code)
        target = audit_target(tpl.id, tpl.tenant_id, tpl.revision, current.version)
        await audit(db, actor, "template.activate_unchanged", target)
        return "unchanged", current
    top = (
        await db.execute(
            select(func.max(DocumentTemplateVersion.version)).where(
                DocumentTemplateVersion.template_id == tpl.id
            )
        )
    ).scalar()
    ver = DocumentTemplateVersion(
        template_id=tpl.id,
        version=(top or 0) + 1,
        name=content["name"],
        description=content["description"],
        groups=content["groups"],
        content_hash=digest,
        activated_by_user_id=actor.user_id,
        created_at=utcnow(),
    )
    db.add(ver)
    await db.flush()
    tpl.current_version_id = ver.id
    tpl.name, tpl.code = model.name, model.code
    tpl.draft, tpl.draft_updated_at = None, None
    _bump(tpl)
    await _flush_code(db, model.code)
    target = audit_target(tpl.id, tpl.tenant_id, tpl.revision, ver.version)
    await audit(db, actor, "template.activate", target)
    return "activated", ver


async def set_status(
    db: AsyncSession, actor: Actor, tpl: DocumentTemplate, revision: int, status: str
) -> DocumentTemplate:
    """Disable/enable (FR-TEMPLATE-010): no version; activation never re-enables."""
    check_revision(tpl, revision)
    if tpl.status == status:
        return tpl
    tpl.status = status
    _bump(tpl)
    await db.flush()
    target = audit_target(tpl.id, tpl.tenant_id, tpl.revision)
    await audit(db, actor, f"template.{'enable' if status == 'ENABLED' else 'disable'}", target)
    return tpl


async def delete_template(
    db: AsyncSession, actor: Actor, tpl: DocumentTemplate, revision: int
) -> None:
    """Soft delete, re-checked under the template lock the caller holds; applying, report
    and review references take the same lock (FR-TEMPLATE-010)."""
    check_revision(tpl, revision)
    reasons = (await protections(db, [tpl]))[tpl.id]
    if reasons:
        raise _conflict("template_in_use", {"reasons": reasons})
    tpl.deleted_at = utcnow()
    _bump(tpl)
    await db.flush()
    await audit(db, actor, "template.delete", audit_target(tpl.id, tpl.tenant_id, tpl.revision))


# ---------------------------------------------------------------- admin


async def admin_list(
    db: AsyncSession, scope: str | None, tenant_id: int | None, q: str | None
) -> list[dict]:
    query = select(DocumentTemplate).where(DocumentTemplate.deleted_at.is_(None))
    if scope == "system":
        query = query.where(DocumentTemplate.tenant_id.is_(None))
    elif scope == "tenant":
        if tenant_id is None:
            query = query.where(DocumentTemplate.tenant_id.is_not(None))
        else:
            query = query.where(DocumentTemplate.tenant_id == tenant_id)
    if q:
        pattern = f"%{like_literal(q.strip())}%"
        query = query.where(
            or_(
                DocumentTemplate.code.ilike(pattern, escape="\\"),
                DocumentTemplate.name.ilike(pattern, escape="\\"),
            )
        )
    rows = (
        await db.execute(
            query.order_by(DocumentTemplate.tenant_id.nulls_first(), DocumentTemplate.id).limit(
                ADMIN_LIST_LIMIT
            )
        )
    ).scalars()
    templates = list(rows)
    names = await owner_names(db, {t.tenant_id for t in templates if t.tenant_id is not None})
    return [
        {**item, "owner_name": names.get(item["tenant_id"])}
        for item in await summaries(db, templates, lambda _t: True)
    ]


async def owner_names(db: AsyncSession, tenant_ids: set[int]) -> dict[int, str | None]:
    """The display name of each owner tenant: the personal user's name (else email) or the
    organization's name."""
    if not tenant_ids:
        return {}
    out: dict[int, str | None] = {}
    for tid, name, email in (
        await db.execute(
            select(Tenant.id, User.display_name, User.email)
            .join(User, User.id == Tenant.owner_user_id)
            .where(Tenant.id.in_(tenant_ids), Tenant.kind == "personal")
        )
    ).all():
        out[tid] = name or email
    for tid, name in (
        await db.execute(
            select(Organization.tenant_id, Organization.name).where(
                Organization.tenant_id.in_(tenant_ids)
            )
        )
    ).all():
        out[tid] = name
    return out


async def admin_scope(db: AsyncSession, scope: str, tenant_id: int | None) -> int | None:
    """The owner of an admin-created template: None (system) or a personal/organization
    tenant (never a guest tenant)."""
    if scope == "system":
        return None
    if tenant_id is None:
        raise _validation("tenant_id")
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.kind not in ("personal", "organization"):
        raise not_found()
    return tenant_id


async def set_grants(
    db: AsyncSession,
    actor: Actor,
    tpl: DocumentTemplate,
    revision: int,
    mode: str,
    plans: list[str],
    user_ids: list[int],
    org_ids: list[int],
) -> DocumentTemplate:
    """Exactly one grant mode (FR-TEMPLATE-009): PLANS = an exact set of plans (targets are
    removed); TARGETS = named users and organizations (plans cleared). No version."""
    if tpl.tenant_id is not None:
        raise _conflict("template_not_system")
    check_revision(tpl, revision)
    if mode == "PLANS":
        chosen = [p for p in PLAN_CODES if p in set(plans)]
        if not chosen:
            raise _validation("plans")
        users, orgs = [], []
    else:
        chosen = []
        users, orgs = sorted(set(user_ids)), sorted(set(org_ids))
        if not users and not orgs:
            raise _validation("user_ids")
        if users:
            found = set((await db.execute(select(User.id).where(User.id.in_(users)))).scalars())
            if found != set(users):
                raise _validation("user_ids")
        if orgs:
            found = set(
                (
                    await db.execute(
                        select(Tenant.id).where(Tenant.id.in_(orgs), Tenant.kind == "organization")
                    )
                ).scalars()
            )
            if found != set(orgs):
                raise _validation("organization_tenant_ids")
    await db.execute(delete(TemplateGrantTarget).where(TemplateGrantTarget.template_id == tpl.id))
    for uid in users:
        db.add(TemplateGrantTarget(template_id=tpl.id, user_id=uid))
    for oid in orgs:
        db.add(TemplateGrantTarget(template_id=tpl.id, organization_tenant_id=oid))
    tpl.grant_mode, tpl.grant_plans = mode, chosen
    _bump(tpl)
    await db.flush()
    target = audit_target(tpl.id, None, tpl.revision)
    await audit(db, actor, f"template.grant.{mode.lower()}", target)
    return tpl


def _search_conditions(q: str, text_cols: list, id_col) -> list:
    q = (q or "").strip()
    conds = []
    if q.isdigit() and len(q) <= 18:
        conds.append(id_col == int(q))
    if len(q) >= 1:
        pattern = f"%{like_literal(q)}%"
        conds.extend(col.ilike(pattern, escape="\\") for col in text_cols)
    return conds


async def search_users(db: AsyncSession, q: str) -> list[dict]:
    conds = _search_conditions(q, [User.email, User.display_name], User.id)
    if not conds:
        return []
    rows = (
        await db.execute(select(User).where(or_(*conds)).order_by(User.id).limit(SEARCH_LIMIT))
    ).scalars()
    return [{"id": u.id, "display_name": u.display_name, "email": u.email} for u in rows]


async def search_organizations(db: AsyncSession, q: str) -> list[dict]:
    conds = _search_conditions(q, [Organization.name], Organization.tenant_id)
    if not conds:
        return []
    rows = (
        await db.execute(
            select(Organization.tenant_id, Organization.name)
            .where(or_(*conds))
            .order_by(Organization.tenant_id)
            .limit(SEARCH_LIMIT)
        )
    ).all()
    return [{"tenant_id": tid, "name": name} for tid, name in rows]


async def search_owners(db: AsyncSession, q: str) -> list[dict]:
    """Personal tenants (by their user) and organizations, for the tenant scope pick."""
    out: list[dict] = []
    user_conds = _search_conditions(q, [User.email, User.display_name], Tenant.id)
    if user_conds:
        rows = (
            await db.execute(
                select(Tenant.id, User.display_name, User.email)
                .join(User, User.id == Tenant.owner_user_id)
                .where(Tenant.kind == "personal", or_(*user_conds))
                .order_by(Tenant.id)
                .limit(SEARCH_LIMIT)
            )
        ).all()
        out += [
            {"tenant_id": tid, "kind": "personal", "name": name, "email": email}
            for tid, name, email in rows
        ]
    for org in await search_organizations(db, q):
        out.append({"tenant_id": org["tenant_id"], "kind": "organization", "name": org["name"]})
    return out[:SEARCH_LIMIT]
