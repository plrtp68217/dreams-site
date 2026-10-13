import html
import re
import secrets
from difflib import SequenceMatcher
from html.parser import HTMLParser

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


class _PlaceScanner(HTMLParser):
    """Finds anchorable elements (see ensure_anchor_ids) with their start offset, id and text."""

    def __init__(self, value: str):
        super().__init__(convert_charrefs=True)
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", value)]
        self.places: list[dict] = []
        self.stack: list[tuple[str, dict | None]] = []
        self.feed(value)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag in _VOID:
            return
        a = dict(attrs)
        place = None
        classes = set((a.get("class") or "").split())
        if tag in ("h3", "h4", "article") or (tag == "div" and classes & _ANCHORABLE_CLASSES):
            line, col = self.getpos()
            kind = tag if tag != "div" else next(c for c in ("line", "note", "callout") if c in classes)
            place = {"kind": kind, "start": self.line_starts[line - 1] + col, "id": a.get("id") or a.get("data-id"),
                     "text": [], "title": None}
            self.places.append(place)
        self.stack.append((tag, place))

    def handle_endtag(self, tag):
        if tag in _VOID or all(t != tag for t, _ in self.stack):
            return
        while self.stack:
            open_tag, place = self.stack.pop()
            if place is not None and place["kind"] == "h4":
                card = next((p for t, p in reversed(self.stack) if p is not None and p["kind"] == "article"), None)
                if card is not None and card["title"] is None:
                    card["title"] = "".join(place["text"])
            if open_tag == tag:
                break

    def handle_data(self, data):
        for _, place in self.stack:
            if place is not None:
                place["text"].append(data)


_VOID = {"br", "img", "hr", "input", "meta", "link", "wbr", "col", "area", "source"}


def _scan(value: str) -> list[dict]:
    places = _PlaceScanner(value).places
    for p in places:
        text = " ".join("".join(p["text"]).split())
        p["key"] = " ".join((p["title"] or "").split()) if p["kind"] == "article" and p["title"] else text
    return places


def carry_anchor_ids(old: str, new: str, threshold: float = 0.6) -> str:
    """Give places in a new version of a text the ids of the matching places in the old one.

    Tasks point at places by id; after an edit (the editor does not show ids) a line, note, heading or card keeps
    its id if its text is the same or similar enough. Places that match nothing are left for ensure_anchor_ids.
    """
    old_places = [p for p in _scan(old) if p["id"]]
    new_places = _scan(new)
    taken = {p["id"] for p in new_places if p["id"]}
    pending = [p for p in new_places if not p["id"]]
    available = [p for p in old_places if p["id"] not in taken]
    assigned: list[dict] = []

    def assign(match) -> None:
        for p in list(pending):
            candidates = [o for o in available if o["kind"] == p["kind"]]
            best = match(p, candidates)
            if best is not None:
                p["id"] = best["id"]
                available.remove(best)
                pending.remove(p)
                assigned.append(p)

    assign(lambda p, cs: next((o for o in cs if o["key"] == p["key"]), None))

    def similar(p, cs):
        scored = [(SequenceMatcher(None, p["key"], o["key"]).ratio(), o) for o in cs]
        scored = [(r, o) for r, o in scored if r >= threshold]
        return max(scored, key=lambda x: x[0])[1] if scored else None

    assign(similar)

    out = new
    for p in sorted(assigned, key=lambda p: p["start"], reverse=True):
        end = out.index(">", p["start"])
        if out[end - 1] == "/":
            end -= 1
        out = f'{out[:end]} data-id="{html.escape(p["id"])}"{out[end:]}'
    return out
