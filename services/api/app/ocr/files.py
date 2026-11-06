"""What an uploaded file is (FR-UPLOAD-003): format from the bytes, never the name; PDF page
count and page images for previews (FR-UPLOAD-011)."""

from typing import Literal

import pymupdf

Kind = Literal["jpg", "png", "pdf"]
MIME: dict[str, str] = {"jpg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}


class FileCorrupt(ValueError):
    """The bytes claim a format but cannot be read as it."""


class PageOutOfRange(LookupError):
    """No such page in the document."""


def sniff(data: bytes) -> Kind | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"%PDF-"):
        return "pdf"
    return None


def _open_pdf(data: bytes) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001  any parse failure is a corrupt file
        raise FileCorrupt("pdf") from exc
    if doc.needs_pass:
        doc.close()
        raise FileCorrupt("pdf encrypted")
    return doc


def page_count(kind: Kind, data: bytes) -> int:
    """Images are one page; a PDF that cannot be parsed or has no page is corrupt.
    A truncated PDF that PyMuPDF repairs to fewer pages still counts as corrupt when
    it cannot render its last page."""
    if kind != "pdf":
        return 1
    doc = _open_pdf(data)
    try:
        count = doc.page_count
        if count < 1:
            raise FileCorrupt("pdf has no pages")
        if doc.is_repaired:
            raise FileCorrupt("pdf damaged")
        return count
    finally:
        doc.close()


def render_page_png(data: bytes, page: int, zoom: float = 2.0) -> bytes:
    """Page `page` (1-based) of a PDF as a PNG."""
    doc = _open_pdf(data)
    try:
        if page < 1 or page > doc.page_count:
            raise PageOutOfRange(page)
        pix = doc.load_page(page - 1).get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        return pix.tobytes("png")
    finally:
        doc.close()
