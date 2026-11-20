"""Per-engine page-text view of a stored raw result (FR-OCR-028).

TextIn results already carry structure and are read as they are. Google Document AI OCR
and historical Google Cloud Vision results are read as page texts, in page order, with
empty or malformed pages kept as empty strings. The stored raw result is never changed.
"""

from typing import Any


def _int(value: Any) -> int | None:
    try:
        return int(value)  # int64 indices arrive as JSON strings
    except (TypeError, ValueError):
        return None


def _anchor_text(text: str, anchor: Any) -> str:
    """Text a Document AI textAnchor points at; an omitted startIndex means 0."""
    segments = anchor.get("textSegments") if isinstance(anchor, dict) else None
    parts = []
    for seg in segments if isinstance(segments, list) else []:
        if not isinstance(seg, dict):
            continue
        start, end = _int(seg.get("startIndex", 0)), _int(seg.get("endIndex", 0))
        if start is None or end is None or end <= start:
            continue
        parts.append(text[start:end])
    return "".join(parts)


def _docai_pages(raw: Any) -> list[str]:
    documents = raw.get("documents") if isinstance(raw, dict) else None
    texts: list[str] = []
    for doc in documents if isinstance(documents, list) else []:
        if not isinstance(doc, dict):
            continue
        text = doc.get("text") if isinstance(doc.get("text"), str) else ""
        pages = doc.get("pages")
        for page in pages if isinstance(pages, list) else []:
            layout = page.get("layout") if isinstance(page, dict) else None
            anchor = layout.get("textAnchor") if isinstance(layout, dict) else None
            texts.append(_anchor_text(text, anchor))
    return texts


def _vision_pages(raw: Any) -> list[str]:
    pages = raw.get("pages") if isinstance(raw, dict) else None
    texts: list[str] = []
    for page in pages if isinstance(pages, list) else []:
        annotation = page.get("fullTextAnnotation") if isinstance(page, dict) else None
        value = annotation.get("text") if isinstance(annotation, dict) else None
        texts.append(value if isinstance(value, str) else "")
    return texts


def page_texts(engine: str | None, raw: Any) -> list[str] | None:
    """Page texts for text-only engines; None when the engine's raw result is read as is."""
    if engine == "google_docai":
        return _docai_pages(raw)
    if engine == "google_vision":
        return _vision_pages(raw)
    return None


def model_input(engine: str | None, raw: Any) -> Any:
    """What the LLM reads for a stored raw result: `{"pages": [...]}` or the raw itself."""
    texts = page_texts(engine, raw)
    return raw if texts is None else {"pages": texts}
