"""Adapter: turn a DocFlow `upload_file_sync` call into a normalized run result.

The worker hands the adapter:
  - filename, content (PDF bytes), content_type, parser_params
    (DocFlow-shaped query keys: parser_parse_mode, parser_formula_level,
    parser_crop_dewarp, parser_dpi, parser_apply_merge, category,
    batch_number, target_process; routes validate user input upstream).

The adapter returns a plain dict that the worker maps onto OcrJob:

  {
    "status": "SUCCEEDED" | "PARTIAL_SUCCESS" | "FAILED",
    "error_code": "DOCFLOW_RECOGNITION_FAILED" | "DOCFLOW_UNEXPECTED_STATUS" | None,
    "error_message": str | None,         # flattened failure_causes
    "structured": dict,                  # result.files[0] verbatim (data + pages + metadata)
    "task_id": str | None,
    "batch_number": str | None,
    "category": str | None,
  }

`recognition_status` mapping (PRD §12.2 + DocFlow semantics):
  1 → SUCCEEDED iff data.fields AND data.items are both non-empty; else PARTIAL_SUCCESS.
  2 → FAILED (DOCFLOW_RECOGNITION_FAILED); failure_causes collapse into error_message.
  anything else → FAILED (DOCFLOW_UNEXPECTED_STATUS) — vendor returned a non-terminal
                  status to a synchronous endpoint, which should never happen.

Legacy xparse parsers, page-by-page heuristics, prompt-mode helpers, and the
former standalone KV extraction module were intentionally removed during the
DocFlow migration.
"""

from __future__ import annotations

from typing import Any

from textin.client import TextInClient
from textin.errors import (
    DOCFLOW_RECOGNITION_FAILED,
    DOCFLOW_UNEXPECTED_STATUS,
)

VENDOR = "textin-docflow"

# DocFlow-accepted query keys (worker routes must validate user input upstream).
ALLOWED_PARSER_KEYS: frozenset[str] = frozenset(
    {
        "parser_parse_mode",
        "parser_formula_level",
        "parser_crop_dewarp",
        "parser_dpi",
        "parser_apply_merge",
        "category",
        "batch_number",
        "target_process",
    }
)

# Cap failure_causes summary text to keep DB error_message columns bounded.
_MAX_ERROR_MESSAGE_LEN = 512
_MAX_FAILURE_CAUSES = 5


def _num(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _has_non_empty_items(items: Any) -> bool:
    """data.items[][] — considered non-empty if any row has at least one cell."""
    if not isinstance(items, list):
        return False
    for row in items:
        if isinstance(row, list) and len(row) > 0:
            return True
    return False


def _format_failure_causes(causes: Any) -> str | None:
    """Flatten failure_causes[] into a single human-readable string.

    Each cause is a dict like {"code": ..., "msg": ...}; render `[code] msg`.
    Truncate to first N causes and overall length to keep error_message bounded.
    """
    if not isinstance(causes, list) or not causes:
        return None
    parts: list[str] = []
    for cause in causes[:_MAX_FAILURE_CAUSES]:
        if isinstance(cause, dict):
            code = cause.get("code", "")
            msg = cause.get("msg") or cause.get("message") or ""
            rendered = f"[{code}] {msg}".strip()
            if rendered:
                parts.append(rendered)
        else:
            parts.append(str(cause))
    if not parts:
        return None
    return "; ".join(parts)[:_MAX_ERROR_MESSAGE_LEN]


def _count_structure(node: Any) -> tuple[int, int]:
    """Count (tables, fields) in a structured OCR payload.

    Handles both shapes:
    - DocFlow native: `{"data": {"fields": [...], "items": [[...]], "tables": [...]}}`
      → tables = len(data.tables) + number of non-empty rows in data.items[][];
        fields = len(data.fields).
    - Legacy llm_json: any nested dict / list → recursively count tables-of-dicts
      (a list whose elements are all dicts is a table) and scalar leaves as fields.
    """
    if isinstance(node, dict):
        data = node.get("data")
        if isinstance(data, dict):
            fields_raw = data.get("fields")
            items_raw = data.get("items")
            tables_raw = data.get("tables")
            field_count = len(fields_raw) if isinstance(fields_raw, list) else 0
            tables_block_count = (
                sum(1 for row in items_raw if isinstance(row, list) and len(row) > 0)
                if isinstance(items_raw, list)
                else 0
            )
            tables_data_count = (
                len(tables_raw) if isinstance(tables_raw, list) else 0
            )
            return (tables_block_count + tables_data_count, field_count)
        tables = fields = 0
        for value in node.values():
            t, f = _count_structure(value)
            tables += t
            fields += f
        return (tables, fields)
    if isinstance(node, list):
        if node and all(isinstance(x, dict) for x in node):
            return (1, 0)
        tables = fields = 0
        for x in node:
            t, f = _count_structure(x)
            tables += t
            fields += f
        return (tables, fields)
    return (0, 1)


def build_parser_params(params: dict[str, Any]) -> dict[str, Any]:
    """Filter caller-supplied parser_params to keys DocFlow accepts (passthrough)."""
    out: dict[str, Any] = {}
    for key in ALLOWED_PARSER_KEYS:
        if key in params and params[key] is not None:
            out[key] = params[key]
    return out


def normalize_items_to_rows(items: Any) -> list[dict[str, Any]]:
    """Turn DocFlow `data.items[][]` into a row list for DM persistence.

    Each input cell has DocFlow's shape `{"key": str, "value": any, "position": [...]}`.
    Output rows contain:
      - `row_index`: 0-based
      - `cells`: each cell in encounter order, with `key` coerced to a string
                 (or replaced with `${row_index}-${col_index}` if missing)
      - `kv`: dict mapping key → last value seen (later overrides earlier)
      - `cell_positions`: [{key, position}, ...] for distinct keys

    Cells missing a key get a placeholder of `${row_index}-${col_index}` so the
    downstream table viewer can still reference them by row+col.
    """
    rows: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return rows

    for row_index, row in enumerate(items):
        if not isinstance(row, list):
            continue

        cells: list[dict[str, Any]] = []
        kv: dict[str, Any] = {}
        cell_positions: list[dict[str, Any]] = []

        for col_index, cell in enumerate(row):
            if not isinstance(cell, dict):
                continue
            raw_key = cell.get("key")
            key: str = (
                raw_key
                if isinstance(raw_key, str) and raw_key
                else f"{row_index}-{col_index}"
            )
            value = cell.get("value", "")
            position = cell.get("position", [])

            cells.append({"key": key, "value": value, "position": position})
            kv[key] = value
            cell_positions.append({"key": key, "position": position})

        rows.append(
            {
                "row_index": row_index,
                "cells": cells,
                "kv": kv,
                "cell_positions": cell_positions,
            }
        )
    return rows


def run_extraction(
    client: TextInClient,
    *,
    filename: str,
    content: bytes,
    content_type: str = "application/octet-stream",
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Single DocFlow extraction entry.

    `params` is the user-supplied DocFlow-shaped parser_params dict (routes
    validate that `parser_parse_mode` ∈ {auto, scan, vlm} before this is
    called). The full `result.files[0]` payload is returned under
    `structured` so the persistence layer can keep vendor positions and
    pages verbatim for downstream rendering.
    """
    parser_params = build_parser_params(params or {})
    response = client.upload_file_sync(
        filename=filename,
        content=content,
        content_type=content_type,
        parser_params=parser_params,
    )

    result = response.get("result") if isinstance(response, dict) else None
    if not isinstance(result, dict):
        result = {}

    files = result.get("files") if isinstance(result.get("files"), list) else []
    file_entry = files[0] if files and isinstance(files[0], dict) else {}

    data = file_entry.get("data") if isinstance(file_entry.get("data"), dict) else {}
    fields = data.get("fields") if isinstance(data.get("fields"), list) else []
    items = data.get("items") if isinstance(data.get("items"), list) else []

    recognition_status = _num(file_entry.get("recognition_status"), -1)
    failure_causes = file_entry.get("failure_causes")
    error_message = _format_failure_causes(failure_causes)

    if recognition_status == 1:
        has_fields = len(fields) > 0
        has_items = _has_non_empty_items(items)
        status = "SUCCEEDED" if (has_fields and has_items) else "PARTIAL_SUCCESS"
        error_code = None
    elif recognition_status == 2:
        status = "FAILED"
        error_code = DOCFLOW_RECOGNITION_FAILED
    else:
        status = "FAILED"
        error_code = DOCFLOW_UNEXPECTED_STATUS

    table_count, field_count = _count_structure(file_entry)

    return {
        "vendor": VENDOR,
        "status": status,
        "error_code": error_code,
        "error_message": error_message,
        "structured": file_entry,
        "task_id": file_entry.get("task_id") if isinstance(file_entry.get("task_id"), str) else None,
        "batch_number": file_entry.get("batch_number") if isinstance(file_entry.get("batch_number"), str) else None,
        "category": file_entry.get("category") if isinstance(file_entry.get("category"), str) else None,
        "table_count": table_count,
        "field_count": field_count,
    }


__all__ = [
    "ALLOWED_PARSER_KEYS",
    "DOCFLOW_RECOGNITION_FAILED",
    "DOCFLOW_UNEXPECTED_STATUS",
    "VENDOR",
    "_count_structure",
    "build_parser_params",
    "normalize_items_to_rows",
    "run_extraction",
]
