"""Scenario HTML → scenario Markdown (see markup.py). Used once, to move existing texts to Markdown.

Anything without a Markdown form (the structure strip on the overview page and the like) stays as raw HTML.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup, NavigableString, Tag

_ESCAPE = re.compile(r"([\\`*\[\]])")


def _classes(el: Tag) -> list[str]:
    return list(el.get("class") or [])


def _raw(el: Tag) -> str:
    # an HTML block in Markdown ends at the first blank line
    return re.sub(r"\n\s*\n", "\n", str(el)).strip()


def _text(s: str) -> str:
    return _ESCAPE.sub(r"\\\1", re.sub(r"\s+", " ", s))


def inline(el: Tag | NavigableString, in_table: bool = False) -> str:
    """Inline Markdown for an element's contents."""
    parts: list[str] = []
    for node in el.children if isinstance(el, Tag) else [el]:
        if isinstance(node, NavigableString):
            parts.append(_text(str(node)))
            continue
        name, cls = node.name, _classes(node)
        if name in ("b", "strong"):
            inner = inline(node, in_table).strip()
            parts.append(f"**{inner}**" if inner else "")
        elif name in ("i", "em"):
            inner = inline(node, in_table).strip()
            parts.append(f"*{inner}*" if inner else "")
        elif name == "span" and "flag" in cls:
            parts.append(f"`{node.get_text()}`")
        elif name == "span" and "lid" in cls:
            continue
        elif name == "a" and node.get("href") and not cls:
            parts.append(f"[{inline(node, in_table).strip()}]({node['href']})")
        elif name == "br":
            parts.append("<br>" if in_table else "\\\n")
        elif name == "img":
            parts.append(f"![{node.get('alt', '')}]({node.get('src', '')})")
        elif name == "q":
            parts.append(f"«{inline(node, in_table)}»")
        elif name in ("span", "small", "code") and not cls:
            parts.append(inline(node, in_table))
        else:
            parts.append(str(node))
    return "".join(parts)


def _clean(s: str) -> str:
    return re.sub(r"[ \t]+\n", "\n", re.sub(r" {2,}", " ", s)).strip()


def _images(el: Tag) -> str:
    lines = []
    for img in el.find_all("img"):
        fig = img.find_parent("figure")
        cap = fig.find("figcaption") if fig else None
        caption = cap.get_text(" ", strip=True) if cap else ""
        title = f' "{caption}"' if caption else ""
        lines.append(f"![{img.get('alt', '')}]({img.get('src', '')}{title})")
    return "\n".join(lines)


def _table(table: Tag) -> str:
    rows = [r for r in table.find_all("tr")]
    if not rows or table.find(attrs={"colspan": True}) or table.find(attrs={"rowspan": True}):
        return _raw(table)

    def cells(row: Tag) -> list[str]:
        return [_clean(inline(c, in_table=True)).replace("|", "\\|").replace("\n", " ") for c in row.find_all(["th", "td"])]

    head, *body = rows
    header = cells(head)
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    lines += ["| " + " | ".join(cells(r)) + " |" for r in body]
    return "\n".join(lines)


def _list(el: Tag, ordered: bool) -> str:
    out = []
    for i, li in enumerate(el.find_all("li", recursive=False), start=el.get("start") and int(el["start"]) or 1):
        marker = f"{i}." if ordered else "-"
        nested = [c for c in li.children if isinstance(c, Tag) and c.name in ("ul", "ol")]
        for n in nested:
            n.extract()
        text = _clean(inline(li))
        out.append(f"{marker} {text}")
        for n in nested:
            out += ["   " + line for line in _list(n, n.name == "ol").split("\n")]
    return "\n".join(out)


def _container(name: str, title: str, body: str) -> str:
    head = f"::: {name} {title}".rstrip()
    return f"{head}\n{body.strip()}\n:::" if body.strip() else f"{head}\n:::"


def _items(el: Tag, wrapper: str) -> str:
    """Steps / diary entries: «#### Заголовок» + contents."""
    parts = []
    for item in el.find_all(wrapper, recursive=False):
        h4 = item.find("h4", recursive=False)
        title = _clean(inline(h4)) if h4 else ""
        if h4:
            h4.extract()
        parts.append((f"#### {title}\n" if title else "") + blocks(item))
    return "\n\n".join(parts)


def block(el: Tag) -> str:
    name, cls = el.name, _classes(el)
    if el.get("data-task"):
        return _raw(el)
    if name == "p":
        text = _clean(inline(el))
        if "lede" in cls:
            return _container("вводка", "", text)
        return text
    if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        return "#" * int(name[1]) + " " + _clean(inline(el))
    if name == "div" and "line" in cls:
        who = el.find("span", class_="who")
        q = el.find("q")
        speaker = _clean(inline(who)) if who else ""
        mark = "*" if "ann" in cls else "**"
        return f"> {mark}{speaker}:{mark} {_clean(inline(q) if q else '')}"
    if name == "div" and "note" in cls:
        who = el.find("span", class_="who")
        title = _clean(inline(who)) if who else ""
        if who:
            who.extract()
        body = _clean(inline(el)).replace("\\\n", "\n")
        return _container("записка", title, body)
    if name == "div" and "callout" in cls:
        tag = el.find("b", class_="tag")
        title = _clean(inline(tag)) if tag else ""
        if tag:
            tag.extract()
        kind = "нет-в-сценарии" if "todo" in cls else "заметка"
        return _container(kind, title, blocks(el))
    if name == "article" and "quest" in cls:
        h4 = el.select_one("header h4")
        title = _clean(inline(h4)) if h4 else ""
        body = el.find("div", class_="qbody")
        return _container("карточка", title, blocks(body) if body else "")
    if name == "dl" and "spec" in cls:
        lines = []
        for dt in el.find_all("dt", recursive=False):
            dd = dt.find_next_sibling("dd")
            if dd and dd.find(["ul", "ol", "p", "div", "dl", "table"]):
                # a value of several blocks: continuation lines are indented
                first, *rest = blocks(dd).split("\n")
                value = "\n".join([first] + [f"  {line}" if line.strip() else "" for line in rest])
            else:
                value = _clean(inline(dd)) if dd else ""
            lines.append(f"{_clean(inline(dt))}: {value}")
        return _container("характеристики", "", "\n".join(lines))
    if name == "ul" and "choice" in cls:
        items = []
        for li in el.find_all("li", recursive=False):
            mark = "(+) " if "ok" in _classes(li) else "(-) " if "bad" in _classes(li) else ""
            items.append(f"- {mark}{_clean(inline(li))}")
        return _container("выбор", "", "\n".join(items))
    if name == "ul" and "posters" in cls:
        return _container("плакаты", "", _list(el, ordered=False))
    if name == "ol" and "steps" in cls:
        return _container("этапы", "", _items(el, "li"))
    if name == "div" and "diary" in cls:
        return _container("дневник", "", _items(el, "article"))
    if name in ("ul", "ol") and not cls:
        return _list(el, ordered=name == "ol")
    if name == "div" and "tbl-wrap" in cls and el.find("table"):
        return _table(el.find("table"))
    if name == "table":
        return _table(el)
    if name == "pre" and "mermaid" in cls:
        return f"```mermaid\n{el.get_text().strip()}\n```"
    if name in ("figure", "div") and el.find("img") and (
        set(cls) & {"loc-media", "vis-imgs", "shots", "loc-pair", "gallery"} or name == "figure"
    ):
        return _images(el)
    if name == "div" and set(cls) & {"vis-art", "qbody"} or (name == "div" and not cls):
        return blocks(el)
    return _raw(el)


def blocks(el: Tag) -> str:
    parts = []
    loose: list[str] = []

    def flush() -> None:
        text = _clean("".join(loose))
        if text:
            parts.append(text)
        loose.clear()

    for node in el.children:
        if isinstance(node, NavigableString):
            if str(node).strip():
                loose.append(_text(str(node)))
            continue
        if node.name in ("b", "strong", "i", "em", "a", "span", "q", "small", "br", "img", "code"):
            loose.append(inline(BeautifulSoup(str(node), "html.parser")))
            continue
        flush()
        converted = block(node)
        if converted:
            parts.append(converted)
    flush()
    return "\n\n".join(parts)


def html_to_markdown(html: str) -> str:
    return blocks(BeautifulSoup(html, "html.parser")) + "\n"
