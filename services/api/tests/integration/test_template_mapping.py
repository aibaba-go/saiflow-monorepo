"""Template matching, conversion, switching and the generic result (FR-TEMPLATE-006,
FR-OCR-019, FR-OCR-020, FR-OCR-023; Review Focus 2 and 4). The LLM is faked over httpx."""

import json

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.db import create_sessionmaker
from app.ocr import mapping_worker, worker
from tests.integration.db_fixtures import login
from tests.integration.test_ocr_jobs import new_job
from tests.integration.test_ocr_worker import FakeEngine

JOBS = "/api/v1/ocr/jobs"
RAW = {"เลขที่": "IV00000001", "วันที่": "01/10/2569", "ผู้ขาย": "บริษัท ตัวอย่าง จำกัด"}
TAX_OUTPUT = {
    "document": {"invoice_no": "IV00000001", "invoice_date": "01/10/2569", "stray": "x"},
    "seller": {"name": "บริษัท ตัวอย่าง จำกัด", "tax_id": "0105500000001"},
    "buyer": {"name": "บริษัท ทดสอบ จำกัด"},
    "goods": {
        "line_items": [{"seq": "1", "description": "A", "quantity": "1,200", "amount": "15,000.00"}]
    },
    "summary": {"net_total": "฿ 16,050.40"},
    "unknown_group": {"k": "v"},
}
NO_PRIMARY = {"document": {"billing_no": "X"}}  # nothing a Billing Note needs


class FakeLlm:
    """Replies per stage: match (classification prompt), convert, generic (refine prompt)."""

    def __init__(self):
        self.replies: dict[str, list] = {"match": [], "convert": [], "generic": []}
        self.calls: list[str] = []
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        system = json.loads(request.content)["messages"][0]["content"]
        stage = (
            "match"
            if "单据分类助手" in system
            else "generic"
            if "文档结构化助手" in system
            else "convert"
        )
        self.calls.append(stage)
        if not self.replies[stage]:
            raise AssertionError(f"unexpected {stage} call")
        reply = self.replies[stage].pop(0)
        content = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


@pytest.fixture
def sm(db_engine):
    return create_sessionmaker(db_engine)


@pytest.fixture
def llm():
    return FakeLlm()


@pytest.fixture
def ai_settings(app_settings):
    return app_settings.model_copy(update={"llm_api_key": SecretStr("llm-key")})


async def _versions(db) -> dict[str, int]:
    rows = await db.execute(
        text(
            "select t.code, v.id from document_template_versions v "
            "join document_templates t on t.id = v.template_id"
        )
    )
    return dict(rows.all())


async def _no_sleep(_s):
    return None


async def recognised(api, store, sm, settings, llm, structured=None, engine="textin"):
    """A job recognised by a fake engine; returns the job JSON."""
    job = (await new_job(api)).json()
    fake = FakeEngine(engine, structured=RAW if structured is None else structured)
    if structured == {}:
        fake.structured = None
    await worker.run_once(
        sm, store, settings, engines={engine: fake}, sleep=_no_sleep, llm_transport=llm.transport
    )
    return job


async def mapping_pass(sm, settings, llm):
    return await mapping_worker.run_once(
        sm, settings, transport=llm.transport, sleep=lambda s: None
    )


async def _current(db, job_id):
    return (
        await db.execute(
            text(
                "select v.version, v.structured, v.mapping_id, j.current_mapping_id, "
                "j.pending_mapping_id "
                "from result_versions v join ocr_jobs j on j.id = v.job_id "
                "where v.job_id = :j and v.is_current"
            ),
            {"j": job_id},
        )
    ).one()


async def _stage(api, job_id):
    return (await api.get(f"{JOBS}/{job_id}")).json()["stage"]


async def test_seeded_options(api, line, store, sm, ai_settings, llm, db):  # AC-TEMPLATE-006-01
    await login(api, line)
    job = await recognised(api, store, sm, ai_settings, llm)
    body = (await api.get(f"{JOBS}/{job['id']}/template-options")).json()
    assert sorted(t["code"] for t in body["templates"]) == ["billing_note", "tax_invoice"]
    assert body["generic"] is True


async def test_auto_match_and_convert(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-OCR-019-01, AC-FR-OCR-020-01, Review Focus 4
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    assert await _stage(api, job["id"]) == "TEMPLATE_MATCHING"
    llm.replies["match"] = [
        {
            "ranking": [
                {
                    "template_version_id": versions["tax_invoice"],
                    "score": 0.93,
                    "reason": "VAT invoice",
                }
            ]
        }
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    assert await mapping_pass(sm, ai_settings, llm) is True
    version, structured, mapping_id, current_mapping, pending = await _current(db, job["id"])
    assert version == 2 and mapping_id == current_mapping and pending is None
    assert structured["document"]["invoice_date"] == "2026-10-01"
    assert structured["summary"]["net_total"] == "16050.40"
    assert structured["goods"]["line_items"][0]["quantity"] == "1200"
    assert "stray" not in structured["document"] and "unknown_group" not in structured
    assert await _stage(api, job["id"]) == "VERIFYING"
    assert (await api.get(f"{JOBS}/{job['id']}")).json()["template_name"].startswith("Tax Invoice")


async def test_low_score_stays_free_form(
    api, line, store, sm, ai_settings, llm, db
):  # AC-FR-OCR-019-02
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {
            "ranking": [
                {"template_version_id": versions["billing_note"], "score": 0.55},
                {"template_version_id": versions["tax_invoice"], "score": 0.30},
            ]
        }
    ]
    await mapping_pass(sm, ai_settings, llm)
    assert "convert" not in llm.calls  # below 70%: no conversion
    status, code = (
        await db.execute(text("select status, error_code from template_mappings"))
    ).one()
    assert (status, code) == ("FAILED", "NO_TEMPLATE_FIT")
    assert await _stage(api, job["id"]) == "VERIFYING"
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["template"] is None and result["mapping"] is None  # free-form, no error
    body = (await api.get(f"{JOBS}/{job['id']}/template-options")).json()
    assert [o["code"] for o in body["templates"]] == ["billing_note", "tax_invoice"]
    assert [o["score"] for o in body["templates"]] == [0.55, 0.3]
    assert [o["recommended"] for o in body["templates"]] == [True, False]
    assert body["generic"] is True and body["last_failure"] is None


async def test_auto_primary_missing_is_quiet(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-OCR-019-03
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.85}]}
    ]
    llm.replies["convert"] = [{k: v for k, v in TAX_OUTPUT.items() if k != "summary"}]
    await mapping_pass(sm, ai_settings, llm)
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["template"] is None and result["mapping"] is None
    assert await _stage(api, job["id"]) == "VERIFYING"


async def test_no_templates_no_llm_call(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-OCR-019-04
    await login(api, line)
    await db.execute(text("update document_templates set status = 'DISABLED'"))
    await db.commit()
    job = await recognised(api, store, sm, ai_settings, llm)
    await mapping_pass(sm, ai_settings, llm)
    assert "match" not in llm.calls
    assert (await db.execute(text("select count(*) from template_mappings"))).scalar() == 0
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["template"] is None and result["mapping"] is None


async def test_single_candidate_still_scored(api, line, store, sm, ai_settings, llm, db):
    await login(api, line)
    versions = await _versions(db)
    await db.execute(
        text("update document_templates set status = 'DISABLED' where code = 'billing_note'")
    )
    await db.commit()
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.40}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    assert llm.calls.count("match") == 1 and "convert" not in llm.calls
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["template"] is None and result["mapping"] is None


async def test_manual_failure_shows_after_quiet_auto(api, line, store, sm, ai_settings, llm, db):
    """Review Focus 2: auto low score is quiet; a manual failure shows; a later manual
    success clears it."""
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["billing_note"], "score": 0.45}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    assert (await api.get(f"{JOBS}/{job['id']}/result")).json()["mapping"] is None
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
    )
    assert r.status_code == 202, r.text
    llm.replies["convert"] = [NO_PRIMARY]
    await mapping_pass(sm, ai_settings, llm)
    mapping = (await api.get(f"{JOBS}/{job['id']}/result")).json()["mapping"]
    assert {k: mapping[k] for k in ("status", "error")} == {
        "status": "FAILED",
        "error": "PRIMARY_MISSING",
    }
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["tax_invoice"]}
    )
    assert r.status_code == 202, r.text
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["mapping"] is None and result["template"]["name"].startswith("Tax Invoice")


async def test_manual_low_score_hint(api, line, store, sm, ai_settings, llm, db):  # AC-024-02
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["billing_note"], "score": 0.45}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
    )
    llm.replies["convert"] = [
        {"document": {"billing_date": "22.02.2024"}, "summary": {"total_amount": "1"}}
    ]
    await mapping_pass(sm, ai_settings, llm)
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["match"] == {
        "template_version_id": versions["billing_note"],
        "score": 0.45,
        "low_score": True,
    }


async def test_template_version_details(api, line, db):  # AC-FR-OCR-024-03
    await login(api, line)
    versions = await _versions(db)
    r = await api.get(f"/api/v1/templates/versions/{versions['tax_invoice']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["code"] == "tax_invoice" and body["groups"][0]["key"] == "document"
    assert body["groups"][0]["items"][0]["names"]["zh"]  # field names per language
    assert (await api.get("/api/v1/templates/versions/999999")).status_code == 404
    await db.execute(
        text("update document_templates set status = 'DISABLED' where code = 'tax_invoice'")
    )
    await db.commit()
    r = await api.get(f"/api/v1/templates/versions/{versions['tax_invoice']}")
    assert r.status_code == 404


async def test_wrong_template_primary_missing(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-OCR-020-02
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
    )
    assert r.status_code == 202, r.text
    assert await _stage(api, job["id"]) == "TEMPLATE_MATCHING"
    llm.replies["convert"] = [NO_PRIMARY]
    await mapping_pass(sm, ai_settings, llm)
    failed = (
        await db.execute(
            text("select count(*) from template_mappings where error_code = 'PRIMARY_MISSING'")
        )
    ).scalar()
    assert failed == 1
    version, _, mapping_id, current_mapping, _ = await _current(db, job["id"])
    assert version == 2 and mapping_id == current_mapping  # the Tax Invoice result stays


async def test_switch_back_reuses_mapping(api, line, store, sm, ai_settings, llm, db):  # AC-020-03
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    calls = len(llm.calls)
    r = await api.post(f"{JOBS}/{job['id']}/generic")
    assert r.status_code == 200, r.text
    version, _, mapping_id, _, _ = await _current(db, job["id"])
    assert (version, mapping_id) == (1, None)
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["tax_invoice"]}
    )
    assert r.status_code == 200, r.text
    version, _, mapping_id, _, _ = await _current(db, job["id"])
    assert version == 2 and mapping_id is not None
    assert len(llm.calls) == calls  # no new LLM call


async def test_generic_result_textin(api, line, store, sm, ai_settings, llm, db):  # AC-023-01
    await login(api, line)
    job = await recognised(api, store, sm, ai_settings, llm)
    r = await api.post(f"{JOBS}/{job['id']}/generic")
    assert r.status_code == 200
    _, structured, mapping_id, _, pending = await _current(db, job["id"])
    assert structured == RAW and mapping_id is None and pending is None
    assert await _stage(api, job["id"]) == "VERIFYING"


async def test_vision_generic_built_by_llm(api, line, store, sm, ai_settings, llm, db):
    await login(api, line)
    llm.replies["generic"] = ['{"document": {"invoice_no": "IV9", "total": 12.50}}']  # as sent
    job = await recognised(api, store, sm, ai_settings, llm, structured={}, engine="google_vision")
    _, structured, _, _, _ = await _current(db, job["id"])
    assert structured == {"document": {"invoice_no": "IV9", "total": "12.50"}}  # decimals as text


async def test_version_records_template_version(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-TEMPLATE-006-02
    await login(api, line)
    versions = await _versions(db)
    await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    await db.execute(
        text(
            "insert into document_template_versions "
            "(template_id, version, name, groups, content_hash) "
            "select template_id, 2, name, groups, 'new' "
            "from document_template_versions where id = :v"
        ),
        {"v": versions["tax_invoice"]},
    )
    await db.commit()
    used = (
        await db.execute(
            text("select template_version_id from template_mappings where status='READY'")
        )
    ).scalar()
    assert used == versions["tax_invoice"]


async def test_mapping_limit_5(api, line, store, sm, ai_settings, llm, db):
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [NO_PRIMARY]
    await mapping_pass(sm, ai_settings, llm)  # attempt 1 (auto) fails
    for _ in range(4):
        r = await api.post(
            f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
        )
        assert r.status_code == 202, r.text
        llm.replies["convert"] = [NO_PRIMARY]
        await mapping_pass(sm, ai_settings, llm)
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
    )
    assert (r.status_code, r.json()["code"]) == (409, "mapping_limit")


async def test_in_progress_and_unknown_template(api, line, store, sm, ai_settings, llm, db):
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)  # the auto mapping is pending
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
    )
    assert (r.status_code, r.json()["code"]) == (409, "mapping_in_progress")
    r = await api.post(f"{JOBS}/{job['id']}/template", json={"template_version_id": 999999})
    assert r.status_code == 404


async def test_llm_unavailable_keeps_generic(api, line, store, sm, app_settings, llm, db):
    await login(api, line)
    job = await recognised(api, store, sm, app_settings, llm)  # no LLM key
    await mapping_pass(sm, app_settings, llm)
    code = (await db.execute(text("select error_code from template_mappings"))).scalar()
    assert code == "LLM_UNAVAILABLE"
    assert llm.calls == []
    assert await _stage(api, job["id"]) == "VERIFYING"


async def test_late_mapping_does_not_overwrite_confirmed(
    api, line, store, sm, ai_settings, llm, db
):
    # Review Focus 2
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    await db.execute(
        text("update ocr_jobs set review_status='CONFIRMED' where id=:j"), {"j": job["id"]}
    )
    await db.commit()
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, ai_settings, llm)
    version, _, mapping_id, _, _ = await _current(db, job["id"])
    assert (version, mapping_id) == (1, None)
    r = await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["tax_invoice"]}
    )
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")
    r = await api.post(f"{JOBS}/{job['id']}/generic")
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")


async def test_startup_recovery_fails_fresh_conversion(api, line, store, sm, ai_settings, llm, db):
    """A conversion cut by a restart fails at once, so the person can pick a template again."""
    await login(api, line)
    job = await recognised(api, store, sm, ai_settings, llm)
    await db.execute(
        text("update template_mappings set status='CONVERTING', updated_at=now() where job_id=:j"),
        {"j": job["id"]},
    )
    await db.commit()
    await mapping_worker.recover(sm)
    assert await _stage(api, job["id"]) == "TEMPLATE_MATCHING"  # fresh: periodic check waits
    await mapping_worker.recover(sm, startup=True)
    assert await _stage(api, job["id"]) == "VERIFYING"


async def test_blank_required_field_still_fits(api, line, store, sm, ai_settings, llm, db):
    """A tax invoice without a buyer converts with the template; the empty required field
    is left to the confirm gate (final review 2)."""
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["tax_invoice"], "score": 0.9}]}
    ]
    llm.replies["convert"] = [{k: v for k, v in TAX_OUTPUT.items() if k != "buyer"}]
    await mapping_pass(sm, ai_settings, llm)
    assert await _stage(api, job["id"]) == "VERIFYING"
    body = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert body["template"] is not None and body["mapping"] is None
    assert "buyer.name" in body["missing_required"]


async def test_failure_card_clears_after_recovering(api, line, store, sm, ai_settings, llm, db):
    """Final review 3: "Use generic" (or switching to a ready template) after a manual
    failure hides the old failure; a newer manual failure shows again."""
    await login(api, line)
    versions = await _versions(db)
    job = await recognised(api, store, sm, ai_settings, llm)
    llm.replies["match"] = [
        {"ranking": [{"template_version_id": versions["billing_note"], "score": 0.45}]}
    ]
    await mapping_pass(sm, ai_settings, llm)
    await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["billing_note"]}
    )
    llm.replies["convert"] = [NO_PRIMARY]
    await mapping_pass(sm, ai_settings, llm)
    assert (await api.get(f"{JOBS}/{job['id']}/result")).json()["mapping"]["status"] == "FAILED"
    assert (await api.post(f"{JOBS}/{job['id']}/generic")).status_code == 200
    result = (await api.get(f"{JOBS}/{job['id']}/result")).json()
    assert result["mapping"] is None and result["template"] is None
    options = (await api.get(f"{JOBS}/{job['id']}/template-options")).json()
    assert options["last_failure"] is None
    await api.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": versions["tax_invoice"]}
    )
    llm.replies["convert"] = [{"document": {"invoice_no": "X"}}]  # no net_total: fails
    await mapping_pass(sm, ai_settings, llm)
    assert (await api.get(f"{JOBS}/{job['id']}/result")).json()["mapping"]["status"] == "FAILED"
