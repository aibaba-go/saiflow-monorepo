"""File inspection for uploads (FR-UPLOAD-003): format by content, PDF pages and render."""

import io
import zipfile

import pymupdf
import pytest

from app.ocr.files import FileCorrupt, PageOutOfRange, page_count, render_page_png, sniff


def make_pdf(pages: int) -> bytes:
    doc = pymupdf.open()
    for n in range(pages):
        doc.new_page().insert_text((72, 72), f"page {n + 1}")
    data = doc.tobytes()
    doc.close()
    return data


def make_png() -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    return pix.tobytes("png")


JPEG_HEADER = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32


def test_sniff_by_content():
    assert sniff(JPEG_HEADER) == "jpg"
    assert sniff(make_png()) == "png"
    assert sniff(make_pdf(1)) == "pdf"


def test_sniff_rejects_zip_and_docx():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    assert sniff(buf.getvalue()) is None  # a docx, or a ZIP renamed to .jpg
    assert sniff(b"") is None
    assert sniff(b"hello") is None


def test_page_count():
    assert page_count("pdf", make_pdf(3)) == 3
    assert page_count("png", make_png()) == 1
    assert page_count("jpg", JPEG_HEADER) == 1


def test_truncated_pdf_is_corrupt():
    data = make_pdf(3)
    with pytest.raises(FileCorrupt):
        page_count("pdf", data[: len(data) // 3])


def test_render_page():
    data = make_pdf(3)
    png = render_page_png(data, 2)
    assert png.startswith(b"\x89PNG")
    with pytest.raises(PageOutOfRange):
        render_page_png(data, 4)
    with pytest.raises(PageOutOfRange):
        render_page_png(data, 0)


def _bad_xref(data: bytes) -> bytes:
    """A whole PDF whose xref offsets are wrong, as cheap generators write them."""
    start = data.rindex(b"startxref")
    return data[:start] + b"startxref\n9\n%%EOF\n"


def test_pdf_with_wrong_xref_still_counts():
    """PyMuPDF repairs it and every page renders: refusing it would refuse a document that
    opens fine (final review 6)."""
    data = _bad_xref(make_pdf(3))
    doc = pymupdf.open(stream=data, filetype="pdf")
    assert doc.is_repaired  # the case under test
    doc.close()
    assert page_count("pdf", data) == 3


def test_render_is_capped_for_huge_pages():
    """A page with a 14400 pt MediaBox must not render at 2x (~28800 px) (final review 5)."""
    doc = pymupdf.open()
    doc.new_page(width=14400, height=14400)
    data = doc.tobytes()
    doc.close()
    png = render_page_png(data, 1)
    pix = pymupdf.Pixmap(png)
    assert max(pix.width, pix.height) <= 2500
