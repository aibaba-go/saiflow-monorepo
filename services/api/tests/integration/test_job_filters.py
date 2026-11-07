# ruff: noqa: F811  (pytest fixtures imported from test_results)
"""Job list filters by template and Thai date range (FR-VERIFY-017; web-pc-ocr Task 1)."""

from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.test_results import ai_settings, llm, sm, tax_job  # noqa: F401

JOBS = "/api/v1/ocr/jobs"


async def _template_id(db, code: str) -> int:
    return (
        await db.execute(text("select id from document_templates where code = :c"), {"c": code})
    ).scalar_one()


async def _jobs(api, store, sm, settings, llm, db, n: int) -> list[str]:
    return [(await tax_job(api, store, sm, settings, llm, db))["id"] for _ in range(n)]


async def _ids(api, query: str) -> list[str]:
    r = await api.get(f"{JOBS}?{query}")
    assert r.status_code == 200, r.text
    return [i["id"] for i in r.json()["items"]]


async def _make_billing(db, job_id: str) -> None:
    """Point the job's current mapping at the Billing Note template."""
    billing = await _template_id(db, "billing_note")
    await db.execute(
        text(
            "update template_mappings set template_id = :t, template_version_id = "
            "(select current_version_id from document_templates where id = :t) "
            "where id = (select current_mapping_id from ocr_jobs where id = :j)"
        ),
        {"t": billing, "j": job_id},
    )
    await db.commit()


async def test_filter_by_template(api, line, store, sm, ai_settings, llm, db):  # AC-017-04
    await login(api, line)
    a, b, c, d = await _jobs(api, store, sm, ai_settings, llm, db, 4)
    await _make_billing(db, c)
    await db.execute(text("update ocr_jobs set current_mapping_id = null where id = :j"), {"j": d})
    await db.commit()
    tax = await _template_id(db, "tax_invoice")
    assert sorted(await _ids(api, f"template={tax}")) == sorted([a, b])
    assert await _ids(api, "template=generic") == [d]


async def test_date_range_thai_boundary(api, line, store, sm, ai_settings, llm, db):  # AC-017-05
    await login(api, line)
    a, b = await _jobs(api, store, sm, ai_settings, llm, db, 2)
    await db.execute(
        text("update ocr_jobs set created_at = '2026-11-01T16:30:00Z' where id = :j"), {"j": a}
    )
    await db.execute(
        text("update ocr_jobs set created_at = '2026-11-01T17:30:00Z' where id = :j"), {"j": b}
    )
    await db.commit()
    assert await _ids(api, "created_from=2026-11-02") == [b]
    assert await _ids(api, "created_to=2026-11-01") == [a]
    assert sorted(await _ids(api, "created_from=2026-11-01&created_to=2026-11-02")) == sorted(
        [a, b]
    )


async def test_bad_range_400(api, line):
    await login(api, line)
    for query, field in [
        ("created_from=2026-11-03&created_to=2026-11-01", "created_from"),
        ("created_from=11/02/2026", "created_from"),
        ("created_to=2026-13-01", "created_to"),
        ("template=abc", "template"),
    ]:
        r = await api.get(f"{JOBS}?{query}")
        assert r.status_code == 400, (query, r.text)
        assert field in r.json()["fields"], (query, r.json())


async def test_filters_combine(api, line, store, sm, ai_settings, llm, db):
    await login(api, line)
    a, b, c = await _jobs(api, store, sm, ai_settings, llm, db, 3)
    await db.execute(
        text("update ocr_jobs set created_at = '2026-10-01T03:00:00Z' where id = :j"), {"j": b}
    )
    await db.execute(
        text("update ocr_jobs set review_status = 'CONFIRMED' where id = :j"), {"j": c}
    )
    await db.commit()
    tax = await _template_id(db, "tax_invoice")
    got = await _ids(api, f"stage=VERIFYING&template={tax}&created_from=2026-11-01")
    assert got == [a]


async def test_returned_flag(api, line, store, sm, ai_settings, llm, db):
    """A task sent back by a reviewer is marked in the list until it is confirmed again
    (FR-SYS-129 left column; web-pc-ocr Task 4)."""
    await login(api, line)
    a, b = await _jobs(api, store, sm, ai_settings, llm, db, 2)
    await db.execute(
        text(
            "insert into review_rounds (job_id, round_no, required_level, current_level, "
            "status, level_entered_at) values (:j, 1, 1, 1, 'RETURNED', now())"
        ),
        {"j": a},
    )
    await db.commit()
    r = await api.get(f"{JOBS}?stage=VERIFYING")
    flags = {i["id"]: i["returned"] for i in r.json()["items"]}
    assert flags == {a: True, b: False}
    await db.execute(
        text(
            "insert into review_rounds (job_id, round_no, required_level, current_level, "
            "status, level_entered_at) values (:j, 2, 1, 1, 'OPEN', now())"
        ),
        {"j": a},
    )
    await db.execute(
        text("update ocr_jobs set review_status = 'PENDING_L1' where id = :j"), {"j": a}
    )
    await db.commit()
    got = (await api.get(f"{JOBS}/{a}")).json()
    assert got["returned"] is False


async def test_list_templates(api, line, db):
    """Published templates of the current tenant, for the Library filter (web-pc-ocr)."""
    await login(api, line)
    r = await api.get("/api/v1/templates")
    assert r.status_code == 200, r.text
    names = {t["template_id"]: t["name"] for t in r.json()}
    assert await _template_id(db, "tax_invoice") in names
    assert await _template_id(db, "billing_note") in names
    assert all(isinstance(n, str) and n for n in names.values())
