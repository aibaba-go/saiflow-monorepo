"""Google Document AI Enterprise Document OCR over REST (FR-OCR-021, FR-OCR-027).

Synchronous online processing with a service-account token (the mounted key shared with
GCS). Images go in one call; PDFs are cut into ≤15-page chunks (the online limit) in page
order. Only text and layout are requested (no page images, tokens or symbols), and the
chunks' documents are kept as one raw result: {"documents": [<document>, ...]}.

Errors never carry the vendor's message: it can name the project and processor.
"""

import base64
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pymupdf

from app.ocr.files import MIME

PAGES_PER_CALL = 15
FIELD_MASK = ",".join(
    [
        "text",
        "pages.pageNumber",
        "pages.dimension",
        "pages.layout",
        "pages.detectedLanguages",
        "pages.blocks",
        "pages.paragraphs",
        "pages.lines",
    ]
)
SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


class DocAIError(RuntimeError):
    """An HTTP error (status set), a credentials problem or an unusable response."""

    def __init__(
        self, code: str, message: str = "", *, http_status: int | None = None, service: bool
    ) -> None:
        super().__init__(f"Document AI error {code}" + (f": {message}" if message else ""))
        self.code, self.message, self.http_status, self.service = (
            code,
            message,
            http_status,
            service,
        )


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def docai_configured(settings) -> bool:
    """Credentials file present, project and processor set (FR-SYS-005 key status)."""
    path = settings.gcs_credentials_file
    return (
        _present(settings.docai_project_id)
        and _present(settings.docai_processor_id)
        and _present(path)
        and Path(path.strip()).is_file()
    )


class ServiceAccountToken:
    """An OAuth access token from the service-account key file, refreshed when it expires."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._credentials = None
        self._lock = threading.Lock()

    def __call__(self) -> str:
        with self._lock:
            try:
                from google.auth.transport.requests import Request
                from google.oauth2 import service_account

                if self._credentials is None:
                    self._credentials = service_account.Credentials.from_service_account_file(
                        self._path, scopes=SCOPES
                    )
                if not self._credentials.valid:
                    self._credentials.refresh(Request())
                return self._credentials.token
            except Exception:  # noqa: BLE001  key, file and token errors alike
                # no detail: the error text could quote the key file or its path
                raise DocAIError(
                    "CREDENTIALS", "service account token unavailable", service=True
                ) from None


_TOKENS: dict[str, ServiceAccountToken] = {}
_TOKENS_LOCK = threading.Lock()


def token_for(path: str) -> ServiceAccountToken:
    """One cached token per key file: engines are built per job, tokens last an hour."""
    with _TOKENS_LOCK:
        return _TOKENS.setdefault(path, ServiceAccountToken(path))


class DocAIClient:
    def __init__(
        self,
        *,
        project: str,
        location: str,
        processor: str,
        version: str | None = None,
        token_provider: Callable[[], str],
        transport: httpx.BaseTransport | None = None,
        timeout: float = 120.0,
    ) -> None:
        location = location.strip()
        name = f"projects/{project.strip()}/locations/{location}/processors/{processor.strip()}"
        if version and version.strip():
            name += f"/processorVersions/{version.strip()}"
        self._url = f"https://{location}-documentai.googleapis.com/v1/{name}:process"
        self._token = token_provider
        self._client = httpx.Client(
            transport=transport, timeout=httpx.Timeout(timeout, connect=10.0)
        )

    def _call(self, content: bytes, mime: str) -> dict:
        body = {
            "rawDocument": {"content": base64.b64encode(content).decode("ascii"), "mimeType": mime},
            "fieldMask": FIELD_MASK,
        }
        resp = self._client.post(
            self._url, json=body, headers={"Authorization": f"Bearer {self._token()}"}
        )
        if resp.status_code != 200:
            try:
                status = str((resp.json().get("error") or {}).get("status") or "")
            except (ValueError, AttributeError):
                status = ""
            raise DocAIError(
                str(resp.status_code),
                status,
                http_status=resp.status_code,
                service=False,
            )
        try:
            document = resp.json().get("document")
        except (ValueError, AttributeError):
            document = None
        if not isinstance(document, dict):
            raise DocAIError("RESPONSE", "no document in the response", service=True)
        if document.get("error"):
            raise DocAIError("DOCUMENT", "the document could not be processed", service=False)
        return document

    @staticmethod
    def _chunks(content: bytes) -> list[bytes]:
        """≤15-page PDFs as they are; longer ones cut in page order. A PDF that cannot be
        opened goes as it is, and Document AI rejects it as content."""
        try:
            doc = pymupdf.open(stream=content, filetype="pdf")
        except Exception:  # noqa: BLE001
            return [content]
        try:
            if doc.page_count <= PAGES_PER_CALL:
                return [content]
            parts = []
            for start in range(0, doc.page_count, PAGES_PER_CALL):
                part = pymupdf.open()
                try:
                    end = min(start + PAGES_PER_CALL, doc.page_count) - 1
                    part.insert_pdf(doc, from_page=start, to_page=end)
                    parts.append(part.tobytes())
                finally:
                    part.close()
            return parts
        finally:
            doc.close()

    def process(self, content: bytes, kind: str, *, pages: int) -> dict[str, Any]:
        mime = MIME.get(kind, "image/png")  # the worker's sniff() kinds; png as before
        chunks = self._chunks(content) if kind == "pdf" else [content]
        return {"documents": [self._call(chunk, mime) for chunk in chunks]}

    def close(self) -> None:
        self._client.close()
