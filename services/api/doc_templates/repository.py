"""模板仓储：导入 / 升版 / 启停 / 软删除与可用模板查询（design D3，FR-TEMPLATE-002/003/005）。

- 版本内容 = 规范化后的 name + description + groups；SHA-256 有变化才新增版本，版本行只增不改。
- 作用域：tenant_id 为 NULL 是系统模板；对某任务可见的是系统模板 + 任务所属租户的模板。
- 本模块只 add / flush，不 commit：由调用方（脚本或路由）决定事务边界。
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_

from doc_templates.schema import TemplateDef, canonical_groups, parse_template
from extensions import db
from models import AuditEvent, DocumentTemplate, DocumentTemplateVersion, Tenant

ENABLED = "ENABLED"
DISABLED = "DISABLED"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def content_hash(name: str, description: str, groups: list[dict]) -> str:
    payload = json.dumps(
        {"name": name, "description": description, "groups": groups},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def model_hash(model: TemplateDef) -> str:
    return content_hash(model.name, model.description, canonical_groups(model))


def add_audit(action: str, template_id: Any, detail: dict, *, user_id: int | None = None) -> None:
    db.session.add(
        AuditEvent(
            user_id=user_id, action=action, object_type="document_template",
            object_id=str(template_id or ""), detail=detail,
        )
    )


def _scope_filter(query, tenant_id: int | None):
    if tenant_id is None:
        return query.filter(DocumentTemplate.tenant_id.is_(None))
    return query.filter(DocumentTemplate.tenant_id == tenant_id)


def find_template(code: str, tenant_id: int | None) -> DocumentTemplate | None:
    query = DocumentTemplate.query.filter(
        DocumentTemplate.code == code, DocumentTemplate.deleted_at.is_(None)
    )
    return _scope_filter(query, tenant_id).first()


def get_template(template_id: int, *, include_deleted: bool = False) -> DocumentTemplate | None:
    tpl = db.session.get(DocumentTemplate, template_id)
    if tpl is None or (tpl.deleted_at is not None and not include_deleted):
        return None
    return tpl


def current_version(tpl: DocumentTemplate) -> DocumentTemplateVersion | None:
    if tpl.current_version_id is None:
        return None
    return db.session.get(DocumentTemplateVersion, tpl.current_version_id)


def get_version(tpl: DocumentTemplate, version_no: int) -> DocumentTemplateVersion | None:
    return DocumentTemplateVersion.query.filter_by(template_id=tpl.id, version=version_no).first()


def import_template(
    data: Any, *, tenant_id: int | None = None, dry_run: bool = False, source: str = "cli",
    user_id: int | None = None,
) -> dict:
    """按 (作用域, code) 创建或升版；内容未变不操作。校验失败抛 TemplateValidationError。"""
    model = parse_template(data)
    if tenant_id is not None and db.session.get(Tenant, tenant_id) is None:
        raise ValueError(f"tenant {tenant_id} not found")
    groups = canonical_groups(model)
    digest = content_hash(model.name, model.description, groups)
    tpl = find_template(model.code, tenant_id)
    result = {"code": model.code, "tenant_id": tenant_id, "dry_run": dry_run}

    if tpl is not None:
        cur = current_version(tpl)
        if cur is not None and cur.content_hash == digest:
            return {**result, "action": "unchanged", "template_id": tpl.id, "version": cur.version}
        next_no = (
            db.session.query(func.max(DocumentTemplateVersion.version))
            .filter(DocumentTemplateVersion.template_id == tpl.id)
            .scalar()
            or 0
        ) + 1
        if dry_run:
            return {**result, "action": "versioned", "template_id": tpl.id, "version": next_no}
        ver = DocumentTemplateVersion(
            template_id=tpl.id, version=next_no, name=model.name,
            description=model.description, groups=groups, content_hash=digest,
        )
        db.session.add(ver)
        db.session.flush()
        tpl.current_version_id = ver.id
        tpl.name = model.name
        tpl.updated_at = _now()
        add_audit(
            "template.versioned", tpl.id,
            {"source": source, "code": model.code, "tenant_id": tenant_id, "version": next_no,
             "template_version_id": ver.id},
            user_id=user_id,
        )
        return {**result, "action": "versioned", "template_id": tpl.id, "version": next_no,
                "template_version_id": ver.id}

    if dry_run:
        return {**result, "action": "created", "template_id": None, "version": 1}
    tpl = DocumentTemplate(tenant_id=tenant_id, code=model.code, name=model.name, status=ENABLED)
    db.session.add(tpl)
    db.session.flush()
    ver = DocumentTemplateVersion(
        template_id=tpl.id, version=1, name=model.name,
        description=model.description, groups=groups, content_hash=digest,
    )
    db.session.add(ver)
    db.session.flush()
    tpl.current_version_id = ver.id
    add_audit(
        "template.created", tpl.id,
        {"source": source, "code": model.code, "tenant_id": tenant_id, "version": 1,
         "template_version_id": ver.id},
        user_id=user_id,
    )
    return {**result, "action": "created", "template_id": tpl.id, "version": 1, "template_version_id": ver.id}


def set_status(template_id: int, status: str, *, source: str = "cli", user_id: int | None = None) -> bool:
    """启用 / 停用；状态未变返回 False。"""
    if status not in (ENABLED, DISABLED):
        raise ValueError(f"invalid status {status}")
    tpl = get_template(template_id)
    if tpl is None:
        raise LookupError(f"template {template_id} not found")
    if tpl.status == status:
        return False
    tpl.status = status
    tpl.updated_at = _now()
    action = "template.enabled" if status == ENABLED else "template.disabled"
    add_audit(action, tpl.id, {"source": source, "code": tpl.code, "tenant_id": tpl.tenant_id}, user_id=user_id)
    return True


def soft_delete(template_id: int, *, source: str = "cli", user_id: int | None = None) -> bool:
    tpl = get_template(template_id)
    if tpl is None:
        raise LookupError(f"template {template_id} not found")
    tpl.deleted_at = _now()
    tpl.updated_at = tpl.deleted_at
    add_audit("template.deleted", tpl.id, {"source": source, "code": tpl.code, "tenant_id": tpl.tenant_id},
              user_id=user_id)
    return True


def list_templates(
    *, tenant_id: int | None = None, system_only: bool = False, include_deleted: bool = False
) -> list[DocumentTemplate]:
    query = DocumentTemplate.query
    if system_only:
        query = query.filter(DocumentTemplate.tenant_id.is_(None))
    elif tenant_id is not None:
        query = query.filter(DocumentTemplate.tenant_id == tenant_id)
    if not include_deleted:
        query = query.filter(DocumentTemplate.deleted_at.is_(None))
    return query.order_by(DocumentTemplate.tenant_id.is_(None).desc(), DocumentTemplate.id).all()


def available_versions(tenant_id: int | None) -> list[tuple[DocumentTemplate, DocumentTemplateVersion]]:
    """对某租户任务可用的模板：系统 + 本租户、启用、未删除的当前版本（按更新时间倒序）。"""
    scope = DocumentTemplate.tenant_id.is_(None)
    if tenant_id is not None:
        scope = or_(scope, DocumentTemplate.tenant_id == tenant_id)
    rows = (
        db.session.query(DocumentTemplate, DocumentTemplateVersion)
        .join(DocumentTemplateVersion, DocumentTemplateVersion.id == DocumentTemplate.current_version_id)
        .filter(scope, DocumentTemplate.status == ENABLED, DocumentTemplate.deleted_at.is_(None))
        .order_by(DocumentTemplate.updated_at.desc(), DocumentTemplate.id.desc())
        .all()
    )
    return [(t, v) for t, v in rows]


def is_version_available(version: DocumentTemplateVersion, tenant_id: int | None) -> bool:
    """版本仍可用于新映射：模板启用、未删除、为当前版本、作用域可见。"""
    tpl = db.session.get(DocumentTemplate, version.template_id)
    if tpl is None or tpl.deleted_at is not None or tpl.status != ENABLED:
        return False
    if tpl.current_version_id != version.id:
        return False
    return tpl.tenant_id is None or tpl.tenant_id == tenant_id


def template_file(tpl: DocumentTemplate, ver: DocumentTemplateVersion) -> dict:
    """导出为与导入一致的模板文件结构。"""
    return {"code": tpl.code, "name": ver.name, "description": ver.description, "groups": ver.groups}


def version_snapshot(tpl: DocumentTemplate, ver: DocumentTemplateVersion) -> dict:
    return {
        "template_id": tpl.id,
        "template_version_id": ver.id,
        "version": ver.version,
        "code": tpl.code,
        "scope": "system" if tpl.tenant_id is None else "tenant",
        "name": ver.name,
        "description": ver.description,
        "groups": ver.groups,
        "is_current_version": tpl.current_version_id == ver.id,
        "status": tpl.status,
        "deleted": tpl.deleted_at is not None,
    }
