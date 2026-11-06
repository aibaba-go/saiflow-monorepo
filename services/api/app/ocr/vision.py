"""Google Cloud Vision DOCUMENT_TEXT_DETECTION over REST with an API key (FR-OCR-021).
Images go to images:annotate; PDFs to files:annotate, at most 5 pages per call. The raw
responses are returned as one payload: {"pages": [<page response>, ...]}."""

import base64
from typing import Any

import httpx
from pydantic import SecretStr

BASE_URL = "https://vision.googleapis.com/v1"
PAGES_PER_CALL = 5
FEATURES = [{"type": "DOCUMENT_TEXT_DETECTION"}]


class VisionError(RuntimeError):
    """An HTTP error (status set) or an error inside one page's response (status None)."""

    def __init__(self, code: str, message: str, *, http_status: int | None = None) -> None:
        super().__init__(f"Vision error {code}: {message}")
        self.code, self.message, self.http_status = code, message, http_status


class VisionClient:
    def __init__(
        self,
        api_key: SecretStr,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._key = api_key
        self._client = httpx.Client(
            transport=transport, timeout=httpx.Timeout(timeout, connect=10.0)
        )

    def _post(self, path: str, body: dict) -> dict:
        resp = self._client.post(
            f"{BASE_URL}/{path}", params={"key": self._key.get_secret_value()}, json=body
        )
        if resp.status_code != 200:
            try:
                err = resp.json().get("error") or {}
            except ValueError:
                err = {}
            raise VisionError(
                str(err.get("status") or resp.status_code),
                str(err.get("message") or ""),
                http_status=resp.status_code,
            )
        return resp.json()

    @staticmethod
    def _check(page: dict) -> dict:
        if isinstance(page, dict) and page.get("error"):
            err = page["error"]
            raise VisionError(str(err.get("code")), str(err.get("message") or ""))
        return page

    def annotate(self, content: bytes, kind: str, *, pages: int) -> dict[str, Any]:
        encoded = base64.b64encode(content).decode("ascii")
        if kind != "pdf":
            body = {"requests": [{"image": {"content": encoded}, "features": FEATURES}]}
            out = self._post("images:annotate", body)
            return {"pages": [self._check(p) for p in out.get("responses") or []]}
        collected: list[dict] = []
        for start in range(1, pages + 1, PAGES_PER_CALL):
            batch = list(range(start, min(start + PAGES_PER_CALL, pages + 1)))
            body = {
                "requests": [
                    {
                        "inputConfig": {"content": encoded, "mimeType": "application/pdf"},
                        "features": FEATURES,
                        "pages": batch,
                    }
                ]
            }
            out = self._post("files:annotate", body)
            for file_response in out.get("responses") or []:
                collected.extend(self._check(p) for p in file_response.get("responses") or [])
        return {"pages": collected}

    def close(self) -> None:
        self._client.close()
