"""TextIn 结果规范化（PRD §12.2）。

当前唯一路径：run_extraction → v2 Prompt 模式智能抽取，只保留 llm_json
（key-value 字段 + 表格）作为结构化结果。normalize_response 为 parse/sync
的旧版逐页规范化（表格单元格/文字/字段），保留供兼容旧结果。
"""
from __future__ import annotations

import json
from typing import Any

from textin.client import TextInClient
from textin.errors import TextInAPIError

VENDOR = "textin"


def _num(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _find(response: dict[str, Any], key: str) -> Any:
    """parse/sync 的结果在顶层；extract/sync 的解析结果可能包在 result 里。"""
    if key in response:
        return response[key]
    result = response.get("result")
    if isinstance(result, dict) and key in result:
        return result[key]
    return None


def _page_numbers(response: dict[str, Any]) -> list[int]:
    pages = _find(response, "pages") or []
    out: list[int] = []
    for p in pages:
        if isinstance(p, dict) and p.get("page_number") is not None:
            out.append(_num(p["page_number"], -1))
    if not out:
        for e in _find(response, "elements") or []:
            if isinstance(e, dict) and e.get("page_number") is not None:
                n = _num(e["page_number"], -1)
                if n > 0 and n not in out:
                    out.append(n)
    return sorted(n for n in out if n > 0)


def _page_texts(response: dict[str, Any]) -> dict[int, str]:
    pages = _find(response, "pages") or []
    out: dict[int, str] = {}
    for p in pages:
        if not isinstance(p, dict):
            continue
        n = _num(p.get("page_number"), 0)
        md = (p.get("markdown") or "").strip()
        if n > 0 and md:
            out[n] = md
    for e in _find(response, "elements") or []:
        # TextIn 文字块 type 为 NarrativeText/Title/TableCaption 等；Table 的 text 是 HTML 表格，跳过
        if not isinstance(e, dict) or e.get("type") == "Table":
            continue
        n = _num(e.get("page_number"), 0)
        text = (e.get("text") or "").strip().replace("**", "")
        if n > 0 and text:
            out[n] = f"{out[n]}\n{text}".strip() if n in out else text
    return out


def _normalize_tables(response: dict[str, Any]) -> dict[int, list[dict[str, Any]]]:
    out: dict[int, list[dict[str, Any]]] = {}
    seq = 0
    for e in _find(response, "elements") or []:
        if not isinstance(e, dict) or e.get("type") != "Table":
            continue
        seq += 1
        page = _num(e.get("page_number"), 1)
        ts = e.get("table_structure") or {}
        cells_in = ts.get("cells") or []
        cells: list[dict[str, Any]] = []
        max_row = max_col = 0
        for c in cells_in:
            if not isinstance(c, dict):
                continue
            row = _num(c.get("row"))
            col = _num(c.get("col"))
            row_span = max(1, _num(c.get("row_span"), 1))
            col_span = max(1, _num(c.get("col_span"), 1))
            text = str(c.get("text") or "")
            max_row = max(max_row, row + row_span)
            max_col = max(max_col, col + col_span)
            cells.append(
                {
                    "row_index": row,
                    "column_index": col,
                    "row_span": row_span,
                    "column_span": col_span,
                    "raw_text": text,
                    "current_text": text,
                    "polygon": c.get("polygon") or c.get("coordinates") or [],
                    "confidence": float(c.get("confidence") or 0),
                    "review_status": "UNREVIEWED",
                }
            )
        # 第一行约定为表头：跳过不进 fields，但保留在表格结构里
        out.setdefault(page, []).append(
            {
                "table_id": f"table_{seq}",
                "row_count": max_row,
                "column_count": max_col,
                "cells": cells,
            }
        )
    return out


def _fields_for_page(fields: list[dict[str, Any]], page: int) -> list[dict[str, Any]]:
    return [
        {"name": f["name"], "value": f["value"], "source": f.get("source", ""), "source_page": f.get("page_number", 0)}
        for f in fields
        if f.get("page_number", 0) in (0, page)
    ]


def normalize_response(
    response: dict[str, Any],
    *,
    fields: list[dict[str, Any]],
    page_start: int = 1,
    page_count: int | None = None,
) -> dict[str, Any]:
    """标准化主入口。page_start/page_count 为 1 基请求范围，用于缺失页计算。"""
    page_numbers = _page_numbers(response)
    texts = _page_texts(response)
    tables = _normalize_tables(response)

    requested_end = (page_start + page_count - 1) if page_count else None
    if requested_end:
        expected = set(range(page_start, requested_end + 1))
    else:
        expected = set(page_numbers) or {page_start}
    missing = sorted(expected - set(page_numbers))

    pages = []
    for n in sorted(set(page_numbers) | (expected - set(missing))):
        pages.append(
            {
                "page_number": n,
                "text": texts.get(n, ""),
                "tables": tables.get(n, []),
                "fields": _fields_for_page(fields, n),
            }
        )

    table_count = sum(len(t) for t in tables.values())
    duration = response.get("duration")
    metadata = _find(response, "metadata") or {}
    return {
        "vendor": VENDOR,
        "page_count": _num(metadata.get("page_count"), len(page_numbers) or 1),
        "duration_ms": _num(duration) if isinstance(duration, (int, float)) else 0,
        "pages": pages,
        "missing_pages": missing,
        "table_count": table_count,
        "field_count": len(fields),
    }


EXTRACT_PROMPT = "请帮我结构化这个文件，结果以 JSON 形式返回"


def _parse_llm_json(raw: Any) -> dict[str, Any] | list[Any]:
    """llm_json 通常是对象；个别情况下以字符串（可能带 ```json 围栏）返回。"""
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if s.startswith("```"):
            s = s.strip("`").removeprefix("json").strip()
        try:
            parsed = json.loads(s)
        except ValueError as e:
            raise TextInAPIError(-1, "llm_json is not valid JSON") from e
        if isinstance(parsed, (dict, list)):
            return parsed
    raise TextInAPIError(-1, "llm_json missing in TextIn response")


def _count_structure(node: Any) -> tuple[int, int]:
    """(表格数, 字段数)：元素为对象的数组视为表格，其余标量叶子计为字段。"""
    if isinstance(node, list):
        if node and all(isinstance(x, dict) for x in node):
            return 1, 0
        tables = fields = 0
        for x in node:
            t, f = _count_structure(x)
            tables, fields = tables + t, fields + f
        return tables, fields
    if isinstance(node, dict):
        tables = fields = 0
        for v in node.values():
            t, f = _count_structure(v)
            tables, fields = tables + t, fields + f
        return tables, fields
    return 0, 1


def run_extraction(
    client: TextInClient,
    *,
    filename: str,
    content: bytes,
    params: dict[str, Any],
) -> dict[str, Any]:
    """唯一 OCR 调用路径：TextIn Prompt 模式智能抽取（PRD §12 单厂商）。

    结果只保留大模型返回的结构化 JSON（key-value 字段 + 表格）。
    """
    response = client.extract_with_prompt(
        filename=filename, content=content, prompt=EXTRACT_PROMPT, params=params
    )
    result = response.get("result") if isinstance(response.get("result"), dict) else {}
    structured = _parse_llm_json(result.get("llm_json"))
    table_count, field_count = _count_structure(structured)
    pages = result.get("pages")
    page_count = _num(response.get("page_count")) or (len(pages) if isinstance(pages, list) else 0)
    duration = response.get("duration")
    return {
        "vendor": VENDOR,
        "page_count": page_count,
        "duration_ms": _num(duration) if isinstance(duration, (int, float)) else 0,
        "structured": structured,
        "missing_pages": [],
        "table_count": table_count,
        "field_count": field_count,
        "field_source": "prompt",
    }


def normalize_v3_to_ir(v3_fields: Any) -> dict[str, Any]:
    """把 extract-v3 返回的扁平 KV 转 IR。

    当前 contract: k 来自 schema 字段(后台勾选),v 为抽取值;具体类型未对齐前保持原样。
    TODO: 真实契约含 confidence/bbox/表格时再迭代。
    """
    if isinstance(v3_fields, dict):
        return {str(k): v for k, v in v3_fields.items()}
    return {}


def run_extraction_v3(
    client: TextInClient,
    *,
    filename: str,
    content: bytes,
    params: dict[str, Any],
) -> dict[str, Any]:
    """新支路: parse_sync → extract_v3 → 归一 IR。

    返回与 run_extraction 同 schema;失败抛 TextInAPIError,由 worker 走兜底矩阵。
    """
    parse_json = client.parse_sync(filename=filename, content=content, params=params)
    result = client.extract_v3_from_ocr_json(parse_json=parse_json, params=params)
    extracted = result.get("extracted") if isinstance(result.get("extracted"), dict) else {}
    structured = normalize_v3_to_ir(extracted)
    table_count, field_count = _count_structure(structured)
    page_count = _num(result.get("page_count")) or _num(parse_json.get("page_count"))
    duration = result.get("duration") or parse_json.get("duration")
    return {
        "vendor": VENDOR,
        "page_count": page_count,
        "duration_ms": _num(duration) if isinstance(duration, (int, float)) else 0,
        "structured": structured,
        "missing_pages": [],
        "table_count": table_count,
        "field_count": field_count,
        "field_source": "extract_v3",
    }


__all__ = [
    "EXTRACT_PROMPT",
    "VENDOR",
    "TextInAPIError",
    "normalize_response",
    "normalize_v3_to_ir",
    "run_extraction",
    "run_extraction_v3",
]
