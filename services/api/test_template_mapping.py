"""模板匹配、转换与映射 Worker 测试（FR-OCR-018/019、FR-VERIFY-018，design D7–D12、D16）。

只使用内存 SQLite + 真实模型；DeepSeek 用 httpx.MockTransport 模拟，不导入 app.py、不连共享库、不访问网络。
单据内容全部为合成数据（不含真实客户信息）。
"""
from __future__ import annotations

import copy
import json
import socket
import uuid
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from flask import Flask

from doc_templates import converter, matcher, normalize, service
from doc_templates import repository as repo
from doc_templates.llm import (
    LLM_INVALID_OUTPUT,
    LLM_TIMEOUT,
    LLM_UNAVAILABLE,
    MAPPING_INTERRUPTED,
    MATCH_FAILED,
    RAW_RESULT_MISSING,
    RAW_TOO_LARGE,
    LlmClient,
    MappingError,
    OutputInvalid,
    parse_json,
)
from doc_templates.schema import canonical_groups, parse_template
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

SEED_DIR = Path(__file__).resolve().parent / "templates_seed"
CONFIG = {
    "DEEPSEEK_API_KEY": "synthetic-key",
    "DEEPSEEK_BASE_URL": "https://llm.invalid",
    "DEEPSEEK_MODEL": "deepseek-test",
    "DEEPSEEK_TIMEOUT_SECONDS": 30,
}


def _seed(name: str) -> dict:
    return json.loads((SEED_DIR / f"{name}.json").read_text(encoding="utf-8"))


SEED_GROUPS = {name: canonical_groups(parse_template(_seed(name))) for name in ("billing_note", "tax_invoice")}

# ---- 合成单据（虚构公司与编号） ----

RAW_TAX_INVOICE = {
    "เอกสาร": "ต้นฉบับใบกำกับภาษี / ใบส่งของ TAX INVOICE ORIGINAL",
    "เลขที่": "IV00000001",
    "วันที่": "01/10/2026",
    "ผู้ขาย": {"ชื่อ": "บริษัท ตัวอย่าง จำกัด", "เลขประจำตัวผู้เสียภาษี": "0105500000001"},
    "ลูกค้า": {"ชื่อ": "บริษัท ทดสอบ จำกัด", "เลขประจำตัวผู้เสียภาษี": "0105500000002"},
    "รายการ": [
        {"ลำดับ": "1", "รายการสินค้า": "แผ่นทดสอบ A", "จำนวน": "1,200", "หน่วย": "แผ่น", "ราคา": "12.5",
         "จำนวนเงิน": "15,000.00"},
        {"ลำดับ": "2", "รายการสินค้า": "แผ่นทดสอบ B", "จำนวน": "3", "หน่วย": "กล่อง", "ราคา": "0.125",
         "จำนวนเงิน": "0.375"},
    ],
    "รวมเงินสุทธิ": "฿ 16,050.40",
}

LLM_TAX_INVOICE = {
    "document": {"invoice_no": "IV00000001", "invoice_date": "01/10/2026",
                 "document_title": "ต้นฉบับใบกำกับภาษี / ใบส่งของ TAX INVOICE ORIGINAL",
                 "customer_code": "", "payment_term": "30 วัน", "unknown_extra": "drop me"},
    "seller": {"name": "บริษัท ตัวอย่าง จำกัด", "tax_id": "0105500000001", "branch": "สำนักงานใหญ่"},
    "buyer": {"name": "บริษัท ทดสอบ จำกัด", "tax_id": "0105500000002"},
    "goods": {"line_items": [
        {"seq": "1", "description": "แผ่นทดสอบ A", "quantity": "1,200", "unit": "แผ่น", "unit_price": "12.5",
         "amount": "15,000.00"},
        {"seq": None, "description": None, "quantity": None, "amount": None},
        {"seq": 2, "description": "แผ่นทดสอบ B", "quantity": "3", "unit": "กล่อง", "unit_price": "0.125",
         "amount": "0.375", "note": "extra column"},
    ]},
    "summary": {"sub_total": "15,000.375", "vat_rate": "7%", "vat_amount": "1,050.03",
                "net_total": "฿ 16,050.40", "amount_in_words": "(หนึ่งหมื่นหกพันห้าสิบบาทสี่สิบสตางค์)"},
    "delivery": {},
    "stray_group": {"x": 1},
}

EXPECTED_TAX_INVOICE = {
    "document": {"invoice_no": "IV00000001", "invoice_date": "01/10/2026",
                 "document_title": "ต้นฉบับใบกำกับภาษี / ใบส่งของ TAX INVOICE ORIGINAL",
                 "customer_code": None, "customer_po_no": None, "salesman": None, "payment_term": "30 วัน",
                 "due_date": None},
    "seller": {"name": "บริษัท ตัวอย่าง จำกัด", "name_en": None, "tax_id": "0105500000001",
               "branch": "สำนักงานใหญ่", "address": None, "phone": None, "fax": None},
    "buyer": {"name": "บริษัท ทดสอบ จำกัด", "tax_id": "0105500000002", "branch": None, "address": None},
    "goods": {"line_items": [
        {"seq": 1, "product_code": None, "description": "แผ่นทดสอบ A", "po_no": None, "quantity": "1200",
         "unit": "แผ่น", "unit_price": "12.5", "discount": None, "amount": "15000.00"},
        {"seq": 2, "product_code": None, "description": "แผ่นทดสอบ B", "po_no": None, "quantity": "3",
         "unit": "กล่อง", "unit_price": "0.125", "discount": None, "amount": "0.375"},
    ]},
    "summary": {"sub_total": "15000.375", "discount_rate": None, "discount_amount": None, "total_before_vat": None,
                "vat_rate": "7%", "vat_amount": "1050.03", "net_total": "16050.40",
                "amount_in_words": "(หนึ่งหมื่นหกพันห้าสิบบาทสี่สิบสตางค์)"},
    "delivery": {"delivered_by": None, "delivery_date": None, "vehicle_no": None, "received_by": None,
                 "received_date": None},
    "other": {"remark": None},
}

LLM_BILLING_NOTE = {
    "document": {"billing_no": "BN-0001", "billing_date": "22.02.2026", "invoice_count": "1"},
    "issuer": {"name": "ห้างหุ้นส่วนจำกัด ตัวอย่างดิสทริบิวเตอร์", "tax_id": "0105500000003"},
    "customer": {"name": "บริษัท ทดสอบ จำกัด"},
    "invoices": {"items": [
        {"item_no": "1", "invoice_date": "21.02.2026", "invoice_no": "INV0001", "amount_before_vat": "6,230.20",
         "vat_amount": "436.11", "total_amount": "6,666.31 บาท"},
    ]},
    "summary": {"total_amount": "6,666.31"},
    "payment": {"bank_name": "ธนาคาร ตัวอย่าง", "account_no": "0000000000"},
}


# ---- 夹具 ----


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("template mapping tests must not open network connections")

    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


@pytest.fixture()
def app():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_ENGINE_OPTIONS={},
                      TEMPLATE_MAPPING_ENABLED=True, **CONFIG)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=7, tenant_type="PERSONAL", display_name="t7"))
        db.session.add(Tenant(id=8, tenant_type="PERSONAL", display_name="t8"))
        db.session.add(User(id=1, line_provider="dev", line_sub="synthetic-1", display_name="Synthetic"))
        db.session.add(File(id="f" * 32, tenant_id=7, created_by_user_id=1, uploader_user_id=1,
                            original_name="synthetic.pdf", storage_path="files/synthetic.pdf", status="READY",
                            page_count=1))
        db.session.commit()
        repo.import_template(_seed("billing_note"))
        repo.import_template(_seed("tax_invoice"))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


class FakeLlm:
    """按系统提示词区分匹配 / 转换阶段，依次返回预置回复。"""

    def __init__(self) -> None:
        self.replies: dict[str, list] = {"match": [], "convert": []}
        self.requests: list[tuple[str, dict, httpx.Request]] = []
        self.hooks: dict[str, object] = {}
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        stage = "match" if "单据分类助手" in body["messages"][0]["content"] else "convert"
        self.requests.append((stage, body, request))
        hook = self.hooks.pop(stage, None)
        if hook is not None:
            hook()
        if not self.replies[stage]:
            raise AssertionError(f"unexpected {stage} call")
        reply = self.replies[stage].pop(0)
        if reply == "TIMEOUT":
            raise httpx.ReadTimeout("synthetic timeout", request=request)
        if reply == "CONNECT":
            raise httpx.ConnectError("synthetic connect error", request=request)
        if isinstance(reply, int):
            return httpx.Response(reply, json={"error": "synthetic"})
        content = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 40},
        })

    def stages(self) -> list[str]:
        return [s for s, _, _ in self.requests]


@pytest.fixture()
def llm():
    return FakeLlm()


@pytest.fixture()
def sleeps():
    return []


@pytest.fixture()
def worker(app, llm, sleeps):
    return MappingWorker(app, transport=llm.transport, sleep=sleeps.append)


def _tpl(code: str) -> DocumentTemplate:
    return DocumentTemplate.query.filter_by(code=code, tenant_id=None).one()


def _ver_id(code: str) -> int:
    return repo.current_version(_tpl(code)).id


def _make_job(raw=None, *, auto=True, review_status="UNREVIEWED"):
    job = OcrJob(tenant_id=7, created_by_user_id=1, file_id="f" * 32, status="SUCCEEDED", review_status=review_status)
    db.session.add(job)
    db.session.flush()
    raw_row = OcrRawResult(id=uuid.uuid4().hex, job_id=job.id, payload=copy.deepcopy(raw or RAW_TAX_INVOICE))
    v1 = ResultVersion(job_id=job.id, version=1, is_current=True, structured=copy.deepcopy(raw or RAW_TAX_INVOICE))
    db.session.add_all([raw_row, v1])
    db.session.flush()
    mapping = service.create_auto_mapping(job, raw_row.id, v1) if auto else None
    db.session.commit()
    return job.id, (mapping.id if mapping else None), v1.id, raw_row.id


def _reload(model, ident):
    db.session.expire_all()
    return db.session.get(model, ident)


def _ranking(*entries):
    return {"ranking": [{"template_version_id": v, "score": s, "reason": r} for v, s, r in entries]}


def _actions(job_id: str) -> list[str]:
    db.session.expire_all()
    return [a.action for a in AuditEvent.query.filter_by(object_id=job_id).order_by(AuditEvent.id).all()]


# ---- LlmClient ----


def _client(llm, sleeps, **over):
    return LlmClient({**CONFIG, **over}, transport=llm.transport, sleep=sleeps.append)


def _stage(client):
    return client.run_stage("convert", [{"role": "system", "content": "单据数据录入助手"}],
                            parse_json, invalid_code=LLM_INVALID_OUTPUT)


def test_llm_success_request_shape_and_usage(llm, sleeps):
    llm.replies["convert"] = [{"a": "1.50"}]
    client = _client(llm, sleeps)
    assert _stage(client) == {"a": "1.50"}
    _, body, request = llm.requests[0]
    assert str(request.url) == "https://llm.invalid/chat/completions"
    assert request.headers["Authorization"] == "Bearer synthetic-key"
    assert body["temperature"] == 0 and body["model"] == "deepseek-test"
    assert "response_format" not in body
    assert (client.usage.calls, client.usage.prompt_tokens, client.usage.completion_tokens) == (1, 100, 40)
    assert sleeps == []


@pytest.mark.parametrize("first", ["TIMEOUT", "CONNECT", 429, 500, 503, "not json at all"])
def test_llm_retries_once_after_transient_or_invalid(llm, sleeps, first):
    llm.replies["convert"] = [first, {"ok": True}]
    client = _client(llm, sleeps)
    assert _stage(client) == {"ok": True}
    assert client.usage.calls == 2 and sleeps == [2.0]


@pytest.mark.parametrize("replies, code", [
    (["TIMEOUT", "TIMEOUT"], LLM_TIMEOUT),
    (["CONNECT", 502], LLM_UNAVAILABLE),
    ([429, 429], LLM_UNAVAILABLE),
    (["bad", "still bad"], LLM_INVALID_OUTPUT),
])
def test_llm_gives_up_after_two_calls(llm, sleeps, replies, code):
    llm.replies["convert"] = list(replies)
    client = _client(llm, sleeps)
    with pytest.raises(MappingError) as exc:
        _stage(client)
    assert exc.value.code == code
    assert client.usage.calls == 2 and sleeps == [2.0]


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_llm_non_retryable_4xx_fails_immediately(llm, sleeps, status):
    llm.replies["convert"] = [status]
    client = _client(llm, sleeps)
    with pytest.raises(MappingError) as exc:
        _stage(client)
    assert exc.value.code == LLM_UNAVAILABLE
    assert client.usage.calls == 1 and sleeps == []


def test_llm_invalid_output_sends_repair_message(llm, sleeps):
    llm.replies["convert"] = ["这不是 JSON", {"fixed": 1}]
    _stage(_client(llm, sleeps))
    first, second = llm.requests[0][1]["messages"], llm.requests[1][1]["messages"]
    assert len(first) == 1
    assert second[-2] == {"role": "assistant", "content": "这不是 JSON"}
    assert second[-1]["role"] == "user" and "不合法" in second[-1]["content"]


def test_llm_not_configured_never_calls(llm, sleeps):
    client = _client(llm, sleeps, DEEPSEEK_API_KEY="")
    with pytest.raises(MappingError) as exc:
        _stage(client)
    assert exc.value.code == LLM_UNAVAILABLE and llm.requests == []


@pytest.mark.parametrize("content, expected", [
    ('{"a": 1.10, "b": 2}', {"a": "1.10", "b": 2}),
    ('```json\n{"a": 1}\n```', {"a": 1}),
    ('结果如下：{"a": "x"} 以上', {"a": "x"}),
])
def test_parse_json_keeps_decimals_as_text(content, expected):
    assert parse_json(content) == expected


@pytest.mark.parametrize("content", ["", "[1, 2", "no braces"])
def test_parse_json_rejects_garbage(content):
    with pytest.raises(OutputInvalid):
        parse_json(content)


# ---- matcher ----


def _cands(n=2):
    return [matcher.Candidate(100 + i, 200 + i, f"T{i}", f"desc {i}", SEED_GROUPS["tax_invoice"]) for i in range(n)]


def test_match_zero_candidates_fails(llm, sleeps):
    with pytest.raises(MappingError) as exc:
        matcher.match(_client(llm, sleeps), RAW_TAX_INVOICE, [])
    assert exc.value.code == MATCH_FAILED


def test_match_single_candidate_skips_llm(llm, sleeps):
    result = matcher.match(_client(llm, sleeps), RAW_TAX_INVOICE, _cands(1))
    assert (result.template_version_id, result.score, result.reason) == (200, None, "single_candidate")
    assert llm.requests == []


def test_match_picks_top_whitelisted_candidate(llm, sleeps):
    llm.replies["match"] = [_ranking((999, 0.99, "not a candidate"), (200, 0.4, "weak"), (201, 0.9, "strong"))]
    result = matcher.match(_client(llm, sleeps), RAW_TAX_INVOICE, _cands(2))
    assert (result.template_id, result.template_version_id, result.score) == (101, 201, 0.9)
    assert [r["template_version_id"] for r in result.ranking] == [201, 200]
    user = llm.requests[0][1]["messages"][1]["content"]
    assert "<<<DOCUMENT" in user and "DOCUMENT>>>" in user
    assert "指令" in llm.requests[0][1]["messages"][0]["content"]  # 防注入提示


def test_parse_ranking_clamps_dedupes_and_limits():
    wl = {c.template_version_id: c for c in _cands(5)}
    ranking = matcher.parse_ranking(json.dumps(_ranking(
        (200, 1.7, "x" * 300), (200, 0.1, "dup"), ("201", -0.2, "neg"), (202, 0.5, 1), (203, 0.6, "a"),
        (204, "nan", "bad score"), (True, 0.9, "bool id"),
    )), wl)
    assert [(r["template_version_id"], r["score"]) for r in ranking] == [(200, 1.0), (203, 0.6), (202, 0.5)]
    assert len(ranking[0]["reason"]) == 255 and ranking[2]["reason"] == ""


@pytest.mark.parametrize("content", [
    json.dumps({"ranking": []}), json.dumps({"ranking": [{"template_version_id": 999, "score": 1}]}),
    json.dumps({"rank": 1}), json.dumps([1, 2]),
])
def test_parse_ranking_without_valid_entries_is_invalid(content):
    with pytest.raises(OutputInvalid):
        matcher.parse_ranking(content, {c.template_version_id: c for c in _cands(2)})


def test_match_all_invalid_twice_is_match_failed(llm, sleeps):
    llm.replies["match"] = [_ranking((999, 1, "")), "garbage"]
    with pytest.raises(MappingError) as exc:
        matcher.match(_client(llm, sleeps), RAW_TAX_INVOICE, _cands(2))
    assert exc.value.code == MATCH_FAILED and len(llm.requests) == 2


def test_compact_raw_limit_is_not_truncated():
    ok = {"t": "x" * (matcher.MAX_RAW_CHARS - 8)}
    assert len(matcher.compact_raw(ok)) == matcher.MAX_RAW_CHARS
    with pytest.raises(MappingError) as exc:
        matcher.compact_raw({"t": "x" * matcher.MAX_RAW_CHARS})
    assert exc.value.code == RAW_TOO_LARGE


def test_catalog_is_compact_and_capped():
    cands = _cands(60)
    cands[0].groups = [{"key": "g", "name": "G", "description": "d" * 500,
                        "items": [{"kind": "field", "key": "a", "name": "A", "description": "x" * 500}]}]
    catalog = matcher.build_catalog(cands)
    assert len(catalog) == matcher.MAX_CATALOG
    assert len(catalog[0]["groups"][0]["description"]) == matcher.DESC_LIMIT
    assert len(catalog[0]["groups"][0]["items"][0]["description"]) == matcher.DESC_LIMIT
    assert "type" not in catalog[0]["groups"][0]["items"][0]


def test_match_with_too_large_raw_never_calls_llm(llm, sleeps):
    with pytest.raises(MappingError) as exc:
        matcher.match(_client(llm, sleeps), {"t": "x" * 70000}, _cands(2))
    assert exc.value.code == RAW_TOO_LARGE and llm.requests == []


# ---- converter / normalize ----


def test_skeleton_and_guide_follow_template():
    groups = SEED_GROUPS["tax_invoice"]
    sk = converter.skeleton(groups)
    assert list(sk) == [g["key"] for g in groups]
    assert sk["goods"]["line_items"][0]["amount"] is None and sk["document"]["invoice_no"] is None
    guide = converter.field_guide(groups)
    assert "document.invoice_no" in guide and "必填" in guide and "金额" in guide


def test_convert_messages_contain_skeleton_and_document():
    msgs = converter.build_messages('{"a":1}', "Tax Invoice", SEED_GROUPS["tax_invoice"])
    assert msgs[0]["role"] == "system" and "null" in msgs[0]["content"]
    assert '"line_items"' in msgs[1]["content"] and "<<<DOCUMENT\n{\"a\":1}\nDOCUMENT>>>" in msgs[1]["content"]


def test_parse_output_extracts_per_schema_and_normalizes():
    structured, warnings, dropped = converter.parse_output(
        json.dumps(LLM_TAX_INVOICE, ensure_ascii=False), SEED_GROUPS["tax_invoice"])
    assert structured == EXPECTED_TAX_INVOICE
    assert warnings == [{"path": "goods.line_items[1].amount", "code": normalize.AMOUNT_PRECISION},
                        {"path": "summary.sub_total", "code": normalize.AMOUNT_PRECISION}]
    assert dropped == 3  # stray_group + unknown_extra + note
    # 键顺序与模板一致
    assert list(structured["seller"]) == [i["key"] for i in SEED_GROUPS["tax_invoice"][1]["items"]]


@pytest.mark.parametrize("payload", [
    [1, 2],
    {"document": "not an object"},
    {"goods": {"line_items": {"seq": 1}}},
    {"goods": {"line_items": ["row"]}},
    {"document": {"invoice_no": {"nested": True}}},
    {"goods": {"line_items": [{"seq": 1}] * 501}},
])
def test_parse_output_rejects_structurally_invalid(payload):
    with pytest.raises(OutputInvalid):
        converter.parse_output(json.dumps(payload), SEED_GROUPS["tax_invoice"])


def test_parse_output_accepts_exactly_500_rows():
    rows = [{"seq": i, "description": "x", "amount": "1"} for i in range(500)]
    structured, _, _ = converter.parse_output(json.dumps({"goods": {"line_items": rows}}), SEED_GROUPS["tax_invoice"])
    assert len(structured["goods"]["line_items"]) == 500


@pytest.mark.parametrize("ftype, value, expected", [
    ("integer", "1,200", (1200, None)),
    ("integer", "-3", (-3, None)),
    ("integer", "7.00", (7, None)),
    ("integer", 12, (12, None)),
    ("integer", "1.5", ("1.5", normalize.TYPE_MISMATCH)),
    ("integer", "9007199254740993", ("9007199254740993", normalize.TYPE_MISMATCH)),
    ("integer", "abc", ("abc", normalize.TYPE_MISMATCH)),
    ("integer", True, (True, normalize.TYPE_MISMATCH)),
    ("decimal", "0012.50", ("12.50", None)),
    ("decimal", "1,234.567890", ("1234.567890", None)),
    ("decimal", "-0.00", ("0.00", None)),
    ("decimal", 0.1, ("0.1", None)),
    ("decimal", 1e20, (1e20, normalize.TYPE_MISMATCH)),
    ("amount", "฿ 1,050.5", ("1050.50", None)),
    ("amount", "6,666.31 บาท", ("6666.31", None)),
    ("amount", "THB 10", ("10.00", None)),
    ("amount", "-25", ("-25.00", None)),
    ("amount", "1.005", ("1.005", normalize.AMOUNT_PRECISION)),
    ("amount", "12%", ("12%", normalize.TYPE_MISMATCH)),
    ("amount", "   ", (None, None)),
    ("amount", None, (None, None)),
    ("string", "  text  ", ("text", None)),
    ("string", "", (None, None)),
    ("string", 15, ("15", None)),
])
def test_normalize_value(ftype, value, expected):
    assert normalize.normalize_value(ftype, value) == expected


def test_fill_structure_required_and_type_warnings():
    groups = SEED_GROUPS["tax_invoice"]
    edited = {"document": {"invoice_no": "IV1", "custom": "keep"},
              "goods": {"line_items": [{"amount": "x", "extra": 1}, {"description": "d", "amount": "1.00"}]},
              "user_group": {"k": "v"}}
    filled = normalize.fill_structure(groups, edited)
    assert filled["document"]["custom"] == "keep" and filled["user_group"] == {"k": "v"}
    assert filled["document"]["due_date"] is None and filled["other"] == {"remark": None}
    assert list(filled["goods"]["line_items"][0])[-1] == "extra"
    missing = normalize.required_missing(groups, filled)
    assert "document.invoice_date" in missing and "seller.name" in missing
    assert "goods.line_items[0].description" in missing and "goods.line_items[1].description" not in missing
    assert "document.invoice_no" not in missing
    assert normalize.type_warnings(groups, filled) == [
        {"path": "goods.line_items[0].amount", "code": normalize.TYPE_MISMATCH}]
    assert normalize.required_missing(groups, EXPECTED_TAX_INVOICE) == []


def test_golden_billing_note_conversion():
    structured, warnings, dropped = converter.parse_output(
        json.dumps(LLM_BILLING_NOTE, ensure_ascii=False), SEED_GROUPS["billing_note"])
    assert warnings == [] and dropped == 0
    assert structured["document"]["invoice_count"] == 1
    assert structured["invoices"]["items"] == [{
        "item_no": 1, "invoice_date": "21.02.2026", "invoice_no": "INV0001", "product": None,
        "delivery_date": None, "amount_before_vat": "6230.20", "vat_amount": "436.11", "total_amount": "6666.31",
    }]
    assert structured["summary"] == {"total_amount": "6666.31", "total_amount_text": None}
    assert normalize.required_missing(SEED_GROUPS["billing_note"], structured) == []


# ---- service ----


def test_auto_mapping_only_when_templates_available(app):
    job_id, mapping_id, _v1, _ = _make_job()
    job = _reload(OcrJob, job_id)
    assert job.pending_mapping_id == mapping_id and job.current_mapping_id is None
    for tpl in DocumentTemplate.query.all():
        repo.set_status(tpl.id, "DISABLED")
    db.session.commit()
    _, none_id, _, _ = _make_job()
    assert none_id is None


def test_version_numbers_are_max_plus_one(app):
    job_id, _, _v1, _ = _make_job(auto=False)
    db.session.add(ResultVersion(job_id=job_id, version=5, is_current=False, structured={}))
    db.session.commit()
    assert service.next_version_no(job_id) == 6


def test_delete_for_job_clears_pointers(app):
    job_id, _mapping_id, _, _ = _make_job()
    service.delete_for_job(job_id)
    db.session.commit()
    job = _reload(OcrJob, job_id)
    assert job.pending_mapping_id is None
    assert TemplateMapping.query.filter_by(job_id=job_id).count() == 0
    assert OcrRawResult.query.filter_by(job_id=job_id).count() == 0


# ---- mapping worker ----


def test_worker_matches_converts_and_auto_applies(app, worker, llm, sleeps):
    job_id, mapping_id, v1, _ = _make_job()
    tax_ver = _ver_id("system.tax_invoice")
    llm.replies["match"] = [_ranking((tax_ver, 0.92, "tax invoice title"), (_ver_id("system.billing_note"), 0.2, "no"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]
    assert worker.next_pending() == mapping_id
    worker.process(mapping_id)

    assert llm.stages() == ["match", "convert"] and sleeps == []
    mapping = _reload(TemplateMapping, mapping_id)
    assert mapping.status == service.READY and mapping.error_code == ""
    assert (mapping.template_id, mapping.template_version_id) == (_tpl("system.tax_invoice").id, tax_ver)
    assert mapping.match_score == 0.92 and mapping.match_reason == "tax invoice title"
    assert [c["template_version_id"] for c in mapping.candidates] == [tax_ver, _ver_id("system.billing_note")]
    assert (mapping.llm_calls, mapping.prompt_tokens, mapping.completion_tokens) == (2, 200, 80)
    assert mapping.model == "deepseek-test" and mapping.prompt_version == "match-v1+convert-v1"
    assert mapping.dropped_keys == 3 and len(mapping.warnings) == 2
    assert mapping.started_at is not None and mapping.finished_at is not None

    job = _reload(OcrJob, job_id)
    current = service.current_version(job_id)
    assert job.current_mapping_id == mapping_id and job.pending_mapping_id is None
    assert current.id == mapping.result_version_id and current.version == 2 and current.mapping_id == mapping_id
    assert current.structured == EXPECTED_TAX_INVOICE
    assert _reload(ResultVersion, v1).is_current is False
    assert job.table_count >= 1 and job.field_count > 0
    assert _actions(job_id) == ["template.applied"]
    assert worker.next_pending() is None


def test_worker_single_candidate_skips_match_call(app, worker, llm):
    repo.set_status(_tpl("system.billing_note").id, "DISABLED")
    db.session.commit()
    _job_id, mapping_id, _, _ = _make_job()
    llm.replies["convert"] = [LLM_TAX_INVOICE]
    worker.process(mapping_id)
    assert llm.stages() == ["convert"]
    mapping = _reload(TemplateMapping, mapping_id)
    assert mapping.status == service.READY and mapping.match_reason == "single_candidate"
    assert mapping.match_score is None and mapping.prompt_version == "convert-v1" and mapping.llm_calls == 1


def test_claim_happens_only_once(app, worker, llm):
    _job_id, mapping_id, _, _ = _make_job()
    assert worker._claim(mapping_id) == service.MATCHING
    assert worker._claim(mapping_id) is None
    worker.process(mapping_id)  # 已被认领：不调用大模型、不改状态
    assert llm.requests == []
    assert _reload(TemplateMapping, mapping_id).status == service.MATCHING


def test_manual_mapping_with_version_goes_straight_to_converting(app, worker, llm):
    job_id, _, v1, raw_id = _make_job(auto=False)
    job = service.lock_job(job_id)
    tpl = _tpl("system.billing_note")
    m = service.create_mapping(job, raw_id, source=service.MANUAL, base_version_id=v1, template_id=tpl.id,
                               template_version_id=repo.current_version(tpl).id, user_id=1)
    db.session.commit()
    llm.replies["convert"] = [LLM_BILLING_NOTE]
    worker.process(m.id)
    assert llm.stages() == ["convert"]
    mapping = _reload(TemplateMapping, m.id)
    assert mapping.status == service.READY and mapping.match_reason == ""
    assert _reload(OcrJob, job_id).current_mapping_id == m.id
    audit = AuditEvent.query.filter_by(object_id=job_id, action="template.applied").one()
    assert audit.user_id == 1 and audit.detail["source"] == service.MANUAL


def test_user_edit_during_conversion_keeps_mapping_unapplied(app, worker, llm):
    job_id, mapping_id, v1, _ = _make_job()
    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]

    def user_saves():
        with app.app_context():
            old = db.session.get(ResultVersion, v1)
            old.is_current = False
            db.session.flush()
            db.session.add(ResultVersion(job_id=job_id, version=service.next_version_no(job_id), is_current=True,
                                         created_by_user_id=1, structured={"edited": True}))
            db.session.get(OcrJob, job_id).review_status = "EDITED"
            db.session.commit()

    llm.hooks["convert"] = user_saves
    worker.process(mapping_id)
    mapping = _reload(TemplateMapping, mapping_id)
    job = _reload(OcrJob, job_id)
    current = service.current_version(job_id)
    assert mapping.status == service.READY
    assert current.structured == {"edited": True} and current.version == 2
    assert _reload(ResultVersion, mapping.result_version_id).version == 3
    assert job.current_mapping_id is None and job.pending_mapping_id is None
    assert "template.applied" not in _actions(job_id)


def test_confirmed_job_is_converted_but_not_applied(app, worker, llm):
    job_id, mapping_id, v1, _ = _make_job(review_status="CONFIRMED")
    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]
    worker.process(mapping_id)
    assert _reload(TemplateMapping, mapping_id).status == service.READY
    assert service.current_version(job_id).id == v1
    assert _reload(OcrJob, job_id).current_mapping_id is None


def test_newer_request_supersedes_auto_apply(app, worker, llm):
    job_id, mapping_id, v1, raw_id = _make_job()
    job = service.lock_job(job_id)
    tpl = _tpl("system.billing_note")
    newer = service.create_mapping(job, raw_id, source=service.MANUAL, base_version_id=v1, template_id=tpl.id,
                                   template_version_id=repo.current_version(tpl).id, user_id=1)
    db.session.commit()
    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]
    worker.process(mapping_id)
    assert _reload(TemplateMapping, mapping_id).status == service.READY
    job = _reload(OcrJob, job_id)
    assert job.current_mapping_id is None and job.pending_mapping_id == newer.id


def test_results_deleted_mid_run_writes_nothing(app, worker, llm):
    job_id, mapping_id, _v1, _ = _make_job()
    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]

    def delete_results():
        with app.app_context():
            ResultVersion.query.filter_by(job_id=job_id).delete(synchronize_session=False)
            service.delete_for_job(job_id)
            db.session.commit()

    llm.hooks["convert"] = delete_results
    worker.process(mapping_id)
    db.session.expire_all()
    assert ResultVersion.query.filter_by(job_id=job_id).count() == 0
    assert TemplateMapping.query.filter_by(job_id=job_id).count() == 0
    assert _actions(job_id) == []


def test_results_deleted_before_match_aborts(app, worker, llm):
    job_id, mapping_id, _, _ = _make_job()

    def delete_results():
        with app.app_context():
            ResultVersion.query.filter_by(job_id=job_id).delete(synchronize_session=False)
            service.delete_for_job(job_id)
            db.session.commit()

    llm.hooks["match"] = delete_results
    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    worker.process(mapping_id)
    assert llm.stages() == ["match"]
    assert TemplateMapping.query.filter_by(job_id=job_id).count() == 0


@pytest.mark.parametrize("match_replies, convert_replies, code, calls", [
    (["garbage", _ranking((999, 1, ""))], [], MATCH_FAILED, 2),
    (["TIMEOUT", "TIMEOUT"], [], LLM_TIMEOUT, 2),
    ([401], [], LLM_UNAVAILABLE, 1),
    (None, ["bad", ["not", "object"]], LLM_INVALID_OUTPUT, 3),
    (None, [503, 503], LLM_UNAVAILABLE, 3),
])
def test_worker_failures_mark_failed_and_clear_pending(app, worker, llm, sleeps, match_replies, convert_replies,
                                                        code, calls):
    job_id, mapping_id, v1, _ = _make_job()
    llm.replies["match"] = match_replies or [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    llm.replies["convert"] = list(convert_replies)
    worker.process(mapping_id)
    mapping = _reload(TemplateMapping, mapping_id)
    assert mapping.status == service.FAILED and mapping.error_code == code
    assert mapping.llm_calls == calls and mapping.finished_at is not None
    job = _reload(OcrJob, job_id)
    assert job.pending_mapping_id is None and job.current_mapping_id is None
    assert service.current_version(job_id).id == v1
    assert _actions(job_id) == ["template.mapping_failed"]
    assert AuditEvent.query.filter_by(object_id=job_id).one().detail["result"] == code


def test_worker_raw_too_large_fails_without_llm(app, worker, llm):
    _job_id, mapping_id, _, _ = _make_job(raw={"t": "x" * 70000})
    worker.process(mapping_id)
    mapping = _reload(TemplateMapping, mapping_id)
    assert (mapping.status, mapping.error_code, mapping.llm_calls) == (service.FAILED, RAW_TOO_LARGE, 0)
    assert llm.requests == []


def test_worker_raw_missing(app, worker, llm):
    _job_id, mapping_id, _, raw_id = _make_job()
    OcrRawResult.query.filter_by(id=raw_id).delete(synchronize_session=False)
    db.session.commit()
    worker.process(mapping_id)
    assert _reload(TemplateMapping, mapping_id).error_code == RAW_RESULT_MISSING
    assert llm.requests == []


def test_worker_without_llm_config_fails_unavailable(app, llm, sleeps):
    _job_id, mapping_id, _, _ = _make_job()
    app.config["DEEPSEEK_API_KEY"] = ""
    MappingWorker(app, transport=llm.transport, sleep=sleeps.append).process(mapping_id)
    assert _reload(TemplateMapping, mapping_id).error_code == LLM_UNAVAILABLE
    assert llm.requests == []


def test_worker_unexpected_error_is_interrupted(app, worker, llm, monkeypatch):
    _job_id, mapping_id, _, _ = _make_job()
    monkeypatch.setattr(matcher, "match", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    worker.process(mapping_id)
    mapping = _reload(TemplateMapping, mapping_id)
    assert mapping.status == service.FAILED and mapping.error_code == MAPPING_INTERRUPTED
    assert "boom" not in mapping.error_message


def test_recover_stale_only_touches_old_in_progress(app, worker):
    old_id = _make_job()[1]
    fresh_id = _make_job()[1]
    pending_id = _make_job()[1]
    stamp = service.now()
    TemplateMapping.query.filter_by(id=old_id).update(
        {"status": service.CONVERTING, "updated_at": stamp - timedelta(minutes=11)}, synchronize_session=False)
    TemplateMapping.query.filter_by(id=fresh_id).update(
        {"status": service.MATCHING, "updated_at": stamp - timedelta(minutes=2)}, synchronize_session=False)
    TemplateMapping.query.filter_by(id=pending_id).update(
        {"updated_at": stamp - timedelta(hours=1)}, synchronize_session=False)
    db.session.commit()

    assert worker.recover_stale() == 1
    old = _reload(TemplateMapping, old_id)
    assert (old.status, old.error_code) == (service.FAILED, MAPPING_INTERRUPTED)
    assert _reload(OcrJob, old.job_id).pending_mapping_id is None
    assert _reload(TemplateMapping, fresh_id).status == service.MATCHING
    assert _reload(TemplateMapping, pending_id).status == service.PENDING
    assert worker.recover_stale() == 0


def test_tenant_template_is_a_candidate_only_for_its_tenant(app, worker, llm):
    tenant_tpl = copy.deepcopy(_seed("billing_note"))
    tenant_tpl["code"] = "t8.billing"
    repo.import_template(tenant_tpl, tenant_id=8)
    db.session.commit()
    _job_id, mapping_id, _, _ = _make_job()  # tenant 7 只看到两个系统模板
    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.9, "x"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]
    worker.process(mapping_id)
    catalog_text = llm.requests[0][1]["messages"][1]["content"]
    catalog = json.loads(catalog_text.split("\n", 1)[1].split("\n\n", 1)[0])
    assert sorted(c["template_version_id"] for c in catalog) == sorted(
        [_ver_id("system.tax_invoice"), _ver_id("system.billing_note")])


# ---- OCR Worker 集成（真实 _process_inner，供应商与存储打桩） ----


def _run_ocr(app, monkeypatch, *, enabled: bool):
    import deepseek
    import storage
    import worker as ocr_worker
    from textin import adapter

    app.config["TEMPLATE_MAPPING_ENABLED"] = enabled
    app.extensions["textin_client"] = object()
    monkeypatch.setattr(storage, "exists", lambda path: True)
    monkeypatch.setattr(storage, "get_bytes", lambda path: b"%PDF synthetic")
    monkeypatch.setattr(storage, "put_bytes", lambda *a, **k: "audit/x.json")
    refined = []
    monkeypatch.setattr(deepseek, "refine_json", lambda data, cfg: refined.append(data) or {"refined": True})
    monkeypatch.setattr(adapter, "run_extraction", lambda client, **kw: {
        "vendor": "textin", "page_count": 1, "duration_ms": 5, "structured": copy.deepcopy(RAW_TAX_INVOICE),
        "missing_pages": [], "table_count": 1, "field_count": 4, "field_source": "prompt",
    })
    job = OcrJob(tenant_id=7, created_by_user_id=1, file_id="f" * 32, status="QUEUED")
    db.session.add(job)
    db.session.commit()
    job_id = job.id
    ocr_worker.OcrWorker(app)._process(job_id)
    db.session.expire_all()
    return job_id, refined


def test_ocr_worker_flag_on_saves_raw_and_queues_auto_mapping(app, monkeypatch, worker, llm):
    job_id, refined = _run_ocr(app, monkeypatch, enabled=True)
    job = db.session.get(OcrJob, job_id)
    assert job.status == "SUCCEEDED" and refined == []  # 开关开启时不做 DeepSeek 整理
    raw = OcrRawResult.query.filter_by(job_id=job_id).one()
    v1 = service.current_version(job_id)
    assert raw.payload == RAW_TAX_INVOICE and v1.structured == RAW_TAX_INVOICE and v1.version == 1
    mapping = TemplateMapping.query.filter_by(job_id=job_id).one()
    assert job.pending_mapping_id == mapping.id and mapping.base_version_id == v1.id
    assert (mapping.source, mapping.status, mapping.raw_result_id) == (service.AUTO, service.PENDING, raw.id)

    llm.replies["match"] = [_ranking((_ver_id("system.tax_invoice"), 0.95, "title"))]
    llm.replies["convert"] = [LLM_TAX_INVOICE]
    worker.process(worker.next_pending())
    current = service.current_version(job_id)
    assert current.version == 2 and current.structured == EXPECTED_TAX_INVOICE
    assert _reload(OcrRawResult, raw.id).payload == RAW_TAX_INVOICE  # 原始结果不变


def test_ocr_worker_flag_off_keeps_refine_and_creates_no_mapping(app, monkeypatch):
    job_id, refined = _run_ocr(app, monkeypatch, enabled=False)
    job = db.session.get(OcrJob, job_id)
    assert job.status == "SUCCEEDED" and refined == [RAW_TAX_INVOICE]
    assert service.current_version(job_id).structured == {"refined": True}
    assert OcrRawResult.query.filter_by(job_id=job_id).one().payload == RAW_TAX_INVOICE
    assert TemplateMapping.query.count() == 0 and job.pending_mapping_id is None
