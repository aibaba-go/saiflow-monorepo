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


async def test_creator_in_list(api, line, store, sm, ai_settings, llm, db):
    """Each task names its creator, so web-pc can tell own from colleagues' jobs
    (verify_own vs verify_others; final review Important 3)."""
    me = await login(api, line)
    (a,) = await _jobs(api, store, sm, ai_settings, llm, db, 1)
    item = (await api.get(JOBS)).json()["items"][0]
    assert (item["id"], item["created_by_user_id"]) == (a, me["user_id"])


async def test_generic_filter_excludes_unfinished(api, line, store, db):
    """A job still recognising has no result: it is not a generic result (minor-fixes-ui)."""
    from tests.integration.test_ocr_jobs import new_job

    await login(api, line)
    queued = (await new_job(api)).json()
    assert queued["id"] not in await _ids(api, "template=generic")


async def test_generic_filter_keeps_finished(api, line, store, sm, ai_settings, llm, db):
    # Review Focus 3: finished generic results (returned or confirmed) still match
    await login(api, line)
    a, b = await _jobs(api, store, sm, ai_settings, llm, db, 2)
    await db.execute(
        text(
            "update ocr_jobs set current_mapping_id = null, review_status = 'CONFIRMED' where id = :j"
        ),
        {"j": a},
    )
    await db.execute(text("update ocr_jobs set current_mapping_id = null where id = :j"), {"j": b})
    await db.commit()
    assert sorted(await _ids(api, "template=generic")) == sorted([a, b])


async def test_mapping_state_has_target(api, line, store, sm, ai_settings, llm, db):
    """A failed manual conversion names its template version, so the page can retry it."""
    await login(api, line)
    (job_id,) = await _jobs(api, store, sm, ai_settings, llm, db, 1)
    billing = (
        await db.execute(
            text(
                "select t.id, t.current_version_id from document_templates t "
                "where t.code = 'billing_note'"
            )
        )
    ).one()
    await db.execute(
        text(
            "insert into template_mappings (id, job_id, raw_result_id, template_id, "
            "template_version_id, source, status, error_code, finished_at, created_at) "
            "select gen_random_uuid()::text, :j, m.raw_result_id, :t, :v, 'MANUAL', 'FAILED', "
            "'PRIMARY_MISSING', now() + interval '1 second', now() + interval '1 second' "
            "from template_mappings m where m.job_id = :j limit 1"
        ),
        {"j": job_id, "t": billing[0], "v": billing[1]},
    )
    await db.commit()
    body = (await api.get(f"{JOBS}/{job_id}/result")).json()
    assert body["mapping"]["status"] == "FAILED"
    assert body["mapping"]["template_version_id"] == billing[1]
