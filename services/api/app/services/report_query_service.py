"""Running the cards of a report page (FR-REPORT-007..012/015/017): one fresh query per card
on the formal data in the caller's scope, no result cache; the checks that need real data
(group limit, mixed units, negative values in a pie) and the admin's synthetic preview."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import report_query
from app.repositories.report_query import GROUP_LIMIT, QueryTimeout
from app.services.report_config import (
    PROPORTION_TYPES,
    CardSpec,
    VersionDef,
    resolve_period,
    validate,
)

EXCLUDED_KEYS = (
    "invalid_number",
    "too_precise",
    "invalid_date",
    "missing_date",
    "empty_row",
    "invalid_structure",
    "missing",
)


def zero_diagnostics() -> dict:
    return {"documents": 0, "items": 0, "excluded": {k: 0 for k in EXCLUDED_KEYS}}


def format_value(value: Any, agg: str, mtype: str | None) -> str | None:
    """An exact decimal string; avg drops trailing zeros (amounts keep two decimals)."""
    if value is None:
        return None
    if agg == "count":
        return str(int(value))
    text = format(Decimal(value), "f")
    if agg == "avg" and "." in text:
        text = text.rstrip("0").rstrip(".")
    if mtype == "amount":
        whole, _, frac = text.partition(".")
        if len(frac) < 2:
            text = f"{whole}.{frac.ljust(2, '0')}"
    if text.startswith("-") and text.strip("-0.") == "":
        text = text[1:]
    return text


def buckets(start: date, end: date, grain: str) -> list[str]:
    out: list[str] = []
    if grain == "year":
        return [f"{y:04d}" for y in range(start.year, end.year + 1)]
    if grain == "month":
        y, m = start.year, start.month
        while (y, m) <= (end.year, end.month):
            out.append(f"{y:04d}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        return out
    day = start
    while day <= end and len(out) <= GROUP_LIMIT:
        out.append(day.isoformat())
        day += timedelta(days=1)
    return out


def _fill(spec: CardSpec, rows: list[dict], period: tuple[date, date]) -> list[dict]:
    """Time buckets without data are shown as null (never 0) on bar and line charts."""
    if (
        spec.type not in ("bar", "line")
        or spec.dim_kind != "date"
        or spec.series is not None
        or spec.unit_mode == "field"
        or not rows
    ):
        return rows
    wanted = buckets(period[0], period[1], spec.time_grain or "day")
    have = {r["dimension"] for r in rows}
    if len(have | set(wanted)) > GROUP_LIMIT:
        return rows
    unit = spec.unit_value if spec.unit_mode == "fixed" else None
    extra = [
        {"dimension": b, "series": None, "unit": unit, "value": None, "count": 0, "valid_count": 0}
        for b in wanted
        if b not in have
    ]
    return sorted(rows + extra, key=lambda r: (r["dimension"] is None, r["dimension"] or ""))


def _card(
    card_id: str | None, status: str, code: str | None, applied: bool, rows=None, diag=None
) -> dict:
    return {
        "card_id": card_id,
        "status": status,
        "error_code": code,
        "period_applied": applied,
        "rows": rows or [],
        "diagnostics": diag or zero_diagnostics(),
    }


async def run_card(
    db: AsyncSession,
    spec: CardSpec,
    *,
    tenant_id: int,
    scope_user_id: int | None,
    period: tuple[date, date],
) -> dict:
    applied = spec.period_slot is not None
    query = report_query.build(
        spec, tenant_id=tenant_id, scope_user_id=scope_user_id, period=period if applied else None
    )
    try:
        diag_row, raw_rows = await report_query.run(db, query)
    except QueryTimeout:
        return _card(spec.id, "error", "query_timeout", applied)
    diag = {
        "documents": int(diag_row["documents"] or 0),
        "items": int(diag_row["items"] or 0),
        "excluded": {k: int(diag_row[k] or 0) for k in EXCLUDED_KEYS},
    }
    if len(raw_rows) > GROUP_LIMIT:
        return _card(spec.id, "error", "group_limit", applied, diag=diag)
    mixed = int(diag_row["unit_mismatch"] or 0) > 0 or (
        spec.unit_mode == "field" and spec.type in PROPORTION_TYPES and int(diag_row["units"]) > 1
    )
    if mixed:
        return _card(spec.id, "error", "mixed_units", applied, diag=diag)
    mtype = spec.measure.type if spec.measure else None
    rows = [
        {
            "dimension": r["dimension"],
            "series": r["series"],
            "unit": r["unit"],
            "value": format_value(r["value"], spec.agg, mtype),
            "count": int(r["cnt"]),
            "valid_count": int(r["valid"]),
        }
        for r in raw_rows
    ]
    # A positive net group must not hide a negative formal measure (FR-REPORT-012).
    # This minimum comes from the same authorized/period-filtered SQL rows as the groups.
    if spec.type in PROPORTION_TYPES and (
        (diag_row["min_value"] is not None and Decimal(diag_row["min_value"]) < 0)
        or any(r["value"] is not None and Decimal(r["value"]) < 0 for r in rows)
    ):
        return _card(spec.id, "error", "negative_in_pie", applied, diag=diag)
    if not rows:
        return _card(spec.id, "empty", None, applied, diag=diag)
    if applied:
        rows = _fill(spec, rows, period)
    return _card(spec.id, "ok" if applied else "not_applicable", None, applied, rows, diag)


async def run_page(
    db: AsyncSession,
    *,
    config: Any,
    versions: Mapping[int, VersionDef],
    tenant_id: int,
    scope_user_id: int | None,
    override: Any,
    now: datetime,
    only_card: str | None = None,
) -> dict:
    """Every card of the page (or one), each in its own read-only snapshot under the
    statement timeout. `override` is already a {from, to} dict or None."""
    period = resolve_period(config, override, now)
    check = validate(config, versions)
    await db.commit()  # nothing of the caller stays open across the card transactions
    cards = []
    for card_id, spec in check.entries:
        if only_card is not None and card_id != only_card:
            continue
        if spec is None:
            cards.append(_card(card_id, "error", "invalid_config", False))
            continue
        cards.append(
            await run_card(
                db, spec, tenant_id=tenant_id, scope_user_id=scope_user_id, period=period
            )
        )
    return {
        "generated_at": now,
        "period": {"from": period[0].isoformat(), "to": period[1].isoformat()},
        "scope": "all" if scope_user_id is None else "own",
        "synthetic": False,
        "cards": cards,
    }


# ---------------------------------------------------------------- synthetic preview (admin)

_SAMPLE_CATEGORIES = ("Sample A", "Sample B", "Sample C")
_SAMPLE_SERIES = ("Series 1", "Series 2")


def _synthetic_value(spec: CardSpec, i: int) -> str:
    if spec.agg == "count":
        return str(3 + i * 2)
    base = Decimal(100 + 25 * i)
    mtype = spec.measure.type if spec.measure else "decimal"
    if mtype == "integer":
        return str(int(base))
    return format(base.quantize(Decimal("0.01")), "f")


def synthetic_card(spec: CardSpec, period: tuple[date, date]) -> dict:
    """Made-up rows from the configuration only: never a business value (FR-REPORT-003)."""
    if spec.dim_kind == "date":
        dims: list[str | None] = buckets(period[0], period[1], spec.time_grain or "month")[:3]
    elif spec.dim_kind == "category":
        dims = list(_SAMPLE_CATEGORIES)
    else:
        dims = [None]
    series: list[str | None] = list(_SAMPLE_SERIES) if spec.series is not None else [None]
    unit = None
    if spec.agg != "count":
        unit = spec.unit_value if spec.unit_mode == "fixed" else "UNIT"
    rows = []
    for i, d in enumerate(dims):
        for j, s in enumerate(series):
            rows.append(
                {
                    "dimension": d,
                    "series": s,
                    "unit": unit,
                    "value": _synthetic_value(spec, i + j),
                    "count": 3 + i + j,
                    "valid_count": 3 + i + j,
                }
            )
    applied = spec.period_slot is not None
    return _card(spec.id, "ok" if applied else "not_applicable", None, applied, rows)


def synthetic_page(
    *, config: Any, versions: Mapping[int, VersionDef], override: Any, now: datetime
) -> dict:
    period = resolve_period(config, override, now)
    check = validate(config, versions)
    cards = []
    for card_id, spec in check.entries:
        if spec is None:
            cards.append(_card(card_id, "error", "invalid_config", False))
        else:
            cards.append(synthetic_card(spec, period))
    return {
        "generated_at": now,
        "period": {"from": period[0].isoformat(), "to": period[1].isoformat()},
        "scope": "synthetic",
        "synthetic": True,
        "cards": cards,
    }
