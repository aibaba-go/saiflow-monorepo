"""Google Cloud Vision client (FR-OCR-021): images and PDFs (5 pages per call), errors."""

import base64
import json

import httpx
import pytest
from pydantic import SecretStr

from app.ocr.engines import classify
from app.ocr.textin.errors import TextInAPIError
from app.ocr.vision import VisionClient, VisionError


def _page(text: str) -> dict:
    return {"fullTextAnnotation": {"text": text}}


def test_image_uses_images_annotate():
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"responses": [_page("INVOICE 1")]})

    client = VisionClient(SecretStr("vision-key"), transport=httpx.MockTransport(handle))
    raw = client.annotate(b"\x89PNG", "png", pages=1)
    assert raw["pages"][0]["fullTextAnnotation"]["text"] == "INVOICE 1"
    req = seen[0]
    assert req.url.path == "/v1/images:annotate"
    assert req.url.params["key"] == "vision-key"
    body = json.loads(req.content)["requests"][0]
    assert base64.b64decode(body["image"]["content"]) == b"\x89PNG"
    assert body["features"] == [{"type": "DOCUMENT_TEXT_DETECTION"}]


def test_pdf_batches_five_pages_per_call():
    calls: list[list[int]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/files:annotate"
        pages = json.loads(request.content)["requests"][0]["pages"]
        calls.append(pages)
        return httpx.Response(
            200, json={"responses": [{"responses": [_page(f"p{p}") for p in pages]}]}
        )

    client = VisionClient(SecretStr("k"), transport=httpx.MockTransport(handle))
    raw = client.annotate(b"%PDF-1.7", "pdf", pages=12)
    assert calls == [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12]]
    assert [p["fullTextAnnotation"]["text"] for p in raw["pages"]] == [
        f"p{n}" for n in range(1, 13)
    ]


@pytest.mark.parametrize(
    ("status", "body", "kind"),
    [
        (429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}}, "service"),
        (503, {"error": {"code": 503, "status": "UNAVAILABLE"}}, "service"),
        (403, {"error": {"code": 403, "status": "PERMISSION_DENIED"}}, "service"),
        (400, {"error": {"code": 400, "status": "INVALID_ARGUMENT"}}, "content"),
    ],
)
def test_http_errors_are_classified(status, body, kind):
    client = VisionClient(
        SecretStr("k"), transport=httpx.MockTransport(lambda r: httpx.Response(status, json=body))
    )
    with pytest.raises(VisionError) as err:
        client.annotate(b"\x89PNG", "png", pages=1)
    assert classify(err.value) == kind


def test_error_inside_a_response_is_content():
    def handle(request):
        return httpx.Response(
            200, json={"responses": [{"error": {"code": 3, "message": "bad image"}}]}
        )

    client = VisionClient(SecretStr("k"), transport=httpx.MockTransport(handle))
    with pytest.raises(VisionError) as err:
        client.annotate(b"\x89PNG", "png", pages=1)
    assert classify(err.value) == "content"


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


def test_build_engines_only_with_keys():
    from app.ocr.engines import build_engines

    assert build_engines(_settings()) == {}
    engines = build_engines(
        _settings(
            textin_app_id="app",
            textin_secret_code=SecretStr("s"),
            google_vision_api_key=SecretStr("v"),
        )
    )
    assert set(engines) == {"textin", "google_vision"}
    assert set(build_engines(_settings(google_vision_api_key=SecretStr("v")))) == {"google_vision"}


def test_vision_engine_returns_raw_pages():
    from app.ocr.engines import VisionEngine

    client = VisionClient(
        SecretStr("k"),
        transport=httpx.MockTransport(
            lambda r: httpx.Response(200, json={"responses": [_page("hello")]})
        ),
    )
    result = VisionEngine(client).run(kind="png", content=b"\x89PNG", filename="a.png", pages=1)
    assert result.engine == "google_vision"
    assert result.structured is None
    assert result.raw["pages"][0]["fullTextAnnotation"]["text"] == "hello"
    assert result.page_count == 1
