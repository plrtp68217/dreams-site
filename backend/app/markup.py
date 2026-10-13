"""Scenario Markdown → HTML.

Ordinary Markdown (CommonMark + tables) plus a few scenario blocks:

    > **Клоун:** Ты заказала это сама.        dialogue line
    > *Громкая связь:* Касса закрыта.         announcement / sign (italic speaker)
    `ff_side_done`                            flag / variable

    ::: заметка Заголовок                     callout; also «нет-в-сценарии»
    текст
    :::
    ::: записка Подпись                       parchment note (line breaks are kept)
    ::: карточка Заголовок                    card (former quest / location)
    ::: вводка                                lead paragraph
    ::: характеристики                        «Термин: значение» per line
    ::: выбор                                 list; «(+)» right answer, «(-)» bad answer
    ::: этапы / ::: дневник                   items start with «#### Заголовок»
    ::: плакаты                               list of posters

Images in one paragraph form a gallery; ![подпись](/media/x.jpg "подпись под картинкой").
Raw HTML still works for the rare layouts that have no syntax.
"""
from __future__ import annotations

import re
import textwrap
from dataclasses import dataclass, field
from html import escape

from markdown_it import MarkdownIt

from .html_utils import carry_anchor_ids, ensure_anchor_ids, sanitize_html


def _flag(self, tokens, idx, options, env) -> str:
    return f'<span class="flag">{escape(tokens[idx].content)}</span>'


def _fence(self, tokens, idx, options, env) -> str:
    token = tokens[idx]
    if token.info.strip() == "mermaid":
        return f'<pre class="mermaid">{escape(token.content)}</pre>\n'
    return f"<pre><code>{escape(token.content)}</code></pre>\n"


def _parser(breaks: bool = False) -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": True, "breaks": breaks}).enable(["table", "strikethrough"])
    md.add_render_rule("code_inline", _flag)
    md.add_render_rule("fence", _fence)
    return md


_MD = _parser()
_MD_BREAKS = _parser(breaks=True)

# ---------- containers ----------

_OPEN = re.compile(r"^\s*:::\s*([\w-]+)[ \t]*(.*?)\s*$")
_CLOSE = re.compile(r"^\s*:::\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


@dataclass
class Block:
    name: str
    title: str
    children: list[str | Block] = field(default_factory=list)


def parse_blocks(source: str) -> list[str | Block]:
    """Split the source into text chunks and (nested) ::: containers. Code fences are left alone."""
    root = Block("", "")
    stack = [root]
    text: list[str] = []
    in_fence = None

    def flush() -> None:
        if text:
            stack[-1].children.append("\n".join(text))
            text.clear()

    for line in source.replace("\r\n", "\n").split("\n"):
        fence = _FENCE.match(line)
        if in_fence:
            text.append(line)
            if fence and fence.group(1) == in_fence:
                in_fence = None
            continue
        if fence:
            in_fence = fence.group(1)
            text.append(line)
            continue
        if (m := _OPEN.match(line)) is not None:
            flush()
            block = Block(m.group(1).lower(), m.group(2))
            stack[-1].children.append(block)
            stack.append(block)
        elif _CLOSE.match(line) and len(stack) > 1:
            flush()
            stack.pop()
        else:
            text.append(line)
    flush()
    return root.children


# ---------- text chunks ----------

# «> **Клоун:** текст», «> **Клоун**: текст», «> *Табличка:* текст»
_LINE = re.compile(r"^\s*>\s*(\*\*|\*)([^*\n]+?)(:?)\1(:?)\s*(.*)$")
_TABLE = re.compile(r"<table>.*?</table>", re.S)
_IMAGES_P = re.compile(r"<p>((?:\s*<img [^>]*>\s*)+)</p>")
_IMG = re.compile(r"<img [^>]*>")
_ATTR = re.compile(r'(\w+)="([^"]*)"')


def _inline(text: str) -> str:
    return _MD.renderInline(text.strip())


def _dialogue(chunk: str) -> str:
    """Turn dialogue lines into HTML blocks before the Markdown pass (each line stands alone)."""
    out: list[str] = []
    in_fence = None
    for line in chunk.split("\n"):
        fence = _FENCE.match(line)
        if in_fence or fence:
            if in_fence and fence and fence.group(1) == in_fence:
                in_fence = None
            elif not in_fence and fence:
                in_fence = fence.group(1)
            out.append(line)
            continue
        m = _LINE.match(line)
        if m and (m.group(3) or m.group(4)):
            ann = " ann" if m.group(1) == "*" else ""
            who = escape(m.group(2).strip())
            out += ["", f'<div class="line{ann}"><span class="who">{who}</span><q>{_inline(m.group(5))}</q></div>', ""]
        else:
            out.append(line)
    return "\n".join(out)


def _gallery(m: re.Match) -> str:
    figures = []
    for img in _IMG.findall(m.group(1)):
        attrs = dict(_ATTR.findall(img))
        caption = attrs.get("title", "")
        figures.append(
            f'<figure><img src="{attrs.get("src", "")}" alt="{attrs.get("alt", "")}" loading="lazy">'
            + (f"<figcaption>{caption}</figcaption>" if caption else "")
            + "</figure>"
        )
    return f'<div class="gallery">{"".join(figures)}</div>'


def _text(chunk: str, md: MarkdownIt = _MD) -> str:
    html = md.render(_dialogue(chunk))
    html = _TABLE.sub(lambda m: f'<div class="tbl-wrap">{m.group(0)}</div>', html)
    return _IMAGES_P.sub(_gallery, html)


# ---------- containers ----------

def _render(items: list[str | Block], md: MarkdownIt = _MD) -> str:
    return "".join(_text(it, md) if isinstance(it, str) else _container(it) for it in items)


def _split_items(children: list[str | Block]) -> list[tuple[str, list[str | Block]]]:
    """«#### Заголовок» starts a new item (steps, diary entries)."""
    items: list[tuple[str, list[str | Block]]] = []
    for child in children:
        if isinstance(child, Block):
            if not items:
                items.append(("", []))
            items[-1][1].append(child)
            continue
        current: list[str] = []
        for line in child.split("\n"):
            if (m := re.match(r"^\s*####\s+(.*)$", line)) is not None:
                if items and current:
                    items[-1][1].append("\n".join(current))
                elif current and any(s.strip() for s in current):
                    items.append(("", ["\n".join(current)]))
                current = []
                items.append((m.group(1).strip(), []))
            else:
                current.append(line)
        if current:
            if not items:
                items.append(("", []))
            items[-1][1].append("\n".join(current))
    return items


def _text_lines(children: list[str | Block]) -> list[str]:
    return [line for c in children if isinstance(c, str) for line in c.split("\n")]


_TERM = re.compile(r"^(?![-*+>\s]|\d+[.)])([^:]{1,80}?):(?:\s+(.*))?$")


def _dd(parts: list[str | Block]) -> str:
    texts = [p for p in parts if isinstance(p, str) and p.strip()]
    only_text = all(isinstance(p, str) for p in parts)
    if only_text and len(texts) == 1 and "\n" not in texts[0].strip():
        return _inline(texts[0])
    chunks: list[str | Block] = []
    for part in parts:
        if isinstance(part, str) and chunks and isinstance(chunks[-1], str):
            chunks[-1] += "\n" + part
        else:
            chunks.append(part)
    return _render([textwrap.dedent(c) if isinstance(c, str) else c for c in chunks])


def _spec(block: Block) -> str:
    """«Термин: значение» per line; indented lines and nested blocks continue the value."""
    pairs: list[tuple[str, list[str | Block]]] = []
    for child in block.children:
        if isinstance(child, Block):
            if not pairs:
                pairs.append(("", []))
            pairs[-1][1].append(child)
            continue
        for line in child.split("\n"):
            m = _TERM.match(line)
            if m:
                pairs.append((m.group(1), [m.group(2) or ""]))
            elif pairs:
                pairs[-1][1].append(line)
            elif line.strip():
                pairs.append(("", [line]))
    rows = "".join(f"<dt>{_inline(term)}</dt><dd>{_dd(value)}</dd>" for term, value in pairs)
    return f'<dl class="spec">{rows}</dl>'


def _choice(block: Block) -> str:
    items = []
    for line in _text_lines(block.children):
        m = re.match(r"^\s*[-*+]\s+(?:\((\+|-)\)\s*)?(.*)$", line)
        if not m:
            continue
        cls = {"+": ' class="ok"', "-": ' class="bad"'}.get(m.group(1) or "", "")
        items.append(f"<li{cls}>{_inline(m.group(2))}</li>")
    return f'<ul class="choice">{"".join(items)}</ul>'


def _container(block: Block) -> str:
    name, title = block.name, _inline(block.title) if block.title else ""
    if name in ("заметка", "нет-в-сценарии"):
        cls = "callout todo" if name == "нет-в-сценарии" else "callout"
        tag = title or ("Нет в сценарии" if name == "нет-в-сценарии" else "Заметка")
        return f'<div class="{cls}"><b class="tag">{tag}</b>{_render(block.children)}</div>'
    if name == "записка":
        return f'<div class="note"><span class="who">{title or "Записка"}</span>{_render(block.children, _MD_BREAKS)}</div>'
    if name == "карточка":
        return (f'<article class="quest"><header><h4>{title}</h4></header>'
                f'<div class="qbody">{_render(block.children)}</div></article>')
    if name == "вводка":
        return _render(block.children).replace("<p>", '<p class="lede">')
    if name == "характеристики":
        return _spec(block)
    if name == "выбор":
        return _choice(block)
    if name in ("этапы", "дневник"):
        items = _split_items(block.children)
        if name == "этапы":
            lis = "".join(f"<li>{f'<h4>{_inline(t)}</h4>' if t else ''}{_render(c)}</li>" for t, c in items)
            return f'<ol class="steps">{lis}</ol>'
        arts = "".join(f"<article>{f'<h4>{_inline(t)}</h4>' if t else ''}{_render(c)}</article>" for t, c in items)
        return f'<div class="diary">{arts}</div>'
    if name == "плакаты":
        return _render(block.children).replace("<ul>", '<ul class="posters">', 1)
    # unknown block: show it as a callout, so nothing written is lost
    label = escape(block.name) + (f" {title}" if title else "")
    return f'<div class="callout"><b class="tag">{label}</b>{_render(block.children)}</div>'


def render_markdown(source: str) -> str:
    """Scenario Markdown → HTML (not yet sanitized)."""
    return _render(parse_blocks(source))


def render_scenario(source: str, previous_html: str = "") -> str:
    """Markdown → the HTML stored and shown: sanitized, with stable hidden anchors for tasks.

    Places (lines, notes, headings, cards…) keep the ids they had in `previous_html` when their text matches."""
    html = sanitize_html(render_markdown(source))
    return ensure_anchor_ids(carry_anchor_ids(previous_html, html)) if previous_html else ensure_anchor_ids(html)
