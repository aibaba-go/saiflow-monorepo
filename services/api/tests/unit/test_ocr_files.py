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
