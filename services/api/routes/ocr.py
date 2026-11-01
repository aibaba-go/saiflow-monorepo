"""OCR 任务路由（PRD §9/§14.2）。

任务归属租户由源文件推导（文件与任务同租户），访问控制与 fileaccess 一致：
本人任务 + 本人生成，或所在企业租户的 ACTIVE 成员可见。
幂等创建：Idempotency-Key（header 优先，body 兜底）命中已有任务时原样返回。
"""
from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, current_app, request
from sqlalchemy import and_, func, select

from auth import audit, current_user
from errors import invalid_argument, not_found, ok, state_conflict
from extensions import db
from fileaccess import get_file_for_user
from models import File, OcrJob, User
import quota
from workspace import accessible_tenant_ids, resolve_tenant

ocr_bp = Blueprint("ocr", __name__)

TERMINAL = {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}
RUNNING = {"QUEUED", "PREPROCESSING", "PROCESSING", "POSTPROCESSING"}
MAX_FIELD_NAMES = 100
MAX_FIELD_NAME_LEN = 64


def _get_job_for_user(job_id: str, user) -> OcrJob:
    job = db.session.get(OcrJob, job_id)
    if job is None:
        raise not_found()
    if job.created_by_user_id == user.id:
        return job
    # 他人任务只在同一个可见租户下才放行（他人的个人租户不在列表里）
    if job.tenant_id in accessible_tenant_ids(user):
        return job
    raise not_found()


def _registered(user: User | None) -> bool:
    return user is not None and not user.is_guest and user.registered_at is not None


_STAGES = {"OCR_PROCESSING", "OCR_FAILED", "TEMPLATE_MATCHING", "VERIFYING", "VERIFIED", "COMPLETED"}
_SUCCESS = ("SUCCEEDED", "PARTIAL_SUCCESS")


def _stage_condition(stage: str):
    """与 OcrJob.stage() 一致的 SQL 条件，供分页前在库内按阶段筛选。"""
    if stage == "OCR_FAILED":
        return OcrJob.status.in_(("FAILED", "CANCELLED"))
    if stage == "OCR_PROCESSING":
        return OcrJob.status.notin_(TERMINAL)
    succeeded = OcrJob.status.in_(_SUCCESS)
    unconfirmed = and_(succeeded, OcrJob.review_status != "CONFIRMED")
    if stage == "TEMPLATE_MATCHING":
        return and_(unconfirmed, OcrJob.pending_mapping_id.isnot(None))
    if stage == "VERIFYING":
        return and_(unconfirmed, OcrJob.pending_mapping_id.is_(None))
    confirmed = and_(succeeded, OcrJob.review_status == "CONFIRMED")
    if stage == "COMPLETED":
        return and_(confirmed, OcrJob.completed_at.isnot(None))
    return and_(confirmed, OcrJob.completed_at.is_(None))


def _summary(job: OcrJob) -> dict:
    from doc_templates.views import template_names

    file = db.session.get(File, job.file_id)
    return job.to_summary(
        file_name=file.original_name if file else "", template_name=template_names([job]).get(job.id)
    )


@ocr_bp.get("/ocr/capabilities")
def capabilities():
    cfg = current_app.config
    return ok(
        {
            "vendor": "textin",
            "features": {
                "table": True,
                "formula": True,
                "rotate": True,
                "fields": True,
                "parse_modes": ["scan", "layout", "article"],
            },
            "limits": {
                "allowed_extensions": sorted(cfg["ALLOWED_FILE_EXTENSIONS"]),
                "max_file_size_bytes": cfg["MAX_FILE_SIZE_BYTES"],
                "max_pages_per_task": cfg["MAX_PAGES_PER_TASK"],
                "max_images_per_task": cfg["MAX_IMAGES_PER_TASK"],
                "max_images_total_bytes": cfg["MAX_IMAGES_TOTAL_BYTES"],
            },
        }
    )


@ocr_bp.post("/ocr/jobs")
def create_job():
    user = current_user()
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        raise invalid_argument()

    file_id = body.get("file_id")
    if not file_id or not isinstance(file_id, str):
        raise invalid_argument(field_errors=[{"field": "file_id", "reason": "required"}])

    file = get_file_for_user(file_id, user)  # 跨用户直接 404
    if file.purpose != "OCR_TASK":
        raise invalid_argument("job.file_purpose_invalid")
    if file.status != "READY":
        raise state_conflict("job.file_not_ready")

    # 任务与文件同租户；这里再解析一次租户（文件可见≠租户可用，企业需 ACTIVE 成员且已过审）
    tenant = resolve_tenant(user, file.tenant_id)

    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise invalid_argument(field_errors=[{"field": "params", "reason": "invalid"}])
    field_names = body.get("field_names")
    if field_names is not None:
        if (
            not isinstance(field_names, list)
            or len(field_names) > MAX_FIELD_NAMES
            or any(not isinstance(n, str) or not n.strip() or len(n) > MAX_FIELD_NAME_LEN for n in field_names)
        ):
            raise invalid_argument(field_errors=[{"field": "field_names", "reason": "invalid"}])
        field_names = [n.strip() for n in field_names if n.strip()]

    page = params.get("page")
    page_count = params.get("page_count")
    if page is not None and (not isinstance(page, int) or isinstance(page, bool) or page < 0):
        raise invalid_argument(field_errors=[{"field": "page", "reason": "invalid"}])
    if page_count is not None and (
        not isinstance(page_count, int) or isinstance(page_count, bool) or page_count < 1
    ):
        raise invalid_argument(field_errors=[{"field": "page_count", "reason": "invalid"}])
    if file.page_count:
        start = (page or 0) + 1
        span = page_count or min(file.page_count, current_app.config["MAX_PAGES_PER_TASK"])
        if start > file.page_count:
            raise invalid_argument("job.page_out_of_range")
        if span > current_app.config["MAX_PAGES_PER_TASK"]:
            raise invalid_argument("job.page_count_exceeded")

    idem = request.headers.get("Idempotency-Key") or body.get("idempotency_key") or None
    if idem is not None:
        if not isinstance(idem, str) or not idem.strip() or len(idem) > 128:
            raise invalid_argument(field_errors=[{"field": "idempotency_key", "reason": "invalid"}])
        idem = idem.strip()
        existing = OcrJob.query.filter_by(idempotency_key=idem).first()
        if existing is not None:
            owner = existing.created_by_user_id == user.id
            if owner or existing.tenant_id in accessible_tenant_ids(user):
                return ok(_summary(existing), status=200)  # 幂等重放
            raise not_found()

    stored_params = {
        k: params[k]
        for k in ("parse_mode", "table", "formula", "rotate", "page", "page_count")
        if k in params
    }
    if field_names:
        stored_params["field_names"] = field_names

    job = OcrJob(
        tenant_id=tenant.id,
        created_by_user_id=user.id,
        file_id=file.id,
        params=stored_params,
        capability={"vendor": "textin"},
        status="QUEUED",
        progress=0,
        idempotency_key=idem,
    )
    db.session.add(job)
    db.session.flush()  # 先生成 job.id，配额消耗才能关联
    quota.check_and_consume(job)
    db.session.commit()
    audit("job.create", "ocr_job", job.id, {"file_id": file.id, "params": stored_params})
    return ok(_summary(job), status=201)


@ocr_bp.get("/ocr/jobs")
def list_jobs():
    user = current_user()
    q = request.args

    # 可见范围就是「我能访问的租户」，个人租户只有本人、企业租户按 ACTIVE 成员
    tenant_ids = accessible_tenant_ids(user)
    query = OcrJob.query.filter(OcrJob.tenant_id.in_(tenant_ids or [0]))

    status = q.get("status")
    if status:
        wanted = [s.strip().upper() for s in status.split(",") if s.strip()]
        bad = [s for s in wanted if s not in TERMINAL | RUNNING]
        if bad:
            raise invalid_argument(field_errors=[{"field": "status", "reason": "invalid"}])
        query = query.filter(OcrJob.status.in_(wanted))

    if q.get("tenant_id") is not None:
        tid = q.get("tenant_id", type=int)
        if tid is None:
            raise invalid_argument(field_errors=[{"field": "tenant_id", "reason": "invalid"}])
        # 不可见租户按 404 处理（与改造前传他人 enterprise_id 的行为一致）
        if tid not in tenant_ids:
            raise not_found()
        query = query.filter(OcrJob.tenant_id == tid)

    stage = q.get("stage")
    if stage:
        stage = stage.strip().upper()
        if stage not in _STAGES:
            raise invalid_argument(field_errors=[{"field": "stage", "reason": "invalid"}])
        query = query.filter(_stage_condition(stage))

    keyword = (q.get("q") or "").strip()
    if keyword:
        query = query.filter(
            OcrJob.file_id.in_(
                select(File.id).where(
                    func.lower(File.original_name).contains(keyword.lower(), autoescape=True)
                )
            )
        )

    page = q.get("page", default=1, type=int)
    page_size = q.get("page_size", default=20, type=int)
    if page < 1 or page_size < 1 or page_size > 100:
        raise invalid_argument(field_errors=[{"field": "page", "reason": "invalid"}])

    total = query.count()
    rows = (
        query.order_by(OcrJob.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    file_ids = {j.file_id for j in rows}
    names = {
        f.id: f.original_name for f in File.query.filter(File.id.in_(file_ids)).all()
    } if file_ids else {}
    from doc_templates.views import template_names

    tpl_names = template_names(rows)
    return ok(
        {
            "items": [
                j.to_summary(file_name=names.get(j.file_id, ""), template_name=tpl_names.get(j.id))
                for j in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    )


@ocr_bp.get("/ocr/jobs/<job_id>")
def get_job(job_id: str):
    job = _get_job_for_user(job_id, current_user())
    return ok(_summary(job))


@ocr_bp.post("/ocr/jobs/<job_id>/cancel")
def cancel_job(job_id: str):
    user = current_user()
    job = _get_job_for_user(job_id, user)
    if job.status in TERMINAL:
        raise state_conflict("job.already_terminal")
    if job.status == "CANCEL_REQUESTED":
        return ok(_summary(job))  # 幂等
    if job.status == "QUEUED":
        job.status = "CANCELLED"
        job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        # 页数计量只统计非 FAILED/CANCELLED 的任务，取消即自动不计，无需返还流水
    else:
        job.status = "CANCEL_REQUESTED"
    db.session.commit()
    audit("job.cancel", "ocr_job", job.id)
    return ok(_summary(job))


@ocr_bp.post("/ocr/jobs/<job_id>/rerun")
def rerun_job(job_id: str):
    user = current_user()
    old = _get_job_for_user(job_id, user)
    if old.status not in TERMINAL:
        raise state_conflict("job.not_terminal")
    file = db.session.get(File, old.file_id)
    if file is None or file.status != "READY":
        raise state_conflict("job.file_not_ready")
    tenant = resolve_tenant(user, file.tenant_id)

    job = OcrJob(
        tenant_id=tenant.id,
        created_by_user_id=user.id,
        file_id=old.file_id,
        params=dict(old.params or {}),
        capability=dict(old.capability or {}),
        status="QUEUED",
        progress=0,
        parent_job_id=old.id,
    )
    db.session.add(job)
    db.session.flush()
    quota.check_and_consume(job)
    db.session.commit()
    audit("job.rerun", "ocr_job", job.id, {"parent_job_id": old.id})
    return ok(_summary(job), status=201)


@ocr_bp.delete("/ocr/jobs/<job_id>")
def delete_job(job_id: str):
    user = current_user()
    job = _get_job_for_user(job_id, user)
    from doc_templates.service import lock_job

    job = lock_job(job.id)  # D16：与映射完成 / 模板切换串行，删除后 worker 不再补写结果
    if job is None:
        raise not_found()
    if job.status not in TERMINAL:
        raise state_conflict("job.not_terminal")

    from models import Export, PageResult, ResultVersion

    versions = ResultVersion.query.filter_by(job_id=job.id).all()
    version_ids = [v.id for v in versions]
    if version_ids:
        PageResult.query.filter(PageResult.result_version_id.in_(version_ids)).delete(
            synchronize_session=False
        )
        exports = Export.query.filter(Export.result_version_id.in_(version_ids)).all()
        import storage

        for exp in exports:
            if exp.storage_path:
                storage.delete(exp.storage_path)
            db.session.delete(exp)
        for v in versions:
            db.session.delete(v)
    # D16：一并删除模板映射与 OCR 解析结果并清空任务指针；处理中的映射 Worker 发现映射不存在即中止
    from doc_templates.service import delete_for_job

    delete_for_job(job.id)
    db.session.commit()
    audit("job.delete_results", "ocr_job", job.id)
    return ok({"id": job.id, "results_deleted": True})
