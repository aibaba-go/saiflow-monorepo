"""The change log of a result (FR-VERIFY-007), kept as JSON like the results themselves:
each save that makes a new version writes one row whose `items` hold every changed leaf
(path, before, after); each switch of template made by a person writes one TEMPLATE row.

Paths: dict keys joined with ".", list items as "[i]" — "document.invoice_no",
"goods.line_items[1].quantity". A scalar is a leaf, and so is an empty dict or list."""

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ResultChange, ResultVersion, User


def leaves(value: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict) and node:
            for key, child in node.items():
                walk(child, f"{path}.{key}" if path else str(key))
        elif isinstance(node, list) and node:
            for idx, child in enumerate(node):
                walk(child, f"{path}[{idx}]")
        elif path:
            out[path] = node

    walk(value if isinstance(value, dict) else {}, "")
    return out


_MISSING = object()


def _is_table(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(r, dict) for r in value)


def _sort_key(path: str) -> list:
    """Paths compare part by part, row numbers as numbers (items[2] before items[10])."""
    return [int(p) if p.isdigit() else p for p in re.split(r"[.\[\]]+", path) if p != ""]


def _flat(value: Any, path: str) -> dict[str, Any]:
    """The leaves under one row or value, with their full paths."""
    out: dict[str, Any] = {}
    for key, leaf in leaves({"_": value}).items():
        out[path + key[1:]] = leaf
    return out


def _align(old: list[dict], new: list[dict]) -> list[tuple[int | None, int | None]]:
    """Pair rows with the least change: a pair costs its differing leaves, a deleted or an
    inserted row costs all of its leaves. Unchanged rows after a deleted or inserted one
    then pair with themselves, so they are not reported (FR-VERIFY-007)."""
    size = [max(len(leaves(r)), 1) for r in old], [max(len(leaves(r)), 1) for r in new]

    def cost(i: int, j: int) -> int:
        a, b = leaves(old[i]), leaves(new[j])
        return sum(1 for k in a.keys() | b.keys() if a.get(k) != b.get(k))

    n, m = len(old), len(new)
    best = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        best[i][0] = best[i - 1][0] + size[0][i - 1]
    for j in range(1, m + 1):
        best[0][j] = best[0][j - 1] + size[1][j - 1]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best[i][j] = min(
                best[i - 1][j - 1] + cost(i - 1, j - 1),
                best[i - 1][j] + size[0][i - 1],
                best[i][j - 1] + size[1][j - 1],
            )
    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i or j:
        if i and j and best[i][j] == best[i - 1][j - 1] + cost(i - 1, j - 1):
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and best[i][j] == best[i - 1][j] + size[0][i - 1]:
            pairs.append((i - 1, None))
            i -= 1
        else:
            pairs.append((None, j - 1))
            j -= 1
    return pairs[::-1]


def _walk(old: Any, new: Any, path: str, out: list[tuple[str, Any, Any]]) -> None:
    empty = ({}, [])
    if old is _MISSING and new in empty or new is _MISSING and old in empty:
        return  # a container filled in (or dropped) empty: nothing changed for a person
    if (old is _MISSING or isinstance(old, dict)) and (new is _MISSING or isinstance(new, dict)):
        a = {} if old is _MISSING else old
        b = {} if new is _MISSING else new
        if a or b:
            for key in a.keys() | b.keys():
                _walk(
                    a.get(key, _MISSING),
                    b.get(key, _MISSING),
                    f"{path}.{key}" if path else str(key),
                    out,
                )
            return
    if (old is _MISSING or _is_table(old)) and (new is _MISSING or _is_table(new)) and (old or new):
        rows_a = [] if old is _MISSING else old
        rows_b = [] if new is _MISSING else new
        for i, j in _align(rows_a, rows_b):
            if i is not None and j is not None:
                _walk(rows_a[i], rows_b[j], f"{path}[{j}]", out)
            elif i is not None:
                out.extend((p, v, None) for p, v in _flat(rows_a[i], f"{path}[{i}]").items())
            else:
                out.extend((p, None, v) for p, v in _flat(rows_b[j], f"{path}[{j}]").items())
        return
    a = {} if old is _MISSING else _flat(old, path)
    b = {} if new is _MISSING else _flat(new, path)
    for key in a.keys() | b.keys():
        if a.get(key) != b.get(key):
            out.append((key, a.get(key), b.get(key)))


def diff(before: dict | None, after: dict | None) -> list[tuple[str, Any, Any]]:
    """Every change, sorted by path (row numbers as numbers); a missing side is None. Table
    rows are aligned, so deleting or inserting a row reports only that row; empty
    containers filled in by the template are not reported (FR-VERIFY-007)."""
    out: list[tuple[str, Any, Any]] = []
    _walk(
        before if isinstance(before, dict) else {},
        after if isinstance(after, dict) else {},
        "",
        out,
    )
    return sorted(out, key=lambda c: _sort_key(c[0]))


async def record_save(
    db: AsyncSession,
    job_id: str,
    version_id: str,
    before: dict | None,
    after: dict | None,
    user_id: int | None,
) -> None:
    items = [{"path": p, "before": b, "after": a} for p, b, a in diff(before, after)]
    if items:
        db.add(
            ResultChange(
                job_id=job_id, version_id=version_id, kind="SAVE", items=items, user_id=user_id
            )
        )


async def record_switch(
    db: AsyncSession,
    job_id: str,
    version_id: str,
    from_name: str | None,
    to_name: str | None,
    user_id: int | None,
) -> None:
    db.add(
        ResultChange(
            job_id=job_id,
            version_id=version_id,
            kind="TEMPLATE",
            items=[],
            from_template=from_name,
            to_template=to_name,
            user_id=user_id,
        )
    )


async def list_changes(db: AsyncSession, job_id: str) -> list[dict]:
    """Oldest first; a SAVE row becomes one FIELD entry per item."""
    rows = (
        await db.execute(
            select(ResultChange, User.display_name, ResultVersion.version)
            .outerjoin(User, User.id == ResultChange.user_id)
            .outerjoin(ResultVersion, ResultVersion.id == ResultChange.version_id)
            .where(ResultChange.job_id == job_id)
            .order_by(ResultChange.id)
        )
    ).all()
    out: list[dict] = []
    for row, user_name, version in rows:
        common = {"user_name": user_name, "created_at": row.created_at, "version": version}
        if row.kind == "TEMPLATE":
            out.append(
                {
                    "kind": "TEMPLATE",
                    "path": None,
                    "before": None,
                    "after": None,
                    "from_template": row.from_template,
                    "to_template": row.to_template,
                    **common,
                }
            )
            continue
        for item in row.items or []:
            out.append(
                {
                    "kind": "FIELD",
                    "path": item.get("path"),
                    "before": item.get("before"),
                    "after": item.get("after"),
                    "from_template": None,
                    "to_template": None,
                    **common,
                }
            )
    return out
