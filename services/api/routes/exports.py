"""结果导出（PRD §10.4）：POST 创建 → GET 查询 → GET /download 代理下发。

同步生成（P0 数据量下毫秒级），创建即 READY；24h 后过期。
字节经对象存储（storage.py：local / firebase）落地，一律后端代理 send_file(BytesIO)，
浏览器不接触存储凭据或存储 URL。两种下载入口：
- GET /exports/<id>/download：会话 Cookie + 对象级鉴权（默认）。
- GET /export-downloads/<ticket>：FR-ENTRY-015 限时下载票据。Android LINE 内置浏览器把下载交给
  不带 Cookie 的系统下载器，前端改为先以会话 + CSRF 换取 60 秒票据，再在系统浏览器打开。
  票据是 SECRET_KEY 的 HMAC 签名（绑定导出、用户与会话），不落库；兑换时重新校验会话、
  账号状态、任务归属与导出状态，任一不满足按不存在处理。
XLSX 全部单元格按字符串写入，保留前导零；CSV 带 UTF-8 BOM。
"""
from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import math
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, g, request, send_file

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

FORMATS = {"XLSX", "CSV", "TXT", "JSON"}
EXPORT_TTL = timedelta(hours=24)
#: FR-ENTRY-015：下载票据有效期。只需覆盖「打开系统浏览器 → 下载器取文件」的几秒钟。
DOWNLOAD_TICKET_TTL_SECONDS = 60
_TICKET_CONTEXT = b"saiflow-export-download-v1\n"
_DEFAULT_SECRET = "change-this-in-production"
_MIME = {
    "XLSX": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "CSV": "text/csv",
    "TXT": "text/plain",
    "JSON": "application/json",
}


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


_PLAIN_NUMBER = re.compile(r"^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$")


def _safe_cell(value) -> str:
    """防 Excel/CSV 公式注入：用户可编辑的 OCR 文本一律按文本落地。"""
    text = "" if value is None else str(value)
    if _PLAIN_NUMBER.match(text):  # -1,370.47 等纯数字不是公式，无需前缀
        return text
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


# ---------- 金额显示（与 line-mini structured.ts 的 isAmountKey / formatNumber 保持一致）----------
# 单据中的数字默认视为金额：千分位逗号 + 至少保留 2 位小数（29650 → 29,650.00，68523.4 → 68,523.40），
# 超过 2 位的原样保留；序号、数量、税率、编号等计数/标识字段按原值输出。
# 优先级：计数/比率 > 金额 > 编号类 > 默认金额
_COUNT_TOKENS = {
    "seq", "sequence", "qty", "quantity", "count", "pcs", "piece", "pieces", "page", "pages", "id",
    "tel", "phone", "fax", "mobile", "year", "zip", "postal", "postcode", "rate", "ratio", "percent",
    "pct",
}
_AMOUNT_TOKENS = {
    "amount", "amt", "price", "total", "subtotal", "sum", "vat", "tax", "discount", "fee", "cost",
    "balance", "paid", "payment", "deposit", "charge", "money", "net", "gross",
}
_LABEL_TOKENS = {"no", "num", "number", "index", "idx", "line", "row", "item", "code"}
_COUNT_TEXT = re.compile(r"序号|数量|页|率|ลำดับ|หน้า|อัตรา")
_AMOUNT_TEXT = re.compile(r"金额|价|费|税|额|เงิน|ราคา|ภาษี|ส่วนลด|ยอด")
_LABEL_TEXT = re.compile(r"编号|เลขที่|จำนวน")


def _key_tokens(key: str) -> list[str]:
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", key).lower()
    return [t for t in re.split(r"[^a-z]+", spaced) if t]


def _is_amount_key(key: str = "") -> bool:
    tokens = _key_tokens(key)
    if any(t in _COUNT_TOKENS for t in tokens) or _COUNT_TEXT.search(key):
        return False
    if any(t in _AMOUNT_TOKENS for t in tokens) or _AMOUNT_TEXT.search(key):
        return True
    return not (any(t in _LABEL_TOKENS for t in tokens) or _LABEL_TEXT.search(key))


def _format_number(value: int | float, key: str = "") -> str:
    text = str(value)
    if isinstance(value, float) and text.endswith(".0"):
        text = text[:-2]  # 与 JS String(29650) 一致
    if not math.isfinite(value) or not _is_amount_key(key) or "e" in text.lower():
        return text
    sign = "-" if text.startswith("-") else ""
    integer, _, frac = text[len(sign):].partition(".")
    return f"{sign}{int(integer):,}.{frac.ljust(2, '0')}"


def _scalar_text(value, key: str = "") -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _format_number(value, key)
    return str(value)


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
                    out.append((child, ", ".join(_scalar_text(item, str(key)) for item in value)))
            else:
                out.append((child, _scalar_text(value, str(key))))
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
                [
                    [
                        _scalar_text(row.get(column), column)
                        if _is_scalar(row.get(column))
                        else row.get(column)
                        for column in columns
                    ]
                    for row in node
                ],
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


def _format_cell(value, key: str = "") -> str:
    if value is None:
        return ""
    if isinstance(value, list) and all(_is_scalar(item) for item in value):
        return "\n".join(_scalar_text(item, key) for item in value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return _scalar_text(value, key)


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


# ---------- 模板结果导出（design D15，FR-ENTRY-002）----------
# 按模板分组顺序输出；字段行为「显示名称 | 值」，表格表头为列显示名称；
# 金额按字段类型（而不是按键名）格式化；模板外字段追加在对应分组末尾。


def _format_amount(text: str) -> str:
    sign = "-" if text.startswith("-") else ""
    integer, _, frac = text[len(sign):].partition(".")
    return f"{sign}{int(integer):,}.{frac.ljust(2, '0')}"


def _typed_text(value, ftype: str) -> str:
    from doc_templates.normalize import normalize_value

    if value is None:
        return ""
    if ftype == "amount" and not isinstance(value, bool):
        normalized, warn = normalize_value("amount", value)
        if warn is None and isinstance(normalized, str):
            return _format_amount(normalized)
        return str(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and str(value).endswith(".0"):
        return str(value)[:-2]
    if isinstance(value, (dict, list)):
        return _format_cell(value)
    return str(value)


def _template_sections(groups: list[dict], structured) -> tuple[list, list]:
    """返回 (字段分区, 表格分区)，均为已排版的显示文本：
    字段分区 [(标题, [(名称, 值)])]；表格分区 [(标题, [表头], [[单元格]])]。"""
    data = structured if isinstance(structured, dict) else {}
    field_sections: list[tuple[str | None, list[tuple[str, str]]]] = []
    table_sections: list[tuple[str, list[str], list[list[str]]]] = []
    known_groups = set()
    for group in groups:
        gkey = group["key"]
        known_groups.add(gkey)
        gval = data.get(gkey)
        gval = gval if isinstance(gval, dict) else {}
        rows: list[tuple[str, str]] = []
        known_items = set()
        for item in group["items"]:
            known_items.add(item["key"])
            if item["kind"] == "field":
                rows.append((item["name"], _typed_text(gval.get(item["key"]), item.get("type", "string"))))
                continue
            columns = item["columns"]
            col_keys = [c["key"] for c in columns]
            table_rows = gval.get(item["key"])
            table_rows = table_rows if isinstance(table_rows, list) else []
            extra_cols: list[str] = []
            for row in table_rows:
                if isinstance(row, dict):
                    for key in row:
                        if key not in col_keys and key not in extra_cols:
                            extra_cols.append(str(key))
            headers = [c["name"] for c in columns] + [_display_name(k) for k in extra_cols]
            body = []
            for row in table_rows:
                row = row if isinstance(row, dict) else {}
                body.append(
                    [_typed_text(row.get(c["key"]), c.get("type", "string")) for c in columns]
                    + [_format_cell(row.get(k), k) for k in extra_cols]
                )
            table_sections.append((f"{group['name']} · {item['name']}", headers, body))
        for key, value in gval.items():  # 模板外字段追加在分组末尾
            if key in known_items:
                continue
            if isinstance(value, list) and value and all(isinstance(r, dict) for r in value):
                for title, cols, trows in _table_sections(value, [str(key)]):
                    table_sections.append((
                        f"{group['name']} · {_display_name(title)}",
                        [_display_name(c) for c in cols],
                        [[_format_cell(v, cols[i]) for i, v in enumerate(r)] for r in trows],
                    ))
            else:
                rows.append((_display_name(str(key)), _format_cell(value, str(key))))
        if rows:  # 只有表格的分组不出空的字段分区
            field_sections.append((group["name"], rows))
    extra = {k: v for k, v in data.items() if k not in known_groups}
    if extra:
        generic_fields, generic_tables = _generic_sections(extra, "")
        field_sections.extend((title or _display_name("other"), rows) for title, rows in generic_fields)
        table_sections.extend(generic_tables)
    return field_sections, table_sections


def _generic_sections(structured, tables_title: str) -> tuple[list, list]:
    """通用结果的分区（与 line-mini StructuredDataView 一致），排版为与模板分区相同的形状。"""
    fields = []
    for index, (path, rows) in enumerate(_field_sections(structured, [])):
        title = _display_name(path) if (path or index) else None
        fields.append((title, [(_display_name(key), _format_cell(value, str(key))) for key, value in rows]))
    tables = []
    for path, columns, rows in _table_sections(structured, []):
        tables.append((
            _display_name(path) if path else tables_title,
            [_display_name(column) for column in columns],
            [[_format_cell(value, columns[col]) for col, value in enumerate(values)] for values in rows],
        ))
    return fields, tables


def _build_xlsx_structured(
    structured, out: io.BytesIO, missing_pages: list[int], language: str = "th",
    template: tuple[str, list[dict]] | None = None,
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

    if template is not None:
        title = template[0] or info_title
        fields, tables = _template_sections(template[1], structured)
    else:
        title = info_title
        fields, tables = _generic_sections(structured, tables_title)

    plan.append(("title", [(title, "title", center)]))
    for section_title, rows in fields:
        if section_title is not None:
            blank()
            plan.append(("section", [(section_title, "section", center)]))
        for label, text in rows:
            plan.append(("row", [(label, "key", center), (text, "value", left)]))

    for section_title, headers, texts in tables:
        blank()
        plan.append(("section", [(section_title, "section", center)]))
        plan.append(("row", [(header, "head", center) for header in headers]))
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


def _build_csv_template(structured, groups: list[dict]) -> bytes:
    fields, tables = _template_sections(groups, structured)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["section", "name", "value"])
    for title, rows in fields:
        for label, text in rows:
            writer.writerow(["FIELD", _safe_cell(f"{title} / {label}" if title else label), _safe_cell(text)])
    for title, headers, body in tables:
        writer.writerow(["TABLE", _safe_cell(title), ""])
        writer.writerow(["HEADER", *[_safe_cell(h) for h in headers]])
        for row in body:
            writer.writerow(["ROW", *[_safe_cell(cell) for cell in row]])
    return buf.getvalue().encode("utf-8-sig")


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
    from doc_templates.views import groups_for_version

    _, template_ver = groups_for_version(version)
    template = (template_ver.name, template_ver.groups) if template_ver is not None else None
    try:
        if fmt == "XLSX":
            buf = io.BytesIO()
            if version.structured is not None:
                _build_xlsx_structured(
                    version.structured,
                    buf,
                    list(job.missing_pages or []),
                    language=user.language or "th",
                    template=template,
                )
            else:
                _build_xlsx(pages, buf, list(job.missing_pages or []))
            data = buf.getvalue()
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fmt == "CSV":
            if version.structured is not None and template is not None:
                data = _build_csv_template(version.structured, template[1])
            elif version.structured is not None:
                data = _build_csv_structured(version.structured)
            else:
                data = _build_csv(pages)
            mime = "text/csv"
        elif fmt == "JSON":
            # FR-ENTRY-002：不做名称替换、类型格式化或字段投影，保留当前 structured。
            data = json.dumps(version.structured, ensure_ascii=False, indent=2).encode("utf-8")
            mime = "application/json"
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


def _send_export(exp: Export, detail: dict | None = None):
    if exp.status != "READY" or not exp.storage_path:
        raise state_conflict("export.not_ready")
    if not storage.exists(exp.storage_path):
        raise state_conflict("export.not_ready")
    from models import OcrJob

    job = db.session.get(OcrJob, exp.job_id)
    base = _base_name(job) if job else exp.job_id
    audit("export.download", "export", exp.id, detail)
    return send_file(
        io.BytesIO(storage.get_bytes(exp.storage_path)),
        mimetype=_MIME[exp.format],
        as_attachment=True,
        download_name=f"{base}-v{exp.result_version_id[:8]}.{exp.format.lower()}",
    )


@exports_bp.get("/exports/<export_id>/download")
def download_export(export_id: str):
    return _send_export(_get_export_for_user(export_id))


# ---------- FR-ENTRY-015：限时下载票据（Android LINE 内置浏览器） ----------


def _ticket_key() -> bytes:
    key = str(current_app.config.get("SECRET_KEY") or "")
    # 云端仍用默认密钥时票据可被伪造：宁可不提供，也不签发
    if not key or (key == _DEFAULT_SECRET and "K_SERVICE" in os.environ):
        raise service_unavailable("EXPORT_UNAVAILABLE", "error.export_unavailable")
    return key.encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _ticket_sig(payload: str) -> str:
    return _b64(hmac.new(_ticket_key(), _TICKET_CONTEXT + payload.encode("ascii"), hashlib.sha256).digest())


def _issue_ticket(exp: Export, user_id: int, session_id: int) -> tuple[str, int]:
    expires = int(time.time()) + DOWNLOAD_TICKET_TTL_SECONDS
    payload = f"{exp.id}.{user_id}.{session_id}.{expires}"
    return f"{payload}.{_ticket_sig(payload)}", expires


_TICKET_RE = re.compile(r"^([0-9a-f]{32})\.(\d{1,20})\.(\d{1,20})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$")


def _redeem_ticket(token: str):
    """校验票据并恢复用户上下文；任何不满足均返回 None（调用方统一 404）。"""
    from models import Session, User, _now

    m = _TICKET_RE.match(token or "")
    if not m:
        return None
    export_id, user_id, session_id, expires, sig = m.groups()
    payload = f"{export_id}.{user_id}.{session_id}.{expires}"
    if not hmac.compare_digest(sig, _ticket_sig(payload)):
        return None
    now = int(time.time())
    if not now < int(expires) <= now + DOWNLOAD_TICKET_TTL_SECONDS + 5:
        return None
    session = db.session.get(Session, int(session_id))
    if session is None or session.user_id != int(user_id) or session.is_revoked or session.is_expired(_now()):
        return None
    user = db.session.get(User, int(user_id))
    if user is None or user.status != "ACTIVE":
        return None
    if user.line_sub.startswith("dev:") and not current_app.config.get("AUTH_DEV_MODE", False):
        return None
    return export_id, session, user


@exports_bp.post("/exports/<export_id>/download-ticket")
def create_download_ticket(export_id: str):
    exp = _get_export_for_user(export_id)
    if exp.status != "READY" or not exp.storage_path:
        raise state_conflict("export.not_ready")
    token, expires = _issue_ticket(exp, current_user().id, g.current_session.id)
    audit("export.download_ticket", "export", exp.id)
    expires_at = datetime.fromtimestamp(expires, timezone.utc).replace(tzinfo=None)
    return ok({"url": f"/api/v1/export-downloads/{token}", "expires_at": expires_at.isoformat()})


@exports_bp.get("/export-downloads/<token>")
def download_by_ticket(token: str):
    redeemed = _redeem_ticket(token)
    if redeemed is None:
        raise not_found()
    export_id, session, user = redeemed
    g.current_session, g.current_user = session, user  # 供对象级鉴权与审计
    response = _send_export(_get_export_for_user(export_id), {"via": "ticket"})
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
