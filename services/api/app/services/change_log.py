"""The change log of a result (FR-VERIFY-007), kept as JSON like the results themselves:
each save that makes a new version writes one row whose `items` hold every changed leaf
(path, before, after); each switch of template made by a person writes one TEMPLATE row.

Paths: dict keys joined with ".", list items as "[i]" — "document.invoice_no",
"goods.line_items[1].quantity". A scalar is a leaf, and so is an empty dict or list."""

import difflib
import json
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


def _sort_key(path: str) -> list[tuple[int, int | str]]:
    """Paths compare part by part, numbers as numbers (items[2] before items[10]); a number
    and a name never compare directly (final review I1)."""
    return [(0, int(p)) if p.isdigit() else (1, p) for p in re.split(r"[.\[\]]+", path) if p != ""]


def _flat(value: Any, path: str) -> dict[str, Any]:
    """The leaves under one row or value, with their full paths."""
    out: dict[str, Any] = {}
    for key, leaf in leaves({"_": value}).items():
        out[path + key[1:]] = leaf
    return out


ALIGN_LIMIT = 250_000  # cells in the matching grid; beyond it rows pair by position
MATCH_LIMIT = 20_000  # changed rows (both sides) beyond which rows pair by position


def _align(old: list[dict], new: list[dict]) -> list[tuple[int | None, int | None]]:
    """Pair rows with the least change (FR-VERIFY-007): runs of identical rows pair first
    (difflib), and only each changed stretch between them is aligned by cost — a pair
    costs its differing leaves, a deleted or inserted row all of its leaves. A stretch
    whose grid would exceed ALIGN_LIMIT cells pairs by position, so no save can make this
    slow (final review C1)."""
    n, m = len(old), len(new)
    head = 0
    while head < n and head < m and old[head] == new[head]:
        head += 1
    tail = 0
    while tail < n - head and tail < m - head and old[n - 1 - tail] == new[m - 1 - tail]:
        tail += 1
    out: list[tuple[int | None, int | None]] = [(k, k) for k in range(head)]
    a_mid, b_mid = old[head : n - tail], new[head : m - tail]
    if len(a_mid) + len(b_mid) > MATCH_LIMIT:
        # very long changed stretches: pair by position (bounded work for any input)
        span = max(len(a_mid), len(b_mid))
        out.extend(
            (head + k if k < len(a_mid) else None, head + k if k < len(b_mid) else None)
            for k in range(span)
        )
    else:
        out.extend(_matched(a_mid, b_mid, head))
    out.extend((n - tail + k, m - tail + k) for k in range(tail))
    return out


def _matched(old: list[dict], new: list[dict], offset: int) -> list[tuple[int | None, int | None]]:
    keys_a = [json.dumps(r, sort_keys=True, default=str) for r in old]
    keys_b = [json.dumps(r, sort_keys=True, default=str) for r in new]
    out: list[tuple[int | None, int | None]] = []
    # autojunk: rows repeated very often do not anchor matches (keeps difflib near-linear)
    matcher = difflib.SequenceMatcher(None, keys_a, keys_b, autojunk=True)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            out.extend((i1 + k, j1 + k) for k in range(i2 - i1))
            continue
        a, b = old[i1:i2], new[j1:j2]
        if len(a) * len(b) > ALIGN_LIMIT:
            part = [
                (k if k < len(a) else None, k if k < len(b) else None)
                for k in range(max(len(a), len(b)))
            ]
        else:
            part = _grid(a, b)
        out.extend((None if i is None else i + i1, None if j is None else j + j1) for i, j in part)
    return [(None if i is None else i + offset, None if j is None else j + offset) for i, j in out]


def _grid(old: list[dict], new: list[dict]) -> list[tuple[int | None, int | None]]:
    la, lb = [leaves(r) for r in old], [leaves(r) for r in new]
    size_a, size_b = [max(len(x), 1) for x in la], [max(len(x), 1) for x in lb]

    def cost(i: int, j: int) -> int:
        a, b = la[i], lb[j]
        return sum(1 for k in a.keys() | b.keys() if a.get(k) != b.get(k))

    n, m = len(old), len(new)
    best = [[0] * (m + 1) for _ in range(n + 1)]
    pair = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        best[i][0] = best[i - 1][0] + size_a[i - 1]
    for j in range(1, m + 1):
        best[0][j] = best[0][j - 1] + size_b[j - 1]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            c = cost(i - 1, j - 1)
            pair[i][j] = c
            best[i][j] = min(
                best[i - 1][j - 1] + c,
                best[i - 1][j] + size_a[i - 1],
                best[i][j - 1] + size_b[j - 1],
            )
    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i or j:
        if i and j and best[i][j] == best[i - 1][j - 1] + pair[i][j]:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and best[i][j] == best[i - 1][j] + size_a[i - 1]:
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
