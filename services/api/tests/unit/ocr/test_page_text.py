"""Per-engine page-text view of stored raw results (FR-OCR-028)."""

import copy

from app.ocr.page_text import model_input, page_texts

THAI = "ใบกำกับภาษี IV00000001\n"
TOTAL = "ยอดรวม 12345678901234567890\n"


def _docai(*docs):
    return {"documents": list(docs)}


def _doc(text, spans):
    pages = []
    for n, span in enumerate(spans, 1):
        page = {"pageNumber": n}
        if span is not None:
            seg = {"endIndex": str(span[1])}
            if span[0]:
                seg["startIndex"] = str(span[0])  # the API omits a zero start
            page["layout"] = {"textAnchor": {"textSegments": [seg]}}
        pages.append(page)
    return {"text": text, "pages": pages}


def test_docai_pages_in_order_across_chunks_with_empty_pages():
    first = _doc(THAI + TOTAL, [(0, len(THAI)), None, (len(THAI), len(THAI + TOTAL))])
    second = _doc("Page four\n", [(0, 10)])
    raw = _docai(first, second)
    before = copy.deepcopy(raw)
    assert page_texts("google_docai", raw) == [THAI, "", TOTAL, "Page four\n"]
    assert model_input("google_docai", raw) == {"pages": [THAI, "", TOTAL, "Page four\n"]}
    assert raw == before  # the stored result is never changed


def test_docai_multiple_segments_and_malformed_parts():
    text = "AB CD EF"
    page = {
        "layout": {
            "textAnchor": {
                "textSegments": [
                    {"endIndex": "2"},
                    {"startIndex": "6", "endIndex": "8"},
                    {"startIndex": "x", "endIndex": "3"},
                    "junk",
                ]
            }
        }
    }
    raw = _docai({"text": text, "pages": [page, "junk", {"layout": []}]}, "junk")
    assert page_texts("google_docai", raw) == ["ABEF", "", ""]
    assert page_texts("google_docai", {"documents": "x"}) == []
    assert page_texts("google_docai", None) == []


def test_vision_history_reads_full_text_annotation():
    raw = {"pages": [{"fullTextAnnotation": {"text": THAI}}, {}, {"fullTextAnnotation": []}]}
    assert page_texts("google_vision", raw) == [THAI, "", ""]
    assert model_input("google_vision", raw) == {"pages": [THAI, "", ""]}


def test_textin_raw_is_read_as_is():
    raw = {"pages": [{"content": []}], "detail": [{"text": "x"}]}
    assert page_texts("textin", raw) is None
    assert model_input("textin", raw) is raw
    assert model_input(None, raw) is raw
