import html
import re

import nh3

_EXTRA_TAGS = {"section", "label"}
_ATTRIBUTES = {
    "*": {"class", "id", "style", "title", "lang", "role", "aria-label"},
    "a": {"href", "target"},
    "img": {"src", "alt", "loading", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
    "ol": {"start"},
}


def sanitize_html(value: str) -> str:
    """Strip scripts, event handlers and unknown tags from editor-provided HTML."""
    return nh3.clean(
        value,
        tags=nh3.ALLOWED_TAGS | _EXTRA_TAGS,
        attributes=_ATTRIBUTES,
        generic_attribute_prefixes={"data-"},
        url_schemes={"http", "https", "mailto"},
        strip_comments=True,
    )


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def html_to_text(value: str) -> str:
    return _WS.sub(" ", html.unescape(_TAG.sub(" ", value))).strip()


def snippet(text: str, query: str, radius: int = 70) -> str:
    idx = text.lower().find(query.lower())
    if idx < 0:
        return text[: radius * 2]
    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")
