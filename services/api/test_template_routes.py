"""模板选择 / 切换 / 结果 / 导出接口测试（FR-VERIFY-018..020、FR-OCR-020/021，design D8、D13–D16）。

真实路由模块逐个加载（不执行 routes/__init__.py、不导入 app.py），内存 SQLite + 真实模型；
不连共享库、不访问网络、不调用大模型（映射结果直接用 service.finalize_ready 生成）。
单据内容全部为合成数据。
"""
from __future__ import annotations

import copy
import csv
import importlib.util
import io
import itertools
import json
import socket
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from flask import Flask, g

from doc_templates import repository as repo
from doc_templates import service, views
from errors import ApiError, error_response
from extensions import db
from mapping_worker import MappingWorker
from models import (
    AuditEvent,
    DocumentTemplate,
    File,
    OcrJob,
    OcrRawResult,
    ResultVersion,
    TemplateMapping,
    Tenant,
    User,
)
from test_template_mapping import (
    CONFIG,
    EXPECTED_TAX_INVOICE,
    LLM_BILLING_NOTE,
    LLM_TAX_INVOICE,
    RAW_TAX_INVOICE,
    FakeLlm,
    _seed,
)

API_DIR = Path(__file__).resolve().parent
TAX = "system.tax_invoice"
BILL = "system.billing_note"
TENANT_CODE = "tenant.custom_invoice"
FILE_T7 = "f" * 32
FILE_T8 = "e" * 32


def _load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, API_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(name)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous
    return module


@pytest.fixture(scope="module")
def routes():
    package = ModuleType("routes")
    package.__path__ = []
    with pytest.MonkeyPatch.context() as loader:
        loader.setitem(sys.modules, "routes", package)
        ocr = _load_module("routes.ocr", "routes/ocr.py")
        loader.setitem(sys.modules, "routes.ocr", ocr)
        results = _load_module("routes.results", "routes/results.py")
        loader.setitem(sys.modules, "routes.results", results)
        templates = _load_module("routes.templates", "routes/templates.py")
        exports = _load_module("routes.exports", "routes/exports.py")
        yield SimpleNamespace(ocr=ocr, results=results, templates=templates, exports=exports)


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("template route tests must not open network connections")

    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


@pytest.fixture()
def who():
    return {"id": 1}


@pytest.fixture()
def app(routes, who):
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_ENGINE_OPTIONS={},
        TEMPLATE_MAPPING_ENABLED=True, TEMPLATE_LOW_SCORE_THRESHOLD=0.7, TEMPLATE_MAX_MAPPINGS_PER_JOB=5,
    )
    db.init_app(app)
    for bp in (routes.ocr.ocr_bp, routes.results.results_bp, routes.templates.templates_bp,
               routes.exports.exports_bp):
        app.register_blueprint(bp, url_prefix="/api/v1")

    @app.errorhandler(ApiError)
    def _api_error(err):
        return error_response(err)

    @app.before_request
    def _login():
        g.current_user = db.session.get(User, who["id"])

    registered = datetime(2026, 10, 1)
    with app.app_context():
        db.create_all()
        db.session.add_all([
            User(id=1, line_provider="dev", line_sub="synthetic-1", display_name="Synthetic A",
                 registered_at=registered),
            User(id=2, line_provider="dev", line_sub="synthetic-2", display_name="Synthetic B",
                 registered_at=registered),
            User(id=3, line_provider="guest", line_sub="synthetic-guest", display_name="Guest"),
        ])
        db.session.flush()
        db.session.add_all([
            Tenant(id=7, tenant_type="PERSONAL", owner_user_id=1, display_name="t7", status="ACTIVE"),
            Tenant(id=8, tenant_type="PERSONAL", owner_user_id=2, display_name="t8", status="ACTIVE"),
            Tenant(id=9, tenant_type="PERSONAL", owner_user_id=3, display_name="t9", status="ACTIVE"),
        ])
        db.session.flush()
        db.session.add_all([
            File(id=FILE_T7, tenant_id=7, created_by_user_id=1, uploader_user_id=1, original_name="synthetic.pdf",
                 storage_path="files/synthetic.pdf", status="READY", page_count=1),
            File(id=FILE_T8, tenant_id=8, created_by_user_id=2, uploader_user_id=2, original_name="other.pdf",
                 storage_path="files/other.pdf", status="READY", page_count=1),
        ])
        db.session.commit()
        repo.import_template(_seed("billing_note"))
        repo.import_template(_seed("tax_invoice"))
        tenant_tpl = _seed("tax_invoice")
        tenant_tpl.update(code=TENANT_CODE, name="Custom Invoice / ใบกำกับเฉพาะ")
        repo.import_template(tenant_tpl, tenant_id=8)
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


# ---- 数据构造 ----

_tick = itertools.count()


def _stamp() -> datetime:
    base = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    return base + timedelta(seconds=next(_tick))


def _tpl(code: str, tenant_id: int | None = None) -> DocumentTemplate:
    return DocumentTemplate.query.filter_by(code=code, tenant_id=tenant_id).one()


def _ver(code: str, tenant_id: int | None = None):
    return repo.current_version(_tpl(code, tenant_id))


def _job(*, raw=True, status="SUCCEEDED", review_status="UNREVIEWED", tenant=7, user=1) -> str:
    job = OcrJob(tenant_id=tenant, created_by_user_id=user, file_id=FILE_T7 if tenant == 7 else FILE_T8,
                 status=status, review_status=review_status, page_count=1)
    db.session.add(job)
    db.session.flush()
    db.session.add(ResultVersion(job_id=job.id, version=1, is_current=True,
                                 structured=copy.deepcopy(RAW_TAX_INVOICE)))
    if raw:
        db.session.add(OcrRawResult(id=uuid.uuid4().hex, job_id=job.id, payload=copy.deepcopy(RAW_TAX_INVOICE)))
    db.session.commit()
    return job.id


def _new_mapping(job_id: str, code: str, source: str, *, score=None, candidates=None, tenant_id=None):
    job = service.lock_job(job_id)
    cur = service.current_version(job_id)
    tpl, ver = _tpl(code, tenant_id), _ver(code, tenant_id)
    mapping = service.create_mapping(
        job, views.raw_result_id_of(job_id), source=source, base_version_id=cur.id,
        template_id=tpl.id, template_version_id=ver.id, user_id=None if source == service.AUTO else 1,
    )
    mapping.created_at = _stamp()
    mapping.match_score = score
    mapping.candidates = candidates
    return job, mapping


def _ready(job_id: str, code: str = TAX, *, source=service.MANUAL, structured=None, score=None, candidates=None,
           apply=True) -> str:
    job, mapping = _new_mapping(job_id, code, source, score=score, candidates=candidates)
    if not apply:
        job.pending_mapping_id = None
    mapping.status = service.CONVERTING
    service.finalize_ready(mapping, job, copy.deepcopy(structured or EXPECTED_TAX_INVOICE), warnings=[], dropped=0)
    db.session.commit()
    return mapping.id


def _failed(job_id: str, code: str = BILL, *, source=service.MANUAL, error="LLM_TIMEOUT") -> str:
    job, mapping = _new_mapping(job_id, code, source)
    service.fail(mapping, job, error, "synthetic timeout")
    db.session.commit()
    return mapping.id


def _pending(job_id: str, code: str = BILL) -> str:
    _, mapping = _new_mapping(job_id, code, service.MANUAL)
    db.session.commit()
    return mapping.id


def _cands(*entries):
    return [{"template_id": _tpl(c).id, "template_version_id": _ver(c).id, "score": s, "reason": "synthetic"}
            for c, s in entries]


def _job_row(job_id: str) -> OcrJob:
    db.session.expire_all()
    return db.session.get(OcrJob, job_id)


def _actions(job_id: str) -> list[AuditEvent]:
    db.session.expire_all()
    return AuditEvent.query.filter_by(object_id=job_id).order_by(AuditEvent.id).all()


def _action_names(job_id: str) -> list[str]:
    return [a.action for a in _actions(job_id)]


def _raw_id(job_id: str) -> str:
    return views.raw_result_id_of(job_id)


def _apply(client, job_id, expected, **body):
    return client.post(f"/api/v1/ocr/jobs/{job_id}/apply-template", json={"expected_version": expected, **body})


def _apply_template(client, job_id, expected, code=TAX, tenant_id=None, **body):
    return _apply(client, job_id, expected, raw_result_id=_raw_id(job_id), template_id=_tpl(code, tenant_id).id,
                  **body)


def _generic(client, job_id, expected):
    return client.post(f"/api/v1/ocr/jobs/{job_id}/use-generic", json={"expected_version": expected})


def _results(client, job_id):
    resp = client.get(f"/api/v1/ocr/jobs/{job_id}/results")
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["data"]


def _patch(client, job_id, expected, structured=None, **body):
    payload = {"expected_version": expected, **body}
    if structured is not None:
        payload["structured"] = structured
    return client.patch(f"/api/v1/ocr/jobs/{job_id}/results", json=payload)


def _err(resp):
    return resp.get_json()["code"], resp.get_json()["message_key"]


# ---- GET /templates/versions/<id> ----


def test_system_template_version_is_readable_by_guest_without_description(client, who):
    who["id"] = 3
    ver = _ver(TAX)
    resp = client.get(f"/api/v1/templates/versions/{ver.id}")
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert "description" not in data
    assert data["scope"] == "system" and data["code"] == TAX and data["is_current_version"] is True
    assert [g["key"] for g in data["groups"]] == ["document", "seller", "buyer", "goods", "summary", "delivery",
                                                  "other"]


def test_other_tenant_template_version_is_hidden(client, who):
    tenant_ver = _ver(TENANT_CODE, 8)
    assert client.get(f"/api/v1/templates/versions/{tenant_ver.id}").status_code == 404
    assert client.get("/api/v1/templates/versions/999999").status_code == 404
    who["id"] = 2
    resp = client.get(f"/api/v1/templates/versions/{tenant_ver.id}")
    assert resp.status_code == 200 and resp.get_json()["data"]["scope"] == "tenant"


def test_disabled_and_deleted_template_versions_stay_readable(client):
    tpl, ver = _tpl(BILL), _ver(BILL)
    repo.set_status(tpl.id, "DISABLED")
    db.session.commit()
    data = client.get(f"/api/v1/templates/versions/{ver.id}").get_json()["data"]
    assert data["status"] == "DISABLED" and data["deleted"] is False
    repo.soft_delete(tpl.id)
    db.session.commit()
    data = client.get(f"/api/v1/templates/versions/{ver.id}").get_json()["data"]
    assert data["deleted"] is True and data["groups"]


# ---- GET template-options ----


def test_template_options_sorted_by_auto_score_with_recommendation(client):
    job_id = _job()
    auto_id = _ready(job_id, TAX, source=service.AUTO, score=0.92, candidates=_cands((TAX, 0.92), (BILL, 0.3)))
    failed_id = _failed(job_id, BILL)
    data = client.get(f"/api/v1/ocr/jobs/{job_id}/template-options").get_json()["data"]

    assert data["enabled"] is True and data["raw_result_id"] == _raw_id(job_id)
    assert data["current_mapping_id"] == auto_id and data["pending_mapping_id"] is None
    assert data["max_mappings"] == 5 and data["mapping_count"] == 2
    codes = [t["code"] for t in data["templates"]]
    assert codes == [TAX, BILL]  # 他租户模板不出现
    tax, bill = data["templates"]
    assert tax["recommended"] and tax["generated"] and tax["is_current"] and tax["ready_mapping_id"] == auto_id
    assert tax["score"] == 0.92 and tax["low_score"] is False and tax["scope"] == "system"
    assert not bill["recommended"] and not bill["generated"] and bill["low_score"] is True
    assert [(m["id"], m["status"], m["is_current"]) for m in data["mappings"]] == [
        (auto_id, "READY", True), (failed_id, "FAILED", False)]


def test_template_options_without_scores_has_no_recommendation(client):
    job_id = _job()
    pending_id = _pending(job_id, BILL)
    data = client.get(f"/api/v1/ocr/jobs/{job_id}/template-options").get_json()["data"]
    assert [t["code"] for t in data["templates"]] == [BILL, TAX]  # 按名称排序
    assert not any(t["recommended"] for t in data["templates"])
    assert data["templates"][0]["in_progress_mapping_id"] == pending_id
    assert data["pending_mapping_id"] == pending_id and data["mappings"] == []


def test_template_options_single_candidate_ready_auto_counts_as_recommended(client):
    job_id = _job()
    _ready(job_id, TAX, source=service.AUTO)  # 单候选：无分数、无候选列表
    tax = client.get(f"/api/v1/ocr/jobs/{job_id}/template-options").get_json()["data"]["templates"][0]
    assert tax["code"] == TAX and tax["score"] == 1.0 and tax["recommended"]


def test_template_options_flag_off_lists_no_templates(app, client):
    job_id = _job()
    app.config["TEMPLATE_MAPPING_ENABLED"] = False
    data = client.get(f"/api/v1/ocr/jobs/{job_id}/template-options").get_json()["data"]
    assert data["enabled"] is False and data["templates"] == []


def test_template_options_other_users_job_is_404(client):
    job_id = _job(tenant=8, user=2)
    assert client.get(f"/api/v1/ocr/jobs/{job_id}/template-options").status_code == 404


# ---- POST apply-template ----


def test_apply_template_creates_manual_mapping_202(client):
    job_id = _job()
    resp = _apply_template(client, job_id, 1)
    assert resp.status_code == 202
    summary = resp.get_json()["data"]["mapping"]
    assert summary["status"] == "PENDING" and summary["source"] == "MANUAL"
    assert summary["template_name"] == _ver(TAX).name and summary["template_version"] == 1
    job = _job_row(job_id)
    mapping = db.session.get(TemplateMapping, summary["id"])
    assert job.pending_mapping_id == mapping.id and job.current_mapping_id is None
    assert mapping.base_version_id == service.current_version(job_id).id
    assert mapping.template_version_id == _ver(TAX).id and mapping.created_by_user_id == 1

    # 同一模板已在进行中：不新建，只把 pending 指过去
    again = _apply_template(client, job_id, 1)
    assert again.status_code == 202 and again.get_json()["data"]["mapping"]["id"] == mapping.id
    assert service.mapping_count(job_id) == 1


def test_apply_template_points_pending_to_in_progress_mapping(client):
    job_id = _job()
    bill_id = _pending(job_id, BILL)
    tax = _apply_template(client, job_id, 1, TAX).get_json()["data"]["mapping"]
    assert _job_row(job_id).pending_mapping_id == tax["id"]
    resp = _apply_template(client, job_id, 1, BILL)
    assert resp.status_code == 202 and resp.get_json()["data"]["mapping"]["id"] == bill_id
    assert _job_row(job_id).pending_mapping_id == bill_id


def test_apply_template_reuses_ready_mapping_200_and_force_regenerates(client):
    job_id = _job()
    mapping_id = _ready(job_id, TAX, apply=False)  # 已生成未生效
    resp = _apply_template(client, job_id, 1)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["version"] == 2 and data["current_mapping"]["id"] == mapping_id
    assert data["template_schema"]["template_version_id"] == _ver(TAX).id
    assert data["structured"]["summary"]["net_total"] == "16050.40"
    assert _job_row(job_id).current_mapping_id == mapping_id
    switched = [a for a in _actions(job_id) if a.action == "template.switched"]
    assert len(switched) == 1 and switched[0].user_id == 1 and switched[0].detail["mapping_id"] == mapping_id

    forced = _apply_template(client, job_id, 2, force=True)
    assert forced.status_code == 202
    new_id = forced.get_json()["data"]["mapping"]["id"]
    assert new_id != mapping_id and _job_row(job_id).pending_mapping_id == new_id
    assert db.session.get(TemplateMapping, new_id).base_version_id == service.current_version(job_id).id


def test_apply_template_by_mapping_id(client):
    job_id, other_job = _job(), _job()
    ready_id = _ready(job_id, TAX, apply=False)
    failed_id = _failed(job_id, BILL)
    foreign_id = _ready(other_job, TAX)

    assert _apply(client, job_id, 1, mapping_id=foreign_id).status_code == 404
    resp = _apply(client, job_id, 1, mapping_id=failed_id)
    assert resp.status_code == 409 and _err(resp) == ("MAPPING_NOT_READY", "template.mapping_not_ready")
    assert _apply(client, job_id, 1, mapping_id="").status_code == 400

    resp = _apply(client, job_id, 1, mapping_id=ready_id)
    assert resp.status_code == 200 and resp.get_json()["data"]["current_mapping"]["id"] == ready_id
    # 已是当前映射再次切换：幂等，不再记切换审计
    assert _apply(client, job_id, 2, mapping_id=ready_id).status_code == 200
    assert _action_names(job_id).count("template.switched") == 1


def test_apply_template_raw_result_checks(client):
    no_raw = _job(raw=False)
    resp = _apply(client, no_raw, 1, raw_result_id="x" * 32, template_id=_tpl(TAX).id)
    assert resp.status_code == 409 and _err(resp)[0] == "RAW_RESULT_MISSING"

    job_id = _job()
    assert _apply(client, job_id, 1, raw_result_id="x" * 32, template_id=_tpl(TAX).id).status_code == 404
    resp = _apply(client, job_id, 1, template_id=_tpl(TAX).id)
    assert resp.status_code == 400 and resp.get_json()["field_errors"][0]["field"] == "raw_result_id"
    resp = _apply(client, job_id, 1, raw_result_id=_raw_id(job_id))
    assert resp.status_code == 400 and resp.get_json()["field_errors"][0]["field"] == "template_id"


def test_apply_template_unavailable_templates(client):
    job_id = _job()
    for template_id in (_tpl(TENANT_CODE, 8).id, 999999):
        resp = _apply(client, job_id, 1, raw_result_id=_raw_id(job_id), template_id=template_id)
        assert resp.status_code == 409 and _err(resp)[0] == "TEMPLATE_UNAVAILABLE"
    repo.set_status(_tpl(BILL).id, "DISABLED")
    db.session.commit()
    resp = _apply_template(client, job_id, 1, BILL)
    assert resp.status_code == 409 and _err(resp)[0] == "TEMPLATE_UNAVAILABLE"
    assert service.mapping_count(job_id) == 0


def test_apply_template_rejects_confirmed_failed_and_stale_jobs(client):
    confirmed = _job(review_status="CONFIRMED")
    resp = _apply_template(client, confirmed, 1)
    assert resp.status_code == 409 and _err(resp) == ("STATE_CONFLICT", "results.already_confirmed")
    failed = _job(status="FAILED")
    resp = _apply_template(client, failed, 1)
    assert resp.status_code == 409 and _err(resp) == ("STATE_CONFLICT", "results.not_ready")
    job_id = _job()
    resp = _apply_template(client, job_id, 7)
    assert resp.status_code == 409 and _err(resp)[0] == "VERSION_CONFLICT"
    resp = client.post(f"/api/v1/ocr/jobs/{job_id}/apply-template", json={"template_id": 1})
    assert resp.status_code == 400
    assert service.mapping_count(job_id) == 0


def test_apply_template_mapping_limit(app, client):
    app.config["TEMPLATE_MAX_MAPPINGS_PER_JOB"] = 2
    job_id = _job()
    _failed(job_id, BILL)
    _failed(job_id, TAX)
    resp = _apply_template(client, job_id, 1)
    assert resp.status_code == 409 and _err(resp)[0] == "MAPPING_LIMIT_REACHED"
    assert service.mapping_count(job_id) == 2


def test_apply_template_flag_off_and_ownership_order(app, client):
    app.config["TEMPLATE_MAPPING_ENABLED"] = False
    job_id = _job()
    resp = _apply_template(client, job_id, 1)
    assert resp.status_code == 409 and _err(resp)[0] == "TEMPLATE_MAPPING_DISABLED"
    foreign = _job(tenant=8, user=2)
    assert _apply(client, foreign, 1, raw_result_id=_raw_id(foreign), template_id=_tpl(TAX).id).status_code == 404


# ---- POST use-generic ----


def test_use_generic_switches_back_and_is_idempotent(app, client):
    job_id = _job()
    mapping_id = _ready(job_id, TAX)
    assert _job_row(job_id).current_mapping_id == mapping_id
    app.config["TEMPLATE_MAPPING_ENABLED"] = False  # 关闭开关后仍可回到通用结果
    resp = _generic(client, job_id, 2)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["version"] == 1 and data["current_mapping"] is None and data["template_schema"] is None
    assert data["structured"] == RAW_TAX_INVOICE
    job = _job_row(job_id)
    assert job.current_mapping_id is None and job.pending_mapping_id is None
    assert _generic(client, job_id, 1).status_code == 200
    assert _action_names(job_id).count("template.generic_selected") == 2
    assert ResultVersion.query.filter_by(job_id=job_id).count() == 2
    assert _generic(client, job_id, 2).status_code == 409  # 版本冲突


def test_use_generic_clears_pending_request(client):
    job_id = _job()
    _apply_template(client, job_id, 1)
    assert _job_row(job_id).pending_mapping_id is not None
    assert _generic(client, job_id, 1).status_code == 200
    assert _job_row(job_id).pending_mapping_id is None
    assert _results(client, job_id)["pending_mapping"] is None


def test_use_generic_rejects_confirmed(client):
    job_id = _job(review_status="CONFIRMED")
    resp = _generic(client, job_id, 1)
    assert resp.status_code == 409 and _err(resp)[1] == "results.already_confirmed"


# ---- GET results 附加字段 ----


def test_generic_results_extras(app, client):
    job_id = _job()
    data = _results(client, job_id)
    assert data["raw_result_id"] == _raw_id(job_id) and data["template_available"] is True
    assert data["current_mapping"] is None and data["template_schema"] is None and data["validation"] is None
    assert data["pending_mapping"] is None and data["latest_failed_mapping"] is None
    app.config["TEMPLATE_MAPPING_ENABLED"] = False
    assert _results(client, job_id)["template_available"] is False
    assert _results(client, _job(raw=False))["template_available"] is False


def test_template_results_extras_with_validation_and_low_score(client):
    job_id = _job()
    structured = copy.deepcopy(EXPECTED_TAX_INVOICE)
    structured["summary"]["net_total"] = None
    structured["summary"]["vat_amount"] = "abc"
    _ready(job_id, TAX, source=service.AUTO, structured=structured, score=0.55,
           candidates=_cands((TAX, 0.55), (BILL, 0.2)))
    data = _results(client, job_id)
    current = data["current_mapping"]
    assert current["template_name"] == _ver(TAX).name and current["source"] == "AUTO"
    assert current["match_score"] == 0.55 and current["low_score"] is True
    assert data["template_schema"]["groups"][0]["key"] == "document"
    assert data["validation"]["required_missing"] == ["summary.net_total"]
    warned = {w["path"] for w in data["validation"]["type_warnings"]}
    assert "summary.vat_amount" in warned and "summary.net_total" not in warned  # 空值不告警


def test_results_pending_and_latest_failed(client):
    job_id = _job()
    failed_id = _failed(job_id, BILL, error="LLM_TIMEOUT")
    data = _results(client, job_id)
    failed = data["latest_failed_mapping"]
    assert failed["id"] == failed_id and failed["error_code"] == "LLM_TIMEOUT"
    assert failed["template_name"] == _ver(BILL).name

    _apply_template(client, job_id, 1, TAX)
    pending = _results(client, job_id)["pending_mapping"]
    assert pending["status"] == "PENDING" and pending["template_name"] == _ver(TAX).name

    _ready(job_id, TAX, apply=False)  # 之后有一次成功：不再提示失败
    assert _results(client, job_id)["latest_failed_mapping"] is None


# ---- PATCH results ----


def test_version_numbers_stay_unique_across_switches(client):
    job_id = _job()
    mapping_id = _ready(job_id, TAX)  # v2 当前
    assert _generic(client, job_id, 2).get_json()["data"]["version"] == 1

    generic_edit = copy.deepcopy(RAW_TAX_INVOICE)
    generic_edit["เลขที่"] = "IV00000099"
    resp = _patch(client, job_id, 1, generic_edit)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["version"] == 3 and data["current_mapping"] is None

    assert _apply(client, job_id, 3, mapping_id=mapping_id).get_json()["data"]["version"] == 2
    template_edit = copy.deepcopy(EXPECTED_TAX_INVOICE)
    template_edit["document"]["invoice_no"] = "IV00000099"
    data = _patch(client, job_id, 2, template_edit).get_json()["data"]
    assert data["version"] == 4 and data["current_mapping"]["id"] == mapping_id

    assert _generic(client, job_id, 4).get_json()["data"]["version"] == 3  # 回到通用结果的最新编辑
    db.session.expire_all()
    rows = {v.version: v.mapping_id for v in ResultVersion.query.filter_by(job_id=job_id).all()}
    assert rows == {1: None, 2: mapping_id, 3: None, 4: mapping_id}
    assert ResultVersion.query.filter_by(job_id=job_id, is_current=True).count() == 1


def test_patch_template_result_fills_structure_and_keeps_extra_keys(client):
    job_id = _job()
    _ready(job_id, TAX)
    edited = {"document": {"invoice_no": "IV1", "custom_note": "keep me"},
              "goods": {"line_items": [{"description": "synthetic", "lot": "L-1"}]},
              "extra_group": {"a": "b"}}
    resp = _patch(client, job_id, 2, edited)
    assert resp.status_code == 200
    structured = resp.get_json()["data"]["structured"]
    assert structured["document"]["custom_note"] == "keep me"
    assert structured["document"]["invoice_date"] is None
    assert set(structured["seller"]) == set(EXPECTED_TAX_INVOICE["seller"])
    row = structured["goods"]["line_items"][0]
    assert row["lot"] == "L-1" and row["amount"] is None and row["description"] == "synthetic"
    assert structured["extra_group"] == {"a": "b"}
    assert _job_row(job_id).review_status == "EDITED"


def test_confirm_required_gate_422_and_drafts_are_not_gated(client):
    job_id = _job()
    _ready(job_id, TAX)
    missing = copy.deepcopy(EXPECTED_TAX_INVOICE)
    missing["summary"]["net_total"] = ""
    missing["seller"]["tax_id"] = None
    resp = _patch(client, job_id, 2, missing, confirm=True)
    assert resp.status_code == 422
    assert [e["field"] for e in resp.get_json()["field_errors"]] == ["structured.seller.tax_id",
                                                                       "structured.summary.net_total"]
    job = _job_row(job_id)
    assert job.review_status == "UNREVIEWED" and service.current_version(job_id).version == 2

    draft = _patch(client, job_id, 2, missing)
    assert draft.status_code == 200 and draft.get_json()["data"]["version"] == 3
    assert draft.get_json()["data"]["validation"]["required_missing"] == ["seller.tax_id", "summary.net_total"]
    # 仅确认（无改动）也按当前内容校验
    assert _patch(client, job_id, 3, confirm=True).status_code == 422

    fixed = copy.deepcopy(EXPECTED_TAX_INVOICE)
    resp = _patch(client, job_id, 3, fixed, confirm=True)
    assert resp.status_code == 200 and resp.get_json()["data"]["review_status"] == "CONFIRMED"


def test_generic_results_are_never_gated(client):
    job_id = _job()
    assert _patch(client, job_id, 1, confirm=True).status_code == 200
    assert _job_row(job_id).review_status == "CONFIRMED"


def test_match_feedback_records_match_and_changed(client):
    matched = _job()
    _ready(matched, TAX, source=service.AUTO, score=0.9, candidates=_cands((TAX, 0.9)))
    assert _patch(client, matched, 2, confirm=True).status_code == 200
    feedback = [a for a in _actions(matched) if a.action == "template.match_feedback"]
    assert len(feedback) == 1 and feedback[0].detail["result"] == "match" and feedback[0].user_id == 1
    assert feedback[0].detail["template_version_id"] == _ver(TAX).id

    changed = _job()
    _ready(changed, TAX, source=service.AUTO, score=0.6, candidates=_cands((TAX, 0.6)))
    assert _generic(client, changed, 2).status_code == 200
    assert _patch(client, changed, 1, confirm=True).status_code == 200
    detail = next(a.detail for a in _actions(changed) if a.action == "template.match_feedback")
    assert detail["result"] == "changed" and detail["template_version_id"] is None
    assert detail["auto_template_version_id"] == _ver(TAX).id

    no_auto = _job()
    _ready(no_auto, TAX)  # 手动映射：不记录匹配反馈
    assert _patch(client, no_auto, 2, confirm=True).status_code == 200
    assert "template.match_feedback" not in _action_names(no_auto)


# ---- 任务摘要与删除 ----


def test_job_summary_and_list_include_template_name(client):
    templated, generic = _job(), _job()
    _ready(templated, TAX)
    assert client.get(f"/api/v1/ocr/jobs/{templated}").get_json()["data"]["template_name"] == _ver(TAX).name
    assert client.get(f"/api/v1/ocr/jobs/{generic}").get_json()["data"]["template_name"] is None
    items = client.get("/api/v1/ocr/jobs").get_json()["data"]["items"]
    names = {item["id"]: item["template_name"] for item in items}
    assert names == {templated: _ver(TAX).name, generic: None}


def test_stage_template_matching_in_summary_and_filter(client):
    """处理流程「上传 → OCR 处理 → 模板匹配」：映射进行中的任务阶段为 TEMPLATE_MATCHING，结束后回到 VERIFYING。"""
    matching, verifying, ocr_running, failed_map = _job(), _job(), _job(status="PROCESSING"), _job()
    _pending(matching)
    _failed(failed_map)
    confirmed = _job(review_status="CONFIRMED")
    service.lock_job(confirmed).pending_mapping_id = "synthetic-stale"  # 已确认优先于匹配中
    db.session.commit()

    def stage_of(job_id):
        return client.get(f"/api/v1/ocr/jobs/{job_id}").get_json()["data"]["stage"]

    def listed(stage):
        items = client.get(f"/api/v1/ocr/jobs?stage={stage}").get_json()["data"]["items"]
        return {item["id"] for item in items}

    assert stage_of(matching) == "TEMPLATE_MATCHING"
    assert {stage_of(j) for j in (verifying, failed_map)} == {"VERIFYING"}
    assert stage_of(ocr_running) == "OCR_PROCESSING"
    assert stage_of(confirmed) == "VERIFIED"
    assert listed("TEMPLATE_MATCHING") == {matching}
    assert listed("VERIFYING") == {verifying, failed_map}
    assert listed("OCR_PROCESSING") == {ocr_running}
    assert listed("VERIFIED") == {confirmed}

    _ready(matching, TAX)
    assert stage_of(matching) == "VERIFYING"
    assert listed("TEMPLATE_MATCHING") == set()
    assert client.get("/api/v1/ocr/jobs?stage=POSTPROCESSING").status_code == 400


def test_delete_results_removes_mappings_and_raw_result(client, monkeypatch):
    job_id = _job()
    _ready(job_id, TAX)
    _failed(job_id, BILL)
    original_lock = service.lock_job
    locked = []

    def tracked_lock(target_id):
        locked.append(target_id)
        return original_lock(target_id)

    monkeypatch.setattr(service, "lock_job", tracked_lock)
    resp = client.delete(f"/api/v1/ocr/jobs/{job_id}")
    assert resp.status_code == 200
    assert locked == [job_id]
    job = _job_row(job_id)
    assert job.current_mapping_id is None and job.pending_mapping_id is None
    assert TemplateMapping.query.filter_by(job_id=job_id).count() == 0
    assert OcrRawResult.query.filter_by(job_id=job_id).count() == 0
    assert ResultVersion.query.filter_by(job_id=job_id).count() == 0


# ---- 导出 ----


@pytest.fixture()
def stored(routes, monkeypatch):
    saved: dict[str, bytes] = {}

    def put_bytes(category, name, data, mime):
        saved[name] = data
        return f"{category}/{name}"

    monkeypatch.setattr(routes.exports.storage, "put_bytes", put_bytes)
    return saved


def _export(client, stored, job_id, fmt) -> bytes:
    resp = client.post(f"/api/v1/ocr/jobs/{job_id}/exports", json={"format": fmt})
    assert resp.status_code == 201, resp.get_json()
    return stored[f"{resp.get_json()['data']['id']}.{fmt.lower()}"]


def _xlsx_rows(data: bytes) -> list[list[str]]:
    from openpyxl import load_workbook

    ws = load_workbook(io.BytesIO(data)).active
    return [[c for c in row if c is not None] for row in ws.iter_rows(values_only=True)]


def test_template_xlsx_export_follows_template_order(client, stored):
    job_id = _job()
    structured = copy.deepcopy(EXPECTED_TAX_INVOICE)
    structured["document"]["custom_note"] = "keep me"
    _ready(job_id, TAX, structured=structured)
    rows = _xlsx_rows(_export(client, stored, job_id, "XLSX"))
    assert rows[0] == [_ver(TAX).name]
    sections = [r[0] for r in rows if len(r) == 1]
    groups = [g["name"] for g in _ver(TAX).groups]
    expected_sections = [n for n in groups if n != "Items / รายการสินค้า"]
    assert [s for s in sections[1:] if s in groups] == expected_sections
    table_title = next(s for s in sections if " · " in s)
    assert table_title.startswith(_ver(TAX).groups[3]["name"])
    pairs = {r[0]: r[1] for r in rows if len(r) == 2}
    assert pairs["Tax Invoice No. / เลขที่ใบกำกับภาษี"] == "IV00000001"
    assert pairs["Custom Note"] == "keep me"
    flat = [c for r in rows for c in r]
    assert "16,050.40" in flat and "15,000.00" in flat
    # 文档信息区在前，表格区在后（模板字段顺序与界面一致）
    assert flat.index("Tax Invoice No. / เลขที่ใบกำกับภาษี") < flat.index("IV00000001")


def test_template_csv_export_uses_template_names(client, stored):
    job_id = _job()
    _ready(job_id, TAX)
    text = _export(client, stored, job_id, "CSV").decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == ["section", "name", "value"]
    assert rows[1] == ["FIELD", "Document / ข้อมูลเอกสาร / Tax Invoice No. / เลขที่ใบกำกับภาษี", "IV00000001"]
    table = next(i for i, r in enumerate(rows) if r[0] == "TABLE")
    assert rows[table + 1][0] == "HEADER" and rows[table + 1][1] == _ver(TAX).groups[3]["items"][0]["columns"][0][
        "name"]
    net = next(r for r in rows if r[:2] == ["FIELD", "Summary / สรุปยอด / Net Total / รวมเงินสุทธิ"])
    assert net[2] == "16,050.40"


@pytest.mark.parametrize("code", [TAX, BILL, None])
def test_json_export_preserves_structure_and_download_type(routes, client, stored, monkeypatch, code):
    job_id = _job()
    if code is not None:
        content = copy.deepcopy(EXPECTED_TAX_INVOICE if code == TAX else LLM_BILLING_NOTE)
        content["document"]["synthetic_extra"] = "000123"
        content["document"]["precision_extra"] = "9007199254740993.123456789"
        _ready(job_id, code, structured=content)
    expected = copy.deepcopy(service.current_version(job_id).structured)
    generated = client.post(f"/api/v1/ocr/jobs/{job_id}/exports", json={"format": "JSON"})
    assert generated.status_code == 201
    export_id = generated.get_json()["data"]["id"]
    data = stored[f"{export_id}.json"]
    assert json.loads(data) == expected
    monkeypatch.setattr(routes.exports.storage, "exists", lambda path: True)
    monkeypatch.setattr(routes.exports.storage, "get_bytes", lambda path: stored[path.split("/")[-1]])
    downloaded = client.get(f"/api/v1/exports/{export_id}/download")
    assert downloaded.status_code == 200 and downloaded.mimetype == "application/json"
    assert ".json" in downloaded.headers["Content-Disposition"]
    assert json.loads(downloaded.data) == expected
    # TXT 的既有扩展名与内容路径保持不变。
    assert _export(client, stored, job_id, "TXT") == data


def test_generic_export_is_unchanged(routes, client, stored):
    job_id = _job()
    xlsx = _xlsx_rows(_export(client, stored, job_id, "XLSX"))
    expected = io.BytesIO()
    routes.exports._build_xlsx_structured(copy.deepcopy(RAW_TAX_INVOICE), expected, [], language="th")
    assert xlsx == _xlsx_rows(expected.getvalue())
    assert xlsx[0] == ["ข้อมูลเอกสาร"]
    text = _export(client, stored, job_id, "CSV").decode("utf-8-sig")
    assert text == routes.exports._build_csv_structured(copy.deepcopy(RAW_TAX_INVOICE)).decode("utf-8-sig")
    assert text.splitlines()[0] == "section,path,value"


@pytest.mark.parametrize("code,reply,other_code,other_reply", [
    (TAX, LLM_TAX_INVOICE, BILL, LLM_BILLING_NOTE),
    (BILL, LLM_BILLING_NOTE, TAX, LLM_TAX_INVOICE),
])
def test_isolated_mapping_review_switch_confirm_export_flow(app, client, stored, code, reply, other_code, other_reply):
    """两份系统种子的集成回归：OCR 原始结果 → 真 Worker / API / 复核 / 导出；模型全 mock。"""
    app.config.update(CONFIG)
    job_id = _job()
    if code == BILL:
        raw = OcrRawResult.query.filter_by(job_id=job_id).one()
        raw.payload = copy.deepcopy(LLM_BILLING_NOTE)
        service.current_version(job_id).structured = copy.deepcopy(LLM_BILLING_NOTE)
        db.session.commit()
    job = service.lock_job(job_id)
    auto = service.create_auto_mapping(job, _raw_id(job_id), service.current_version(job_id))
    auto_id = auto.id
    db.session.commit()
    llm = FakeLlm()
    llm.replies["match"] = [{"ranking": _cands((code, 0.93), (other_code, 0.2))}]
    llm.replies["convert"] = [reply, other_reply]
    worker = MappingWorker(app, transport=llm.transport, sleep=lambda _: None)
    worker.process(auto_id)
    data = _results(client, job_id)
    assert data["version"] == 2
    assert data["current_mapping"]["id"] == auto_id
    assert data["template_schema"]["name"] == _ver(code).name
    assert data["validation"]["required_missing"] == []

    edited = copy.deepcopy(data["structured"])
    edited["document"]["synthetic_extra"] = "keep through all switches"
    saved = _patch(client, job_id, 2, edited).get_json()["data"]
    assert saved["version"] == 3
    response = _apply_template(client, job_id, 3, other_code)
    assert response.status_code == 202
    manual_id = response.get_json()["data"]["mapping"]["id"]
    worker.process(manual_id)
    other = _results(client, job_id)
    assert other["version"] == 4 and other["current_mapping"]["id"] == manual_id
    back = _apply(client, job_id, 4, mapping_id=auto_id).get_json()["data"]
    assert back["version"] == 3 and back["structured"] == edited
    generic = _generic(client, job_id, 3).get_json()["data"]
    assert generic["version"] == 1 and generic["current_mapping"] is None
    back = _apply(client, job_id, 1, mapping_id=auto_id).get_json()["data"]
    assert back["structured"] == edited

    required_key = "invoice_no" if code == TAX else "billing_date"
    missing = copy.deepcopy(edited)
    missing["document"][required_key] = ""
    blocked = _patch(client, job_id, 3, missing, confirm=True)
    assert blocked.status_code == 422
    assert _results(client, job_id)["version"] == 3
    confirmed = _patch(client, job_id, 3, edited, confirm=True)
    assert confirmed.status_code == 200
    assert confirmed.get_json()["data"]["review_status"] == "CONFIRMED"
    assert _generic(client, job_id, 3).status_code == 409
    assert llm.stages() == ["match", "convert", "convert"]
    assert "template.match_feedback" in _action_names(job_id)
    assert _xlsx_rows(_export(client, stored, job_id, "XLSX"))[0] == [_ver(code).name]
    csv_text = _export(client, stored, job_id, "CSV").decode("utf-8-sig")
    assert "keep through all switches" in csv_text
