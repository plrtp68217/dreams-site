import html
import re
import secrets

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


# Places in the scenario a task can point at: headings, dialogue lines, notes, callouts and cards.
_ANCHORABLE_TAG = re.compile(r"<(h3|h4|article|div)(\s[^>]*)?>")
_ANCHORABLE_CLASSES = {"line", "note", "callout"}
_HAS_ID = re.compile(r'\s(?:id|data-id)="')
_CLASS = re.compile(r'\sclass="([^"]*)"')
_IDS = re.compile(r'\s(?:id|data-id)="([^"]+)"')


def ensure_anchor_ids(value: str) -> str:
    """Give every anchorable block a hidden data-id, so tasks can link to it and it survives edits."""
    taken = set(_IDS.findall(value))

    def new_id() -> str:
        while (candidate := f"p-{secrets.token_hex(3)}") in taken:
            pass  # pragma: no cover - 1 in 16M
        taken.add(candidate)
        return candidate

    def sub(m: re.Match) -> str:
        tag, attrs = m.group(1), m.group(2) or ""
        if _HAS_ID.search(attrs):
            return m.group(0)
        if tag == "div":
            cls = _CLASS.search(attrs)
            if not cls or not _ANCHORABLE_CLASSES & set(cls.group(1).split()):
                return m.group(0)
        return f'<{tag}{attrs} data-id="{new_id()}">'

    return _ANCHORABLE_TAG.sub(sub, value)


def has_anchor(value: str, anchor: str) -> bool:
    return anchor in _IDS.findall(value)

