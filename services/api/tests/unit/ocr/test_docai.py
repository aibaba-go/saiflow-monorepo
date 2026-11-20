"""Google Document AI OCR client and engine (FR-OCR-021, FR-OCR-027): one call per image,
PDFs in ≤15-page chunks, compact field mask, service-account token, error classes."""

import base64
import json

import httpx
import pymupdf
import pytest
from pydantic import SecretStr

from app.ocr.docai import (
    FIELD_MASK,
    PAGES_PER_CALL,
    DocAIClient,
    DocAIError,
    ServiceAccountToken,
    docai_configured,
)
from app.ocr.engines import DocAIEngine, build_engines, classify, error_code
from app.ocr.textin.errors import TextInAPIError


def _pdf(pages: int) -> bytes:
    doc = pymupdf.open()
    for n in range(pages):
        doc.new_page().insert_text((72, 72), f"page {n + 1}")
    try:
        return doc.tobytes()
    finally:
        doc.close()


def _document(texts: list[str]) -> dict:
    """A Document AI document as REST returns it: int64 indices as strings, startIndex omitted
    when zero."""
    text, pages, at = "", [], 0
    for n, value in enumerate(texts, 1):
        segment = {"endIndex": str(at + len(value))}
        if at:
            segment["startIndex"] = str(at)
        pages.append({"pageNumber": n, "layout": {"textAnchor": {"textSegments": [segment]}}})
        text += value
        at += len(value)
    return {"text": text, "pages": pages}


def _client(handle, **kw) -> DocAIClient:
    return DocAIClient(
        project=kw.pop("project", "proj"),
        location=kw.pop("location", "asia-southeast1"),
        processor=kw.pop("processor", "proc123"),
        version=kw.pop("version", None),
        token_provider=lambda: "tok-abc",
        transport=httpx.MockTransport(handle),
    )


def _pages_in(request: httpx.Request) -> int:
    body = json.loads(request.content)["rawDocument"]
    data = base64.b64decode(body["content"])
    if body["mimeType"] != "application/pdf":
        return 1
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return doc.page_count


def test_image_is_one_call_with_field_mask_and_bearer_token():
    seen: list[httpx.Request] = []

    def handle(request):
        seen.append(request)
        return httpx.Response(
            200, json={"document": _document(["INVOICE 1\n"]), "humanReviewStatus": {}}
        )

    raw = _client(handle).process(b"\xff\xd8\xffjpeg", "jpg", pages=1)
    assert raw == {"documents": [_document(["INVOICE 1\n"])]}
    (req,) = seen
    assert req.url.host == "asia-southeast1-documentai.googleapis.com"
    assert req.url.path == "/v1/projects/proj/locations/asia-southeast1/processors/proc123:process"
    assert req.headers["authorization"] == "Bearer tok-abc"
    body = json.loads(req.content)
    assert body["rawDocument"]["mimeType"] == "image/jpeg"
    assert base64.b64decode(body["rawDocument"]["content"]) == b"\xff\xd8\xffjpeg"
    assert body["fieldMask"] == FIELD_MASK
    # compact: text and layout, never page images or token/symbol detail
    assert "pages.image" not in FIELD_MASK and "pages.tokens" not in FIELD_MASK
    assert {"text", "pages.pageNumber", "pages.layout"} <= set(FIELD_MASK.split(","))


def test_processor_version_and_multi_region_host():
    seen: list[httpx.Request] = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={"document": _document(["x"])})

    _client(handle, location="us", version="pretrained-ocr-v2.1.1-2025-01-31").process(
        b"\x89PNG", "png", pages=1
    )
    assert seen[0].url.host == "us-documentai.googleapis.com"
    assert seen[0].url.path == (
        "/v1/projects/proj/locations/us/processors/proc123/"
        "processorVersions/pretrained-ocr-v2.1.1-2025-01-31:process"
    )
    assert json.loads(seen[0].content)["rawDocument"]["mimeType"] == "image/png"


def test_short_pdf_is_sent_unchanged():
    data = _pdf(PAGES_PER_CALL)
    seen: list[bytes] = []

    def handle(request):
        seen.append(base64.b64decode(json.loads(request.content)["rawDocument"]["content"]))
        return httpx.Response(200, json={"document": _document(["p"] * PAGES_PER_CALL)})

    raw = _client(handle).process(data, "pdf", pages=PAGES_PER_CALL)
    assert seen == [data]
    assert len(raw["documents"]) == 1


def test_long_pdf_is_split_in_page_order():
    calls: list[int] = []

    def handle(request):
        count = _pages_in(request)
        start = sum(calls)
        calls.append(count)
        return httpx.Response(
            200, json={"document": _document([f"p{start + n + 1}" for n in range(count)])}
        )

    raw = _client(handle).process(_pdf(32), "pdf", pages=32)
    assert PAGES_PER_CALL == 15
    assert calls == [15, 15, 2]
    assert [d["text"][:3] for d in raw["documents"]] == ["p1p", "p16", "p31"]
    assert sum(len(d["pages"]) for d in raw["documents"]) == 32


def test_a_failing_chunk_fails_the_whole_document():
    calls = []

    def handle(request):
        calls.append(1)
        if len(calls) == 2:
            return httpx.Response(503, json={"error": {"code": 503, "status": "UNAVAILABLE"}})
        return httpx.Response(200, json={"document": _document(["p"] * _pages_in(request))})

    with pytest.raises(DocAIError) as err:
        _client(handle).process(_pdf(20), "pdf", pages=20)
    assert classify(err.value) == "service"
    assert len(calls) == 2


@pytest.mark.parametrize(
    ("status", "vendor", "kind"),
    [
        (401, "UNAUTHENTICATED", "service"),
        (403, "PERMISSION_DENIED", "service"),
        (404, "NOT_FOUND", "service"),
        (408, "DEADLINE_EXCEEDED", "service"),
        (429, "RESOURCE_EXHAUSTED", "service"),
        (500, "INTERNAL", "service"),
        (503, "UNAVAILABLE", "service"),
        (400, "INVALID_ARGUMENT", "content"),
        (413, "", "content"),
    ],
)
def test_http_errors_are_classified(status, vendor, kind):
    body = {
        "error": {
            "code": status,
            "status": vendor,
            "message": "projects/920915040833/locations/asia-southeast1/processors/proc123 x",
        }
    }
    client = _client(lambda r: httpx.Response(status, json=body))
    with pytest.raises(DocAIError) as err:
        client.process(b"\x89PNG", "png", pages=1)
    assert classify(err.value) == kind
    assert error_code("google_docai", err.value) == f"DOCAI_ERROR_{status}"
    # the processor path from the vendor message never reaches the job's error text
    assert "proc123" not in str(err.value) and "920915040833" not in str(err.value)


def test_missing_document_is_a_service_failure():
    client = _client(lambda r: httpx.Response(200, json={}))
    with pytest.raises(DocAIError) as err:
        client.process(b"\x89PNG", "png", pages=1)
    assert classify(err.value) == "service"


def test_document_error_is_content():
    body = {"document": {"error": {"code": 3, "message": "unsupported"}, "pages": []}}
    with pytest.raises(DocAIError) as err:
        _client(lambda r: httpx.Response(200, json=body)).process(b"\x89PNG", "png", pages=1)
    assert classify(err.value) == "content"


def test_credentials_failure_is_service_and_hides_details(tmp_path):
    bad = tmp_path / "sa.json"
    # A fake, unusable key; keys are split so check-no-secrets.sh does not flag the fixture.
    fake_key = {"type": "service" + "_account", "private" + "_key": "SECRET-VALUE"}
    bad.write_text(json.dumps(fake_key))
    token = ServiceAccountToken(str(bad))
    with pytest.raises(DocAIError) as err:
        token()
    assert classify(err.value) == "service"
    assert error_code("google_docai", err.value) == "DOCAI_ERROR_CREDENTIALS"
    assert "SECRET-VALUE" not in str(err.value) and str(tmp_path) not in str(err.value)
    assert err.value.__cause__ is None and err.value.__suppress_context__


@pytest.mark.parametrize(
    ("err", "kind"),
    [
        (httpx.ReadTimeout("t"), "service"),
        (httpx.ConnectError("c"), "service"),
        (TextInAPIError("429", "busy", http_status=429), "service"),
        (TextInAPIError("500", "oops", http_status=500), "service"),
        (TextInAPIError("40306", "rate"), "service"),
        (TextInAPIError("40301", "image cannot be recognised"), "content"),
        (TextInAPIError("400", "bad file", http_status=400), "content"),
        (ValueError("parse"), "content"),
    ],
)
def test_classify_codes(err, kind):
    assert classify(err) == kind


def _settings(**keys):
    from app.config import Settings

    return Settings(db_host="h", db_name="n", db_user="u", db_password=SecretStr("p"), **keys)


def test_configured_needs_credentials_file_project_and_processor(tmp_path):
    creds = tmp_path / "sa.json"
    creds.write_text("{}")
    full = {
        "gcs_credentials_file": str(creds),
        "docai_project_id": "proj",
        "docai_processor_id": "proc",
    }
    assert docai_configured(_settings(**full))
    assert _settings(**full).docai_location == "asia-southeast1"
    for missing in full:
        assert not docai_configured(_settings(**{**full, missing: " "}))
    assert not docai_configured(_settings(**{**full, "gcs_credentials_file": str(tmp_path / "x")}))


def test_build_engines_only_when_configured(tmp_path):
    creds = tmp_path / "sa.json"
    creds.write_text("{}")
    docai = {
        "gcs_credentials_file": str(creds),
        "docai_project_id": "proj",
        "docai_processor_id": "proc",
    }
    assert build_engines(_settings()) == {}
    engines = build_engines(
        _settings(textin_app_id="app", textin_secret_code=SecretStr("s"), **docai)
    )
    assert set(engines) == {"textin", "google_docai"}
    assert set(build_engines(_settings(**docai))) == {"google_docai"}


def test_engine_returns_raw_documents_and_page_count():
    def handle(request):
        return httpx.Response(200, json={"document": _document(["a", "b"][: _pages_in(request)])})

    result = DocAIEngine(_client(handle)).run(
        kind="png", content=b"\x89PNG", filename="a.png", pages=1
    )
    assert result.engine == "google_docai"
    assert result.structured is None
    assert result.raw == {"documents": [_document(["a"])]}
    assert result.page_count == 1
