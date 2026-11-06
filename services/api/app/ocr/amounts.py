"""Amount checks on a template result (FR-OCR-013, EPIC-02 §4.2).

Which values take part comes from the template's field roles, not from field names:
- row columns: quantity, unit_price, line_discount, line_base, line_tax, line_total;
- header fields: lines_total, discount, base, tax, grand_total.

Checks (tolerance ±0.01 THB, Decimal only):
- row: quantity × unit_price = line_total (skipped when the row has a line discount), and
  line_base + line_tax = line_total;
- lines_total = Σ line_total;
- base = (lines_total or Σ line_total) − discount;
- grand_total = (base, else (lines_total or Σ) − discount) + tax.

A check runs only when all its inputs parse; a missing discount or tax counts as 0. A
mismatch is reported, never corrected (OCR-Pipeline §5.3).
"""

import re
from decimal import Decimal, InvalidOperation
from typing import Any

TOLERANCE = Decimal("0.01")
_CENT = Decimal("0.01")
_NOISE = re.compile(r"[,\s]|฿|บาท|thb", re.IGNORECASE)
_PLAIN = re.compile(r"^-?\d+(\.\d+)?$")


def parse(value: Any) -> Decimal | None:
    """A plain decimal from text like "1,234.50" or "฿ 70"; None for anything else."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    text = _NOISE.sub("", str(value))
    if not _PLAIN.match(text):
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _money(value: Decimal) -> str:
    return str(value.quantize(_CENT))


def _issue(path: str, computed: Decimal, recognised: Any) -> dict:
    return {"path": path, "computed": _money(computed), "recognised": str(recognised)}


def _off(expected: Decimal, actual: Decimal) -> bool:
    return abs(expected - actual) > TOLERANCE


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def check(groups: list[dict], structured: Any) -> list[dict]:
    data = structured if isinstance(structured, dict) else {}
    issues: list[dict] = []
    line_totals: list[Decimal] = []
    header: dict[str, tuple[str, Any, Decimal | None]] = {}
    for group in groups:
        gkey = group["key"]
        gval = data.get(gkey) if isinstance(data.get(gkey), dict) else {}
        for item in group["items"]:
            if item["kind"] == "field":
                role = item.get("role")
                if role:
                    raw = gval.get(item["key"])
                    header[role] = (f"{gkey}.{item['key']}", raw, parse(raw))
                continue
            cols = {c["role"]: c["key"] for c in item.get("columns", []) if c.get("role")}
            rows = gval.get(item["key"])
            for idx, row in enumerate(rows if isinstance(rows, list) else []):
                if not isinstance(row, dict):
                    continue
                path = f"{gkey}.{item['key']}[{idx}]"
                total_key = cols.get("line_total")
                total = parse(row.get(total_key)) if total_key else None
                if total is not None:
                    line_totals.append(total)
                qty = parse(row.get(cols["quantity"])) if "quantity" in cols else None
                price = parse(row.get(cols["unit_price"])) if "unit_price" in cols else None
                discounted = "line_discount" in cols and not _blank(row.get(cols["line_discount"]))
                if None not in (qty, price, total) and not discounted:
                    if _off(qty * price, total):
                        issues.append(_issue(f"{path}.{total_key}", qty * price, row[total_key]))
                base = parse(row.get(cols["line_base"])) if "line_base" in cols else None
                tax = parse(row.get(cols["line_tax"])) if "line_tax" in cols else None
                if None not in (base, tax, total) and _off(base + tax, total):
                    issues.append(_issue(f"{path}.{total_key}", base + tax, row[total_key]))

    def value(role: str) -> Decimal | None:
        return header[role][2] if role in header else None

    summed = sum(line_totals, Decimal(0)) if line_totals else None
    lines_total = value("lines_total")
    if lines_total is not None and summed is not None and _off(summed, lines_total):
        path, raw, _ = header["lines_total"]
        issues.append(_issue(path, summed, raw))
    left = lines_total if lines_total is not None else summed
    discount = value("discount") or Decimal(0)
    base = value("base")
    if base is not None and left is not None and _off(left - discount, base):
        path, raw, _ = header["base"]
        issues.append(_issue(path, left - discount, raw))
    grand = value("grand_total")
    before_tax = base if base is not None else (left - discount if left is not None else None)
    if grand is not None and before_tax is not None:
        expected = before_tax + (value("tax") or Decimal(0))
        if _off(expected, grand):
            path, raw, _ = header["grand_total"]
            issues.append(_issue(path, expected, raw))
    return issues
