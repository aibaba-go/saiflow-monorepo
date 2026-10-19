"""Custom exceptions used by the TextIn DocFlow provider.

Layered:
  TextInError
    TextInAPIError    — TextIn business error (HTTP 200 but code != 200)
  LookupError
    ExtractionNotFound     — record JSON missing
    UploadedFileNotFound   — original upload missing
  RuntimeError
    RecordParseError       — stored JSON is corrupt
    OcrHTTPError           — logical validation error carrying HTTP status,
                              translated to {code, msg, data} by the blueprint

Plus vendor-specific error-code constants and a defensive JSON-decode helper
that prefers UTF-8 and falls back to GBK/gb2312 if DocFlow (or a proxy in front
of it) returns non-UTF-8 bytes. DocFlow renamed the legacy `message` field to
`msg`; callers must read `msg`, never `message`.
"""

from __future__ import annotations

from typing import Any

# --- Public vendor-specific error code constants ----------------------------
# Routes / i18n / audit JSON reference these by literal value, so they must
# stay stable. Apply these on OcrHTTPError.code (or pass through verbatim to
# downstream consumers) so the route layer can map them to user-visible keys.

DOCFLOW_RECOGNITION_FAILED: str = "DOCFLOW_RECOGNITION_FAILED"
"""Vendor returned code=200 but `recognition_status == 2` (extraction failed)."""

DOCFLOW_UNEXPECTED_STATUS: str = "DOCFLOW_UNEXPECTED_STATUS"
"""Vendor returned code=200 but `recognition_status` is non-terminal / unexpected."""

OCR_VENDOR_UNAVAILABLE: str = "OCR_VENDOR_UNAVAILABLE"
"""Transport-level failure reaching the vendor (5xx, 429, connection, timeout)."""


class TextInError(RuntimeError):
    """Base class for TextIn integration errors."""


class TextInAPIError(TextInError):
    """TextIn business error.

    Carries the raw vendor `payload` plus the human-readable `msg` parsed from
    the response body's `msg` field (DocFlow renamed `message` -> `msg`).
    """

    def __init__(
        self,
        code: int | str,
        msg: str = "",
        payload: dict[str, Any] | None = None,
    ) -> None:
        msg = msg or ""
        super().__init__(f"TextIn API error {code}: {msg}")
        self.code = code
        self.msg = msg
        self.payload = payload or {}


class ExtractionNotFound(LookupError):
    """The requested extraction_id is not present in local storage."""


class UploadedFileNotFound(LookupError):
    """The original upload file for an extraction is missing."""


class RecordParseError(RuntimeError):
    """A persisted extraction JSON could not be parsed."""


class OcrHTTPError(Exception):
    """Logical OCR error meant to be rendered as {code, msg, data}.

    Routes raise this for validation failures; a single blueprint
    errorhandler converts it to a Flask JSON response.
    """

    def __init__(
        self,
        status: int,
        code: str,
        msg: str,
        data: Any = None,
    ) -> None:
        super().__init__(msg)
        self.status = status
        self.code = code
        self.msg = msg
        self.data = data


# --- Defensive response parsing ---------------------------------------------


def _try_decode(buf: bytes, encoding: str) -> str | None:
    try:
        return buf.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        return None


def decode_vendor_body(buf: bytes) -> str:
    """Decode vendor response bytes; UTF-8 first, GBK/gb2312 fallback.

    DocFlow returns UTF-8 JSON, but a misconfigured proxy might transcode to
    GBK/gb2312. Prefer UTF-8; fall back to GBK then gb2312 so we still produce
    a parseable payload. If all candidates fail, return a lossy UTF-8 decode
    so the caller can still log something useful instead of crashing.
    """
    decoded = (
        _try_decode(buf, "utf-8")
        or _try_decode(buf, "gbk")
        or _try_decode(buf, "gb2312")
    )
    if decoded is None:
        return buf.decode("utf-8", errors="replace")
    return decoded


def parse_docflow_error(payload: Any) -> TextInAPIError:
    """Build a TextInAPIError from a DocFlow error response payload.

    DocFlow renamed the human-readable error field from `message` (legacy
    xparse) to `msg`. We read `msg` exclusively and never read `message`, so
    legacy payloads without `msg` surface as blank msg instead of being
    silently misread.

    Non-dict payloads raise TypeError to prevent None/str from silently
    swallowing errors further up the stack.
    """
    if not isinstance(payload, dict):
        raise TypeError(
            f"parse_docflow_error expects dict, got {type(payload).__name__}"
        )
    code = payload.get("code", -1)
    msg_raw = payload.get("msg", "")
    msg = msg_raw if isinstance(msg_raw, str) else ""
    return TextInAPIError(code=code, msg=msg, payload=payload)
