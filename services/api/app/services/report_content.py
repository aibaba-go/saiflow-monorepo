import copy
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit
from uuid import UUID

from app.config import Settings

STATIC_TYPES = frozenset({"image", "html"})
_TAGS = frozenset(
    {
        "div",
        "span",
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "br",
        "hr",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "small",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "blockquote",
        "pre",
        "code",
    }
)
_BLOCKED = frozenset(
    {
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "svg",
        "math",
        "form",
        "head",
        "template",
        "audio",
        "video",
    }
)
_VOID = frozenset({"br", "hr", "img", "input", "meta", "link", "base", "embed", "source"})
_STYLE = frozenset(
    {
        "color",
        "background-color",
        "font-size",
        "font-weight",
        "text-align",
        "padding",
        "margin",
        "border",
        "border-radius",
        "line-height",
        "width",
        "max-width",
        "height",
    }
)
_VALUE = re.compile(r"^[a-zA-Z0-9#.%\s-]{1,100}$")


class _SafeHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.blocked = []

    def handle_starttag(self, tag, attrs):
        if self.blocked:
            if tag not in _VOID:
                self.blocked.append(tag)
            return
        if tag in _BLOCKED:
            if tag not in _VOID:
                self.blocked.append(tag)
            return
        if tag not in _TAGS:
            return
        style = []
        for key, value in attrs:
            if key == "style" and value:
                for declaration in value.split(";"):
                    name, _, val = declaration.partition(":")
                    name, val = name.strip().lower(), val.strip()
                    if name in _STYLE and _VALUE.fullmatch(val):
                        style.append(f"{name}:{val}")
        attr = f' style="{escape(";".join(style), quote=True)}"' if style else ""
        self.out.append(f"<{tag}{attr}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.blocked:
            if tag in self.blocked:
                self.blocked = self.blocked[: self.blocked.index(tag)]
            return
        if tag in _TAGS and tag not in _VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.blocked:
            self.out.append(escape(data))


def sanitize_html(html: str) -> str:
    parser = _SafeHTML()
    parser.feed(html)
    parser.close()
    return "".join(parser.out)


def https_origin(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("an HTTPS URL without credentials is required")
    if parsed.query or parsed.fragment:
        raise ValueError("embedded URLs cannot contain query parameters or fragments")
    if any(c.isspace() or ord(c) < 32 for c in url):
        raise ValueError("invalid URL")
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    return f"https://{host}" + (f":{parsed.port}" if parsed.port not in (None, 443) else "")


def content_errors(card: dict) -> list[tuple[str, str]]:
    content = card.get("content")
    if not isinstance(content, dict):
        return [("content", "content must be an object")]
    try:
        if card["type"] == "image":
            UUID(content.get("asset_id", ""))
            if not isinstance(content.get("alt", ""), str) or len(content.get("alt", "")) > 200:
                raise ValueError("image description is at most 200 characters")
            if content.get("fit", "contain") not in ("contain", "cover"):
                raise ValueError("image fit must be contain or cover")
        elif content.get("mode", "html") == "html":
            html = content.get("html")
            if not isinstance(html, str) or not 1 <= len(html) <= 20000:
                raise ValueError("HTML is 1-20000 characters")
        elif content.get("mode") == "url":
            url = content.get("url")
            if not isinstance(url, str) or len(url) > 2000:
                raise ValueError("an HTTPS URL is required")
            https_origin(url)
        else:
            raise ValueError("content mode must be html or url")
    except (ValueError, TypeError, AttributeError) as exc:
        return [("content", str(exc))]
    return []


def embed_origins(settings: Settings | None) -> list[str]:
    allowed = {
        https_origin(v.strip())
        for v in (settings.report_embed_origins if settings else "").split(",")
        if v.strip()
    }
    own = settings.web_pc_origin if settings else None
    if own and urlsplit(own).scheme == "https":
        allowed.discard(https_origin(own))
    return sorted(allowed)


def sanitize_config(config: dict, settings: Settings | None = None) -> dict:
    from app.services.report_service import invalid

    out = copy.deepcopy(config)
    for i, card in enumerate(out.get("cards", []) if isinstance(out.get("cards"), list) else []):
        if not isinstance(card, dict) or card.get("type") != "html":
            continue
        content = card.get("content")
        if not isinstance(content, dict):
            continue
        if content.get("mode", "html") == "html" and isinstance(content.get("html"), str):
            if len(content["html"]) > 20000:
                raise invalid(
                    [
                        {
                            "card_id": card.get("id"),
                            "path": f"cards[{i}].content.html",
                            "message": "HTML is at most 20000 characters",
                        }
                    ]
                )
            content["html"] = sanitize_html(content["html"])
        elif content.get("mode") == "url":
            try:
                origin = https_origin(content.get("url", ""))
                if origin not in embed_origins(settings):
                    raise ValueError("this HTTPS origin is not allowed for embedded pages")
            except (ValueError, TypeError, AttributeError) as exc:
                raise invalid(
                    [
                        {
                            "card_id": card.get("id"),
                            "path": f"cards[{i}].content.url",
                            "message": str(exc),
                        }
                    ]
                ) from exc
    return out
