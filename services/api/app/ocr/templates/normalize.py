"""按模板取值、类型标准化与必填校验（design D10、D8 结构补齐、D13 必填门禁）。

结果形状：{group_key: {field_key: 标量, table_key: [{col_key: 标量}]}}，键顺序与模板一致。
数值以原文为准：integer 输出 JSON 整数；decimal / amount 输出规范化字符串，不舍入、不走浮点。
"""

from __future__ import annotations

import json
import re
from datetime import date as _date
from typing import Any

MAX_TABLE_ROWS = 500
MAX_SAFE_INT = 2**53 - 1

TYPE_MISMATCH = "type_mismatch"
AMOUNT_PRECISION = "amount_precision"

_CURRENCY_RE = re.compile(r"฿|บาท|thb", re.IGNORECASE)
_SPACE_RE = re.compile(r"[\s\u00a0\u200b]+")
_INT_RE = re.compile(r"^-?\d+(\.0+)?$")
_DEC_RE = re.compile(r"^-?\d+(\.\d+)?$")
# Thai documents put the day first; years from 2400 are Buddhist era (FR-OCR-016)
_DMY_RE = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$")
_YMD_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
BUDDHIST_OFFSET = 543


class InvalidOutput(ValueError):
    """大模型输出结构不符合模板（触发修复重试，仍失败则 LLM_INVALID_OUTPUT）。"""


def is_empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _clean_number(text: str) -> str:
    text = _CURRENCY_RE.sub("", text)
    text = _SPACE_RE.sub("", text)
    return text.replace(",", "")


def _canonical_decimal(text: str) -> str:
    sign = ""
    if text.startswith("-"):
        sign, text = "-", text[1:]
    whole, _, frac = text.partition(".")
    whole = whole.lstrip("0") or "0"
    out = f"{whole}.{frac}" if frac else whole
    if out.strip("0.") == "":
        sign = ""  # -0 / -0.00 视为 0
    return sign + out


def _normalize_date(value: Any) -> tuple[Any, str | None]:
    """A date as YYYY-MM-DD; Buddhist-era years become Gregorian; anything else is kept
    with a type warning, so the person can correct it."""
    text = str(value).strip()
    if not text:
        return None, None
    m = _YMD_RE.match(text)
    if m:
        year, month, day = (int(x) for x in m.groups())
    else:
        m = _DMY_RE.match(text)
        if not m:
            return text, TYPE_MISMATCH
        day, month, year = (int(x) for x in m.groups())
    if year >= 2400:
        year -= BUDDHIST_OFFSET
    try:
        return _date(year, month, day).isoformat(), None
    except ValueError:
        return text, TYPE_MISMATCH


def normalize_value(ftype: str, value: Any) -> tuple[Any, str | None]:
    """返回 (标准化后的值, 警告码或 None)。null 与空值不算类型错误。"""
    if value is None:
        return None, None
    if ftype == "date":
        if isinstance(value, (bool, dict, list)):
            return value, TYPE_MISMATCH
        return _normalize_date(value)
    if ftype not in ("integer", "decimal", "amount"):
        if isinstance(value, (dict, list)):
            text = json.dumps(value, ensure_ascii=False)
        elif isinstance(value, bool):
            text = "true" if value else "false"
        else:
            text = str(value)
        text = text.strip()
        return (text or None), None

    if isinstance(value, (bool, dict, list)):
        return value, TYPE_MISMATCH
    if isinstance(value, int):
        raw = str(value)
    elif isinstance(value, float):
        raw = repr(value)
        if "e" in raw or "E" in raw or raw in ("nan", "inf", "-inf"):
            return value, TYPE_MISMATCH
    else:
        raw = str(value)
    original = raw.strip()
    if not original:
        return None, None
    text = _clean_number(original)

    if ftype == "integer":
        if not _INT_RE.match(text):
            return original, TYPE_MISMATCH
        number = int(text.split(".")[0])
        if abs(number) > MAX_SAFE_INT:
            return original, TYPE_MISMATCH
        return number, None

    if not _DEC_RE.match(text):
        return original, TYPE_MISMATCH
    canonical = _canonical_decimal(text)
    if ftype == "decimal":
        return canonical, None
    whole, _, frac = canonical.partition(".")
    if len(frac) > 2:
        return canonical, AMOUNT_PRECISION
    return f"{whole}.{frac.ljust(2, '0')}", None


def _scalar(value: Any, path: str) -> Any:
    if isinstance(value, (dict, list)):
        raise InvalidOutput(f"{path} must be a scalar")
    return value


def extract_per_schema(groups: list[dict], data: Any) -> tuple[dict, list[dict], int]:
    """按模板逐项取值：缺失补 null、丢弃模板外键、标准化类型。

    返回 (structured, warnings, dropped_keys)；结构非法抛 InvalidOutput。
    """
    if not isinstance(data, dict):
        raise InvalidOutput("top level must be an object")
    warnings: list[dict] = []
    dropped = 0
    known_groups = {g["key"] for g in groups}
    dropped += sum(1 for k in data if k not in known_groups)
    out: dict = {}
    for group in groups:
        gkey = group["key"]
        gval = data.get(gkey)
        if gval is None:
            gval = {}
        if not isinstance(gval, dict):
            raise InvalidOutput(f"{gkey} must be an object")
        known_items = {i["key"] for i in group["items"]}
        dropped += sum(1 for k in gval if k not in known_items)
        gout: dict = {}
        for item in group["items"]:
            key = item["key"]
            path = f"{gkey}.{key}"
            if item["kind"] == "field":
                value, warn = normalize_value(
                    item.get("type", "string"), _scalar(gval.get(key), path)
                )
                if warn:
                    warnings.append({"path": path, "code": warn})
                gout[key] = value
                continue
            rows = gval.get(key)
            if rows is None:
                rows = []
            if not isinstance(rows, list):
                raise InvalidOutput(f"{path} must be an array")
            if len(rows) > MAX_TABLE_ROWS:
                raise InvalidOutput(f"{path} exceeds {MAX_TABLE_ROWS} rows")
            columns = item["columns"]
            col_keys = {c["key"] for c in columns}
            table: list[dict] = []
            for row in rows:
                if not isinstance(row, dict):
                    raise InvalidOutput(f"{path} rows must be objects")
                dropped += sum(1 for k in row if k not in col_keys)
                idx = len(table)
                rout: dict = {}
                row_warnings: list[dict] = []
                for col in columns:
                    cpath = f"{path}[{idx}].{col['key']}"
                    value, warn = normalize_value(
                        col.get("type", "string"), _scalar(row.get(col["key"]), cpath)
                    )
                    if warn:
                        row_warnings.append({"path": cpath, "code": warn})
                    rout[col["key"]] = value
                if all(v is None for v in rout.values()):
                    continue  # 骨架中的全 null 行或空白行
                table.append(rout)
                warnings.extend(row_warnings)
            gout[key] = table
        out[gkey] = gout
    return out, warnings, dropped


def fill_structure(groups: list[dict], structured: dict) -> dict:
    """保存模板结果前的结构补齐：缺失的模板字段补 null、表格行补齐列；模板外内容原样保留。"""
    if not isinstance(structured, dict):
        return structured
    out: dict = {}
    for group in groups:
        gkey = group["key"]
        gval = structured.get(gkey)
        if gval is None:
            gval = {}
        if not isinstance(gval, dict):
            out[gkey] = gval
            continue
        gout: dict = {}
        for item in group["items"]:
            key = item["key"]
            if item["kind"] == "field":
                gout[key] = gval.get(key)
                continue
            rows = gval.get(key)
            if rows is None:
                rows = []
            if isinstance(rows, list):
                filled = []
                for row in rows:
                    if isinstance(row, dict):
                        new_row = {c["key"]: row.get(c["key"]) for c in item["columns"]}
                        new_row.update({k: v for k, v in row.items() if k not in new_row})
                        filled.append(new_row)
                    else:
                        filled.append(row)
                rows = filled
            gout[key] = rows
        gout.update({k: v for k, v in gval.items() if k not in gout})
        out[gkey] = gout
    out.update({k: v for k, v in structured.items() if k not in out})
    return out


def primary_missing(groups: list[dict], structured: Any) -> list[str]:
    """Primary fields (FR-OCR-020 主要字段) are the required header fields; a template
    result missing any of them means the chosen template does not fit the document.
    Required table columns are checked at confirmation, not here."""
    return [path for path in required_missing(groups, structured) if "[" not in path]


def required_missing(groups: list[dict], structured: Any) -> list[str]:
    """必填缺失路径：字段值为空；表格列在已有的每一行中为空。"""
    missing: list[str] = []
    data = structured if isinstance(structured, dict) else {}
    for group in groups:
        gkey = group["key"]
        gval = data.get(gkey)
        gval = gval if isinstance(gval, dict) else {}
        for item in group["items"]:
            key = item["key"]
            if item["kind"] == "field":
                if item.get("required") and is_empty(gval.get(key)):
                    missing.append(f"{gkey}.{key}")
                continue
            required_cols = [c["key"] for c in item["columns"] if c.get("required")]
            rows = gval.get(key)
            if not required_cols or not isinstance(rows, list):
                continue
            for idx, row in enumerate(rows):
                row = row if isinstance(row, dict) else {}
                for ckey in required_cols:
                    if is_empty(row.get(ckey)):
                        missing.append(f"{gkey}.{key}[{idx}].{ckey}")
    return missing


def type_warnings(groups: list[dict], structured: Any) -> list[dict]:
    """当前内容中与模板类型不符的值（仅提示，不阻断保存或确认）。"""
    warnings: list[dict] = []
    data = structured if isinstance(structured, dict) else {}
    for group in groups:
        gkey = group["key"]
        gval = data.get(gkey)
        gval = gval if isinstance(gval, dict) else {}
        for item in group["items"]:
            key = item["key"]
            if item["kind"] == "field":
                _, warn = normalize_value(item.get("type", "string"), gval.get(key))
                if warn:
                    warnings.append({"path": f"{gkey}.{key}", "code": warn})
                continue
            rows = gval.get(key)
            if not isinstance(rows, list):
                continue
            for idx, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                for col in item["columns"]:
                    _, warn = normalize_value(col.get("type", "string"), row.get(col["key"]))
                    if warn:
                        warnings.append({"path": f"{gkey}.{key}[{idx}].{col['key']}", "code": warn})
    return warnings
