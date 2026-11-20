from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.services.report_config import Slot

COMMON_OPS = frozenset({"eq", "neq", "in", "not_in", "empty", "not_empty"})
ORDER_OPS = frozenset({"gt", "gte", "lt", "lte", "between"})
_NUMBER = re.compile(r"^-?[0-9]+(?:\.[0-9]+)?$")
_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


@dataclass(frozen=True)
class FilterRule:
    slot: Slot
    op: str
    values: tuple[str, ...]


@dataclass(frozen=True)
class FilterGroup:
    match: str
    rules: tuple[FilterRule, ...]


def operand(value: Any, kind: str) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("a typed text or integer value is required")
    text = str(value).strip()
    if not 1 <= len(text) <= 200:
        raise ValueError("a value is 1-200 characters")
    if kind == "string":
        return text
    if kind == "date":
        if not _DATE.fullmatch(text):
            raise ValueError("a date is YYYY-MM-DD")
        date.fromisoformat(text)
        return text
    if not _NUMBER.fullmatch(text):
        raise ValueError("a plain decimal value is required")
    number = Decimal(text)
    if kind == "integer" and (number != number.to_integral_value() or abs(number) > 2**53 - 1):
        raise ValueError("a safe integer is required")
    if kind == "amount" and len(text.partition(".")[2]) > 2:
        raise ValueError("an amount has at most two decimals")
    return text


def parse_group(raw: Any, path: str, slot: Callable, error: Callable) -> FilterGroup | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        error(path, "filters must be an object")
        return None
    match = raw.get("match", "and")
    if match not in ("and", "or"):
        error(f"{path}.match", "match must be and or or")
    rules = raw.get("rules")
    if not isinstance(rules, list) or len(rules) > 20:
        error(f"{path}.rules", "choose at most 20 conditions")
        return None
    out = []
    for i, rule in enumerate(rules):
        p = f"{path}.rules[{i}]"
        if not isinstance(rule, dict):
            error(p, "a condition must be an object")
            continue
        field = slot(
            rule.get("path"), f"{p}.path", {"string", "integer", "decimal", "amount", "date"}
        )
        if field is None:
            continue
        op = rule.get("op")
        allowed = COMMON_OPS | ({"contains"} if field.type == "string" else ORDER_OPS)
        if not isinstance(op, str) or op not in allowed:
            error(f"{p}.op", "the operator does not support this field type")
            continue
        if op in ("empty", "not_empty"):
            out.append(FilterRule(field, op, ()))
            continue
        value = rule.get("value")
        values = value if op in ("in", "not_in", "between") else [value]
        if not isinstance(values, list) or not 1 <= len(values) <= 100:
            error(f"{p}.value", "choose 1-100 typed values")
            continue
        if op == "between" and len(values) != 2:
            error(f"{p}.value", "between requires two values")
            continue
        try:
            normalized = tuple(operand(v, field.type) for v in values)
            if op == "between":
                ordered = (
                    normalized if field.type == "date" else tuple(Decimal(v) for v in normalized)
                )
                if ordered[0] > ordered[1]:
                    raise ValueError("the range ends before it starts")
        except ValueError as exc:
            error(f"{p}.value", str(exc))
            continue
        out.append(FilterRule(field, op, normalized))
    return FilterGroup(match, tuple(out)) if out else None


def page_groups(raw: Any, card_ids: set[str], error: Callable) -> dict[str, dict]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        error("filters", "filters must be an object")
        return {}
    rules, targets = raw.get("rules"), raw.get("targets")
    if not isinstance(rules, list) or len(rules) > 20:
        error("filters.rules", "choose at most 20 conditions")
        return {}
    if not isinstance(targets, dict):
        error("filters.targets", "explicit card mappings are required")
        return {}
    if rules and not targets:
        error("filters.targets", "choose at least one target card")
    if raw.get("match", "and") not in ("and", "or"):
        error("filters.match", "match must be and or or")
    keys = [r.get("path") if isinstance(r, dict) else None for r in rules]
    if any(not isinstance(k, str) or not 1 <= len(k) <= 200 for k in keys) or len(set(keys)) != len(
        keys
    ):
        error("filters.rules", "each condition needs a distinct mapping key")
        return {}
    out = {}
    for cid, paths in targets.items():
        if cid not in card_ids:
            error(f"filters.targets.{cid}", "the target card does not exist")
            continue
        mapped = paths if isinstance(paths, dict) else {}
        out[cid] = {
            "match": raw.get("match", "and"),
            "rules": [{**r, "path": mapped.get(r["path"])} for r in rules],
        }
    return out
