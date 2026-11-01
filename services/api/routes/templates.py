"""模板选择与切换（design D8、D13；FR-VERIFY-018，FR-TEMPLATE-001..005）。

- GET  /templates/versions/<id>                  版本快照（预览 / 渲染；停用或删除的版本仍可读）
- GET  /ocr/jobs/<id>/template-options           可用模板 + 该任务已有映射
- POST /ocr/jobs/<id>/apply-template             套用模板（复用 READY → 200；新建或排队 → 202）
- POST /ocr/jobs/<id>/use-generic                不套用模板（通用结果）

所有写接口走会话 + CSRF（middleware）、任务归属（_get_job_for_user）与租户校验；
切换在任务行锁下执行，不调用大模型、不复制数据。
"""
from __future__ import annotations

from flask import Blueprint, current_app, request

from auth import current_user
from doc_templates import service, views
from doc_templates.repository import current_version as template_current_version
from doc_templates.repository import get_template, is_version_available
from errors import (
    ApiError,
    invalid_argument,
    not_found,
    ok,
    state_conflict,
    version_conflict,
)
from extensions import db
from models import DocumentTemplate, DocumentTemplateVersion, TemplateMapping
from routes.ocr import _get_job_for_user
from routes.results import _result_payload
from workspace import accessible_tenant_ids

templates_bp = Blueprint("templates", __name__)

SUCCESS = ("SUCCEEDED", "PARTIAL_SUCCESS")


def _conflict(code: str, key: str) -> ApiError:
    return ApiError(409, code, key)


def _int_field(body: dict, name: str, *, required: bool = True) -> int | None:
    value = body.get(name)
    if value is None and not required:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise invalid_argument(field_errors=[{"field": name, "reason": "required" if value is None else "invalid"}])
    return value


def _locked_job_for_switch(job_id: str, expected: int):
    """取任务行锁并校验：识别成功、未确认、expected_version 等于当前版本号。"""
    job = _get_job_for_user(job_id, current_user())
    job = service.lock_job(job.id)
    if job.status not in SUCCESS:
        raise state_conflict("results.not_ready")
    if job.review_status == "CONFIRMED":
        raise state_conflict("results.already_confirmed")
    cur = service.current_version(job.id)
    if cur is None:
        raise state_conflict("results.not_ready")
    if expected != cur.version:
        raise version_conflict()
    return job, cur


def _audit(action: str, job, mapping: TemplateMapping | None, result: str, version_no: int) -> None:
    user = current_user()
    service.add_audit(
        action, job,
        {"mapping_id": mapping.id if mapping else None,
         "template_id": mapping.template_id if mapping else None,
         "template_version_id": mapping.template_version_id if mapping else None,
         "source": mapping.source if mapping else None,
         "result": result, "version": version_no},
        user_id=user.id if user else None,
    )


def _switch_to_mapping(job, cur, mapping: TemplateMapping):
    target = service.latest_version_of(job.id, mapping.id)
    if target is None:
        raise state_conflict("template.mapping_not_ready")
    if cur.id != target.id or job.current_mapping_id != mapping.id or job.pending_mapping_id:
        service.switch_to(job, target, mapping.id)
        _audit("template.switched", job, mapping, "switched", target.version)
    db.session.commit()
    return ok(_result_payload(job, target))


@templates_bp.get("/templates/versions/<int:version_id>")
def get_template_version(version_id: int):
    user = current_user()
    ver = db.session.get(DocumentTemplateVersion, version_id)
    if ver is None:
        raise not_found()
    tpl = db.session.get(DocumentTemplate, ver.template_id)
    if tpl is None:
        raise not_found()
    if tpl.tenant_id is not None and tpl.tenant_id not in accessible_tenant_ids(user):
        raise not_found()  # 他租户模板不泄露存在性
    from doc_templates.repository import version_snapshot

    snap = version_snapshot(tpl, ver)
    snap.pop("description", None)  # 描述是给大模型的匹配提示，不下发前端
    return ok(snap)


@templates_bp.get("/ocr/jobs/<job_id>/template-options")
def get_template_options(job_id: str):
    job = _get_job_for_user(job_id, current_user())
    return ok(views.template_options(job))


@templates_bp.post("/ocr/jobs/<job_id>/apply-template")
def apply_template(job_id: str):
    _get_job_for_user(job_id, current_user())  # 先做归属校验（跨用户 404 优先于开关）
    if not views.mapping_enabled():
        raise _conflict("TEMPLATE_MAPPING_DISABLED", "template.mapping_disabled")
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        raise invalid_argument()
    expected = _int_field(body, "expected_version")
    mapping_id = body.get("mapping_id")

    job, cur = _locked_job_for_switch(job_id, expected)

    # —— 切回已有映射 ——
    if mapping_id is not None:
        if not isinstance(mapping_id, str) or not mapping_id:
            raise invalid_argument(field_errors=[{"field": "mapping_id", "reason": "invalid"}])
        mapping = db.session.get(TemplateMapping, mapping_id)
        if mapping is None or mapping.job_id != job.id:
            raise not_found()
        if mapping.status != service.READY:
            raise _conflict("MAPPING_NOT_READY", "template.mapping_not_ready")
        return _switch_to_mapping(job, cur, mapping)

    # —— 按模板套用 ——
    raw_result_id = body.get("raw_result_id")
    if not isinstance(raw_result_id, str) or not raw_result_id:
        raise invalid_argument(field_errors=[{"field": "raw_result_id", "reason": "required"}])
    template_id = _int_field(body, "template_id")
    force = body.get("force") is True

    raw = views.raw_result_of(job.id)
    if raw is None:
        raise _conflict("RAW_RESULT_MISSING", "template.raw_result_missing")
    if raw.id != raw_result_id:
        raise not_found()

    tpl = get_template(template_id)
    ver = template_current_version(tpl) if tpl is not None else None
    if ver is None or not is_version_available(ver, job.tenant_id):
        raise _conflict("TEMPLATE_UNAVAILABLE", "template.unavailable")

    mappings = TemplateMapping.query.filter_by(job_id=job.id, template_version_id=ver.id).order_by(
        TemplateMapping.created_at.desc(), TemplateMapping.id.desc()
    ).all()
    ready = next((m for m in mappings if m.status == service.READY), None)
    if ready is not None and not force:
        return _switch_to_mapping(job, cur, ready)

    running = next((m for m in mappings if m.status in service.IN_PROGRESS), None)
    if running is not None:
        job.pending_mapping_id = running.id
        db.session.commit()
        return ok({"mapping": views.mapping_summary(running, ver)}, status=202)

    limit = int(current_app.config.get("TEMPLATE_MAX_MAPPINGS_PER_JOB", 5))
    if service.mapping_count(job.id) >= limit:
        raise _conflict("MAPPING_LIMIT_REACHED", "template.mapping_limit_reached")

    user = current_user()
    mapping = service.create_mapping(
        job, raw.id, source=service.MANUAL, base_version_id=cur.id,
        template_id=tpl.id, template_version_id=ver.id, user_id=user.id if user else None,
    )
    db.session.commit()
    return ok({"mapping": views.mapping_summary(mapping, ver)}, status=202)


@templates_bp.post("/ocr/jobs/<job_id>/use-generic")
def use_generic(job_id: str):
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        raise invalid_argument()
    expected = _int_field(body, "expected_version")
    job, cur = _locked_job_for_switch(job_id, expected)
    target = service.latest_version_of(job.id, None)
    if target is None:
        raise not_found()
    if cur.id != target.id or job.current_mapping_id is not None or job.pending_mapping_id:
        service.switch_to(job, target, None)
    # FR-OCR-020：显式降级选择也需可追溯，重复选择不新增结果版本。
    _audit("template.generic_selected", job, None, "generic", target.version)
    db.session.commit()
    return ok(_result_payload(job, target))
