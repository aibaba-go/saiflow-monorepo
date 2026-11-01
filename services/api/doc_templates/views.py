"""模板映射的读取视图（design D13）：结果页附加字段、模板选项、映射摘要、任务模板名。

只读，不修改会话中的对象；由 routes/results.py、routes/templates.py、routes/ocr.py 共用。
"""
from __future__ import annotations

from flask import current_app

from doc_templates import normalize, service
from doc_templates.repository import available_versions
from extensions import db
from models import (
    DocumentTemplateVersion,
    OcrJob,
    OcrRawResult,
    ResultVersion,
    TemplateMapping,
)


def mapping_enabled() -> bool:
    return bool(current_app.config.get("TEMPLATE_MAPPING_ENABLED"))


def low_score_threshold() -> float:
    return float(current_app.config.get("TEMPLATE_LOW_SCORE_THRESHOLD", 0.7))


def raw_result_of(job_id: str) -> OcrRawResult | None:
    return OcrRawResult.query.filter_by(job_id=job_id).first()


def raw_result_id_of(job_id: str) -> str | None:
    row = db.session.query(OcrRawResult.id).filter(OcrRawResult.job_id == job_id).first()
    return row[0] if row else None


def mapping_version(mapping: TemplateMapping | None) -> DocumentTemplateVersion | None:
    if mapping is None or mapping.template_version_id is None:
        return None
    return db.session.get(DocumentTemplateVersion, mapping.template_version_id)


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def mapping_summary(mapping: TemplateMapping, ver: DocumentTemplateVersion | None = None) -> dict:
    ver = ver if ver is not None else mapping_version(mapping)
    score = mapping.match_score
    return {
        "id": mapping.id,
        "status": mapping.status,
        "source": mapping.source,
        "template_id": mapping.template_id,
        "template_version_id": mapping.template_version_id,
        "template_version": ver.version if ver else None,
        "template_name": ver.name if ver else None,
        "match_score": score,
        "low_score": score is not None and score < low_score_threshold(),
        "error_code": mapping.error_code or None,
        "error_message": mapping.error_message or None,
        "created_at": _iso(mapping.created_at),
        "finished_at": _iso(mapping.finished_at),
    }


def groups_for_version(version: ResultVersion | None) -> tuple[TemplateMapping | None, DocumentTemplateVersion | None]:
    """结果版本所属映射与模板版本；通用结果返回 (None, None)。"""
    if version is None or not version.mapping_id:
        return None, None
    mapping = db.session.get(TemplateMapping, version.mapping_id)
    return mapping, mapping_version(mapping)


def template_available(job: OcrJob, raw_id: str | None) -> bool:
    return mapping_enabled() and raw_id is not None and bool(available_versions(job.tenant_id))


def latest_failed(job_id: str) -> TemplateMapping | None:
    latest = (
        TemplateMapping.query.filter(
            TemplateMapping.job_id == job_id,
            TemplateMapping.status.in_((service.READY, service.FAILED)),
        )
        .order_by(TemplateMapping.created_at.desc(), TemplateMapping.id.desc())
        .first()
    )
    return latest if latest is not None and latest.status == service.FAILED else None


def result_extras(job: OcrJob, version: ResultVersion) -> dict:
    """GET / PATCH results 的模板相关附加字段。"""
    raw_id = raw_result_id_of(job.id)
    mapping, ver = groups_for_version(version)
    current = schema = validation = None
    if mapping is not None and ver is not None:
        current = mapping_summary(mapping, ver)
        schema = {"template_version_id": ver.id, "name": ver.name, "groups": ver.groups}
        structured = version.structured if isinstance(version.structured, dict) else {}
        validation = {
            "required_missing": normalize.required_missing(ver.groups, structured),
            "type_warnings": normalize.type_warnings(ver.groups, structured),
        }
    pending = None
    if job.pending_mapping_id:
        pm = db.session.get(TemplateMapping, job.pending_mapping_id)
        if pm is not None and pm.status in service.IN_PROGRESS:
            pending = {
                "id": pm.id, "status": pm.status, "source": pm.source,
                "template_name": (mapping_version(pm).name if pm.template_version_id else None),
            }
    failed = latest_failed(job.id)
    return {
        "raw_result_id": raw_id,
        "current_mapping": current,
        "template_schema": schema,
        "pending_mapping": pending,
        "latest_failed_mapping": (
            {"id": failed.id, "template_name": (mapping_version(failed).name if failed.template_version_id else None),
             "error_code": failed.error_code, "error_message": failed.error_message,
             "source": failed.source}
            if failed is not None else None
        ),
        "template_available": template_available(job, raw_id),
        "validation": validation,
    }


def template_options(job: OcrJob) -> dict:
    """模板选择框：可用模板（按自动匹配得分排序，第一项推荐）+ 该任务已有映射。"""
    raw_id = raw_result_id_of(job.id)
    mappings = (
        TemplateMapping.query.filter_by(job_id=job.id)
        .order_by(TemplateMapping.created_at.asc(), TemplateMapping.id.asc())
        .all()
    )
    auto = next((m for m in reversed(mappings) if m.source == service.AUTO), None)
    scores: dict[int, float] = {}
    if auto is not None:
        for cand in auto.candidates or []:
            tid = cand.get("template_id") if isinstance(cand, dict) else None
            if isinstance(tid, int) and isinstance(cand.get("score"), (int, float)) and tid not in scores:
                scores[tid] = float(cand["score"])
        if auto.template_id is not None and auto.template_id not in scores and auto.status == service.READY:
            scores[auto.template_id] = auto.match_score if auto.match_score is not None else 1.0

    ready_by_version: dict[int, TemplateMapping] = {}
    for m in mappings:
        if m.status == service.READY and m.template_version_id is not None:
            ready_by_version[m.template_version_id] = m  # 同一版本取最近一次
    in_progress_by_version = {
        m.template_version_id: m for m in mappings
        if m.status in service.IN_PROGRESS and m.template_version_id is not None
    }

    current_tv = _mapping_template_version(job.current_mapping_id) if job.current_mapping_id else None
    templates = []
    if mapping_enabled():
        for tpl, ver in available_versions(job.tenant_id):
            ready = ready_by_version.get(ver.id)
            running = in_progress_by_version.get(ver.id)
            templates.append({
                "template_id": tpl.id,
                "template_version_id": ver.id,
                "template_version": ver.version,
                "code": tpl.code,
                "scope": "system" if tpl.tenant_id is None else "tenant",
                "name": ver.name,
                "score": scores.get(tpl.id),
                "low_score": tpl.id in scores and scores[tpl.id] < low_score_threshold(),
                "recommended": False,
                "generated": ready is not None,
                "ready_mapping_id": ready.id if ready else None,
                "in_progress_mapping_id": running.id if running else None,
                "is_current": current_tv is not None and current_tv == ver.id,
            })
        templates.sort(key=lambda t: (t["score"] is None, -(t["score"] or 0.0), t["name"].lower(), t["template_id"]))
        if templates and templates[0]["score"] is not None:
            templates[0]["recommended"] = True

    return {
        "raw_result_id": raw_id,
        "enabled": mapping_enabled(),
        "current_mapping_id": job.current_mapping_id,
        "pending_mapping_id": job.pending_mapping_id,
        "max_mappings": int(current_app.config.get("TEMPLATE_MAX_MAPPINGS_PER_JOB", 5)),
        "mapping_count": len(mappings),
        "templates": templates,
        "mappings": [
            {**mapping_summary(m), "is_current": job.current_mapping_id == m.id}
            for m in mappings if m.status in (service.READY, service.FAILED)
        ],
    }


def _mapping_template_version(mapping_id: str) -> int | None:
    row = db.session.query(TemplateMapping.template_version_id).filter(TemplateMapping.id == mapping_id).first()
    return row[0] if row else None


def template_names(jobs: list[OcrJob]) -> dict[str, str]:
    """任务摘要用：job_id → 当前映射的模板名（通用结果不出现在结果中）。"""
    ids = {j.current_mapping_id for j in jobs if j.current_mapping_id}
    if not ids:
        return {}
    rows = (
        db.session.query(TemplateMapping.id, DocumentTemplateVersion.name)
        .join(DocumentTemplateVersion, DocumentTemplateVersion.id == TemplateMapping.template_version_id)
        .filter(TemplateMapping.id.in_(ids))
        .all()
    )
    by_mapping = {mid: name for mid, name in rows}
    return {j.id: by_mapping[j.current_mapping_id] for j in jobs if j.current_mapping_id in by_mapping}
