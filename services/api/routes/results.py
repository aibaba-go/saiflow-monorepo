"""结果读取与复核（PRD §10 + 乐观并发）。

GET 返回当前 ResultVersion：structured 为 TextIn Prompt 模式结构化 JSON
（旧版逐页结果折算为 {fields, tables}），pages 为旧版逐页数据。
PATCH 携带 expected_version 做乐观并发校验，命中冲突返回 409 VERSION_CONFLICT。
TextIn Prompt 任务没有 PageResult，编辑时直接提交完整 structured；
旧版逐页任务仍支持按单元格编辑。
每次有内容修改都会生成新 ResultVersion（旧版本 is_current=False，历史可追溯）。

模板映射（FR-VERIFY-018..020，design D8、D13、D14）：
- 新版本号 = 任务内 max(version) + 1，并继承当前版本的 mapping_id（通用 / 某个模板映射各自演进）；
- PATCH 在任务行锁下执行，与模板切换、映射自动生效串行；
- 模板结果保存前按模板补齐结构（缺失字段补 null，模板外内容原样保留）；
- 模板结果确认前做必填门禁，缺失返回 422（草稿保存不拦截）；
- 首次确认时记录一次自动匹配反馈审计（template.match_feedback）；
- 响应附加 raw_result_id / current_mapping / template_schema / pending_mapping /
  latest_failed_mapping / template_available / validation（见 doc_templates.views.result_extras）。
"""
from __future__ import annotations

import copy
import json
from datetime import datetime, timezone

from flask import Blueprint, request

from auth import audit, current_user
from errors import (
    auth_required,
    invalid_argument,
    not_found,
    ok,
    permission_denied,
    state_conflict,
    version_conflict,
)
from extensions import db
from doc_templates import normalize as template_normalize
from doc_templates import service as mapping_service
from doc_templates import views as template_views
from errors import ApiError
from models import PageResult, ResultVersion, TemplateMapping
from routes.ocr import TERMINAL, _get_job_for_user, _registered
from textin.adapter import _count_structure

results_bp = Blueprint("results", __name__)

MAX_EDIT_TEXT = 4000
MAX_STRUCTURED_BYTES = 2_000_000


def _normalize_structured(value):
    if not isinstance(value, (dict, list)):
        raise invalid_argument(field_errors=[{"field": "structured", "reason": "invalid"}])
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        raise invalid_argument(field_errors=[{"field": "structured", "reason": "invalid"}])
    if len(encoded.encode("utf-8")) > MAX_STRUCTURED_BYTES:
        raise invalid_argument(field_errors=[{"field": "structured", "reason": "too_large"}])
    return copy.deepcopy(value)


def _current_version(job_id: str) -> ResultVersion | None:
    return ResultVersion.query.filter_by(job_id=job_id, is_current=True).first()


def _pages_payload(version: ResultVersion) -> list[dict]:
    rows = (
        PageResult.query.filter_by(result_version_id=version.id)
        .order_by(PageResult.page_number.asc())
        .all()
    )
    return [
        {"page_number": p.page_number, "text": p.text, "tables": p.tables, "fields": p.fields}
        for p in rows
    ]


def _legacy_structured(pages: list[dict]) -> dict:
    """旧版逐页结果（无 structured）折算成同形 JSON：字段 key-value + 表格行。"""
    fields: dict[str, str] = {}
    tables: list[list[list[str]]] = []
    for p in pages:
        for f in p.get("fields") or []:
            name = str(f.get("name") or "")
            if name and name not in fields:
                fields[name] = str(f.get("value") or "")
        for t in p.get("tables") or []:
            grid = [["" for _ in range(int(t.get("column_count") or 0))] for _ in range(int(t.get("row_count") or 0))]
            for c in t.get("cells") or []:
                r, col = c.get("row_index", 0), c.get("column_index", 0)
                if r < len(grid) and col < len(grid[r]):
                    grid[r][col] = str(c.get("current_text") or "")
            tables.append(grid)
    return {"fields": fields, "tables": tables}


def _result_payload(job, version: ResultVersion) -> dict:
    pages = _pages_payload(version)
    structured = version.structured if version.structured is not None else _legacy_structured(pages)
    return {
        "job_id": job.id,
        "version": version.version,
        "review_status": job.review_status,
        "page_count": job.page_count,
        "table_count": job.table_count,
        "field_count": job.field_count,
        "missing_pages": list(job.missing_pages or []),
        "structured": structured,
        "pages": pages,
        **_template_extras(job, version),
    }


# —— 模板映射协作点（集中为模块级函数，便于单元测试替换）——


def _template_extras(job, version: ResultVersion) -> dict:
    return template_views.result_extras(job, version)


def _lock_job(job):
    return mapping_service.lock_job(job.id)


def _template_groups(version: ResultVersion) -> list[dict] | None:
    _, template_ver = template_views.groups_for_version(version)
    return template_ver.groups if template_ver is not None else None


def _next_version_no(job_id: str) -> int:
    return mapping_service.next_version_no(job_id)


def _required_gate(groups: list[dict], structured) -> None:
    """必填门禁（FR-VERIFY-020）：模板结果确认前，按保存后的内容校验 required；缺失返回 422，不写入。"""
    missing = template_normalize.required_missing(groups, structured)
    if missing:
        raise ApiError(
            422, "INVALID_ARGUMENT", "results.required_missing",
            field_errors=[{"field": f"structured.{path}", "reason": "required"} for path in missing],
        )


def _match_feedback(job, version: ResultVersion, user) -> None:
    """确认时记录一次自动匹配反馈：自动匹配的模板版本 vs 最终确认的模板版本。"""
    auto = (
        TemplateMapping.query.filter_by(job_id=job.id, source=mapping_service.AUTO)
        .order_by(TemplateMapping.created_at.desc(), TemplateMapping.id.desc())
        .first()
    )
    if auto is None:
        return
    final = db.session.get(TemplateMapping, version.mapping_id) if version.mapping_id else None
    auto_tv = auto.template_version_id if auto.status == mapping_service.READY else None
    final_tv = final.template_version_id if final is not None else None
    mapping_service.add_audit(
        "template.match_feedback", job,
        {"mapping_id": final.id if final else None,
         "auto_mapping_id": auto.id, "auto_status": auto.status,
         "auto_template_version_id": auto_tv, "auto_match_score": auto.match_score,
         "final_template_id": final.template_id if final else None,
         "template_version_id": final_tv,
         "source": final.source if final else None,
         "result": "match" if auto_tv is not None and auto_tv == final_tv else "changed",
         "version": version.version},
        user_id=user.id if user else None,
    )


@results_bp.get("/ocr/jobs/<job_id>/results")
def get_results(job_id: str):
    job = _get_job_for_user(job_id, current_user())
    version = _current_version(job.id)
    if version is None:
        if job.status not in TERMINAL:
            raise state_conflict("results.not_ready")
        raise not_found()
    return ok(_result_payload(job, version))


@results_bp.patch("/ocr/jobs/<job_id>/results")
def update_results(job_id: str):
    user = current_user()
    job = _get_job_for_user(job_id, user)
    job = _lock_job(job)  # 与模板切换 / 映射生效串行，版本号 max+1 不撞号
    version = _current_version(job.id)
    if version is None:
        if job.status not in TERMINAL:
            raise state_conflict("results.not_ready")
        raise not_found()
    groups = _template_groups(version)

    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        raise invalid_argument()
    expected = body.get("expected_version")
    if not isinstance(expected, int) or isinstance(expected, bool):
        raise invalid_argument(field_errors=[{"field": "expected_version", "reason": "required"}])
    if expected != version.version:
        raise version_conflict()

    edits = body.get("edits") or []
    if not isinstance(edits, list):
        raise invalid_argument(field_errors=[{"field": "edits", "reason": "invalid"}])
    confirm = bool(body.get("confirm"))
    # FR-SYS-011/014：仅结果 Continue 要求注册；在任何版本/状态写入前拒绝，草稿仍可保存。
    if confirm and not _registered(user):
        if user.is_guest:
            raise auth_required()
        raise permission_denied("registration.required")

    normalized_structured = None
    structured_changed = False
    raw_structured = body.get("structured")
    if raw_structured is not None:
        if edits:
            raise invalid_argument(
                field_errors=[
                    {"field": "edits", "reason": "mutually_exclusive_with_structured"}
                ]
            )
        normalized_structured = _normalize_structured(raw_structured)
        if groups is not None:
            # 模板结果的结构补齐：缺失的模板字段补 null、表格行补齐列；模板外内容原样保留
            normalized_structured = template_normalize.fill_structure(groups, normalized_structured)
        structured_changed = normalized_structured != version.structured

    field_errors: list[dict] = []
    normalized: list[dict] = []
    for i, e in enumerate(edits):
        if not isinstance(e, dict):
            field_errors.append({"field": f"edits[{i}]", "reason": "invalid"})
            continue
        pn, tid, ri, ci = e.get("page_number"), e.get("table_id"), e.get("row_index"), e.get("column_index")
        text = e.get("current_text")
        ok_shape = (
            isinstance(pn, int) and not isinstance(pn, bool) and pn >= 1
            and isinstance(tid, str) and tid
            and isinstance(ri, int) and not isinstance(ri, bool) and ri >= 0
            and isinstance(ci, int) and not isinstance(ci, bool) and ci >= 0
            and isinstance(text, str) and len(text) <= MAX_EDIT_TEXT
        )
        if not ok_shape:
            field_errors.append({"field": f"edits[{i}]", "reason": "invalid"})
            continue
        normalized.append(
            {"page_number": pn, "table_id": tid, "row_index": ri, "column_index": ci, "text": text}
        )
    if field_errors:
        raise invalid_argument(field_errors=field_errors)

    if confirm and groups is not None:
        _required_gate(groups, normalized_structured if structured_changed else version.structured)
    was_confirmed = job.review_status == "CONFIRMED"

    pages = _pages_payload(version)

    if structured_changed:
        new_version = ResultVersion(
            job_id=job.id,
            version=_next_version_no(job.id),
            is_current=True,
            created_by_user_id=user.id,
            structured=normalized_structured,
            mapping_id=version.mapping_id,
        )
        version.is_current = False
        db.session.flush()  # 先落旧版本，避免 (job_id) WHERE is_current 部分唯一索引瞬时冲突
        db.session.add(new_version)
        db.session.flush()
        version = new_version
        job.table_count, job.field_count = _count_structure(normalized_structured)

    elif normalized:
        page_map = {p["page_number"]: p for p in pages}
        not_found_errors: list[dict] = []
        for e in normalized:
            page = page_map.get(e["page_number"])
            table = next(
                (t for t in (page["tables"] if page else []) if t.get("table_id") == e["table_id"]),
                None,
            )
            cell = next(
                (
                    c
                    for c in (table.get("cells") if table else [])
                    if c.get("row_index") == e["row_index"] and c.get("column_index") == e["column_index"]
                ),
                None,
            )
            if cell is None:
                not_found_errors.append(
                    {
                        "field": "edits",
                        "reason": "cell_not_found",
                        "page_number": e["page_number"],
                        "table_id": e["table_id"],
                        "row_index": e["row_index"],
                        "column_index": e["column_index"],
                    }
                )
                continue
            cell["current_text"] = e["text"]
            cell["review_status"] = "EDITED"  # raw_text 保留，审计可回溯
        if not_found_errors:
            raise invalid_argument(field_errors=not_found_errors)

        new_version = ResultVersion(
            job_id=job.id,
            version=_next_version_no(job.id),
            is_current=True,
            created_by_user_id=user.id,
            structured=copy.deepcopy(version.structured),
            mapping_id=version.mapping_id,
        )
        version.is_current = False
        db.session.flush()
        db.session.add(new_version)
        db.session.flush()
        for p in pages:
            db.session.add(
                PageResult(
                    result_version_id=new_version.id,
                    page_number=p["page_number"],
                    text=p["text"],
                    tables=p["tables"],
                    fields=p["fields"],
                )
            )
        version = new_version

    if confirm:
        if not was_confirmed:
            _match_feedback(job, version, user)
        job.review_status = "CONFIRMED"
        if job.completed_at is None:
            job.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if not normalized and not structured_changed:
            # 仅确认：内容未变，直接把当前版本所有单元格置为 CONFIRMED
            rows = PageResult.query.filter_by(result_version_id=version.id).all()
            for r in rows:
                new_tables: list[dict] = []
                changed = False
                for t in r.tables or []:
                    t = dict(t)
                    new_cells = []
                    for cell in t.get("cells") or []:
                        cell = dict(cell)
                        if cell.get("review_status") != "CONFIRMED":
                            cell["review_status"] = "CONFIRMED"
                            changed = True
                        new_cells.append(cell)
                    t["cells"] = new_cells
                    new_tables.append(t)
                if changed:
                    r.tables = new_tables  # JSON 列需整体赋值才会标脏
    elif (normalized or structured_changed) and job.review_status != "CONFIRMED":
        job.review_status = "EDITED"

    db.session.commit()
    audit(
        "result.review",
        "ocr_job",
        job.id,
        {
            "version": version.version,
            "edits": len(normalized),
            "structured_changed": structured_changed,
            "confirm": confirm,
        },
    )
    return ok(_result_payload(job, version))
