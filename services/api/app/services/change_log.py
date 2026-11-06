"""The change log of a result (FR-VERIFY-007), kept as JSON like the results themselves:
each save that makes a new version writes one row whose `items` hold every changed leaf
(path, before, after); each switch of template made by a person writes one TEMPLATE row.

Paths: dict keys joined with ".", list items as "[i]" — "document.invoice_no",
"goods.line_items[1].quantity". A scalar is a leaf, and so is an empty dict or list."""

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


def diff(before: dict | None, after: dict | None) -> list[tuple[str, Any, Any]]:
    """Every leaf path whose value differs, sorted by path; a missing side is None."""
    old, new = leaves(before), leaves(after)
    return [
        (path, old.get(path), new.get(path))
        for path in sorted(old.keys() | new.keys())
        if old.get(path) != new.get(path)
    ]


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
