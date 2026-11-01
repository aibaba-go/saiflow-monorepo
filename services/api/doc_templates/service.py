"""模板映射与结果版本指针（design D7、D8、D16）。

- 任务内结果版本号为单一序列：新版本号 = max(version) + 1（切回旧映射后再保存不会撞号）。
- result_versions.mapping_id 标记版本归属；为空表示通用结果。
- ocr_jobs.current_mapping_id 指向当前版本所属映射；pending_mapping_id 指向用户最近一次请求、尚未完成的映射。
- 创建 / 切换 / 生效都在任务行锁（FOR UPDATE）下执行；本模块不 commit，由调用方提交。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func

from extensions import db
from models import AuditEvent, OcrJob, ResultVersion, TemplateMapping

AUTO = "AUTO"
MANUAL = "MANUAL"
PENDING = "PENDING"
MATCHING = "MATCHING"
CONVERTING = "CONVERTING"
READY = "READY"
FAILED = "FAILED"
IN_PROGRESS = (PENDING, MATCHING, CONVERTING)


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def lock_job(job_id: str) -> OcrJob | None:
    return db.session.get(OcrJob, job_id, with_for_update=True, populate_existing=True)


def current_version(job_id: str) -> ResultVersion | None:
    return ResultVersion.query.filter_by(job_id=job_id, is_current=True).first()


def next_version_no(job_id: str) -> int:
    return (
        db.session.query(func.max(ResultVersion.version)).filter(ResultVersion.job_id == job_id).scalar() or 0
    ) + 1


def latest_version_of(job_id: str, mapping_id: str | None) -> ResultVersion | None:
    """某个映射（None = 通用结果）最近保存的版本。"""
    query = ResultVersion.query.filter(ResultVersion.job_id == job_id)
    if mapping_id is None:
        query = query.filter(ResultVersion.mapping_id.is_(None))
    else:
        query = query.filter(ResultVersion.mapping_id == mapping_id)
    return query.order_by(ResultVersion.version.desc()).first()


def mapping_count(job_id: str) -> int:
    return TemplateMapping.query.filter_by(job_id=job_id).count()


def add_audit(action: str, job: OcrJob, detail: dict, *, user_id: int | None = None) -> None:
    db.session.add(
        AuditEvent(
            user_id=user_id, action=action, object_type="ocr_job", object_id=str(job.id),
            detail={"tenant_id": job.tenant_id, **detail},
        )
    )


def create_mapping(
    job: OcrJob, raw_result_id: str, *, source: str, base_version_id: str | None,
    template_id: int | None = None, template_version_id: int | None = None, user_id: int | None = None,
) -> TemplateMapping:
    """新建映射并设为 pending（调用方已持有任务行锁）。"""
    mapping = TemplateMapping(
        job_id=job.id, raw_result_id=raw_result_id, source=source, status=PENDING,
        template_id=template_id, template_version_id=template_version_id,
        created_by_user_id=user_id, base_version_id=base_version_id,
    )
    db.session.add(mapping)
    db.session.flush()
    job.pending_mapping_id = mapping.id
    return mapping


def create_auto_mapping(job: OcrJob, raw_result_id: str, base_version: ResultVersion) -> TemplateMapping | None:
    """OCR 成功后：存在可用模板时创建 AUTO 映射（0 个候选不创建）。"""
    from doc_templates.repository import available_versions

    if not available_versions(job.tenant_id):
        return None
    return create_mapping(job, raw_result_id, source=AUTO, base_version_id=base_version.id)


def switch_to(job: OcrJob, target: ResultVersion, mapping_id: str | None) -> ResultVersion:
    """把任务当前版本切换到 target（同步、无数据复制；调用方已持有任务行锁）。"""
    from textin.adapter import _count_structure

    cur = current_version(job.id)
    if cur is not None and cur.id != target.id:
        cur.is_current = False
        db.session.flush()  # 先落旧版本，避免 (job_id) WHERE is_current 部分唯一索引瞬时冲突
    target.is_current = True
    job.current_mapping_id = mapping_id
    job.pending_mapping_id = None
    job.table_count, job.field_count = _count_structure(target.structured)
    return target


def finalize_ready(
    mapping: TemplateMapping, job: OcrJob, structured: dict, *, warnings: list[dict], dropped: int,
) -> tuple[ResultVersion, bool]:
    """映射 READY：总会生成归属版本；仅在 D8 条件全部满足时自动生效。返回 (版本, 是否生效)。"""
    version = ResultVersion(
        job_id=job.id, version=next_version_no(job.id), is_current=False,
        created_by_user_id=None, structured=structured, mapping_id=mapping.id,
    )
    db.session.add(version)
    db.session.flush()
    mapping.status = READY
    mapping.result_version_id = version.id
    mapping.warnings = warnings
    mapping.dropped_keys = dropped
    mapping.finished_at = now()
    mapping.error_code = ""
    mapping.error_message = ""

    cur = current_version(job.id)
    apply = (
        job.pending_mapping_id == mapping.id
        and cur is not None
        and cur.id == mapping.base_version_id
        and job.review_status != "CONFIRMED"
    )
    if apply:
        switch_to(job, version, mapping.id)
        add_audit(
            "template.applied", job,
            {"mapping_id": mapping.id, "template_id": mapping.template_id,
             "template_version_id": mapping.template_version_id, "source": mapping.source,
             "result": "auto_applied", "version": version.version},
            user_id=mapping.created_by_user_id,
        )
    elif job.pending_mapping_id == mapping.id:
        job.pending_mapping_id = None  # 只保留为「已生成，可切换」
    return version, apply


def fail(mapping: TemplateMapping, job: OcrJob | None, code: str, message: str) -> None:
    mapping.status = FAILED
    mapping.error_code = code
    mapping.error_message = (message or "")[:512]
    mapping.finished_at = now()
    if job is not None:
        if job.pending_mapping_id == mapping.id:
            job.pending_mapping_id = None
        add_audit(
            "template.mapping_failed", job,
            {"mapping_id": mapping.id, "template_id": mapping.template_id,
             "template_version_id": mapping.template_version_id, "source": mapping.source,
             "result": code},
            user_id=mapping.created_by_user_id,
        )


def delete_for_job(job_id: str) -> None:
    """删除任务结果时一并删除映射与原始结果（D16）；调用方先删结果版本。"""
    from models import OcrRawResult

    job = db.session.get(OcrJob, job_id)
    if job is not None:
        job.current_mapping_id = None
        job.pending_mapping_id = None
    TemplateMapping.query.filter_by(job_id=job_id).delete(synchronize_session=False)
    OcrRawResult.query.filter_by(job_id=job_id).delete(synchronize_session=False)
