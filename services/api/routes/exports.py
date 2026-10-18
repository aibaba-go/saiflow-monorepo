"""结果导出（PRD §10.4）：POST 创建 → GET 查询 → GET /download 代理下发。

同步生成（P0 数据量下毫秒级），创建即 READY；24h 后过期。
字节经对象存储（storage.py：local / firebase）落地；下载必须携带会话 Cookie
且通过对象级鉴权——不提供任何匿名或签名 URL，一律后端代理 send_file(BytesIO)。
XLSX 全部单元格按字符串写入，保留前导零；CSV 带 UTF-8 BOM。
"""
from __future__ import annotations

import csv
import io
import json
import unicodedata
from datetime import timedelta

from flask import Blueprint, request, send_file

from auth import audit, current_user
from errors import (
    invalid_argument,
    not_found,
    ok,
    service_unavailable,
    state_conflict,
)
from extensions import db
from models import Export, File, PageResult, ResultVersion
from routes.ocr import TERMINAL, _get_job_for_user
import storage

exports_bp = Blueprint("exports", __name__)

FORMATS = {"XLSX", "CSV", "TXT"}
EXPORT_TTL = timedelta(hours=24)


def _current_version(job_id: str) -> ResultVersion | None:
    return ResultVersion.query.filter_by(job_id=job_id, is_current=True).first()


def _load_pages(version_id: str) -> list[PageResult]:
    return (
        PageResult.query.filter_by(result_version_id=version_id)
        .order_by(PageResult.page_number.asc())
        .all()
    )


def _base_name(job) -> str:
    file = db.session.get(File, job.file_id)
    name = (file.original_name if file else "") or job.id
    stem = name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return stem or job.id


def _safe_cell(value) -> str:
    """防 Excel/CSV 公式注入：用户可编辑的 OCR 文本一律按文本落地。"""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def _collect_fields(node, path: str, out: list[tuple[str, object]]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}" if path else str(key)
            if isinstance(value, dict):
                _collect_fields(value, child, out)
            elif isinstance(value, list):
                if value and all(isinstance(item, dict) for item in value):
                    continue  # 对象数组在 Tables 区展开
                if any(isinstance(item, (dict, list)) for item in value):
                    out.append((child, json.dumps(value, ensure_ascii=False)))
                else:
                    out.append((child, ", ".join("" if item is None else str(item) for item in value)))
            else:
                out.append((child, value))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            child = f"{path}.{index}" if path else str(index)
            _collect_fields(value, child, out)


def _collect_tables(node, path: str, out: list[tuple[str, list[str], list[list]]]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            _collect_tables(value, f"{path}.{key}" if path else str(key), out)
        return
    if not isinstance(node, list):
        return

    if node and all(isinstance(row, dict) for row in node):
        columns: list[str] = []
        for row in node:
            for key in row:
                if key not in columns:
                    columns.append(str(key))
        out.append(
            (
                path or "Table",
                columns,
                [[row.get(column, "") for column in columns] for row in node],
            )
        )
        for row in node:
            for key, value in row.items():
                if isinstance(value, (dict, list)):
                    _collect_tables(value, f"{path}.{key}" if path else str(key), out)
        return

    if node and all(isinstance(row, list) for row in node):
        size = max(len(row) for row in node)
        out.append((path or "Table", [f"col_{i + 1}" for i in range(size)], node))
        return

    for index, value in enumerate(node):
        if isinstance(value, (dict, list)):
            _collect_tables(value, f"{path}.{index}" if path else str(index), out)


# 与 line-mini StructuredDataView / structured.ts 的分区规则保持一致
_SECTION_TITLES = {
    "en": ("Document information", "Tables", "Missing pages (OCR partial)"),
    "th": ("ข้อมูลเอกสาร", "ตารางข้อมูล", "หน้าที่ขาดหาย (OCR บางส่วน)"),
}


def _is_scalar(value) -> bool:
    return not isinstance(value, (dict, list))


def _display_name(path: str) -> str:
    text = " / ".join(part.replace("_", " ") for part in path.split("."))
    return " ".join(word[:1].upper() + word[1:] for word in text.split(" "))


def _format_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list) and all(_is_scalar(item) for item in value):
        return "\n".join("" if item is None else str(item) for item in value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, indent=2)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _field_sections(node, path: list[str]) -> list[tuple[str, list[tuple[str, object]]]]:
    if not isinstance(node, dict):
        return []
    rows = [
        (str(key), value)
        for key, value in node.items()
        if _is_scalar(value) or (isinstance(value, list) and all(_is_scalar(i) for i in value))
    ]
    sections = [(".".join(path), rows)] if rows else []
    for key, value in node.items():
        if isinstance(value, dict):
            sections.extend(_field_sections(value, [*path, str(key)]))
    return sections


def _table_sections(node, path: list[str]) -> list[tuple[str, list[str], list[list]]]:
    if isinstance(node, list):
        if node and all(isinstance(row, dict) for row in node):
            columns: list[str] = []
            for row in node:
                for key in row:
                    if str(key) not in columns:
                        columns.append(str(key))
            tables = [(".".join(path), columns, [[row.get(c) for c in columns] for row in node])]
            for index, row in enumerate(node):
                for key, value in row.items():
                    if isinstance(value, (dict, list)):
                        tables.extend(_table_sections(value, [*path, str(index), str(key)]))
            return tables
        if node and all(
            isinstance(row, list) and all(_is_scalar(cell) for cell in row) for row in node
        ):
            size = max(len(row) for row in node)
            columns = [str(i + 1) for i in range(size)]
            rows = [[row[i] if i < len(row) else None for i in range(size)] for row in node]
            return [(".".join(path), columns, rows)]
        out: list[tuple[str, list[str], list[list]]] = []
        for index, value in enumerate(node):
            if isinstance(value, (dict, list)):
                out.extend(_table_sections(value, [*path, str(index)]))
        return out
    if isinstance(node, dict):
        out = []
        for key, value in node.items():
            if isinstance(value, (dict, list)):
                out.extend(_table_sections(value, [*path, str(key)]))
        return out
    return []


def _text_width(text: str) -> int:
    """单行显示宽度：泰文上下标记不占宽，CJK 占两格。"""
    width = 0
    for ch in text:
        if unicodedata.category(ch) == "Mn":
            continue
        width += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return width


def _line_count(text: str, col_width: float) -> int:
    per_line = max(1, int(col_width * 1.1))
    return sum(max(1, -(-_text_width(line) // per_line)) for line in (text or "").split("\n"))


# 版式参照产品提供的 sample-format.xlsx
_XLSX_FONT = "Microsoft YaHei"
_ROW_HEIGHT = 22.5
_LINE_HEIGHT = 16.5
_TITLE_HEIGHT = 28.5
_LONG_TEXT = 20


def _build_xlsx_structured(
    structured, out: io.BytesIO, missing_pages: list[int], language: str = "th"
) -> None:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter
    except ImportError as e:
        raise service_unavailable("EXPORT_UNAVAILABLE", "error.export_unavailable") from e

    info_title, tables_title, missing_title = _SECTION_TITLES.get(language, _SECTION_TITLES["en"])
    side = Side(style="thin", color="FFE3E8F0")
    border = Border(left=side, right=side, top=side, bottom=side)
    label_fill = PatternFill("solid", fgColor="FFE8EDFF")
    styles = {
        "title": (Font(name=_XLSX_FONT, size=16, bold=True), None, False),
        "section": (Font(name=_XLSX_FONT, size=10, bold=True), None, False),
        "note": (Font(name=_XLSX_FONT, size=10, italic=True, color="FF6B7280"), None, False),
        "key": (Font(name=_XLSX_FONT, size=10, bold=True, color="FF4A66F7"), label_fill, True),
        "head": (Font(name=_XLSX_FONT, size=11, bold=True, color="FF4A66F7"), label_fill, True),
        "value": (Font(name=_XLSX_FONT, size=10), None, True),
    }
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    note_align = Alignment(horizontal="left", vertical="center")

    # 先排版成 (kind, [(text, style, align)]) 行，再统一计算列宽与行高
    plan: list[tuple[str, list[tuple[str, str, Alignment]]]] = []

    def blank() -> None:
        plan.append(("blank", []))

    fields = _field_sections(structured, [])
    tables = _table_sections(structured, [])

    plan.append(("title", [(info_title, "title", center)]))
    for index, (path, rows) in enumerate(fields):
        if path or index:
            blank()
            plan.append(("section", [(_display_name(path), "section", center)]))
        for key, value in rows:
            plan.append(("row", [(_display_name(key), "key", center), (_format_cell(value), "value", left)]))

    for path, columns, rows in tables:
        blank()
        plan.append(("section", [(_display_name(path) if path else tables_title, "section", center)]))
        plan.append(("row", [(_display_name(column), "head", center) for column in columns]))
        texts = [[_format_cell(value) for value in values] for values in rows]
        long_cols = {
            col
            for line in texts
            for col, text in enumerate(line)
            if "\n" in text or _text_width(text) > _LONG_TEXT
        }
        for line in texts:
            plan.append(
                ("row", [(text, "value", left if col in long_cols else center) for col, text in enumerate(line)])
            )

    if missing_pages:
        blank()
        plan.append(
            ("section", [(f"{missing_title}: " + ", ".join(map(str, missing_pages)), "note", note_align)])
        )

    needed: dict[int, int] = {}
    for kind, cells in plan:
        if kind != "row":
            continue
        for col, (text, _, _) in enumerate(cells, start=1):
            longest = max((_text_width(line) for line in text.split("\n")), default=0)
            needed[col] = max(needed.get(col, 0), longest)
    widths: dict[int, float] = {
        col: min(max(size * 1.2 + 3, 9), 50) for col, size in needed.items()
    }
    if fields:
        widths[1] = max(widths.get(1, 0), 25)
        widths[2] = max(widths.get(2, 0), 50)

    wb = Workbook()
    ws = wb.active
    ws.title = "Result"
    for col, width in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = width

    for row_no, (kind, cells) in enumerate(plan, start=1):
        lines = 1
        for col, (text, style, align) in enumerate(cells, start=1):
            font, fill, boxed = styles[style]
            cell = ws.cell(row=row_no, column=col, value=_safe_cell(text))
            cell.font = font
            cell.alignment = align
            if fill is not None:
                cell.fill = fill
            if boxed:
                cell.border = border
            if align.wrap_text:
                lines = max(lines, _line_count(text, widths.get(col, 9)))
        if kind == "title":
            ws.merge_cells(start_row=row_no, start_column=1, end_row=row_no, end_column=2)
            ws.row_dimensions[row_no].height = _TITLE_HEIGHT
        else:
            ws.row_dimensions[row_no].height = _ROW_HEIGHT + (lines - 1) * _LINE_HEIGHT
    wb.save(out)


def _build_csv_structured(structured) -> bytes:
    fields: list[tuple[str, object]] = []
    _collect_fields(structured, "", fields)
    tables: list[tuple[str, list[str], list[list]]] = []
    _collect_tables(structured, "", tables)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["section", "path", "value"])
    for path, value in fields:
        writer.writerow(["FIELD", _safe_cell(path), _safe_cell(value)])
    for title, columns, rows in tables:
        writer.writerow(["TABLE", _safe_cell(title), ""])
        writer.writerow(["HEADER", *[_safe_cell(column) for column in columns]])
        for row in rows:
            writer.writerow(["ROW", *[_safe_cell(cell) for cell in row]])
    return buf.getvalue().encode("utf-8-sig")


def _build_xlsx(pages: list[PageResult], out: io.BytesIO, missing_pages: list[int]) -> None:
    try:
        from openpyxl import Workbook
    except ImportError as e:  # 部署缺依赖时给出可诊断的 503
        raise service_unavailable("EXPORT_UNAVAILABLE", "error.export_unavailable") from e

    wb = Workbook()
    ws = wb.active
    ws.title = "Tables"
    for page in pages:
        for t in page.tables or []:
            ws.append([f"Page {page.page_number} · {t.get('table_id', '')}"])
            col_count = int(t.get("column_count") or 0)
            if col_count:
                ws.append([f"col_{i + 1}" for i in range(col_count)])
            grid: dict[tuple[int, int], str] = {}
            for c in t.get("cells") or []:
                grid[(c.get("row_index", 0), c.get("column_index", 0))] = str(
                    c.get("current_text") or ""
                )
            for r in range(int(t.get("row_count") or 0)):
                ws.append([grid.get((r, c), "") for c in range(col_count)])
            ws.append([])
    if missing_pages:
        ws.append([f"Missing pages (OCR partial): {', '.join(map(str, missing_pages))}"])

    ws_text = wb.create_sheet("Text")
    ws_text.append(["page", "text"])
    for page in pages:
        ws_text.append([str(page.page_number), page.text or ""])

    ws_fields = wb.create_sheet("Fields")
    ws_fields.append(["page", "name", "value", "source"])
    for page in pages:
        for f in page.fields or []:
            ws_fields.append(
                [
                    str(page.page_number),
                    str(f.get("name", "")),
                    str(f.get("value", "")),
                    str(f.get("source", "")),
                ]
            )
    wb.save(out)


def _build_csv(pages: list[PageResult]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["page", "table_id", "row_index", "column_index", "text"])
    for page in pages:
        for t in page.tables or []:
            for c in t.get("cells") or []:
                writer.writerow(
                    [
                        page.page_number,
                        t.get("table_id", ""),
                        c.get("row_index", 0),
                        c.get("column_index", 0),
                        str(c.get("current_text") or ""),
                    ]
                )
    return buf.getvalue().encode("utf-8-sig")


def _build_txt(pages: list[PageResult]) -> bytes:
    parts: list[str] = []
    for page in pages:
        parts.append(f"===== Page {page.page_number} =====")
        parts.append(page.text or "")
    return "\n".join(parts).encode("utf-8")


@exports_bp.post("/ocr/jobs/<job_id>/exports")
def create_export(job_id: str):
    user = current_user()
    job = _get_job_for_user(job_id, user)
    if job.status not in TERMINAL:
        raise state_conflict("job.not_terminal")
    version = _current_version(job.id)
    if version is None:
        raise not_found()

    body = request.get_json(silent=True) or {}
    fmt = str(body.get("format") or "").upper()
    if fmt not in FORMATS:
        raise invalid_argument(field_errors=[{"field": "format", "reason": "invalid"}])

    from models import _now

    exp = Export(
        job_id=job.id,
        result_version_id=version.id,
        format=fmt,
        status="GENERATING",
        created_by_user_id=user.id,
        expires_at=_now() + EXPORT_TTL,
    )
    db.session.add(exp)
    db.session.flush()

    pages = _load_pages(version.id)
    try:
        if fmt == "XLSX":
            buf = io.BytesIO()
            if version.structured is not None:
                _build_xlsx_structured(
                    version.structured,
                    buf,
                    list(job.missing_pages or []),
                    language=user.language or "th",
                )
            else:
                _build_xlsx(pages, buf, list(job.missing_pages or []))
            data = buf.getvalue()
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fmt == "CSV":
            data = (
                _build_csv_structured(version.structured)
                if version.structured is not None
                else _build_csv(pages)
            )
            mime = "text/csv"
        else:
            if version.structured is not None:
                data = json.dumps(version.structured, ensure_ascii=False, indent=2).encode("utf-8")
            else:
                data = _build_txt(pages)
            mime = "text/plain"
        exp.storage_path = storage.put_bytes("exports", f"{exp.id}.{fmt.lower()}", data, mime)
    except Exception as e:  # noqa: BLE001 生成失败落 FAILED，可重试
        exp.status = "FAILED"
        db.session.commit()
        raise service_unavailable("EXPORT_FAILED", "error.export_failed") from e

    exp.status = "READY"
    db.session.commit()
    audit("export.create", "export", exp.id, {"job_id": job.id, "format": fmt})
    return ok(exp.to_dict(), status=201)


def _get_export_for_user(export_id: str) -> Export:
    from models import _now

    exp = db.session.get(Export, export_id)
    if exp is None:
        raise not_found()
    _get_job_for_user(exp.job_id, current_user())  # 对象级鉴权，跨用户 404
    if exp.status == "READY" and exp.expires_at and exp.expires_at <= _now():
        exp.status = "EXPIRED"
        db.session.commit()
        raise state_conflict("export.expired")
    return exp


@exports_bp.get("/exports/<export_id>")
def get_export(export_id: str):
    return ok(_get_export_for_user(export_id).to_dict())


@exports_bp.get("/exports/<export_id>/download")
def download_export(export_id: str):
    exp = _get_export_for_user(export_id)
    if exp.status != "READY" or not exp.storage_path:
        raise state_conflict("export.not_ready")
    if not storage.exists(exp.storage_path):
        raise state_conflict("export.not_ready")
    from models import OcrJob

    job = db.session.get(OcrJob, exp.job_id)
    base = _base_name(job) if job else exp.job_id
    audit("export.download", "export", exp.id)
    return send_file(
        io.BytesIO(storage.get_bytes(exp.storage_path)),
        mimetype={
            "XLSX": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "CSV": "text/csv",
            "TXT": "text/plain",
        }[exp.format],
        as_attachment=True,
        download_name=f"{base}-v{exp.result_version_id[:8]}.{exp.format.lower()}",
    )
